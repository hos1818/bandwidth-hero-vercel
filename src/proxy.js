const axios = require('axios');
const { pick } = require('lodash');
const zlib = require('node:zlib');
const lzma = require('lzma-native');
const { ZstdCodec } = require('zstd-codec');
const shouldCompress = require('./shouldCompress');
const redirect = require('./redirect');
const compress = require('./compress');
const bypass = require('./bypass');
const copyHeaders = require('./copyHeaders');
const http2 = require('node:http2');
const https = require('node:https');
const { URL } = require('node:url');
const Bottleneck = require('bottleneck');
const cloudscraper = require('cloudscraper');


// Safely access SSL options with a fallback for older Node.js versions
const SSL_OP_NO_TLSv1 = https.constants?.SSL_OP_NO_TLSv1 || 0x04000000;
const SSL_OP_NO_TLSv1_1 = https.constants?.SSL_OP_NO_TLSv1_1 || 0x10000000;

// Compression formats based on client support
const compressionMethods = {
    gzip: (data) => zlib.gzipSync(data),
    br: (data) => zlib.brotliCompressSync(data),
    deflate: (data) => zlib.deflateSync(data)
};

// Helper for decompression based on encoding
async function decompress(data, encoding) {
    const decompressors = {
        gzip: () => zlib.promises.gunzip(data),
        br: () => zlib.promises.brotliDecompress(data),
        deflate: () => zlib.promises.inflate(data),
        lzma: () => new Promise((resolve, reject) => lzma.decompress(data, (result, error) => error ? reject(error) : resolve(result))),
        zstd: () => new Promise((resolve, reject) => {
            ZstdCodec.run(zstd => {
                try {
                    resolve(new zstd.Simple().decompress(data));
                } catch (error) {
                    reject(error);
                }
            });
        })
    };
    return decompressors[encoding] ? decompressors[encoding]() : data;
}

// Makes HTTP/2 requests
async function makeHttp2Request(config) {
    return new Promise((resolve, reject) => {
        const client = http2.connect(config.url.origin);
        const headers = {
            ':method': 'GET',
            ':path': config.url.pathname,
            ...pick(config.headers, ['cookie', 'dnt', 'referer']),
            'user-agent': config.headers['user-agent'],
        };

        const req = client.request(headers);
        let data = [];
        req.on('data', chunk => data.push(chunk));
        req.on('end', () => resolve(Buffer.concat(data)));
        req.on('error', err => reject(err));
        req.end();
    });
}

// Create a limiter with a maximum of 1 request every 2 seconds
const limiter = new Bottleneck({
    maxConcurrent: 5,  // Limit to 5 concurrent requests
    minTime: 2000      // Minimum time of 2 seconds between requests
});

async function makeRequest(config) {
    return limiter.schedule(() => axios(config));
}


// Caching logic (simple in-memory cache, could be replaced with Redis or similar)
const requestCache = new Map();

// Circuit breaker
const circuitBreaker = {
    failureThreshold: 5,
    resetTimeout: 60000,
    failureCount: 0,
    lastFailureTime: null,
    isOpen() {
        return this.failureCount >= this.failureThreshold && Date.now() - this.lastFailureTime < this.resetTimeout;
    },
    recordFailure() {
        this.failureCount++;
        this.lastFailureTime = Date.now();
    },
    reset() {
        this.failureCount = 0;
        this.lastFailureTime = null;
    }
};

// Safely handle decompression
function decompressBody(body, encoding) {
    switch (encoding) {
        case 'br':
            return zlib.brotliDecompressSync(body);
        case 'gzip':
            return zlib.gunzipSync(body);
        case 'deflate':
            return zlib.inflateSync(body);
        default:
            return body;  // No compression or unknown encoding
    }
}

// Enhanced cloudscraper handling function
async function makeCloudscraperRequest(config, retries = 3, redirectCount = 0) {
    const MAX_REDIRECTS = 5;
    const MAX_RETRIES = 3;

    const ciphers = [
        'ECDHE-ECDSA-AES128-GCM-SHA256',
        'ECDHE-RSA-AES128-GCM-SHA256',
        'ECDHE-ECDSA-AES256-GCM-SHA384',
        'ECDHE-RSA-AES256-GCM-SHA384',
        'DHE-RSA-AES128-GCM-SHA256',
        'DHE-RSA-AES256-GCM-SHA384'
    ].join(':');

    const agent = new https.Agent({
        ciphers,
        honorCipherOrder: true,
        secureOptions: https.constants.SSL_OP_NO_TLSv1 | https.constants.SSL_OP_NO_TLSv1_1,
        keepAlive: true,
    });

    // Exponential backoff with jitter
    const retryRequest = async (delay, retryAttempt) => {
        const jitter = Math.random() * 1000;
        const backoffTime = delay * Math.pow(2, retryAttempt) + jitter;
        console.warn(`Retrying in ${backoffTime.toFixed(0)}ms...`);
        return new Promise((resolve) => setTimeout(resolve, backoffTime))
            .then(() => makeCloudscraperRequest(config, retries - 1, redirectCount));
    };

    // Check circuit breaker
    if (circuitBreaker.isOpen()) {
        console.error('Circuit is open, aborting request.');
        throw new Error('Circuit breaker is open, aborting requests.');
    }

    // Caching logic: check cache first
    const cacheKey = config.url.href;
    if (requestCache.has(cacheKey)) {
        console.log('Serving response from cache');
        return requestCache.get(cacheKey);
    }

    return limiter.schedule(() => new Promise((resolve, reject) => {
        cloudscraper.get({
            uri: config.url.href,
            headers: config.headers,
            gzip: true,
            encoding: null,  // Raw buffer data
            agentOptions: {
                httpsAgent: agent,
                proxy: config.proxy || null,
            },
            timeout: config.timeout || 10000
        }, async (error, response, body) => {
            if (error) {
                circuitBreaker.recordFailure();  // Record failure for circuit breaker
                if (retries > 0) {
                    return resolve(await retryRequest(1000, MAX_RETRIES - retries));  // Retry with backoff
                }
                console.error(`Cloudscraper failed: ${error.message}`);
                return reject(new Error('Cloudscraper Request Failed'));
            }

            const { statusCode } = response;
            
            // Handle Cloudflare challenges
            if (response.headers['cf-mitigated']) {
                console.warn('Cloudflare challenge detected, retrying with cloudscraper...');
                return resolve(await retryRequest(2000, MAX_RETRIES - retries));
            }

            // Handle 403 Forbidden or Cloudflare retries
            if (statusCode === 403) {
                if (retries > 0) {
                    console.warn(`403 Forbidden. Retrying... Attempts left: ${retries}`);
                    return resolve(await retryRequest(2000, MAX_RETRIES - retries));
                }
                console.error('Cloudflare returned 403, maximum retries reached.');
                return reject(new Error('Cloudscraper Request Blocked by Cloudflare'));
            }

            // Handle redirects (302)
            if (statusCode === 302 && redirectCount < MAX_REDIRECTS) {
                const redirectUrl = response.headers.location;
                if (redirectUrl) {
                    console.info(`302 Redirected to: ${redirectUrl}`);
                    config.url = new URL(redirectUrl);  // Follow the redirect
                    return resolve(makeCloudscraperRequest(config, retries, redirectCount + 1));
                }
            }

            // Handle too many redirects
            if (redirectCount >= MAX_REDIRECTS) {
                return reject(new Error('Too many redirects, aborting request.'));
            }

            // Handle decompression
            let decompressedBody;
            try {
                const contentEncoding = response.headers['content-encoding'];
                decompressedBody = decompressBody(body, contentEncoding);
            } catch (decompressionError) {
                console.error('Decompression failed:', decompressionError);
                return reject(new Error('Decompression failed'));
            }

            // Cache the successful response
            requestCache.set(cacheKey, { headers: response.headers, data: decompressedBody });

            // Reset the circuit breaker on success
            circuitBreaker.reset();

            // Successful request
            resolve({ headers: response.headers, data: decompressedBody });
        });
    }));
}


// Proxy function to handle requests
async function proxy(req, res) {
    const config = {
        url: new URL(req.params.url),
        method: 'get',
        headers: {
            ...pick(req.headers, ['cookie', 'referer']),
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/*,*/*;q=0.8',
            'Accept-Encoding': 'gzip, deflate, br',  // Allow gzip, deflate, and Brotli compression
            'Cache-Control': 'no-cache',
            'DNT': '1',
            'x-forwarded-for': req.headers['x-forwarded-for'] || req.ip,
            'Connection': 'keep-alive',
        },
        timeout: 5000,
        maxRedirects: 5,
        responseType: 'arraybuffer',
        validateStatus: status => status < 500,
    };

    try {
        let originResponse;

        // First attempt regular request (either HTTP/1 or HTTP/2)
        if (config.url.protocol === 'http2:') {
            originResponse = await makeHttp2Request(config);
        } else {
            originResponse = await makeRequest(config); // Use the rate-limited request
        }

        // Check for Cloudflare status codes
        if (originResponse.status === 403 || originResponse.status === 503) {
            console.log('Cloudflare detected, retrying with cloudscraper...');
            originResponse = await makeCloudscraperRequest(config); // Fallback to cloudscraper
        }

        const { headers, data } = originResponse;
        const contentEncoding = headers['content-encoding'];
        let decompressedData = contentEncoding ? await decompress(data, contentEncoding) : data;

        // Validate decompressedData
        if (!decompressedData) {
            throw new Error('Decompression failed or no data received');
        }

        // Compression Optimization: Choose the best compression method based on Accept-Encoding header
        const acceptedEncodings = req.headers['accept-encoding'] || '';
        if (shouldCompress(req, decompressedData)) {
            if (acceptedEncodings.includes('br')) {
                decompressedData = compressionMethods.br(decompressedData);
                res.setHeader('Content-Encoding', 'br');
            } else if (acceptedEncodings.includes('gzip')) {
                decompressedData = compressionMethods.gzip(decompressedData);
                res.setHeader('Content-Encoding', 'gzip');
            } else if (acceptedEncodings.includes('deflate')) {
                decompressedData = compressionMethods.deflate(decompressedData);
                res.setHeader('Content-Encoding', 'deflate');
            } else {
                res.setHeader('Content-Encoding', 'identity');
            }
        }


        // Copy headers and send response
        copyHeaders(originResponse, res, {
            additionalExcludedHeaders: ['x-custom-header'],
            transformFunction: (key, value) => key === 'x-transform-header' ? value.toUpperCase() : value,
            overwriteExisting: false,
            mergeArrays: true
        });

        // Security Enhancement: Add HTTPS enforcement
        if (req.headers['x-forwarded-proto'] !== 'https') {
            res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
            res.redirect(301, `https://${req.headers.host}${req.url}`);
            return;
        }

        // Security Enhancement: Content Security Policy
        res.setHeader('Content-Security-Policy', "default-src 'self'; img-src *; media-src *; script-src 'none'; object-src 'none';");

        // Set additional headers
        res.set('X-Proxy', 'Cloudflare Worker');
        res.set('Access-Control-Allow-Origin', '*'); // Allow CORS if needed

        res.setHeader('content-encoding', 'identity');
        req.params.originType = response.headers['content-type'] || '';
        req.params.originSize = decompressedData.length;

        if (shouldCompress(req, decompressedData)) {
            compress(req, res, decompressedData);
        } else {
            bypass(req, res, decompressedData);
        }
    } catch (error) {
        if (error.response) {
            console.error(`Server responded with status: ${error.response.status}`);
        } else if (error.request) {
            console.error('No response received:', error.request);
        } else {
            console.error('Error setting up request:', error.message);
        }
        redirect(req, res);
    }
}

module.exports = proxy;

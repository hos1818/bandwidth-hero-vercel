const axios = require('axios');
const { pick } = require('lodash');
const zlib = require('node:zlib');
const lzma = require('lzma-native');
const { ZstdCodec } = require('zstd-codec');
const Bottleneck = require('bottleneck');
const cloudscraper = require('cloudscraper');
const https = require('node:https');
const { URL } = require('node:url');
const shouldCompress = require('./shouldCompress');
const redirect = require('./redirect');
const compress = require('./compress');
const bypass = require('./bypass');
const copyHeaders = require('./copyHeaders');
const http2 = require('node:http2');


// SSL options for legacy support
const SSL_OP_NO_TLSv1 = https.constants?.SSL_OP_NO_TLSv1 || 0x04000000;
const SSL_OP_NO_TLSv1_1 = https.constants?.SSL_OP_NO_TLSv1_1 || 0x10000000;

// Compression methods
const compressionMethods = {
    gzip: (data) => zlib.gzipSync(data),
    br: (data) => zlib.brotliCompressSync(data),
    deflate: (data) => zlib.deflateSync(data),
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

// Rate limiter for requests
const limiter = new Bottleneck({ maxConcurrent: 5, minTime: 2000 });

// Make request with axios
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

// Makes cloudscraper requests with retry and circuit breaker
async function makeCloudscraperRequest(config, retries = 3, redirectCount = 0) {
    const MAX_REDIRECTS = 5;
    if (circuitBreaker.isOpen()) throw new Error('Circuit breaker is open, aborting requests.');

    const cacheKey = config.url.href;
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
        secureOptions: SSL_OP_NO_TLSv1 | SSL_OP_NO_TLSv1_1,
        keepAlive: true,
    });

    if (requestCache.has(cacheKey)) {
        console.log('Serving response from cache');
        return requestCache.get(cacheKey);
    }

    return limiter.schedule(() => new Promise((resolve, reject) => {
        cloudscraper.get({
            uri: config.url.href,
            headers: config.headers,
            gzip: true,
            encoding: null,
            agentOptions: { httpsAgent: agent },
            timeout: config.timeout || 10000,
        }, async (error, response, body) => {
            if (error) {
                circuitBreaker.recordFailure();
                return retries > 0 ? resolve(await makeCloudscraperRequest(config, retries - 1, redirectCount)) : reject(new Error('Cloudscraper request failed'));
            }

            if (response.statusCode === 302 && redirectCount < MAX_REDIRECTS) {
                config.url = new URL(response.headers.location);
                return resolve(makeCloudscraperRequest(config, retries, redirectCount + 1));
            }

            if (redirectCount >= MAX_REDIRECTS) return reject(new Error('Too many redirects'));

            const contentEncoding = response.headers['content-encoding'];
            const decompressedBody = await decompress(body, contentEncoding);
            requestCache.set(cacheKey, { headers: response.headers, data: decompressedBody });
            circuitBreaker.reset();

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
            ...pick(req.headers, ['cookie', 'referer', 'user-agent']),
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/*,*/*;q=0.8',
            'Accept-Encoding': 'gzip, deflate, br',
            'Cache-Control': 'no-cache',
            'DNT': '1',
            'x-forwarded-for': req.ip,
        },
        timeout: 5000,
        maxRedirects: 5,
        responseType: 'arraybuffer',
    };

    try {
        let originResponse;

        // First attempt regular request (either HTTP/1 or HTTP/2)
        if (config.url.protocol === 'http2:') {
            originResponse = await makeHttp2Request(config);
        } else {
            originResponse = await makeRequest(config); // Use the rate-limited axios-based request
        }

        // Check for Cloudflare status codes
        if (originResponse.status === 403 || originResponse.status === 503) {
            console.log('Cloudflare detected, retrying with cloudscraper...');
            originResponse = await makeCloudscraperRequest(config); // Fallback to cloudscraper
        }

        const { headers, data } = originResponse;
        const contentEncoding = headers['content-encoding'];
        const decompressedData = await decompress(data, contentEncoding);

        // Compression Optimization: Choose the best compression method based on Accept-Encoding header
        const acceptedEncodings = req.headers['accept-encoding'] || '';
        if (shouldCompress(req, decompressedData)) {
            if (acceptedEncodings.includes('br')) {
                res.setHeader('Content-Encoding', 'br');
                res.send(compressionMethods.br(decompressedData));
            } else if (acceptedEncodings.includes('gzip')) {
                res.setHeader('Content-Encoding', 'gzip');
                res.send(compressionMethods.gzip(decompressedData));
            } else if (acceptedEncodings.includes('deflate')) {
                res.setHeader('Content-Encoding', 'deflate');
                res.send(compressionMethods.deflate(decompressedData));
            } else {
                res.setHeader('Content-Encoding', 'identity');
                res.send(decompressedData);
            }
        } else {
            bypass(req, res, decompressedData);
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
        req.params.originType = headers['content-type'] || '';
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

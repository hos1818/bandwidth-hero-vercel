const got = require('got');
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

// Compression formats based on client support
const compressionMethods = {
    gzip: (data) => zlib.gzipSync(data),
    br: (data) => zlib.brotliCompressSync(data),
    deflate: (data) => zlib.deflateSync(data)
};

// Decompression utility function
async function decompress(data, encoding) {
    const decompressors = {
        gzip: () => zlib.promises.gunzip(data),
        br: () => zlib.promises.brotliDecompress(data),
        deflate: () => zlib.promises.inflate(data),
        lzma: () => new Promise((resolve, reject) => {
            lzma.decompress(data, (result, error) => error ? reject(error) : resolve(result));
        }),
        lzma2: () => new Promise((resolve, reject) => {
            lzma.decompress(data, (result, error) => error ? reject(error) : resolve(result));
        }),
        zstd: () => new Promise((resolve, reject) => {
            ZstdCodec.run(zstd => {
                try {
                    const simple = new zstd.Simple();
                    resolve(simple.decompress(data));
                } catch (error) {
                    reject(error);
                }
            });
        }),
    };

    if (decompressors[encoding]) {
        return decompressors[encoding]();
    } else {
        console.warn(`Unknown content-encoding: ${encoding}`);
        return data;
    }
}

// Create a limiter with a maximum of 1 request every 2 seconds
const limiter = new Bottleneck({
    minTime: 2000, // Minimum time between requests in milliseconds
});

// HTTP/2 request handling
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

        req.on('response', (headers) => {
            data = []; // Clear data on each new response
        });
        req.on('data', chunk => data.push(chunk));
        req.on('end', () => resolve(Buffer.concat(data)));
        req.on('error', err => reject(err));

        req.end();
    });
}

// Make HTTP request using got with rate limiting and retry
async function makeRequest(config) {
    return limiter.schedule(() => 
        got(config.url.href, {
            headers: config.headers,
            timeout: config.timeout || 5000,
            decompress: true,  // Auto-handle gzip, br, deflate
            responseType: 'buffer',  // Use 'buffer' to handle binary data
            maxRedirects: config.maxRedirects || 5,
            retry: {
                limit: 3,  // Retry on network errors
                methods: ['GET', 'POST'], // Customize retry for specific methods
                statusCodes: [408, 502, 503, 504], // Retry for these status codes
                calculateDelay: ({ attemptCount }) => Math.min(attemptCount * 1000, 5000) // Exponential backoff
            },
            https: {
                rejectUnauthorized: false // Ignore SSL verification for testing (remove for production)
            }
        })
    );
}

// Enhanced cloudscraper handling function with got
async function makeCloudscraperRequest(config, retries = 3, redirectCount = 0) {
    const MAX_REDIRECTS = 5;  // Limit the number of redirects to prevent infinite loops

    const agent = new https.Agent({
        keepAlive: true,
        honorCipherOrder: true,
        ciphers: [
            'ECDHE-ECDSA-AES128-GCM-SHA256',
            'ECDHE-RSA-AES128-GCM-SHA256',
            'ECDHE-ECDSA-AES256-GCM-SHA384',
            'ECDHE-RSA-AES256-GCM-SHA384',
            'DHE-RSA-AES128-GCM-SHA256',
            'DHE-RSA-AES256-GCM-SHA384'
        ].join(':'),
        secureOptions: https.constants.SSL_OP_NO_TLSv1 | https.constants.SSL_OP_NO_TLSv1_1,
    });

    try {
        const response = await got(config.url.href, {
            headers: config.headers,
            agent: { https: agent },
            decompress: true,
            responseType: 'buffer',  // Handle raw binary data
            retry: { limit: retries },
            maxRedirects: MAX_REDIRECTS,
            followRedirect: true,
        });

        return { headers: response.headers, data: response.rawBody };
    } catch (error) {
        if (retries > 0) {
            console.warn(`Retrying Cloudflare request. Retries left: ${retries}`);
            return makeCloudscraperRequest(config, retries - 1, redirectCount);
        }
        throw new Error('Cloudscraper request failed after maximum retries.');
    }
}

// Proxy function to handle requests
async function proxy(req, res) {
    const config = {
        url: new URL(req.params.url),
        headers: {
            ...pick(req.headers, ['cookie', 'referer']),
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/*,*/*;q=0.8',
            'Accept-Encoding': 'gzip, deflate, br',
            'Cache-Control': 'no-cache',
            'DNT': '1',
            'x-forwarded-for': req.headers['x-forwarded-for'] || req.ip,
            'Connection': 'keep-alive',
        },
        timeout: 5000,
        maxRedirects: 5,
    };

    try {
        let originResponse;

        // First attempt regular request (either HTTP/1 or HTTP/2)
        if (config.url.protocol === 'http2:') {
            originResponse = await makeHttp2Request(config);
        } else {
            originResponse = await makeRequest(config);
        }

        const contentEncoding = originResponse.headers['content-encoding'];
        let decompressedData = contentEncoding ? await decompress(originResponse.data, contentEncoding) : originResponse.data;

        // Choose the best compression method based on Accept-Encoding header
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

        res.setHeader('Content-Security-Policy', "default-src 'self'; img-src *; media-src *; script-src 'none'; object-src 'none';");

        req.params.originType = originResponse.headers['content-type'] || '';
        req.params.originSize = decompressedData.length;

        if (shouldCompress(req, decompressedData)) {
            compress(req, res, decompressedData);
        } else {
            bypass(req, res, decompressedData);
        }
    } catch (error) {
        console.error(`Error processing request: ${error.message}`);
        redirect(req, res);
    }
}

module.exports = proxy;

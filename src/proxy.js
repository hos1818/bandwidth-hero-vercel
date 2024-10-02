const got = require('got'); // Replace axios with got
const { pick } = require('lodash');
const zlib = require('node:zlib');
const lzma = require('lzma-native');
const { ZstdCodec } = require('zstd-codec');
const shouldCompress = require('./shouldCompress');
const redirect = require('./redirect');
const compress = require('./compress');
const bypass = require('./bypass');
const Bottleneck = require('bottleneck');
const cloudscraper = require('cloudscraper');

// Decompression utility function (unchanged)
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

// HTTP/2 request handling using Got (Got natively supports HTTP/2)
async function makeHttp2Request(config) {
    try {
        const response = await got(config.url.href, {
            method: 'GET',
            headers: {
                ...pick(config.headers, ['cookie', 'dnt', 'referer']),
                'user-agent': config.headers['user-agent'],
            },
            http2: true, // Enable HTTP/2 in Got
            responseType: 'buffer', // Get response as Buffer (similar to arraybuffer in axios)
            decompress: false, // Disable Got's automatic decompression
        });
        return { headers: response.headers, data: response.body };
    } catch (error) {
        throw error;
    }
}

// Create a limiter (unchanged)
const limiter = new Bottleneck({
    minTime: 2000, // Minimum time between requests in milliseconds
});

// Got-based request handling with limiter
async function makeRequest(config) {
    return limiter.schedule(() =>
        got(config.url.href, {
            method: config.method,
            headers: config.headers,
            timeout: { request: config.timeout },
            responseType: 'buffer', // Similar to axios' `responseType: 'arraybuffer'`
            followRedirect: config.maxRedirects || 5, // Follow redirects
            decompress: false, // Disable automatic decompression (you handle it manually)
        })
    );
}

// Enhanced cloudscraper handling function (unchanged)
async function makeCloudscraperRequest(config) {
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

    return new Promise((resolve, reject) => {
        cloudscraper.get({
            uri: config.url.href,
            headers: config.headers,
            gzip: true,
            encoding: null, // Get the raw buffer data
            cloudflareTimeout: 5000,
            decodeEmails: true,
            agentOptions: { httpsAgent: agent },
            timeout: config.timeout || 10000,
        }, (error, response, body) => {
            if (error) {
                console.error(`Cloudscraper failed: ${error.message}`);
                return reject(error);
            }
            resolve({ headers: response.headers, data: body });
        });
    });
}

// Proxy function to handle requests using Got
async function proxy(req, res) {
    const config = {
        url: new URL(req.params.url),
        method: 'get',
        headers: {
            ...pick(req.headers, ['cookie', 'referer']),
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/*,*/*;q=0.8',
            'Accept-Encoding': 'gzip, deflate, br',
            'Cache-Control': 'no-cache',
            'DNT': '1',
            'x-forwarded-for': req.headers['x-forwarded-for'] || req.ip,
            'Connection': 'keep-alive',
            'Pragma': 'no-cache',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'same-origin',
            'Sec-Fetch-User': '?1',
            via: '2.0 bandwidth-hero',
        },
        timeout: 5000,
        maxRedirects: 5,
    };

    try {
        let originResponse;

        if (config.url.protocol === 'http2:') {
            originResponse = await makeHttp2Request(config);
        } else {
            originResponse = await makeRequest(config); // Use Got for rate-limited request
        }

        const { headers, data } = originResponse;
        const contentEncoding = headers['content-encoding'];
        let decompressedData = contentEncoding ? await decompress(data, contentEncoding) : data;

        copyHeaders(originResponse, res);

        res.set('X-Proxy', 'Cloudflare Worker');
        res.set('Access-Control-Allow-Origin', '*');

        res.setHeader('content-encoding', 'identity');
        req.params.originType = headers['content-type'] || '';
        req.params.originSize = decompressedData.length;

        if (shouldCompress(req, decompressedData)) {
            compress(req, res, decompressedData);
        } else {
            bypass(req, res, decompressedData);
        }
    } catch (error) {
        console.error(`Error during proxying: ${error.message}`);
        redirect(req, res);
    }
}

module.exports = proxy;

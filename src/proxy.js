const axios = require('axios');
const pick = require('lodash').pick;
const zlib = require('node:zlib');
const lzma = require('lzma-native');
const ZstdCodec = require('zstd-codec').ZstdCodec;
const shouldCompress = require('./shouldCompress');
const redirect = require('./redirect');
const compress = require('./compress');
const bypass = require('./bypass');
const copyHeaders = require('./copyHeaders');
const http2 = require('node:http2');

// Decompression utility function
async function decompress(data, encoding) {
    switch (encoding) {
        case 'gzip':
            return zlib.promises.gunzip(data);
        case 'br':
            return zlib.promises.brotliDecompress(data);
        case 'deflate':
            return zlib.promises.inflate(data);
        case 'lzma':
        case 'lzma2':
            return new Promise((resolve, reject) => {
                lzma.decompress(data, (result, error) => {
                    if (error) return reject(error);
                    resolve(result);
                });
            });
        case 'zstd':
            return new Promise((resolve, reject) => {
                ZstdCodec.run(zstd => {
                    try {
                        const simple = new zstd.Simple();
                        resolve(simple.decompress(data));
                    } catch (error) {
                        reject(error);
                    }
                });
            });
        default:
            console.warn(`Unknown content-encoding: ${encoding}`);
            return data;
    }
}

async function makeHttp2Request(config) {
    return new Promise((resolve, reject) => {
        const client = http2.connect(config.url);

        const headers = {
            ':method': 'GET',
            ':path': config.url.pathname,
            ...pick(config.headers, ['cookie', 'dnt', 'referer']),
            'user-agent': config.headers['user-agent'],
        };

        const req = client.request(headers);

        let data = [];

        req.on('response', (headers, flags) => {
            // Collect response headers
            resolve({ headers, flags });
        });

        req.on('data', chunk => {
            data.push(chunk);
        });

        req.on('end', () => {
            client.close();
            resolve(Buffer.concat(data));
        });

        req.on('error', err => {
            client.close();
            reject(err);
        });

        req.end();
    });
}

async function proxy(req, res) {
    const config = {
        url: new URL(req.params.url),
        method: 'get',
        headers: {
            ...pick(req.headers, ['cookie', 'dnt', 'referer']),
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; rv:121.0) Gecko/20100101 Firefox/121.0',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9',
            'Accept-Language': 'en-US,en;q=0.9',
            'Connection': 'keep-alive',
            'Accept-Encoding': 'gzip, deflate, br, lzma, lzma2, zstd',
            'Upgrade-Insecure-Requests': '1',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'DNT': '1',
            'x-forwarded-for': req.headers['x-forwarded-for'] || req.ip,
            via: '2.0 bandwidth-hero',
        },
        timeout: 10000,
        maxRedirects: 5,
        responseType: 'arraybuffer',
        validateStatus: status => status < 500,
    };

    try {
        let origin;

        if (config.url.protocol === 'http2:') {
            // Handle HTTP/2 request using the node:http2 module
            const response = await makeHttp2Request(config);
            origin = {
                headers: response.headers,
                data: response.data,
            };
        } else {
            // Fallback to axios for non-HTTP/2 requests
            origin = await axios(config);
        }

        // Copy relevant headers from origin to response
        copyHeaders(origin, res);

        // Decompress data based on content-encoding, if necessary
        const contentEncoding = origin.headers['content-encoding'];
        let data = origin.data;
        if (contentEncoding) {
            data = await decompress(data, contentEncoding);
        }

        // Set required response headers and other parameters
        res.setHeader('content-encoding', 'identity');
        req.params.originType = origin.headers['content-type'] || '';
        req.params.originSize = data.length;

        // Decide whether to compress or bypass
        if (shouldCompress(req, data)) {
            compress(req, res, data);
        } else {
            bypass(req, res, data);
        }
    } catch (error) {
        if (error.response) {
            console.error('Server responded with status:', error.response.status);
        } else if (error.request) {
            console.error('No response received:', error.request);
        } else {
            console.error('Error setting up request:', error.message);
        }
        redirect(req, res); // Handle the error by redirecting
    }
}

module.exports = proxy;

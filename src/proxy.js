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

// Cloudflare-specific status codes to handle
const CLOUDFLARE_STATUS_CODES = [403, 503];

// Centralized decompression utility
async function decompress(data, encoding) {
    try {
        switch (encoding) {
            case 'gzip':
                return await zlib.promises.gunzip(data);
            case 'br':
                return await zlib.promises.brotliDecompress(data);
            case 'deflate':
                return await zlib.promises.inflate(data);
            case 'lzma':
            case 'lzma2':
                return await new Promise((resolve, reject) => {
                    lzma.decompress(data, (result, error) => error ? reject(error) : resolve(result));
                });
            case 'zstd':
                return await new Promise((resolve, reject) => {
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
    } catch (error) {
        console.error(`Decompression failed for encoding ${encoding}:`, error);
        return data;
    }
}

// HTTP/2 request handling with error handling
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

        req.on('response', (headers, flags) => {
            req.on('data', chunk => data.push(chunk));
            req.on('end', () => {
                client.close();
                resolve({ headers, flags, data: Buffer.concat(data) });
            });
        });

        req.on('error', err => {
            client.close();
            reject(err);
        });

        req.end();
    });
}

// Proxy function to handle requests
async function proxy(req, res) {
    const config = {
        url: new URL(req.params.url),
        method: 'get',
        headers: {
            ...pick(req.headers, ['cookie', 'dnt', 'referer']),
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; rv:121.0) Gecko/20100101 Firefox/121.0',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/*,*/*;q=0.8',
            'Accept-Encoding': 'gzip, deflate, br, lzma, lzma2, zstd',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'DNT': '1',
            'x-forwarded-for': req.headers['x-forwarded-for'] || req.ip,
            via: '2.0 bandwidth-hero',
        },
        timeout: 10000,
        maxRedirects: 5,
        responseType: 'arraybuffer',
    };

    try {
        let originResponse;
        if (config.url.protocol === 'http2:') {
            originResponse = await makeHttp2Request(config);
        } else {
            originResponse = await axios(config);
        }

        if (!originResponse) {
            console.error("Origin response is empty");
            return redirect(req, res);
        }

        const { headers, data, status } = originResponse;

        if (CLOUDFLARE_STATUS_CODES.includes(status)) {
            console.log(`Bypassing due to Cloudflare status: ${status}`);
            return bypass(req, res, data);
        }

        const contentEncoding = headers['content-encoding'];
        const decompressedData = contentEncoding ? await decompress(data, contentEncoding) : data;

        copyHeaders(originResponse, res, [], transformHeader);
        res.setHeader('content-encoding', 'identity');
        req.params.originType = headers['content-type'] || '';
        req.params.originSize = decompressedData.length;

        if (shouldCompress(req, decompressedData)) {
            compress(req, res, decompressedData);
        } else {
            bypass(req, res, decompressedData);
        }
    } catch (error) {
        console.error(`Request handling failed: ${error.message}`);
        redirect(req, res);
    }
}

module.exports = proxy;

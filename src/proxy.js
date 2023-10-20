const axios = require('axios');
const pick = require('lodash').pick;
const zlib = require('zlib');
const shouldCompress = require('./shouldCompress');
const redirect = require('./redirect');
const compress = require('./compress');
const bypass = require('./bypass');
const copyHeaders = require('./copyHeaders');

async function proxy(req, res) {
    const config = {
        url: req.params.url,
        method: 'get',
        headers: {
            ...pick(req.headers, ['cookie', 'dnt', 'referer']),
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9',
            'Accept-Language': 'en-US,en;q=0.9',
            'Connection': 'keep-alive',
            'Accept-Encoding': 'gzip, deflate, br',
            'Upgrade-Insecure-Requests': '1',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'DNT': '1',
            'x-forwarded-for': req.headers['x-forwarded-for'] || req.ip,
            via: '1.1 bandwidth-hero'
        },
        timeout: 10000,
        maxRedirects: 5,
        responseType: 'arraybuffer',
        validateStatus: status => status < 500,
        transformResponse: [(data, headers) => {
            if (headers['content-encoding'] === 'gzip') {
                return zlib.gunzipSync(data);
            }
            return data;
        }],
    };

    try {
        const origin = await axios(config);
        
        copyHeaders(origin, res);
        res.setHeader('content-encoding', 'identity');
        req.params.originType = origin.headers['content-type'] || '';
        req.params.originSize = origin.data.length;

        const contentEncoding = origin.headers['content-encoding'];
        if (contentEncoding) {
            switch (contentEncoding) {
                case 'gzip':
                    origin.data = await gunzip(origin.data);
                    break;
                case 'br':
                    origin.data = await brotliDecompress(origin.data);
                    break;
                case 'deflate':
                    origin.data = await inflate(origin.data); // Corrected to "inflate" for clarity
                    break;
                default:
                    console.warn(`Unknown content-encoding: ${contentEncoding}`);
            }
        }

        if (shouldCompress(req, origin.data)) {
            compress(req, res, origin.data);
        } else {
            bypass(req, res, origin.data);
        }
    } catch (error) {
        redirect(req, res);
    }
}

// For gzip decompression
function gunzip(data) {
    return new Promise((resolve, reject) => {
        zlib.gunzip(data, (error, decompressed) => {
            if (error) {
                reject(error);
                return;
            }
            resolve(decompressed);
        });
    });
}

// For Brotli decompression
function brotliDecompress(data) {
    return new Promise((resolve, reject) => {
        zlib.brotliDecompress(data, (error, decompressed) => { // Using built-in Brotli support in zlib
            if (error) {
                reject(error);
                return;
            }
            resolve(decompressed);
        });
    });
}

// For deflate decompression (actually "inflate")
function inflate(data) {
    return new Promise((resolve, reject) => {
        zlib.inflate(data, (error, decompressed) => {
            if (error) {
                reject(error);
                return;
            }
            resolve(decompressed);
        });
    });
}


module.exports = proxy;

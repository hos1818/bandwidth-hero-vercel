import got from 'got';
import http2wrapper from 'http2-wrapper';
import zlib from 'zlib';
import { promisify } from 'util';
import lzma from 'lzma-native';
import { ZstdCodec } from 'zstd-codec';
import shouldCompress from './shouldCompress.js';
import redirect from './redirect.js';
import compress from './compress.js';
import bypass from './bypass.js';
import copyHeaders from './copyHeaders.js';


// Cloudflare-specific status codes to handle
const CLOUDFLARE_STATUS_CODES = [403, 503];

// Promisified zlib functions for compatibility across Node.js versions
const gunzip = promisify(zlib.gunzip);
const inflate = promisify(zlib.inflate);
const brotliDecompress = zlib.brotliDecompress ? promisify(zlib.brotliDecompress) : null;

// Custom implementation of lodash's `pick`
function pick(obj, keys) {
    return keys.reduce((acc, key) => {
        if (obj && Object.prototype.hasOwnProperty.call(obj, key)) {
            acc[key] = obj[key];
        }
        return acc;
    }, {});
}

// Centralized decompression utility
async function decompress(data, encoding) {
    const decompressors = {
        gzip: () => gunzip(data),
        br: () => brotliDecompress ? brotliDecompress(data) : Promise.reject(new Error('Brotli not supported in this Node.js version')),
        deflate: () => inflate(data),
        lzma: () => promisify(lzma.decompress)(data),
        lzma2: () => promisify(lzma.decompress)(data),
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
        try {
            return await decompressors[encoding]();
        } catch (error) {
            console.error(`Decompression failed for encoding ${encoding}:`, error);
            return data; // Return original data if decompression fails
        }
    } else {
        console.warn(`Unknown content-encoding: ${encoding}`);
        return data;
    }
}

// Proxy function to handle requests using got with HTTP/2 support
async function proxy(req, res) {
    const config = {
        headers: {
            ...pick(req.headers, ['cookie', 'dnt', 'referer']), // Using custom `pick` function
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:91.0) Gecko/20100101 Firefox/91.0',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate, br',
            'Upgrade-Insecure-Requests': '1',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'x-forwarded-for': req.headers['x-forwarded-for'] || req.ip,
            //via: '2.0 bandwidth-hero',
        },
        timeout: { request: 10000 },
        maxRedirects: 5,
        responseType: 'buffer',
        method: 'GET',
        decompress: false, // handle decompression manually
        http2: true,  // Enable HTTP/2
        request: http2wrapper.auto
    };
    try {
        const gotResponse = await got(req.params.url, config);
        const originResponse = {
            data: gotResponse.rawBody,
            headers: gotResponse.headers,
            status: gotResponse.statusCode,
        };

        if (!originResponse) {
            console.error("Origin response is empty");
            redirect(req, res);
            return;
        }
        const { headers, data, status } = originResponse;

        // Check for Cloudflare-related status codes before decompression
        if (CLOUDFLARE_STATUS_CODES.includes(status)) {
            console.log(`Bypassing due to Cloudflare status: ${status}`);
            bypass(req, res, data);
            return;
        }

        const contentEncoding = headers['content-encoding'];
        const decompressedData = contentEncoding ? await decompress(data, contentEncoding) : data;
        copyHeaders(originResponse, res);
        res.setHeader('content-encoding', 'identity');

        const contentType = headers['content-type'] || detectContentTypeFromBuffer(decompressedData);
        req.params.originType = contentType;
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

function detectContentTypeFromBuffer(buffer) {
    if (buffer.slice(0, 4).toString('hex') === '89504e47') return 'image/png';
    if (buffer.slice(0, 3).toString('hex') === 'ffd8ff') return 'image/jpeg';
    return 'application/octet-stream'; // Default fallback
}

export default proxy;

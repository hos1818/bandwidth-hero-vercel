import got from 'got';
import zlib from 'zlib';
import { promisify } from 'util';
import shouldCompress from './shouldCompress.js';
import redirect from './redirect.js';
import compress from './compress.js';
import bypass from './bypass.js';
import copyHeaders from './copyHeaders.js';
import http2wrapper from 'http2-wrapper';

const CLOUDFLARE_STATUS_CODES = [403, 503];

// Promisified zlib functions
const gunzip = promisify(zlib.gunzip);
const inflate = promisify(zlib.inflate);
const brotliDecompress = zlib.brotliDecompress ? promisify(zlib.brotliDecompress) : null;

/**
 * Picks specific keys from an object
 */
function pick(obj, keys) {
    if (!obj) return {};
    return keys.reduce((acc, key) => {
        if (Object.prototype.hasOwnProperty.call(obj, key)) acc[key] = obj[key];
        return acc;
    }, {});
}

/**
 * Decompress buffer based on content-encoding
 */
async function decompress(data, encoding) {
    if (!data || !encoding) return data;

    const decompressors = {
        gzip: () => gunzip(data),
        br: () => brotliDecompress ? brotliDecompress(data) : Promise.reject(new Error('Brotli not supported')),
        deflate: () => inflate(data),
    };

    const decompressor = decompressors[encoding];
    if (!decompressor) {
        console.warn(`Unknown content-encoding: ${encoding}`);
        return data;
    }

    try {
        return await decompressor();
    } catch (error) {
        console.error(`Decompression failed for encoding ${encoding}:`, error);
        return data; // Fallback to original buffer
    }
}

/**
 * Detects basic content type from buffer signatures
 */
function detectContentTypeFromBuffer(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 4) return 'application/octet-stream';
    const hexSig = buffer.slice(0, 4).toString('hex');
    if (hexSig.startsWith('89504e47')) return 'image/png';
    if (hexSig.startsWith('ffd8ff')) return 'image/jpeg';
    return 'application/octet-stream';
}

/**
 * Main proxy function
 */
async function proxy(req, res) {
    if (!req?.params?.url) {
        console.error('Missing target URL');
        return res.status(400).json({ error: 'Missing URL parameter' });
    }

    const config = {
        headers: {
            ...pick(req.headers, ['cookie', 'dnt', 'referer']),
            'user-agent': req.headers['user-agent'] || 'Mozilla/5.0',
            'accept': req.headers['accept'] || 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'accept-language': req.headers['accept-language'] || 'en-US,en;q=0.5',
            'accept-encoding': 'gzip, deflate, br',
            'upgrade-insecure-requests': '1',
            'cache-control': 'no-cache, no-store, must-revalidate',
            'pragma': 'no-cache',
            'x-forwarded-for': req.headers['x-forwarded-for'] || req.ip,
        },
        timeout: { request: 10000 },
        maxRedirects: 5,
        responseType: 'buffer',
        method: 'GET',
        decompress: false, // Manual handling
        http2: true,
        request: http2wrapper.auto,
        retry: {
            limit: 3,
            methods: ['GET'],
            statusCodes: [408, 429, 500, 502, 503, 504],
            errorCodes: ['ETIMEDOUT', 'ECONNRESET', 'EADDRINUSE', 'ECONNREFUSED'],
        },
    };

    try {
        const { rawBody, headers, statusCode } = await got(req.params.url, config);

        // Handle Cloudflare challenge pages early
        if (CLOUDFLARE_STATUS_CODES.includes(statusCode)) {
            console.warn(`Cloudflare status ${statusCode}, bypassing`);
            return bypass(req, res, rawBody);
        }

        const contentEncoding = headers['content-encoding'];
        const decompressedData = await decompress(rawBody, contentEncoding);

        copyHeaders({ headers, status: statusCode }, res);
        res.setHeader('content-encoding', 'identity');

        req.params.originType = headers['content-type'] || detectContentTypeFromBuffer(decompressedData);
        req.params.originSize = decompressedData.length;

        if (shouldCompress(req, decompressedData)) {
            return compress(req, res, decompressedData);
        }
        return bypass(req, res, decompressedData);

    } catch (error) {
        console.error(`Proxy request failed: ${error.message}`, error);
        return redirect(req, res);
    }
}

export default proxy;

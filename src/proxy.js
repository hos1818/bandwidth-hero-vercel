import got from 'got';
import zlib from 'zlib';
import { promisify } from 'util';
import shouldCompress from './shouldCompress.js';
import redirect from './redirect.js';
import compress from './compress.js';
import bypass from './bypass.js';
import copyHeaders from './copyHeaders.js';
import http2wrapper from 'http2-wrapper';

// Constants
const CLOUDFLARE_STATUS_CODES = [403, 503];
const MAX_RESPONSE_SIZE = 50 * 1024 * 1024; // 50MB
const ALLOWED_PROTOCOLS = ['http:', 'https:'];
const CONTENT_TYPE_SIGNATURES = new Map([
    ['89504e47', 'image/png'],
    ['ffd8ff', 'image/jpeg'],
    ['47494638', 'image/gif'],
    ['424d', 'image/bmp'],
    ['52494646', 'image/webp'],
    ['3c737667', 'image/svg+xml'],
    ['00000020', 'image/avif'],
]);

// Promisified decompressors
const gunzip = promisify(zlib.gunzip);
const inflate = promisify(zlib.inflate);
const brotliDecompress = zlib.brotliDecompress ? promisify(zlib.brotliDecompress) : null;

/**
 * ProxyError for structured error handling
 */
class ProxyError extends Error {
    constructor(message, code, statusCode = 500) {
        super(message);
        this.name = 'ProxyError';
        this.code = code;
        this.statusCode = statusCode;
    }
}

/**
 * Validate URL and block insecure/internal hosts
 */
function validateUrl(url) {
    try {
        const parsed = new URL(url);
        if (!ALLOWED_PROTOCOLS.includes(parsed.protocol)) {
            throw new ProxyError('Invalid protocol', 'INVALID_PROTOCOL', 400);
        }
        const blockedHosts = ['localhost', '127.0.0.1', '0.0.0.0', '::1'];
        if (blockedHosts.includes(parsed.hostname.toLowerCase()) || parsed.hostname.includes('internal')) {
            throw new ProxyError('Blocked hostname', 'BLOCKED_HOST', 403);
        }
        return parsed.href;
    } catch (error) {
        if (error instanceof ProxyError) throw error;
        throw new ProxyError('Invalid URL', 'INVALID_URL', 400);
    }
}

/**
 * Detect content type using magic bytes + basic text detection
 */
function detectContentType(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 4) return 'application/octet-stream';
    const hexSig = buffer.slice(0, 8).toString('hex');
    for (const [signature, contentType] of CONTENT_TYPE_SIGNATURES) {
        if (hexSig.startsWith(signature)) return contentType;
    }
    try {
        const str = buffer.slice(0, 512).toString('utf8');
        if (str.includes('<!DOCTYPE html') || str.includes('<html')) return 'text/html';
        if (str.includes('<?xml')) return 'application/xml';
    } catch {}
    return 'application/octet-stream';
}

/**
 * Decompress raw response buffer
 */
async function decompress(data, encoding) {
    if (!data || !encoding) return data;
    const decompressors = {
        gzip: () => gunzip(data),
        deflate: () => inflate(data),
        br: () => brotliDecompress ? brotliDecompress(data) : Promise.reject(new Error('Brotli not supported')),
    };
    const decompressor = decompressors[encoding];
    if (!decompressor) {
        console.warn(`Unknown content-encoding: ${encoding}`);
        return data;
    }
    try {
        return await decompressor();
    } catch (error) {
        console.error(`Decompression failed for ${encoding}:`, error.message);
        return data; // fallback to original
    }
}

/**
 * Pick specific keys from headers
 */
function pick(obj, keys) {
    if (!obj) return {};
    return keys.reduce((acc, key) => {
        if (key in obj && obj[key] !== undefined) acc[key] = obj[key];
        return acc;
    }, {});
}

/**
 * Build request config with enhanced options
 */
function buildRequestConfig(req) {
    const headers = {
        ...pick(req.headers, ['cookie', 'dnt', 'referer', 'authorization']),
        'user-agent': req.headers['user-agent'] ||
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        'accept': req.headers['accept'] ||
            'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'accept-language': req.headers['accept-language'] || 'en-US,en;q=0.9',
        'accept-encoding': 'gzip, deflate, br',
        'sec-fetch-dest': 'image',
        'sec-fetch-mode': 'no-cors',
        'sec-fetch-site': 'cross-site',
        'connection': 'keep-alive',
        'cache-control': 'no-cache, no-store, must-revalidate',
        'pragma': 'no-cache',
        'x-forwarded-for': req.headers['x-forwarded-for'] || req.ip,
        'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="128"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
    };

    return {
        headers,
        timeout: { request: 10000 },
        maxRedirects: 5,
        responseType: 'buffer',
        method: req.method || 'GET',
        decompress: false, // manual
        http2: true,
        request: http2wrapper.auto,
        retry: {
            limit: 3,
            methods: ['GET'],
            statusCodes: [408, 429, 500, 502, 503, 504],
            errorCodes: ['ETIMEDOUT', 'ECONNRESET', 'EADDRINUSE', 'ECONNREFUSED'],
            calculateDelay: ({ attemptCount }) =>
                Math.min(1000 * Math.pow(2, attemptCount - 1), 5000),
        },
        maxResponseSize: MAX_RESPONSE_SIZE,
    };
}

/**
 * Proxy main
 */
async function proxy(req, res) {
    const startTime = Date.now();

    // Input validation
    if (!req?.params?.url) {
        return res.status(400).json({ error: 'Missing URL parameter', code: 'MISSING_URL' });
    }

    let validatedUrl;
    try {
        validatedUrl = validateUrl(req.params.url);
    } catch (error) {
        return res.status(error.statusCode).json({ error: error.message, code: error.code });
    }

    const config = buildRequestConfig(req);

    try {
        const { rawBody, headers, statusCode } = await got(validatedUrl, config);

        // Cloudflare handling
        if (CLOUDFLARE_STATUS_CODES.includes(statusCode)) {
            console.warn(`Cloudflare status ${statusCode}, bypassing`);
            return bypass(req, res, rawBody);
        }

        // Decompress if needed
        const contentEncoding = headers['content-encoding'];
        const decompressedData = await decompress(rawBody, contentEncoding);

        // Set headers
        copyHeaders({ headers, status: statusCode }, res);
        res.setHeader('content-encoding', 'identity');
        res.setHeader('x-response-time', `${Date.now() - startTime}ms`);

        // Detect type & size
        req.params.originType = headers['content-type'] || detectContentType(decompressedData);
        req.params.originSize = decompressedData.length;

        // Compression decision
        if (shouldCompress(req, decompressedData)) {
            return compress(req, res, decompressedData);
        }
        return bypass(req, res, decompressedData);

    } catch (error) {
        console.error(`Proxy request failed for ${validatedUrl}:`, error.message);

        if (error.name === 'TimeoutError') {
            return res.status(504).json({ error: 'Request timeout', code: 'TIMEOUT' });
        }
        if (error.response?.statusCode === 429) {
            res.setHeader('Retry-After', error.response.headers['retry-after'] || '60');
            return res.status(429).json({ error: 'Rate limited', code: 'RATE_LIMITED' });
        }

        return redirect(req, res);
    }
}

export default proxy;

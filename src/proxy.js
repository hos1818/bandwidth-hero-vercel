import got from 'got';
import zlib from 'zlib';
import { promisify } from 'util';
import { pipeline } from 'stream/promises';
import crypto from 'crypto';
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

// Promisified zlib functions with error handling
const decompressors = {
    gzip: promisify(zlib.gunzip),
    deflate: promisify(zlib.inflate),
    br: zlib.brotliDecompress ? promisify(zlib.brotliDecompress) : null,
};

// Cache for DNS lookups and connections
const agentCache = new Map();
const dnsCache = new Map();

/**
 * Custom error classes for better error handling
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
 * Validates and sanitizes URL
 */
function validateUrl(url) {
    try {
        const parsed = new URL(url);
        
        // Security checks
        if (!ALLOWED_PROTOCOLS.includes(parsed.protocol)) {
            throw new ProxyError('Invalid protocol', 'INVALID_PROTOCOL', 400);
        }
        
        // Prevent SSRF attacks
        const hostname = parsed.hostname.toLowerCase();
        const blockedHosts = ['localhost', '127.0.0.1', '0.0.0.0', '::1'];
        if (blockedHosts.includes(hostname) || hostname.includes('internal')) {
            throw new ProxyError('Blocked hostname', 'BLOCKED_HOST', 403);
        }
        
        return parsed.href;
    } catch (error) {
        if (error instanceof ProxyError) throw error;
        throw new ProxyError('Invalid URL', 'INVALID_URL', 400);
    }
}

/**
 * Enhanced content type detection with magic bytes
 */
function detectContentType(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 4) {
        return 'application/octet-stream';
    }
    
    const hexSig = buffer.slice(0, 8).toString('hex');
    
    for (const [signature, contentType] of CONTENT_TYPE_SIGNATURES) {
        if (hexSig.startsWith(signature)) {
            return contentType;
        }
    }
    
    // Additional text-based detection
    try {
        const str = buffer.slice(0, 512).toString('utf8');
        if (str.includes('<!DOCTYPE html') || str.includes('<html')) {
            return 'text/html';
        }
        if (str.includes('<?xml')) {
            return 'application/xml';
        }
    } catch {}
    
    return 'application/octet-stream';
}

/**
 * Decompress data with streaming support
 */
async function decompressData(data, encoding) {
    if (!data || !encoding) return data;
    
    const decompressor = decompressors[encoding];
    if (!decompressor) {
        console.warn(`Unknown content-encoding: ${encoding}`);
        return data;
    }
    
    try {
        return await decompressor(data);
    } catch (error) {
        console.error(`Decompression failed for ${encoding}:`, error.message);
        throw new ProxyError('Decompression failed', 'DECOMPRESSION_ERROR');
    }
}

/**
 * Generate cache key for agent reuse
 */
function getAgentCacheKey(url) {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.hostname}`;
}

/**
 * Get or create HTTP agent for connection pooling
 */
function getAgent(url) {
    const key = getAgentCacheKey(url);
    
    if (!agentCache.has(key)) {
        agentCache.set(key, {
            http: new http2wrapper.Agent({
                maxSockets: 50,
                maxFreeSockets: 10,
                timeout: 30000,
                keepAlive: true,
                keepAliveMsecs: 1000,
            }),
        });
    }
    
    return agentCache.get(key);
}

/**
 * Build request configuration with enhanced options
 */
function buildRequestConfig(req) {
    const headers = {
        ...pick(req.headers, ['cookie', 'dnt', 'referer', 'authorization']),
        'user-agent': req.headers['user-agent'] || 
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'accept': req.headers['accept'] || 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'accept-language': req.headers['accept-language'] || 'en-US,en;q=0.9',
        'accept-encoding': 'gzip, deflate, br',
        'sec-fetch-dest': 'image',
        'sec-fetch-mode': 'no-cors',
        'sec-fetch-site': 'cross-site',
        'connection': 'keep-alive',
        'cache-control': 'no-cache',
        'x-forwarded-for': req.headers['x-forwarded-for'] || req.ip,
    };
    
    // Add random fingerprinting headers for better Cloudflare bypass
    headers['sec-ch-ua'] = '"Not_A Brand";v="8", "Chromium";v="120"';
    headers['sec-ch-ua-mobile'] = '?0';
    headers['sec-ch-ua-platform'] = '"Windows"';
    
    return {
        headers,
        timeout: {
            lookup: 5000,
            connect: 5000,
            secureConnect: 5000,
            socket: 5000,
            response: 10000,
            send: 10000,
            request: 30000,
        },
        maxRedirects: 5,
        responseType: 'buffer',
        method: req.method || 'GET',
        decompress: false,
        http2: true,
        request: http2wrapper.auto,
        agent: getAgent(req.params.url),
        retry: {
            limit: 3,
            methods: ['GET', 'HEAD'],
            statusCodes: [408, 429, 500, 502, 503, 504],
            errorCodes: ['ETIMEDOUT', 'ECONNRESET', 'EADDRINUSE', 'ECONNREFUSED', 'EHOSTUNREACH'],
            calculateDelay: ({ attemptCount }) => Math.min(1000 * Math.pow(2, attemptCount - 1), 5000),
        },
        hooks: {
            beforeRetry: [
                (error, retryCount) => {
                    console.log(`Retry attempt ${retryCount} for ${error.url}`);
                }
            ],
        },
        dnsCache,
        maxResponseSize: MAX_RESPONSE_SIZE,
    };
}

/**
 * Enhanced pick function with deep cloning
 */
function pick(obj, keys) {
    if (!obj) return {};
    return keys.reduce((acc, key) => {
        if (key in obj && obj[key] !== undefined) {
            acc[key] = obj[key];
        }
        return acc;
    }, {});
}

/**
 * Request metrics logging
 */
function logRequestMetrics(url, startTime, statusCode, size) {
    const duration = Date.now() - startTime;
    console.log({
        url,
        statusCode,
        duration,
        size,
        timestamp: new Date().toISOString(),
    });
}

/**
 * Enhanced proxy function with streaming support
 */
async function proxy(req, res) {
    const startTime = Date.now();
    
    // Input validation
    if (!req?.params?.url) {
        return res.status(400).json({ 
            error: 'Missing URL parameter',
            code: 'MISSING_URL'
        });
    }
    
    let validatedUrl;
    try {
        validatedUrl = validateUrl(req.params.url);
    } catch (error) {
        return res.status(error.statusCode).json({
            error: error.message,
            code: error.code
        });
    }
    
    const config = buildRequestConfig(req);
    
    try {
        // Make request with timeout handling
        const response = await got(validatedUrl, config);
        const { body: rawBody, headers, statusCode } = response;
        
        // Handle Cloudflare challenges
        if (CLOUDFLARE_STATUS_CODES.includes(statusCode)) {
            console.warn(`Cloudflare challenge detected (${statusCode})`);
            
            // Add Cloudflare bypass headers for retry
            config.headers['cf-visitor'] = '{"scheme":"https"}';
            config.headers['cf-connecting-ip'] = req.ip;
            
            return bypass(req, res, rawBody);
        }
        
        // Handle compression
        const contentEncoding = headers['content-encoding'];
        let processedData = rawBody;
        
        if (contentEncoding && contentEncoding !== 'identity') {
            try {
                processedData = await decompressData(rawBody, contentEncoding);
            } catch (error) {
                console.error('Decompression error:', error);
                return res.status(500).json({
                    error: 'Failed to process response',
                    code: 'PROCESSING_ERROR'
                });
            }
        }
        
        // Set response headers
        copyHeaders({ headers, status: statusCode }, res);
        res.setHeader('content-encoding', 'identity');
        res.setHeader('x-proxy-cache', 'MISS');
        res.setHeader('x-response-time', `${Date.now() - startTime}ms`);
        
        // Detect content type
        const contentType = headers['content-type'] || detectContentType(processedData);
        req.params.originType = contentType;
        req.params.originSize = processedData.length;
        
        // Log metrics
        logRequestMetrics(validatedUrl, startTime, statusCode, processedData.length);
        
        // Handle compression if needed
        if (shouldCompress(req, processedData)) {
            return compress(req, res, processedData);
        }
        
        return bypass(req, res, processedData);
        
    } catch (error) {
        console.error(`Proxy error for ${validatedUrl}:`, error);
        
        // Enhanced error handling
        if (error.name === 'TimeoutError') {
            return res.status(504).json({
                error: 'Request timeout',
                code: 'TIMEOUT',
                details: error.message
            });
        }
        
        if (error.name === 'RequestError') {
            return res.status(502).json({
                error: 'Bad gateway',
                code: 'REQUEST_ERROR',
                details: error.message
            });
        }
        
        if (error.response?.statusCode === 429) {
            res.setHeader('Retry-After', error.response.headers['retry-after'] || '60');
            return res.status(429).json({
                error: 'Rate limited',
                code: 'RATE_LIMITED'
            });
        }
        
        // Fallback to redirect
        return redirect(req, res);
    }
}

/**
 * Cleanup function for agent cache
 */
setInterval(() => {
    // Clean up old agents
    for (const [key, agent] of agentCache) {
        if (agent.http && typeof agent.http.destroy === 'function') {
            const sockets = agent.http.sockets;
            if (!sockets || Object.keys(sockets).length === 0) {
                agent.http.destroy();
                agentCache.delete(key);
            }
        }
    }
    
    // Clean up DNS cache
    if (dnsCache.size > 1000) {
        dnsCache.clear();
    }
}, 60000); // Every minute

export default proxy;

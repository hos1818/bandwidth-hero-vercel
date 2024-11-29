import got from 'got';
import http2wrapper from 'http2-wrapper';
import { pick } from 'lodash';
import zlib from 'zlib';
import { promisify } from 'util';
import lzma from 'lzma-native';
import { ZstdCodec } from 'zstd-codec';
import shouldCompress from './shouldCompress.js';
import redirect from './redirect.js';
import compress from './compress.js';
import bypass from './bypass.js';
import copyHeaders from './copyHeaders.js';

const CLOUDFLARE_STATUS_CODES = [403, 503];

// Promisified zlib functions
const gunzip = promisify(zlib.gunzip);
const inflate = promisify(zlib.inflate);
const brotliDecompress = zlib.brotliDecompress ? promisify(zlib.brotliDecompress) : null;

/**
 * Decompresses data based on content encoding.
 * @param {Buffer} data - The data buffer.
 * @param {string} encoding - The content encoding type.
 * @returns {Promise<Buffer>} - The decompressed data.
 */
async function decompress(data, encoding) {
    const decompressors = {
        gzip: () => gunzip(data),
        br: () => brotliDecompress ? brotliDecompress(data) : Promise.reject(new Error('Brotli not supported')),
        deflate: () => inflate(data),
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

    if (!decompressors[encoding]) {
        console.warn(`Unknown content encoding: ${encoding}`);
        return data;
    }

    try {
        return await decompressors[encoding]();
    } catch (error) {
        console.error(`Decompression failed for ${encoding}:`, error);
        return data; // Return original data if decompression fails
    }
}

/**
 * Generates proxy request configuration.
 * @param {Object} req - The HTTP request object.
 * @returns {Object} - The configuration object for `got`.
 */
function getProxyConfig(req) {
    return {
        headers: {
            ...pick(req.headers, ['cookie', 'dnt', 'referer']),
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; rv:121.0) Gecko/20100101 Firefox/121.0',
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate, br',
            'Upgrade-Insecure-Requests': '1',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'x-forwarded-for': req.headers['x-forwarded-for'] || req.ip,
        },
        timeout: { request: 10000 },
        maxRedirects: 5,
        responseType: 'buffer',
        method: 'GET',
        decompress: false, // Handle decompression manually
        http2: true, // Enable HTTP/2
        request: http2wrapper.auto,
    };
}

/**
 * Handles the origin response.
 * @param {Object} req - The HTTP request object.
 * @param {Object} res - The HTTP response object.
 * @param {Object} originResponse - The response from the origin server.
 */
async function handleOriginResponse(req, res, originResponse) {
    const { headers, data, status } = originResponse;

    // Handle Cloudflare-specific status codes
    if (CLOUDFLARE_STATUS_CODES.includes(status)) {
        console.log(`Cloudflare bypass due to status ${status}`);
        return bypass(req, res, data);
    }

    const contentEncoding = headers['content-encoding'];
    const decompressedData = contentEncoding ? await decompress(data, contentEncoding) : data;

    // Set headers for the response
    copyHeaders(originResponse, res);
    res.setHeader('content-encoding', 'identity');
    req.params.originType = headers['content-type'] || '';
    req.params.originSize = decompressedData.length;

    // Compress or bypass based on content and rules
    if (shouldCompress(req, decompressedData)) {
        compress(req, res, decompressedData);
    } else {
        bypass(req, res, decompressedData);
    }
}

/**
 * Main proxy handler function.
 * @param {Object} req - The HTTP request object.
 * @param {Object} res - The HTTP response object.
 */
async function proxy(req, res) {
    try {
        const config = getProxyConfig(req);
        const gotResponse = await got(req.params.url, config);

        const originResponse = {
            data: gotResponse.rawBody,
            headers: gotResponse.headers,
            status: gotResponse.statusCode,
        };

        if (!originResponse) throw new Error('Empty origin response');
        await handleOriginResponse(req, res, originResponse);
    } catch (error) {
        console.error(`Proxy request failed: ${error.message}`);
        redirect(req, res);
    }
}

export default proxy;

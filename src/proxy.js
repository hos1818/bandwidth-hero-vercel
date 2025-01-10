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

// Promisified decompression utilities
const gunzip = promisify(zlib.gunzip);
const inflate = promisify(zlib.inflate);
const brotliDecompress = zlib.brotliDecompress ? promisify(zlib.brotliDecompress) : null;

/**
 * Decompress data based on the provided encoding type.
 * @param {Buffer} data - The compressed data.
 * @param {string} encoding - The content-encoding type.
 * @returns {Promise<Buffer>} - The decompressed data.
 */
async function decompress(data, encoding) {
    const decompressors = {
        gzip: () => gunzip(data),
        br: () =>
            brotliDecompress
                ? brotliDecompress(data)
                : Promise.reject(new Error('Brotli not supported in this Node.js version')),
        deflate: () => inflate(data),
        lzma: () =>
            new Promise((resolve, reject) => {
                lzma.decompress(data, (result, error) => (error ? reject(error) : resolve(result)));
            }),
        lzma2: () =>
            new Promise((resolve, reject) => {
                lzma.decompress(data, (result, error) => (error ? reject(error) : resolve(result)));
            }),
        zstd: () =>
            new Promise((resolve, reject) => {
                ZstdCodec.run((zstd) => {
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
            console.error(`Decompression failed for encoding "${encoding}":`, error);
            return data; // Return original data if decompression fails
        }
    } else {
        console.warn(`Unknown content-encoding: "${encoding}"`);
        return data;
    }
}

/**
 * Prepare request configuration for `got`.
 * @param {Request} req - Express request object.
 * @returns {Object} - Configuration object for `got`.
 */
function prepareRequestConfig(req) {
    return {
        headers: {
            ...pick(req.headers, ['cookie', 'dnt', 'referer']),
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:91.0) Gecko/20100101 Firefox/91.0',
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate, br',
            'Upgrade-Insecure-Requests': '1',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            Pragma: 'no-cache',
            'x-forwarded-for': req.headers['x-forwarded-for'] || req.ip,
        },
        timeout: { request: 10000 },
        maxRedirects: 5,
        responseType: 'buffer',
        method: 'GET',
        decompress: false, // Decompression handled manually
        http2: true, // Enable HTTP/2
        request: http2wrapper.auto,
    };
}

/**
 * Handle the proxy logic, including decompression, header copying, and content transformation.
 * @param {Request} req - Express request object.
 * @param {Response} res - Express response object.
 */
async function proxy(req, res) {
    const config = prepareRequestConfig(req);

    try {
        const gotResponse = await got(req.params.url, config);
        const originResponse = {
            data: gotResponse.rawBody,
            headers: gotResponse.headers,
            status: gotResponse.statusCode,
        };

        if (CLOUDFLARE_STATUS_CODES.includes(originResponse.status)) {
            console.log(`Bypassing due to Cloudflare status: ${originResponse.status}`);
            bypass(req, res, originResponse.data);
            return;
        }

        const { headers, data, status } = originResponse;
        const contentEncoding = headers['content-encoding'];
        const decompressedData = contentEncoding ? await decompress(data, contentEncoding) : data;

        copyHeaders(originResponse, res);
        res.setHeader('content-encoding', 'identity');

        req.params.originType = headers['content-type'] || '';
        req.params.originSize = decompressedData.length;

        if (shouldCompress(req, decompressedData)) {
            compress(req, res, decompressedData);
        } else {
            bypass(req, res, decompressedData);
        }
    } catch (error) {
        console.error(`Request handling failed for URL "${req.params.url}": ${error.message}`);
        redirect(req, res);
    }
}

export default proxy;

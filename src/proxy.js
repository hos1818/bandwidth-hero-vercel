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

const decompressors = {
    gzip: gunzip,
    br: brotliDecompress,
    deflate: inflate,
    lzma: data => new Promise((resolve, reject) =>
        lzma.decompress(data, (result, error) => (error ? reject(error) : resolve(result)))
    ),
    lzma2: data => new Promise((resolve, reject) =>
        lzma.decompress(data, (result, error) => (error ? reject(error) : resolve(result)))
    ),
    zstd: data =>
        new Promise((resolve, reject) => {
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

async function decompress(data, encoding) {
    const decompressor = decompressors[encoding];
    if (decompressor) {
        try {
            return await decompressor(data);
        } catch (error) {
            console.error(`Decompression failed for encoding ${encoding}:`, error);
        }
    } else {
        console.warn(`Unknown content-encoding: ${encoding}`);
    }
    return data; // Fallback to original data
}

async function proxy(req, res) {
    const config = {
        headers: {
            ...pick(req.headers, ['cookie', 'dnt', 'referer']),
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:91.0) Gecko/20100101 Firefox/91.0',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate, br',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'x-forwarded-for': req.headers['x-forwarded-for'] || req.ip,
        },
        timeout: { request: 10000 },
        maxRedirects: 5,
        responseType: 'buffer',
        method: 'GET',
        decompress: false,
        http2: true,
        request: http2wrapper.auto,
    };

    try {
        const { rawBody: data, headers, statusCode: status } = await got(req.params.url, config);

        if (CLOUDFLARE_STATUS_CODES.includes(status)) {
            console.log(`Bypassing due to Cloudflare status: ${status}`);
            bypass(req, res, data);
            return;
        }

        const decompressedData = headers['content-encoding']
            ? await decompress(data, headers['content-encoding'])
            : data;

        copyHeaders({ headers }, res);
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

export default proxy;

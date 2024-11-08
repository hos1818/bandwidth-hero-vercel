import got from 'got';
import axios from 'axios';
import pkg from 'lodash';
const { pick } = pkg;
import zlib from 'node:zlib';
import lzma from 'lzma-native';
import { ZstdCodec } from 'zstd-codec';
import shouldCompress from './shouldCompress.js';
import redirect from './redirect.js';
import compress from './compress.js';
import bypass from './bypass.js';
import copyHeaders from './copyHeaders.js';

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

// Proxy function to handle requests
async function proxy(req, res) {
    const config = {
        method: 'GET',
        url: new URL(req.params.url),
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
        timeout: 5000,
        maxRedirects: 5,
        responseType: 'arraybuffer',

    };

    try {
        const originResponse = await axios(config);

        if (!originResponse) {
            console.error("Origin response is empty");
            return redirect(req, res);
        }

        const { headers, body: data, statusCode: status } = originResponse;

        if (CLOUDFLARE_STATUS_CODES.includes(status)) {
            console.log(`Bypassing due to Cloudflare status: ${status}`);
            return bypass(req, res, data);
        }

        const contentEncoding = headers['content-encoding'];
        const decompressedData = contentEncoding ? await decompress(data, contentEncoding) : data;

        copyHeaders(originResponse, res);
        res.set('content-encoding', 'identity');
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

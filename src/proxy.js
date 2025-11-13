import got from 'got';
import zlib from 'zlib';
import { promisify } from 'util';
import shouldCompress from './shouldCompress.js';
import redirect from './redirect.js';
import compress from './compress.js';
import bypass from './bypass.js';
import copyHeaders from './copyHeaders.js';
import http2wrapper from 'http2-wrapper';

// --- Constants ---
const CLOUDFLARE_STATUS_CODES = [403, 503];
const gunzip = promisify(zlib.gunzip);
const inflate = promisify(zlib.inflate);
const brotliDecompress = zlib.brotliDecompress ? promisify(zlib.brotliDecompress) : null;


// --- Utility: Pick ---
const pick = (obj, keys) =>
  keys.reduce((acc, key) => {
    if (obj?.[key] !== undefined) acc[key] = obj[key];
    return acc;
  }, {});

// --- Utility: Decompress ---
async function decompress(data, encoding) {
  if (!data || !encoding) return data;
  const decompressors = {
    gzip: gunzip,
    deflate: inflate,
    br: brotliDecompress
  };
  const fn = decompressors[encoding];
  if (!fn) return data;

  try {
    return await fn(data);
  } catch (err) {
    console.warn(`⚠️ Decompression failed (${encoding}):`, err.message);
    return data; // fallback to raw
  }
}

// --- Utility: Content Type Detection (simplified, cacheable) ---
const MAGIC_SIGNATURES = new Map([
  ['89504e47', 'image/png'],
  ['ffd8ff', 'image/jpeg'],
  ['52494646', 'image/webp'], // RIFF....WEBP
  ['47494638', 'image/gif'],
  ['424d', 'image/bmp'],
  // The XML signature is 5 bytes, so we check a longer slice.
  ['3c3f786d6c', 'application/xml'], // <?xml
  ['3c737667', 'image/svg+xml'],    // <svg
  ['3c21444f', 'image/svg+xml'],     // <!DOCTYPE
]);

function detectContentType(buffer) {
  if (!Buffer.isBuffer(buffer)) return 'application/octet-stream';

  // 1. Check for binary signatures first
  const hex = buffer.toString('hex', 0, 8); // Read more bytes for robust checks
  for (const [magic, type] of MAGIC_SIGNATURES) {
    if (hex.startsWith(magic)) return type;
  }

  // 2. Specific check for AVIF/ISOBMFF formats (ftyp box at offset 4)
  if (buffer.length > 8 && buffer.toString('ascii', 4, 8) === 'ftyp') {
    // Check for 'avif' or 'avis' brand within the ftyp box
    if (buffer.length > 11 && (buffer.toString('ascii', 8, 12) === 'avif' || buffer.toString('ascii', 8, 12) === 'avis')) {
      return 'image/avif';
    }
  }

  // 3. Fallback to text-based checks for HTML/XML
  const str = buffer.slice(0, 512).toString('utf8');
  if (/<!DOCTYPE html|<html/i.test(str)) return 'text/html';
  if (/^<\?xml/i.test(str)) return 'application/xml'; // Already checked, but good as a fallback

  return 'application/octet-stream';
}

// --- Main Proxy ---
export default async function proxy(req, res) {
  const targetUrl = req?.params?.url;
  if (!targetUrl) {
    console.error('❌ Missing URL parameter');
    return res.status(400).json({ error: 'Missing URL parameter' });
  }

  const config = {
    headers: {
      ...pick(req.headers, ['cookie', 'referer', 'authorization']),
      'user-agent':
        req.headers['user-agent'] ||
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/128 Safari/537.36',
      accept:
        req.headers['accept'] ||
        'image/avif,image/webp,image/*;q=0.8,*/*;q=0.5',
        'accept-encoding': 'gzip, deflate, br',
        'accept-language': req.headers['accept-language'] || 'en-US,en;q=0.9'
    },
    timeout: { 
      request: 15000,  // Allow larger images to download
      response: 20000  // Total timeout
    },
    responseType: 'buffer',
    decompress: false,
    http2: true,
    request: http2wrapper.auto
  };

  try {
    const response = await got(targetUrl, config);
    const { statusCode, headers, rawBody } = response;

    // --- Cloudflare challenge handling ---
    if (CLOUDFLARE_STATUS_CODES.includes(statusCode)) {
      console.warn(`⚠️ Cloudflare response ${statusCode}`);
      return bypass(req, res, rawBody);
    }

    // --- Decompress ---
    const data = await decompress(rawBody, headers['content-encoding']);
    const type = headers['content-type'] || detectContentType(data);

    // --- Set headers safely ---
    copyHeaders({ headers, status: statusCode }, res);
    res.setHeader('content-encoding', 'identity');
    res.setHeader('x-proxy-cache', 'MISS');

     // Add security headers
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('x-frame-options', 'DENY');
    res.setHeader('referrer-policy', 'strict-origin-when-cross-origin');
    
    // --- Attach meta info ---
    req.params.originType = type;
    req.params.originSize = data.length;

    // --- Compress decision ---
    if (shouldCompress(req, data)) {
      return compress(req, res, data);
    }
    return bypass(req, res, data);

  } catch (error) {
  console.error(`❌ Proxy failed: ${error.message}`);
  return redirect(req, res);
  }
}








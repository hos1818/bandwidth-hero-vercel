import got from 'got';
import http2wrapper from 'http2-wrapper';
import shouldCompress from './shouldCompress.js';
import redirect from './redirect.js';
import compress from './compress.js';
import bypass from './bypass.js';
import copyHeaders from './copyHeaders.js';

const CLOUDFLARE_STATUS_CODES = new Set([403, 503]);
const MAX_RESPONSE_SIZE = 25 * 1024 * 1024; // 25MB Hard limit to prevent RAM DoS.

// --- Utility: Fast Content Type Detection ---
// Direct byte comparison is 10x+ faster than .toString('hex')
function detectContentType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return 'application/octet-stream';

  // 1. Image Magic Numbers
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) return 'image/jpeg';
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) return 'image/png';
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) return 'image/gif';
  if (buffer[0] === 0x42 && buffer[1] === 0x4D) return 'image/bmp';
  
  // WEBP (RIFF....WEBP) - Check 'RIFF' at 0 and 'WEBP' at 8
  if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) {
    if (buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  }

  // XML / SVG (Check first 512 bytes for text hints)
  // Optimization: Only convert small chunk to string
  const startStr = buffer.subarray(0, 512).toString('utf8').trimStart();
  
  if (startStr.startsWith('<?xml')) return 'application/xml';
  if (startStr.startsWith('<svg') || startStr.includes('<!DOCTYPE svg')) return 'image/svg+xml';
  if (startStr.startsWith('<!DOCTYPE html') || startStr.startsWith('<html')) return 'text/html';

  // AVIF / ISO Media (ftyp box)
  if (buffer.length > 12 && buffer.subarray(4, 8).toString('ascii') === 'ftyp') {
    const brand = buffer.subarray(8, 12).toString('ascii');
    if (brand === 'avif' || brand === 'avis') return 'image/avif';
  }

  return 'application/octet-stream';
}

// --- Main Proxy ---
export default async function proxy(req, res) {
  const targetUrl = req?.params?.url;
  if (!targetUrl) {
    return res.status(400).json({ error: 'Missing URL parameter' });
  }

  // Extract allowed headers only
  const { cookie, referer, authorization, 'user-agent': userAgent } = req.headers;

  const config = {
    headers: {
      cookie,
      referer,
      authorization,
      'user-agent': userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/128 Safari/537.36',
      'accept': req.headers['accept'] || 'image/avif,image/webp,image/*;q=0.8,*/*;q=0.5',
      'accept-encoding': 'gzip, deflate, br', // Let GOT handle decompression
      'accept-language': req.headers['accept-language'] || 'en-US,en;q=0.9'
    },
    timeout: { 
      request: 15000, 
      response: 20000 
    },
    responseType: 'buffer',
    decompress: true, // Native decompression (Performant)
    throwHttpErrors: false, // Don't throw on 404/500/403 so we can handle them manually
    http2: true,
    request: http2wrapper.auto,
    limit: MAX_RESPONSE_SIZE // Safety limit
  };

  try {
    const response = await got(targetUrl, config);
    const { statusCode, headers, rawBody } = response;

    // --- Cloudflare / Error Handling ---
    if (CLOUDFLARE_STATUS_CODES.has(statusCode)) {
      // Pass rawBody. Note: rawBody is decompressed by 'got' due to decompress:true. 
      // If bypass expects compressed data, we might need to re-compress or change logic.
      // Usually, bypass just pipes data, so uncompressed buffer is safer to send to `res`.
      return bypass(req, res, rawBody);
    }

    // Determine Content-Type
    // Prefer authoritative header, fallback to magic number detection
    let contentType = headers['content-type'];
    if (!contentType || contentType === 'application/octet-stream') {
      contentType = detectContentType(rawBody);
    }

    // --- Prepare Response ---
    // Remove content-encoding because 'got' already decoded it. 
    // We will re-encode later if 'compress' is used.
    if (headers['content-encoding']) delete headers['content-encoding'];
    if (headers['content-length']) delete headers['content-length']; // Recalculated on send

    copyHeaders({ headers, status: statusCode }, res);

    // Security Headers
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('x-frame-options', 'DENY');
    res.setHeader('referrer-policy', 'strict-origin-when-cross-origin');
    res.setHeader('x-proxy-cache', 'MISS');

    // Attach Metadata
    req.params.originType = contentType;
    req.params.originSize = rawBody.length;

    // --- Process or Bypass ---
    if (shouldCompress(req, rawBody)) {
      return compress(req, res, rawBody);
    }

    return bypass(req, res, rawBody);

  } catch (error) {
    // Handle specific GOT errors (Timeouts, Oversized, etc)
    if (error.code === 'ERR_BODY_LARGE') {
      console.warn(`⚠️ File too large: ${targetUrl}`);
      return res.status(413).send('File too large');
    }
    
    console.error(`❌ Proxy request failed: ${error.message} (${targetUrl})`);
    return redirect(req, res);
  }
}


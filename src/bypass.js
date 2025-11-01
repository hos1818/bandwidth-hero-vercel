import { URL } from 'url';
import { PassThrough } from 'stream';
import sanitizeFilename from 'sanitize-filename';

const ALLOWED_CONTENT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',   // ✅ NEW
  'image/avif',   // ✅ NEW
  'image/svg+xml', // ✅ NEW
  'application/pdf',
  'text/plain',
  'application/octet-stream'
]);

const MAX_BUFFER_SIZE = Number(process.env.MAX_BUFFER_SIZE) || 10 * 1024 * 1024; // 10 MB default
const DEFAULT_FILENAME = process.env.DEFAULT_FILENAME || 'download';

/**
 * Safely extracts and sanitizes the filename from a given URL..
 */
function extractFilename(urlString, defaultFilename = DEFAULT_FILENAME) {
  if (!urlString) return defaultFilename;

  try {
    const pathname = new URL(urlString).pathname;
    const raw = decodeURIComponent(pathname.split('/').filter(Boolean).pop() || '');
    const clean = sanitizeFilename(raw.trim()) || defaultFilename;
    return clean;
  } catch {
    return defaultFilename;
  }
}

/**
 * Sets security and content headers for the outgoing response.
 */
function setResponseHeaders(res, { contentType, contentLength, filename }) {
  const safeType = ALLOWED_CONTENT_TYPES.has(contentType)
    ? contentType
    : 'application/octet-stream';
  
  res.setHeader('Content-Type', safeType);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); // ✅ CHANGED
  res.setHeader('X-Proxy-Bypass', '1');
  
  if (contentLength) {
    res.setHeader('Content-Length', contentLength);
  }
  
  // ✅ FIXED: Use inline for images
  if (filename && safeType.startsWith('image/')) {
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  } else if (filename) {
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  }
}

/**
 * Efficiently forwards a validated buffer response.
 */
function bypass(req, res, buffer) {
  try {
    if (!req || !res) throw new Error('Missing Request or Response object');

    if (!Buffer.isBuffer(buffer)) throw new Error('Invalid buffer');
    if (buffer.length === 0) throw new Error('Empty buffer');
    if (buffer.length > MAX_BUFFER_SIZE) throw new Error('Buffer exceeds max size');

    const { url = '', originType = '' } = req.params || {};
    const filename = extractFilename(url);

    setResponseHeaders(res, {
      contentType: originType,
      contentLength: buffer.length,
      filename,
    });

    // Fast path for small responses
    const stream = new PassThrough();
    stream.end(buffer);
    stream.pipe(res);
    stream.on('error', (err) => { /* ... */ });
    res.on('close', () => { stream.destroy(); });
    
    // ✅ SIMPLIFIED (direct send)
    res.end(buffer);  // Works for all buffer sizes

    stream.on('error', (err) => {
      console.error('[Bypass Stream Error]', err);
      if (!res.headersSent) res.status(500).json({ error: 'Stream error' });
    });

    res.on('close', () => {
      stream.destroy();
    });

    console.log(`[Bypass] ${filename} (${buffer.length} bytes)`);
  } catch (err) {
    console.error('[Bypass Error]', err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
}

export default bypass;




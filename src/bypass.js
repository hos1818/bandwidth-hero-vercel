import { URL } from 'url';
import sanitizeFilename from 'sanitize-filename';

// --- Constants ---
const MAX_BUFFER_SIZE = parseInt(process.env.MAX_BUFFER_SIZE, 10) || 25 * 1024 * 1024; // 25 MB matches proxy limit
const DEFAULT_FILENAME = process.env.DEFAULT_FILENAME || 'file.bin';

/**
 * Extract a safe filename from the URL or fall back to default.
 */
function extractFilename(urlString, defaultFilename) {
  try {
    const parsed = new URL(urlString);
    const pathSegments = parsed.pathname.split('/');
    
    // Get last segment that isn't empty (handles trailing slashes)
    const lastSegment = pathSegments.filter(Boolean).pop();
    
    if (!lastSegment) return defaultFilename;

    const decoded = decodeURIComponent(lastSegment);
    return sanitizeFilename(decoded) || defaultFilename;
  } catch {
    return defaultFilename;
  }
}

/**
 * Determine if content should be viewed inline (browser) or downloaded.
 */
function getDisposition(contentType) {
  if (!contentType) return 'attachment';
  // Common types that are safe to display in-browser
  if (/^(image\/(jpeg|png|gif|webp|avif|svg)|text\/|application\/pdf|video\/|audio\/)/i.test(contentType)) {
    return 'inline';
  }
  return 'attachment';
}

/**
 * Main Bypass Function
 * Sends the buffered content directly to the client.
 */
export default function bypass(req, res, buffer) {
  // 1. Validation
  if (!res || res.headersSent) return;
  
  if (!Buffer.isBuffer(buffer)) {
    console.error('❌ Bypass Error: Content is not a buffer');
    return res.status(500).json({ error: 'Internal Server Error: Invalid content' });
  }

  // Double check size to prevent sending massive blobs that might choke the connection
  if (buffer.length > MAX_BUFFER_SIZE) {
    console.warn(`⚠️ Bypass Error: Buffer exceeds limit (${buffer.length} bytes)`);
    return res.status(413).json({ error: 'Content too large' });
  }

  try {
    // 2. Metadata Preparation
    const originUrl = req.params?.url || '';
    const contentType = req.params?.originType || 'application/octet-stream';
    const filename = extractFilename(originUrl, DEFAULT_FILENAME);
    const dispositionType = getDisposition(contentType);

    // 3. Set Headers
    // Security: Stop browser from MIME-sniffing the content
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    
    // Metadata
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Content-Disposition', `${dispositionType}; filename="${filename}"`);
    res.setHeader('X-Proxy-Bypass', '1');

    // Cache Control (Optional: Set defaults if upstream didn't provide them via params)
    // Assuming the main proxy function handles Cache-Control copying, we leave this alone 
    // or set a default private cache.
    if (!res.getHeader('Cache-Control')) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }

    // 4. Send Data
    // res.end(buffer) is the most efficient way to send a buffer in Node.
    // Streaming (PassThrough) is unnecessary overhead when data is already fully in RAM.
    res.end(buffer);

  } catch (error) {
    console.error(`❌ Bypass Failed: ${error.message}`);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to send content' });
    }
  }
}

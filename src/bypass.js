const { URL } = require('url');
const stream = require('node:stream');
const path = require('path'); // Use path module to handle file path securely.
const zlib = require('node:zlib');

/**
 * Forwards a buffer to the response without additional processing.
 * 
 * @param {Object} req - The request object, including parameters.
 * @param {Object} res - The response object for sending the data.
 * @param {Buffer} buffer - The buffer containing the content to be forwarded.
 */
async function forwardWithoutProcessing(req, res, buffer) {
  // Validate input
  if (!req || !res || !Buffer.isBuffer(buffer)) {
    return res.status(500).send("Invalid request or buffer");
  }

  // Set appropriate content type and security headers.
  if (req.params.originType) {
    res.setHeader('Content-Type', req.params.originType); // Ensure correct content type
  }
  res.setHeader('X-Content-Type-Options', 'nosniff');    // Prevent MIME-type sniffing.
  res.setHeader('X-Frame-Options', 'DENY');              // Block content from being embedded in iframes.
  res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache control header for static content.
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src *;"); // Basic CSP header.

  // Log request metadata for better traceability.
  console.log(`Forwarding: ${req.params.url} | IP: ${req.ip} | User-Agent: ${req.headers['user-agent']}`);

  // Safely extract filename from URL for Content-Disposition
  let filename;
  try {
    const urlPath = new URL(req.params.url).pathname;
    filename = decodeURIComponent(path.basename(urlPath)); // Safely decode and sanitize the filename.
  } catch {
    return res.status(400).send("Bad Request: Invalid URL");
  }

  // Set Content-Disposition header, default to "inline".
  const dispositionType = originType.startsWith('image') ? 'inline' : 'attachment';
  res.setHeader('Content-Disposition', `${dispositionType}; filename="${filename}"`);


  // Compression support based on client accepted encoding
  const acceptedEncodings = req.headers['accept-encoding'] || '';
  if (acceptedEncodings.includes('br')) {
    buffer = zlib.brotliCompressSync(buffer);
    res.setHeader('Content-Encoding', 'br');
  } else if (acceptedEncodings.includes('gzip')) {
    buffer = zlib.gzipSync(buffer);
    res.setHeader('Content-Encoding', 'gzip');
  } else {
    res.setHeader('Content-Encoding', 'identity');
  }

  // Set Content-Length and ETag for caching and conditional requests
  res.setHeader('Content-Length', buffer.length);
  const eTag = `"${Buffer.from(buffer).toString('base64')}"`;
  res.setHeader('ETag', eTag);
  if (req.headers['if-none-match'] === eTag) {
    return res.status(304).end();
  }

  // Stream the buffer to the response
  stream.PassThrough().end(buffer).pipe(res);

  console.log(`Forwarded without processing: ${req.params.url} | Response Time: ${Date.now() - req.startTime}ms`);
}

module.exports = forwardWithoutProcessing;  

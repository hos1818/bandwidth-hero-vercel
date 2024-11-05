const { URL } = require('url');
const stream = require('stream');
const path = require('path'); // Use path module to handle file path securely.
const zlib = require('zlib');
const crypto = require('crypto');

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
  const originType = req.params.originType || '';
  const dispositionType = originType.startsWith('image') ? 'inline' : 'attachment';
  res.setHeader('Content-Disposition', `${dispositionType}; filename="${filename}"`);


  // Compression support based on client accepted encoding (using async compression)
  const acceptedEncodings = req.headers['accept-encoding'] || '';

  if (acceptedEncodings.includes('br') && zlib.promises.BrotliCompress) {
    // Use Brotli if the client accepts it and it’s supported in the environment
    buffer = await zlib.promises.BrotliCompress(buffer);
    res.setHeader('Content-Encoding', 'br');
  } else if (acceptedEncodings.includes('gzip')) {
    // Fallback to gzip if Brotli is not available or not supported
    buffer = await zlib.promises.Gzip(buffer);
    res.setHeader('Content-Encoding', 'gzip');
  } else {
    // Default to identity encoding if no supported compression is available
    res.setHeader('Content-Encoding', 'identity');
  }

  // Set Content-Length and ETag for caching and conditional requests
  res.setHeader('Content-Length', buffer.length);

  const eTag = `"${crypto.createHash('sha1').update(buffer).digest('base64')}"`;
  res.setHeader('ETag', eTag);
  if (req.headers['if-none-match'] === eTag) {
    res.status(304).end();
    return;
  }

  // Stream the buffer to the response with error handling
  const bufferStream = new stream.PassThrough();
  bufferStream.end(buffer);
  bufferStream.pipe(res).on('error', (err) => {
    console.error('Error in response stream:', err);
    if (!res.headersSent) {
      res.status(500).send("Internal Server Error");
    }
  });

  console.log(`Forwarded without processing: ${req.params.url} | Response Time: ${Date.now() - req.startTime}ms`);
}

module.exports = forwardWithoutProcessing;  

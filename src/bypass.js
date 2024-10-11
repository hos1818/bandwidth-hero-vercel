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
  // Validate the request, response, and buffer.
  if (!req || !res) {
    throw new Error("Request or Response objects are missing or invalid");
  }
  if (!Buffer.isBuffer(buffer)) {
    console.error("Invalid or missing buffer");
    return res.status(500).send("Invalid or missing buffer");
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

  // Extract and sanitize the filename from the URL's path.
  let filename;
  try {
    const urlPath = new URL(req.params.url).pathname;
    filename = decodeURIComponent(path.basename(urlPath)); // Safely decode and sanitize the filename.
  } catch (error) {
    console.error(`Error extracting filename from URL: ${req.params.url} - ${error.message}`);
    return res.status(400).send("Bad Request: Invalid URL");
  }

  // Set Content-Disposition header, default to "inline".
  if (filename) {
    const dispositionType = req.params.originType && req.params.originType.startsWith('image') ? 'inline' : 'attachment';
    res.setHeader('Content-Disposition', `${dispositionType}; filename="${filename}"`);
  }

  // Support for compression if client accepts it
  const acceptedEncodings = req.headers['accept-encoding'] || '';
  if (acceptedEncodings.includes('br')) {
    buffer = zlib.brotliCompressSync(buffer); // Compress using Brotli if supported
    res.setHeader('Content-Encoding', 'br');
  } else if (acceptedEncodings.includes('gzip')) {
    buffer = zlib.gzipSync(buffer); // Compress using gzip if supported
    res.setHeader('Content-Encoding', 'gzip');
  } else {
    res.setHeader('Content-Encoding', 'identity'); // No compression
  }

  // Set the content length for proper response size handling.
  res.setHeader('content-length', buffer.length);

  // Support ETag and Conditional Requests
  const eTag = `"${Buffer.from(buffer).toString('base64')}"`; // Simple ETag based on buffer content
  res.setHeader('ETag', eTag);
  if (req.headers['if-none-match'] === eTag) {
    return res.status(304).end(); // Not modified, no need to send the buffer
  }

  // Stream the buffer to the response to efficiently handle large data.
  const bufferStream = new stream.PassThrough();
  bufferStream.end(buffer);
  bufferStream.pipe(res);

  // Log the forward action for monitoring purposes.
  console.log(`Forwarded without processing: ${req.params.url} | Response Time: ${Date.now() - req.startTime}ms`);
}

module.exports = forwardWithoutProcessing;

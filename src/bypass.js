const { URL } = require('url');
const stream = require('stream');
const path = require('path');
const zlib = require('zlib');

/**
 * Forwards a buffer to the response without additional processing.
 * 
 * @param {Object} req - The request object, including parameters.
 * @param {Object} res - The response object for sending the data.
 * @param {Buffer} buffer - The buffer containing the content to be forwarded.
 */
async function forwardWithoutProcessing(req, res, buffer) {
  // Validate essential parameters.
  if (!req || !res || !Buffer.isBuffer(buffer)) {
    console.error("Invalid request, response, or buffer");
    return res.status(500).send("Internal Server Error: Invalid request, response, or buffer");
  }

  // Set essential security and content headers.
  const originType = req.params.originType || 'application/octet-stream';
  res.setHeader('Content-Type', originType);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src *");

  // Extract and sanitize filename from URL.
  let filename;
  try {
    const urlPath = new URL(req.params.url).pathname;
    filename = decodeURIComponent(path.basename(urlPath));
  } catch (error) {
    console.error(`Filename extraction error from URL: ${req.params.url} - ${error.message}`);
    return res.status(400).send("Bad Request: Invalid URL");
  }

  // Set Content-Disposition header.
  const dispositionType = originType.startsWith('image') ? 'inline' : 'attachment';
  res.setHeader('Content-Disposition', `${dispositionType}; filename="${filename}"`);

  // Generate ETag for caching and check conditional headers.
  const eTag = `"${buffer.toString('base64')}"`;
  res.setHeader('ETag', eTag);
  if (req.headers['if-none-match'] === eTag) {
    return res.status(304).end(); // Not modified; no need to send the content
  }

  // Compression: Apply only if client supports it and handle asynchronously.
  const acceptedEncodings = req.headers['accept-encoding'] || '';
  let compressedBuffer = buffer;
  if (acceptedEncodings.includes('br')) {
    compressedBuffer = await zlib.promises.brotliCompress(buffer);
    res.setHeader('Content-Encoding', 'br');
  } else if (acceptedEncodings.includes('gzip')) {
    compressedBuffer = await zlib.promises.gzip(buffer);
    res.setHeader('Content-Encoding', 'gzip');
  } else {
    res.setHeader('Content-Encoding', 'identity');
  }

  // Set content length based on final buffer size.
  res.setHeader('Content-Length', compressedBuffer.length);

  // Stream buffer directly to response.
  stream.Readable.from(compressedBuffer).pipe(res);

  console.log(`Forwarded: ${req.params.url} | IP: ${req.ip} | User-Agent: ${req.headers['user-agent']} | Response Time: ${Date.now() - req.startTime}ms`);
}

module.exports = forwardWithoutProcessing;

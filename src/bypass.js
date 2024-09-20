const { URL } = require('url');
const stream = require('node:stream'); 

function forwardWithoutProcessing(req, res, buffer) {
  // Validate inputs
  if (!req || !res) {
    throw new Error("Request or Response objects are missing or invalid");
  }

  if (!buffer || !Buffer.isBuffer(buffer)) {
    console.error("Invalid or missing buffer"); // Consider more sophisticated logging if necessary.
    return res.status(500).send("Invalid or missing buffer");
  }

  // Set headers to maintain the original content and enhance security
  if (req.params.originType) {
    res.setHeader('Content-Type', req.params.originType);
  }
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY'); // This may need to be adjusted based on your application's needs.

  // Flag indicating the content is being forwarded without processing
  res.setHeader('x-proxy-bypass', 1);

  // Set content length for proper content handling
  res.setHeader('content-length', buffer.length);

  // Extract and decode the filename, and set it in the content disposition header
  const urlPath = new URL(req.params.url).pathname;
  const filename = decodeURIComponent(urlPath.split('/').pop());
  if (filename) {
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  }

  // For large files, consider using streams to pipe the content and reduce memory overhead
  const bufferStream = new stream.PassThrough();
  bufferStream.end(buffer);
  bufferStream.pipe(res);

  // You may want to log this action for monitoring purposes
  console.log(`Forwarded without processing: ${req.params.url}`);
}

module.exports = forwardWithoutProcessing;

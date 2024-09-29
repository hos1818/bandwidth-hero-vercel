const { URL } = require('url');
const stream = require('node:stream');

function forwardWithoutProcessing(req, res, buffer) {
  // Validate the request and response objects.
  if (!req || !res) {
    throw new Error("Request or Response objects are missing or invalid");
  }

  // Check that the buffer exists and is valid.
  if (!Buffer.isBuffer(buffer)) {
    console.error("Invalid or missing buffer");
    return res.status(500).send("Invalid or missing buffer");
  }

  // Set headers to preserve content type and enhance security.
  if (req.params.originType) {
    res.setHeader('Content-Type', req.params.originType); // Ensure correct content type
  }
  res.setHeader('X-Content-Type-Options', 'nosniff');    // Prevent MIME-type sniffing.
  res.setHeader('X-Frame-Options', 'DENY');              // Block content from being embedded in iframes.

  // Indicate that content is being forwarded without processing.
  res.setHeader('x-proxy-bypass', 1);

  // Set the content length for proper response size handling.
  res.setHeader('content-length', buffer.length);

  // Extract and set the filename from the URL's path for Content-Disposition.
  const urlPath = new URL(req.params.url).pathname;
  const filename = decodeURIComponent(urlPath.split('/').pop()); // Safely decode the filename.
  
  // Only set Content-Disposition header if a filename is available.
  if (filename) {
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  }

  // Stream the buffer to the response to avoid high memory usage for large files.
  const bufferStream = new stream.PassThrough();
  bufferStream.end(buffer);
  bufferStream.pipe(res); // Pipes the buffer stream to the response for efficient data handling.

  // Optionally log the forward action for monitoring purposes.
  console.log(`Forwarded without processing: ${req.params.url}`);
}

module.exports = forwardWithoutProcessing;

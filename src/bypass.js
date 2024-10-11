const { URL } = require('url');
const stream = require('node:stream');
const path = require('path'); // Use path module to handle file path securely.

/**
 * Forwards a buffer to the response without additional processing.
 * 
 * @param {Object} req - The request object, including parameters.
 * @param {Object} res - The response object for sending the data.
 * @param {Buffer} buffer - The buffer containing the content to be forwarded.
 */
function forwardWithoutProcessing(req, res, buffer) {
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

  // Indicate that content is being forwarded without processing.
  res.setHeader('x-proxy-bypass', 1);

  // Set the content length for proper response size handling.
  res.setHeader('content-length', buffer.length);

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

  // Stream the buffer to the response to efficiently handle large data.
  const bufferStream = new stream.PassThrough();
  bufferStream.end(buffer);
  bufferStream.pipe(res);

  // Log the forward action for monitoring purposes.
  console.log(`Forwarded without processing: ${req.params.url}`);
}

module.exports = forwardWithoutProcessing;

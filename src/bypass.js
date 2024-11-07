const { URL } = require('url');
const { PassThrough } = require('stream');

function forwardWithoutProcessing(req, res, buffer) {
  try {
    // Validate essential parameters
    if (!req || !res) throw new Error("Request or Response objects are missing or invalid");
    if (!Buffer.isBuffer(buffer)) {
      console.error("Invalid or missing buffer");
      return res.status(500).send("Invalid or missing buffer");
    }

    // Set essential headers to preserve content type and security
    res.setHeader('Content-Type', req.params.originType || 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('x-proxy-bypass', 1);
    res.setHeader('Content-Length', buffer.length);

    // Extract filename from URL path if available
    let filename = 'download';
    try {
      const urlPath = new URL(req.params.url).pathname;
      filename = decodeURIComponent(urlPath.split('/').pop()) || filename;
    } catch (error) {
      console.error("Invalid URL provided:", error);
    }
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);

    // Stream the buffer to response efficiently
    const bufferStream = new PassThrough();
    bufferStream.end(buffer);
    bufferStream.pipe(res);

    console.log(`Forwarded without processing: ${req.params.url}`);
  } catch (error) {
    console.error("Error in forwardWithoutProcessing:", error);
    res.status(500).send("Error forwarding content");
  }
}

module.exports = forwardWithoutProcessing;

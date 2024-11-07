import { URL } from 'url';
import { PassThrough } from 'stream';

function forwardWithoutProcessing(req, res, buffer) {
  try {
    // Validate essential parameters
    if (!req || !res) throw new Error("Request or Response objects are missing or invalid");
    if (!Buffer.isBuffer(buffer)) {
      console.error("Invalid or missing buffer");
      return res.status(500).send("Invalid or missing buffer");
    }

    // Extract filename from URL path if available, using 'download' as a default
    let filename = 'download';
    if (req.params?.url) {
      try {
        const urlPath = new URL(req.params.url).pathname;
        filename = decodeURIComponent(urlPath.split('/').pop()) || filename;
      } catch (error) {
        console.error("Invalid URL provided:", error);
      }
    } else {
      console.warn("URL parameter missing from request");
    }

    // Set essential headers only once
    res.set({
      'Content-Type': req.params.originType || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'x-proxy-bypass': 1,
      'Content-Length': buffer.length,
      'Content-Disposition': `inline; filename="${filename}"`,
    });

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

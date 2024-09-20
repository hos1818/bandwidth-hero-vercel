const { URL } = require('url');
const stream = require('node:stream'); 

function forwardWithoutProcessing(req, res, buffer) {
    // Validate inputs
    if (!req || typeof req !== 'object' || !res || typeof res !== 'object') {
        throw new TypeError("Request or Response objects are missing or invalid");
    }

    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
        console.error("Invalid or empty buffer"); 
        return res.status(500).send("Invalid or missing buffer");
    }

    // Set security and content-related headers
    if (req.params.originType) {
        res.setHeader('Content-Type', req.params.originType);
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('x-proxy-bypass', 1); // Custom header indicating bypass

    // Set content length for accurate content handling
    res.setHeader('Content-Length', buffer.length);

    // Extract and decode the filename, handle potential errors
    let filename = '';
    try {
        const urlPath = new URL(req.params.url).pathname;
        filename = decodeURIComponent(urlPath.split('/').pop() || 'download');
    } catch (error) {
        console.error("Error decoding the filename:", error.message);
        filename = 'download';
    }

    // Sanitize and set the Content-Disposition header
    res.setHeader('Content-Disposition', `inline; filename="${filename.replace(/[\x00-\x1F\x7F-\x9F\/\\]/g, '')}"`);

    // Stream the buffer to the response to handle large content efficiently
    const bufferStream = new stream.PassThrough();
    bufferStream.end(buffer);

    // Handle potential stream errors
    bufferStream.on('error', (err) => {
        console.error("Stream error:", err.message);
        res.status(500).send("Error processing the content");
    });

    bufferStream.pipe(res).on('finish', () => {
        console.log(`Successfully forwarded without processing: ${req.params.url}`);
    });

    // Log the action for monitoring purposes
    console.log(`Forwarded without processing: ${req.params.url} with Content-Type: ${req.params.originType}`);
}

module.exports = forwardWithoutProcessing;

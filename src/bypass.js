import { URL } from 'url';
import { PassThrough } from 'stream';

/**
 * Safely extracts the filename from a URL.
 * 
 * @param {string} urlString - The URL string.
 * @param {string} defaultFilename - The default filename to use if extraction fails.
 * @returns {string} - The sanitized filename.
 */
function extractFilename(urlString, defaultFilename = 'download') {
    try {
        const urlPath = new URL(urlString).pathname;
        const rawFilename = decodeURIComponent(urlPath.split('/').pop()) || defaultFilename;
        return rawFilename.replace(/[^a-zA-Z0-9._-]/g, '_'); // Sanitize filename
    } catch {
        return defaultFilename;
    }
}

/**
 * Sets standard response headers for forwarded content.
 * 
 * @param {Object} res - The HTTP response object.
 * @param {Object} options - Options for setting headers.
 */
function setResponseHeaders(res, options) {
    const { contentType, contentLength, filename } = options;

    res.setHeader('Content-Type', contentType || 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('x-proxy-bypass', 1);
    res.setHeader('Content-Length', contentLength);
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
}

/**
 * Streams a buffer to the HTTP response without processing.
 * 
 * @param {Object} req - The HTTP request object.
 * @param {Object} res - The HTTP response object.
 * @param {Buffer} buffer - The buffer to stream.
 */
function forwardWithoutProcessing(req, res, buffer) {
    try {
        if (!req || !res) throw new Error('Request or Response objects are missing or invalid');
        if (!Buffer.isBuffer(buffer)) {
            console.error('Invalid or missing buffer');
            return res.status(500).json({ error: 'Invalid or missing buffer' });
        }

        // Extract and sanitize filename from the URL
        const filename = extractFilename(req.params.url);

        // Set response headers
        setResponseHeaders(res, {
            contentType: req.params.originType,
            contentLength: Buffer.byteLength(buffer),
            filename,
        });

        // Stream the buffer to the response
        const bufferStream = new PassThrough();
        bufferStream.end(buffer);
        bufferStream.pipe(res).on('error', (streamError) => {
            console.error('Error streaming buffer:', streamError);
            res.status(500).json({ error: 'Error streaming content' });
        });

        console.log(`Forwarded without processing: ${req.params.url}`);
    } catch (error) {
        console.error('Error in forwardWithoutProcessing:', error);
        res.status(500).json({ error: 'Error forwarding content' });
    }
}

export default forwardWithoutProcessing;

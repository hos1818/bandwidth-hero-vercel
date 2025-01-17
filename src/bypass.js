import { URL } from 'url';
import { PassThrough } from 'stream';
import winston from 'winston'; // Ensure you install and configure winston

// Configure logger
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.json(),
    transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: 'error.log', level: 'error' })
    ]
});

function extractFilename(urlString, defaultFilename = 'download') {
    try {
        const urlObj = new URL(urlString);
        const pathName = urlObj.pathname;
        const rawFilename = decodeURIComponent(pathName.split('/').pop()) || defaultFilename;
        return rawFilename.replace(/[^a-zA-Z0-9._-]/g, '_');
    } catch (error) {
        logger.error(`Error extracting filename from URL: ${urlString}`, error);
        return defaultFilename;
    }
}

function setResponseHeaders(res, { contentType, contentLength, filename }) {
    // Sanitize content type to prevent attacks
    const safeContentType = /^[\w\/-]+$/.test(contentType) ? contentType : 'application/octet-stream';
    res.setHeader('Content-Type', safeContentType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    // Uncomment if x-proxy-bypass is necessary
    // res.setHeader('x-proxy-bypass', '1');
    if (contentLength) res.setHeader('Content-Length', contentLength);
    if (filename) {
        // Properly escape filename for Content-Disposition
        const safeFilename = encodeURIComponent(filename).replace(/%20/g, ' ');
        res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
    }
}

function bypass(req, res, buffer) {
    if (!req || !res) {
        logger.error('Request or Response objects are missing or invalid');
        return res.status(500).json({ error: 'Server error' });
    }

    if (!Buffer.isBuffer(buffer)) {
        logger.error('Invalid or missing buffer');
        return res.status(500).json({ error: 'Invalid or missing buffer' });
    }

    let urlParam = req.params?.url || '';
    let originType = req.params?.originType || 'application/octet-stream';

    const filename = extractFilename(urlParam, 'download');

    try {
        setResponseHeaders(res, {
            contentType: originType,
            contentLength: buffer.length,
            filename
        });

        // Stream the buffer to avoid high memory usage
        const bufferStream = new PassThrough();
        bufferStream.end(buffer);

        bufferStream.pipe(res)
            .on('error', (streamError) => {
                logger.error('Error streaming buffer:', streamError);
                if (!res.headersSent) {
                    res.status(500).json({ error: 'Error streaming content' });
                }
            })
            .on('finish', () => {
                logger.info(`Successfully bypassed content for URL: ${urlParam}`);
            });
    } catch (error) {
        logger.error('Error in bypass:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Error forwarding content' });
        }
    }
}

export default bypass;

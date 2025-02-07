import { URL } from 'url';
import { PassThrough } from 'stream';
import sanitizeFilename from 'sanitize-filename';

const ALLOWED_CONTENT_TYPES = [
    'image/jpeg', 'image/png', 'image/gif', 'application/pdf', 'text/plain',
    'application/octet-stream', // Default fallback
];
const MAX_BUFFER_SIZE = parseInt(process.env.MAX_BUFFER_SIZE, 10) || 10 * 1024 * 1024; // 10 MB default
const DEFAULT_FILENAME = process.env.DEFAULT_FILENAME || 'download';

function extractFilename(urlString, defaultFilename = DEFAULT_FILENAME) {
    try {
        const urlPath = new URL(urlString).pathname;
        const rawFilename = decodeURIComponent(urlPath.split('/').filter(Boolean).pop()) || defaultFilename;
        return sanitizeFilename(rawFilename);
    } catch {
        return defaultFilename;
    }
}

function setResponseHeaders(res, { contentType, contentLength, filename }) {
    const safeContentType = ALLOWED_CONTENT_TYPES.includes(contentType)
        ? contentType
        : 'application/octet-stream';
    res.setHeader('Content-Type', safeContentType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('x-proxy-bypass', '1');
    if (contentLength) res.setHeader('Content-Length', contentLength);
    if (filename) res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
}

function bypass(req, res, buffer) {
    if (!req || !res) {
        console.error('Request or Response objects are missing or invalid');
        return res?.status(500)?.json({ error: 'Server error' });
    }
    if (!Buffer.isBuffer(buffer) || buffer.length > MAX_BUFFER_SIZE) {
        console.error('Invalid or oversized buffer');
        return res.status(500).json({ error: 'Invalid or oversized buffer' });
    }
    try {
        const filename = extractFilename(req.params?.url || '', DEFAULT_FILENAME);
        setResponseHeaders(res, {
            contentType: req.params?.originType,
            contentLength: buffer.length,
            filename,
        });

        if (buffer.length < 1024) {
            // For small buffers, send directly.
            res.send(buffer);
        } else {
            // For larger buffers, use streaming.
            const bufferStream = new PassThrough();
            bufferStream.end(buffer);
            bufferStream.pipe(res).on('error', (streamError) => {
                console.error({ message: 'Error streaming buffer', error: streamError });
                if (!res.headersSent) {
                    res.status(500).json({ error: 'Error streaming content' });
                }
            });
        }

        console.log(`Successfully bypassed content for URL: ${req.params?.url}`);
    } catch (error) {
        console.error({ message: 'Error in bypass', error: error.message });
        if (!res.headersSent) {
            res.status(500).json({
                error: 'Error forwarding content',
                details: error.message,
            });
        }
    }
}

export default bypass;

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
        console.error('Missing Request or Response object');
        return res?.status(500)?.json({ error: 'Server error' });
    }

    if (!Buffer.isBuffer(buffer) || buffer.length === 0 || buffer.length > MAX_BUFFER_SIZE) {
        console.error('Invalid or oversized buffer');
        return res.status(400).json({ error: 'Invalid or oversized content' });
    }

    try {
        const { url = '', originType = '' } = req.params || {};
        const filename = extractFilename(url, DEFAULT_FILENAME);

        setResponseHeaders(res, {
            contentType: originType,
            contentLength: buffer.length,
            filename,
        });

        if (buffer.length < 1024) {
            res.send(buffer);
        } else {
            new PassThrough()
                .end(buffer)
                .pipe(res)
                .on('error', (err) => {
                    console.error('Stream error:', err.message);
                    if (!res.headersSent) {
                        res.status(500).json({ error: 'Error streaming content' });
                    }
                });
        }

        console.log(`Bypassed content for URL: ${url}`);
    } catch (error) {
        console.error('Bypass error:', error.message);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Error forwarding content' });
        }
    }
}

export default bypass;

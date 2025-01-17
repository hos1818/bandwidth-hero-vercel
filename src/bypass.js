import { URL } from 'url';
import { PassThrough } from 'stream';

function extractFilename(urlString, defaultFilename = 'download') {
    try {
        const urlPath = new URL(urlString).pathname;
        const rawFilename = decodeURIComponent(urlPath.split('/').pop()) || defaultFilename;
        // Sanitize filename: Allow alphanumeric, dots, underscores, and hyphens; replace others with underscores.
        return rawFilename.replace(/[^a-zA-Z0-9._-]/g, '_');
    } catch {
        return defaultFilename;
    }
}

function setResponseHeaders(res, { contentType, contentLength, filename }) {
    res.setHeader('Content-Type', contentType || 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('x-proxy-bypass', '1');
    if (contentLength) res.setHeader('Content-Length', contentLength);
    if (filename) res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
}

function bypass(req, res, buffer) {
    if (!req || !res) {
        console.error('Request or Response objects are missing or invalid');
        return res?.status(500)?.json({ error: 'Server error' });
    }

    if (!Buffer.isBuffer(buffer)) {
        console.error('Invalid or missing buffer');
        return res.status(500).json({ error: 'Invalid or missing buffer' });
    }

    try {
        const filename = extractFilename(req.params?.url || '', 'download');
        setResponseHeaders(res, {
            contentType: req.params?.originType,
            contentLength: buffer.length,
            filename,
        });

        const bufferStream = new PassThrough();
        bufferStream.end(buffer);
        bufferStream.pipe(res).on('error', (streamError) => {
            console.error('Error streaming buffer:', streamError);
            if (!res.headersSent) {
                res.status(500).json({ error: 'Error streaming content' });
            }
        });

        console.log(`Successfully bypassed content for URL: ${req.params?.url}`);
    } catch (error) {
        console.error('Error in bypass:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Error forwarding content' });
        }
    }
}

export default bypass;

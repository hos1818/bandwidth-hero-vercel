import { URL } from 'url';
import { STATUS_CODES } from 'http';

const ALLOWED_PROTOCOLS = ['http:', 'https:'];
const RESTRICTED_HEADERS = ['content-length', 'cache-control', 'expires', 'date', 'etag'];

/**
 * Checks if a given status code is a valid redirect code.
 */
function isValidRedirectStatusCode(statusCode) {
    return STATUS_CODES[statusCode] !== undefined && statusCode >= 300 && statusCode < 400;
}

/**
 * Safely normalizes a URL string: trims, removes trailing slashes, decodes spaces.
 */
function normalizeUrl(urlString) {
    return urlString.trim().replace(/\/+$/, '');
}

/**
 * Validates the given URL against allowed protocols.
 */
function isValidUrl(urlString) {
    if (!urlString) return false;
    try {
        const parsedUrl = new URL(normalizeUrl(urlString));
        return ALLOWED_PROTOCOLS.includes(parsedUrl.protocol) && Boolean(parsedUrl.hostname);
    } catch {
        return false;
    }
}

/**
 * Escapes HTML special characters to prevent injection in fallback HTML.
 */
function escapeHtml(str) {
    return str.replace(/[&<>"']/g, match => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
    })[match]);
}

/**
 * Generates an HTML page for a redirect.
 */
function generateRedirectHtml(url) {
    const safeUrl = escapeHtml(url);
    return `<!DOCTYPE html>
<html><head><meta http-equiv="refresh" content="0;url=${safeUrl}"></head>
<body>Redirecting to <a href="${safeUrl}">${safeUrl}</a></body></html>`;
}

/**
 * Redirect middleware handler.
 */
function redirect(req, res, statusCode = 302, includeHtmlFallback = true) {
    if (!isValidRedirectStatusCode(statusCode)) {
        console.error({ message: 'Invalid status code for redirect', statusCode });
        return res.status(500).json({
            error: 'Invalid redirect status code.',
            details: `Expected 3xx, got ${statusCode}.`
        });
    }

    if (res.headersSent) {
        console.error({ message: 'Headers already sent; cannot redirect.' });
        return;
    }

    const targetUrl = req.params?.url;
    if (!targetUrl || !isValidUrl(targetUrl)) {
        console.error({ message: 'Invalid or missing target URL', targetUrl });
        return res.status(400).json({ error: 'Invalid or missing URL.' });
    }

    try {
        const normalizedUrl = normalizeUrl(targetUrl);
        const encodedUrl = encodeURI(normalizedUrl);

        // Remove restricted headers (case-insensitive)
        RESTRICTED_HEADERS.forEach(header => {
            if (res.hasHeader(header)) res.removeHeader(header);
            if (res.hasHeader(header.toLowerCase())) res.removeHeader(header.toLowerCase());
        });

        res.setHeader('Location', encodedUrl);
        console.log({ message: 'Redirecting', url: encodedUrl, statusCode });

        if (includeHtmlFallback && statusCode === 302) {
            res.status(statusCode).send(generateRedirectHtml(encodedUrl));
        } else {
            res.status(statusCode).end();
        }
    } catch (error) {
        console.error({ message: 'Failed to redirect', error: error.message });
        res.status(500).json({ error: 'Internal server error during redirect.' });
    }
}

export default redirect;

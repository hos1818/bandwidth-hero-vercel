import { URL } from 'url';

const ALLOWED_PROTOCOLS = ['http:', 'https:'];
const RESTRICTED_HEADERS = ['content-length', 'cache-control', 'expires', 'date', 'etag'];

function isValidUrl(urlString) {
    if (!urlString) return false;

    try {
        const parsedUrl = new URL(normalizeUrl(urlString));
        return ALLOWED_PROTOCOLS.includes(parsedUrl.protocol);
    } catch {
        return false;
    }
}

function normalizeUrl(urlString) {
    return urlString.trim().replace(/\/+$/, '').replace(/%20/g, ' ');
}

function generateRedirectHtml(url) {
    return `<html><head><meta http-equiv="refresh" content="0;url=${url}"></head><body></body></html>`;
}

function redirect(req, res, statusCode = 302) {
    if (statusCode < 300 || statusCode >= 400) {
        console.error(`Invalid status code for redirect: ${statusCode}`);
        return res.status(500).json({ error: 'Invalid redirect status code.' });
    }

    if (res.headersSent) {
        console.error('Headers already sent; unable to redirect.');
        return;
    }

    const targetUrl = req.params.url;
    if (!targetUrl || !isValidUrl(targetUrl)) {
        console.error(`Invalid or missing target URL: ${targetUrl}`);
        return res.status(400).json({ error: 'Invalid URL.' });
    }

    RESTRICTED_HEADERS.forEach(header => res.removeHeader(header));

    const encodedUrl = encodeURI(targetUrl);
    res.setHeader('Location', encodedUrl);

    console.log(`Redirecting to ${encodedUrl} with status code ${statusCode}.`);

    res.status(statusCode).send(
        statusCode === 302 ? generateRedirectHtml(encodedUrl) : undefined
    );
}

export default redirect;

import { URL } from 'url';


/**
 * Validates a URL for security and format correctness.
 * 
 * @param {string} urlString - The URL to validate.
 * @returns {boolean} True if the URL is valid, false otherwise.
 */
function isValidUrl(urlString) {
    if (!urlString) return false;

    try {
        const parsedUrl = new URL(normalizeUrl(urlString));
        const allowedProtocols = ['http:', 'https:'];
        return allowedProtocols.includes(parsedUrl.protocol);
    } catch {
        return false;
    }
}

/**
 * Normalizes a URL by trimming spaces, removing trailing slashes, and
 * normalizing percent encoding.
 * 
 * @param {string} urlString - The URL to normalize.
 * @returns {string} The normalized URL.
 */
function normalizeUrl(urlString) {
    return urlString.trim().replace(/\/+$/, '').replace(/%20/g, ' ');
}

/**
 * Redirects the client to a validated URL with a given status code.
 * 
 * @param {Object} req - The request object, containing the URL to redirect.
 * @param {Object} res - The response object, used to send the redirect.
 * @param {number} [statusCode=302] - The HTTP status code for the redirect.
 */
function redirect(req, res, statusCode = 302) {
    const targetUrl = req.params.url;

    if (!targetUrl || !isValidUrl(targetUrl)) {
        console.error(`Invalid or missing target URL: ${targetUrl}`);
        return res.status(400).send('Invalid URL.');
    }

    if (res.headersSent) {
        console.error('Headers already sent; unable to redirect.');
        return;
    }

    // Remove restricted headers to prevent issues with redirection.
    ['content-length', 'cache-control', 'expires', 'date', 'etag'].forEach(header => res.removeHeader(header));

    // Set location header and perform redirect.
    const encodedUrl = encodeURI(targetUrl);
    res.set('Location', encodedUrl);

    console.log(`Redirecting to ${encodedUrl} with status code ${statusCode}.`);

    // For 302 status, include an HTML fallback.
    res.status(statusCode).send(
        statusCode === 302
            ? `<html><head><meta http-equiv="refresh" content="0;url=${encodedUrl}"></head><body></body></html>`
            : undefined
    );
}

export default redirect;

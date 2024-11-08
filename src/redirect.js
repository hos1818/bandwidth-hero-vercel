import { URL } from 'url';

/**
 * Validates a URL for security and format correctness.
 * @param {string} urlString - The URL to validate.
 * @returns {boolean} True if the URL is valid and secure, false otherwise.
 */
function isValidUrl(urlString) {
    if (!urlString) return false;

    try {
        const parsedUrl = new URL(normalizeUrl(urlString));
        const allowedProtocols = ['http:', 'https:'];

        // Basic regex to prevent JavaScript or data URLs
        const unsafePattern = /^(javascript|data):/i;
        return allowedProtocols.includes(parsedUrl.protocol) && !unsafePattern.test(urlString);
    } catch {
        return false;
    }
}

/**
 * Normalizes a URL by trimming spaces, removing trailing slashes, and
 * normalizing percent encoding.
 * @param {string} urlString - The URL to normalize.
 * @returns {string} The normalized URL.
 */
function normalizeUrl(urlString) {
    return urlString.trim().replace(/\/+$/, '').replace(/%20/g, ' ');
}

/**
 * Redirects the client to a validated URL with a given status code.
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

    // Remove headers that may interfere with redirection.
    ['content-length', 'cache-control', 'expires', 'date', 'etag'].forEach(header => res.removeHeader(header));

    // Set location header and perform redirect.
    const encodedUrl = encodeURI(targetUrl);
    res.set('Location', encodedUrl);

    console.log(`Redirecting to ${encodedUrl} with status code ${statusCode}.`);

    // Send a response with an HTML meta redirect as a fallback for 302 status.
    const htmlFallback = statusCode === 302
        ? `<html><head><meta http-equiv="refresh" content="0;url=${encodedUrl}"></head><body></body></html>`
        : '';

    res.status(statusCode).send(htmlFallback);
}

export default redirect;

import { URL } from 'url';
import { STATUS_CODES } from 'http'; // For meaningful status code validation.

const ALLOWED_PROTOCOLS = ['http:', 'https:'];
const RESTRICTED_HEADERS = ['content-length', 'cache-control', 'expires', 'date', 'etag'];

/**
 * Validates if the provided URL string is valid and uses allowed protocols.
 * @param {string} urlString - The URL string to validate.
 * @returns {boolean} True if the URL is valid, false otherwise.
 */
function isValidUrl(urlString) {
    if (!urlString) return false;

    try {
        const parsedUrl = new URL(normalizeUrl(urlString));
        return ALLOWED_PROTOCOLS.includes(parsedUrl.protocol);
    } catch {
        return false;
    }
}

/**
 * Normalizes a URL string by trimming, removing trailing slashes, and decoding spaces.
 * @param {string} urlString - The URL string to normalize.
 * @returns {string} The normalized URL string.
 */
function normalizeUrl(urlString) {
    return urlString.trim().replace(/\/+$/, '').replace(/%20/g, ' ');
}

/**
 * Generates an HTML page for a redirect.
 * @param {string} url - The target URL.
 * @returns {string} HTML content for the redirect.
 */
function generateRedirectHtml(url) {
    return `<html><head><meta http-equiv="refresh" content="0;url=${url}"></head><body>Redirecting to <a href="${url}">${url}</a></body></html>`;
}

/**
 * Validates if the status code is valid for a redirect.
 * @param {number} statusCode - The HTTP status code to validate.
 * @returns {boolean} True if the status code is valid, false otherwise.
 */
function isValidRedirectStatusCode(statusCode) {
    return statusCode >= 300 && statusCode < 400;
}

/**
 * Handles the redirect logic for the response object.
 * @param {Request} req - Express request object.
 * @param {Response} res - Express response object.
 * @param {number} statusCode - The HTTP status code for the redirect.
 */
function redirect(req, res, statusCode = 302) {
    if (!isValidRedirectStatusCode(statusCode)) {
        console.error(`Invalid status code for redirect: ${statusCode}`);
        return res.status(500).json({ error: 'Invalid redirect status code.' });
    }

    if (res.headersSent) {
        console.error('Headers already sent; unable to redirect.');
        return;
    }

    const targetUrl = req.params?.url;
    if (!targetUrl || !isValidUrl(targetUrl)) {
        console.error(`Invalid or missing target URL: ${targetUrl}`);
        return res.status(400).json({ error: 'Invalid or missing URL.' });
    }

    // Normalize and encode the target URL
    const normalizedUrl = normalizeUrl(targetUrl);

    try {
        const encodedUrl = encodeURI(normalizedUrl);

        // Remove restricted headers
        RESTRICTED_HEADERS.forEach(header => {
            if (res.hasHeader(header)) res.removeHeader(header);
        });

        // Set response headers for the redirect
        res.setHeader('Location', encodedUrl);

        console.log(`Redirecting to ${encodedUrl} with status code ${statusCode}.`);

        // Send the appropriate response
        res.status(statusCode).send(
            statusCode === 302 ? generateRedirectHtml(encodedUrl) : undefined
        );
    } catch (error) {
        console.error(`Failed to redirect: ${error.message}`);
        res.status(500).json({ error: 'Internal server error during redirect.' });
    }
}

export default redirect;

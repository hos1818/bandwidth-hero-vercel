import { URL } from 'url';

// Allowed protocols for valid URLs
const ALLOWED_PROTOCOLS = ['http:', 'https:'];
// Restricted headers to remove before redirection
const RESTRICTED_HEADERS = ['content-length', 'cache-control', 'expires', 'date', 'etag'];

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
        return ALLOWED_PROTOCOLS.includes(parsedUrl.protocol);
    } catch {
        return false;
    }
}

/**
 * Normalizes a URL by trimming spaces, removing trailing slashes, and normalizing percent encoding.
 * 
 * @param {string} urlString - The URL to normalize.
 * @returns {string} The normalized URL.
 */
function normalizeUrl(urlString) {
    return urlString.trim().replace(/\/+$/, '').replace(/%20/g, ' ');
}

/**
 * Generates an HTML fallback for redirection.
 * 
 * @param {string} url - The target URL for the redirect.
 * @returns {string} The HTML content for the redirect.
 */
function generateRedirectHtml(url) {
    return `<html><head><meta http-equiv="refresh" content="0;url=${url}"></head><body></body></html>`;
}

/**
 * Redirects the client to a validated URL with a given status code.
 * 
 * @param {Object} req - The request object, containing the URL to redirect.
 * @param {Object} res - The response object, used to send the redirect.
 * @param {number} [statusCode=302] - The HTTP status code for the redirect.
 */
function redirect(req, res, statusCode = 302) {
    // Validate status code
    if (statusCode < 300 || statusCode >= 400) {
        console.error(`Invalid status code for redirect: ${statusCode}`);
        return res.status(500).json({ error: 'Invalid redirect status code.' });
    }

    // Ensure headers haven't already been sent
    if (res.headersSent) {
        console.error('Headers already sent; unable to redirect.');
        return;
    }

    // Extract and validate the target URL
    const targetUrl = req.params.url;
    if (!targetUrl || !isValidUrl(targetUrl)) {
        console.error(`Invalid or missing target URL: ${targetUrl}`);
        return res.status(400).json({ error: 'Invalid URL.' });
    }

    // Remove restricted headers
    RESTRICTED_HEADERS.forEach(header => res.removeHeader(header));

    // Set location header and perform redirect
    const encodedUrl = encodeURI(targetUrl);
    res.setHeader('Location', encodedUrl);

    console.log(`Redirecting to ${encodedUrl} with status code ${statusCode}.`);

    // Respond with redirect status and HTML fallback for 302
    res.status(statusCode).send(
        statusCode === 302 ? generateRedirectHtml(encodedUrl) : undefined
    );
}

export default redirect;

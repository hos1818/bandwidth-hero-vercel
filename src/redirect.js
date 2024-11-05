const { URL } = require('url'); // Import URL class

/**
 * Validates a URL for security, ensuring allowed protocols and hosts.
 * @param {string} urlString - The URL to validate.
 * @param {Object} options - Validation options.
 * @param {Array<string>} options.allowedProtocols - List of allowed protocols.
 * @param {Array<string>} options.allowedHosts - List of allowed hostnames or domains.
 * @returns {boolean} True if the URL is valid, false otherwise.
 */
function isValidUrl(urlString, { allowedProtocols = ['http:', 'https:'], allowedHosts = [] } = {}) {
    if (!urlString) return false;

    try {
        const parsedUrl = new URL(normalizeUrl(urlString));

        // Check protocol
        if (!allowedProtocols.includes(parsedUrl.protocol)) {
            console.warn(`Blocked URL due to invalid protocol: ${parsedUrl.protocol}`);
            return false;
        }

        // Check host/domain
        if (allowedHosts.length && !allowedHosts.some(host => parsedUrl.hostname.endsWith(host))) {
            console.warn(`Blocked URL due to unauthorized host: ${parsedUrl.hostname}`);
            return false;
        }

        return true;
    } catch (error) {
        console.error(`Invalid URL format: ${urlString}. Error: ${error.message}`);
        return false;
    }
}

/**
 * Normalizes a URL by trimming whitespace, removing trailing slashes,
 * and decoding safe characters for consistency.
 * @param {string} urlString - The URL string to normalize.
 * @returns {string} - The normalized URL.
 */
function normalizeUrl(urlString) {
    return decodeURI(urlString.trim().replace(/\/+$/, ''));
}

/**
 * Redirects the client to a validated URL, preventing open redirects and loops.
 * @param {Object} req - The request object.
 * @param {Object} res - The response object.
 * @param {number} [statusCode=302] - The HTTP status code for the redirect.
 * @param {Object} options - Additional options for allowed hosts and protocols.
 */
function redirect(req, res, statusCode = 302, options = {}) {
    const targetUrl = req.params.url;
    if (!targetUrl) return res.status(400).send('Bad Request: Missing target URL.');

    const normalizedUrl = normalizeUrl(targetUrl);
    if (!isValidUrl(normalizedUrl, options)) {
        return res.status(400).send('Invalid URL.');
    }

    if (req.originalUrl === normalizedUrl) {
        return res.status(400).send('Redirect loop detected.');
    }

    if (res.headersSent) return;

    // Clear headers that might conflict with redirects
    ['content-length', 'cache-control', 'expires', 'date', 'etag'].forEach(header => res.removeHeader(header));

    // Set redirect location
    res.setHeader('location', encodeURI(normalizedUrl));
    
    // Log the redirection
    console.log(`Redirecting to ${normalizedUrl} from IP ${req.ip || req.connection.remoteAddress} with status ${statusCode}.`);

    // Send response with fallback HTML for old clients
    const redirectHtml = `<html><head><meta http-equiv="refresh" content="0;url=${encodeURI(normalizedUrl)}"></head><body>Redirecting...</body></html>`;
    res.status(statusCode).send(redirectHtml);
}

module.exports = redirect;

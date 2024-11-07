const { URL } = require('url');

/**
 * Validates a URL's format and security.
 * 
 * @param {string} urlString - The URL to validate.
 * @returns {boolean} True if the URL is valid, false otherwise.
 */
function isValidUrl(urlString) {
    try {
        // Parse and validate protocol
        const parsedUrl = new URL(normalizeUrl(urlString));
        return ['http:', 'https:'].includes(parsedUrl.protocol);
    } catch (error) {
        console.error(`Invalid URL: ${urlString}. Error: ${error.message}`);
        return false;
    }
}

/**
 * Normalizes a URL by trimming whitespace and removing trailing slashes.
 * 
 * @param {string} urlString - The URL string to normalize.
 * @returns {string} - The normalized URL.
 */
function normalizeUrl(urlString) {
    return decodeURI(urlString.trim().replace(/\/+$/, ''));
}

/**
 * Redirects a client to a validated URL, protecting against open redirects.
 * 
 * @param {Object} req - The request object with URL parameters.
 * @param {Object} res - The response object for sending headers and responses.
 * @param {number} [statusCode=302] - HTTP status code for the redirect.
 */
function redirect(req, res, statusCode = 302) {
    const targetUrl = req.params?.url;

    // Validate target URL
    if (!targetUrl || !isValidUrl(targetUrl)) {
        console.error(`Invalid or missing target URL: ${targetUrl}`);
        return res.status(400).send('Invalid or missing target URL.');
    }

    // Normalize URL and prevent redirect loops
    const normalizedUrl = normalizeUrl(targetUrl);
    if (req.originalUrl === normalizedUrl) {
        console.error('Detected a redirect loop.');
        return res.status(400).send('Redirect loop detected.');
    }

    // If headers already sent, prevent further action
    if (res.headersSent) {
        console.error('Headers already sent; cannot redirect.');
        return;
    }

    // Clear sensitive headers and set redirection location
    res.removeHeader('Content-Length');
    res.setHeader('Location', encodeURI(normalizedUrl));

    // Send response with redirect
    console.log(`Redirecting to ${normalizedUrl} with status code ${statusCode}.`);
    res.status(statusCode).send(statusCode === 302 ? `
        <html>
            <head><meta http-equiv="refresh" content="0;url=${encodeURI(normalizedUrl)}"></head>
            <body>Redirecting...</body>
        </html>
    ` : '');
}

module.exports = redirect;

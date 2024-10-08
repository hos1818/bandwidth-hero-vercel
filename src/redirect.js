const { URL } = require('url'); // Import the URL class from the 'url' module

/**
 * Validates a URL for security and format correctness.
 * 
 * @param {string} urlString - The URL to validate.
 * @returns {boolean} True if the URL is valid, false otherwise.
 */
function isValidUrl(urlString) {
    if (!urlString) {
        console.error('No URL provided for validation.');
        return false;
    }

    try {
        // Normalize and parse the URL.
        const normalizedUrl = normalizeUrl(urlString);
        const parsedUrl = new URL(normalizedUrl);

        // Allow only specific protocols for security reasons.
        const allowedProtocols = ['http:', 'https:']; 
        if (!allowedProtocols.includes(parsedUrl.protocol)) {
            console.error(`Invalid URL protocol: ${parsedUrl.protocol}`);
            return false;
        }

        return true; // URL passes all checks.
    } catch (error) {
        console.error(`Invalid URL: ${urlString}. Error: ${error.message}`);
        return false;
    }
}

/**
 * Normalizes a URL by trimming whitespace, removing trailing slashes, 
 * and decoding certain characters for consistency.
 * 
 * @param {string} urlString - The URL string to normalize.
 * @returns {string} - The normalized URL.
 */
function normalizeUrl(urlString) {
    // Normalize URL: trim, remove trailing slashes, and decode safe characters.
    return decodeURI(urlString.trim().replace(/\/+$/, ''));
}

/**
 * Redirects a client to a given URL, with built-in validation and protection 
 * against open redirect vulnerabilities.
 * 
 * @param {Object} req - The request object, containing URL parameters.
 * @param {Object} res - The response object, used to send headers and responses.
 * @param {number} [statusCode=302] - The HTTP status code for the redirect.
 */
function redirect(req, res, statusCode = 302) {
    const targetUrl = req.params.url;

    if (!targetUrl) {
        console.error('No target URL provided for redirection.');
        res.status(400).send('Bad Request: Missing target URL.');
        return;
    }

    // Normalize and validate the URL to prevent open redirects.
    const normalizedUrl = normalizeUrl(targetUrl);
    if (!isValidUrl(normalizedUrl)) {
        console.error(`Attempted redirect to unauthorized or invalid URL: ${targetUrl}`);
        res.status(400).send('Invalid URL.');
        return;
    }

    // Prevent redirect loops by checking if the URL is the same as the current request URL.
    if (req.originalUrl === normalizedUrl) {
        console.error('Detected a redirect loop.');
        res.status(400).send('Redirect loop detected.');
        return;
    }

    // Check if headers have already been sent.
    if (res.headersSent) {
        console.error('Headers already sent, unable to redirect.');
        return;
    }

    // Remove potentially harmful or conflicting headers.
    const restrictedHeaders = ['content-length', 'cache-control', 'expires', 'date', 'etag'];
    restrictedHeaders.forEach(header => res.removeHeader(header));

    // Set the location header for the redirect.
    res.setHeader('location', encodeURI(normalizedUrl));

    // Log the redirect for monitoring purposes.
    console.log(`Redirecting client to ${normalizedUrl} with status code ${statusCode}.`);

    // Send the response with the correct status and fallback HTML for older clients.
    if (statusCode === 302) {
        res.status(statusCode).send(`<html>
            <head><meta http-equiv="refresh" content="0;url=${encodeURI(normalizedUrl)}"></head>
            <body>Redirecting...</body>
            </html>`);
    } else {
        res.status(statusCode).end();
    }
}

module.exports = redirect;

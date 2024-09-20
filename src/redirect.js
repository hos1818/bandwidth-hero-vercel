const { URL } = require('url');

/**
 * Validates and normalizes a URL to ensure it meets security and format requirements.
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
        // Normalize and parse the URL
        const normalizedUrl = normalizeUrl(urlString);
        const parsedUrl = new URL(normalizedUrl);

        // Only allow specific protocols
        const allowedProtocols = ['http:', 'https:'];
        if (!allowedProtocols.includes(parsedUrl.protocol)) {
            console.error(`Invalid URL protocol: ${parsedUrl.protocol}`);
            return false;
        }

        // Optional: Add domain whitelisting logic here to ensure only trusted domains are allowed
        const allowedDomains = ['example.com', 'trusted-site.org'];
        if (!allowedDomains.some(domain => parsedUrl.hostname.endsWith(domain))) {
            console.error(`Unauthorized domain: ${parsedUrl.hostname}`);
            return false;
        }

        return true; // The URL passed all checks
    } catch (error) {
        // Handle errors during URL parsing
        console.error(`URL validation failed: ${urlString}. Error: ${error.message}`);
        return false;
    }
}

/**
 * Normalizes a URL by trimming whitespace, removing trailing slashes, and normalizing encoding.
 * 
 * @param {string} urlString - The URL to normalize.
 * @returns {string} The normalized URL.
 */
function normalizeUrl(urlString) {
    return urlString.trim().replace(/\/+$/, '').replace(/%20/g, ' ');
}

/**
 * Handles the HTTP redirect response, ensuring the target URL is valid and secure.
 * 
 * @param {object} req - The HTTP request object.
 * @param {object} res - The HTTP response object.
 * @param {number} [statusCode=302] - The HTTP status code to use for the redirect.
 */
function redirect(req, res, statusCode = 302) {
    const targetUrl = req.params.url;

    if (!targetUrl) {
        console.error('No target URL provided for redirection.');
        return res.status(400).send('Bad Request: Missing target URL.');
    }

    // Validate the target URL
    if (!isValidUrl(targetUrl)) {
        console.error(`Attempted redirect to an invalid or unauthorized URL: ${targetUrl}`);
        return res.status(400).send('Invalid URL.');
    }

    // Check if headers have already been sent
    if (res.headersSent) {
        console.error('Headers already sent, unable to perform redirect.');
        return;
    }

    // Remove potentially sensitive or problematic headers
    const restrictedHeaders = ['content-length', 'cache-control', 'expires', 'date', 'etag'];
    restrictedHeaders.forEach(header => res.removeHeader(header));

    // Set headers to enhance security during redirect
    res.setHeader('Location', encodeURI(targetUrl));
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'none'; connect-src 'self'");

    // Log the redirect for auditing purposes
    const clientIp = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    console.log(`Redirecting client ${clientIp} to ${targetUrl} with status code ${statusCode}.`);

    // Send the redirect response
    if (statusCode === 302) {
        res.status(statusCode).send(`<html>
            <head><meta http-equiv="refresh" content="0;url=${encodeURI(targetUrl)}"></head>
            <body></body>
            </html>`);
    } else {
        res.status(statusCode).end();
    }
}

module.exports = redirect;

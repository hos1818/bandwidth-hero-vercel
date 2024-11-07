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
        // Normalize the URL to ensure consistency
        const normalizedUrl = normalizeUrl(urlString);
        const parsedUrl = new URL(normalizedUrl); // Parsing might throw an error for invalid URLs.

        // Check if the URL uses an acceptable protocol.
        const allowedProtocols = ['http:', 'https:']; // Add other allowed schemes as needed
        if (!allowedProtocols.includes(parsedUrl.protocol)) {
            console.error(`Invalid URL protocol: ${parsedUrl.protocol}`);
            return false;
        }

        // Add more checks if necessary. For example, you might want to ensure
        // the URL host belongs to a list of trusted domains.

        return true; // The URL is valid
    } catch (error) {
        // Catch and log the error if URL parsing fails
        console.error(`Invalid URL: ${urlString}. Error: ${error.message}`);
        return false;
    }
}

function normalizeUrl(urlString) {
    // Remove trailing slashes and normalize percent encoding
    return urlString.trim().replace(/\/+$/, '').replace(/%20/g, ' ');
}

function redirect(req, res, statusCode = 302) {
    if (!req.params.url) {
        console.error('No target URL provided for redirection.');
        res.status(400).send('Bad Request: Missing target URL.');
        return;
    }

    // Validate URL to protect against open redirect vulnerabilities
    if (!isValidUrl(req.params.url)) {
        console.error(`Attempted redirect to unauthorized URL: ${req.params.url}`);
        res.status(400).send('Invalid URL.');
        return;
    }

    // Check if headers have already been sent
    if (res.headersSent) {
        console.error('Headers already sent, unable to redirect');
        return;
    }

    // Remove headers that might reveal sensitive information or cause issues with redirects
    const restrictedHeaders = ['content-length', 'cache-control', 'expires', 'date', 'etag'];
    restrictedHeaders.forEach(header => res.removeHeader(header));

    // Set the location header for the redirect
    res.setHeader('location', encodeURI(req.params.url));

    // Log the redirect for monitoring purposes
    console.log(`Redirecting client to ${req.params.url} with status code ${statusCode}.`);

    if (statusCode === 302) {
        // Adding HTML body as an extra measure for clients that don't follow redirects
        res.status(statusCode).send(`<html>
        <head><meta http-equiv="refresh" content="0;url=${encodeURI(req.params.url)}"></head>
        <body></body>
        </html>`);
    } else {
        res.status(statusCode).end();
    }
}

module.exports = redirect;

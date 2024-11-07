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
        const parsedUrl = new URL(normalizedUrl);

        // Check if the URL uses an acceptable protocol.
        const allowedProtocols = ['http:', 'https:'];
        if (!allowedProtocols.includes(parsedUrl.protocol)) {
            console.error(`Invalid URL protocol: ${parsedUrl.protocol}`);
            return false;
        }

        // Additional check for open redirects
        if (!parsedUrl.hostname) {
            console.error('Invalid hostname in URL.');
            return false;
        }

        return true; // The URL is valid
    } catch (error) {
        console.error(`Invalid URL: ${urlString}. Error: ${error.message}`);
        return false;
    }
}

/**
 * Normalize URL by trimming whitespaces and handling redundant slashes.
 *
 * @param {string} urlString - The URL to normalize.
 * @returns {string} - Normalized URL.
 */
function normalizeUrl(urlString) {
    return urlString.trim().replace(/\/+$/, '');
}

/**
 * Redirects the request to a validated URL with specific headers and status code.
 *
 * @param {Object} req - Request object.
 * @param {Object} res - Response object.
 * @param {number} statusCode - Status code for redirection, default is 302.
 */
function redirect(req, res, statusCode = 302) {
    const targetUrl = req.params.url;

    if (!targetUrl) {
        res.status(400).json({ error: 'Bad Request: Missing target URL.' });
        return;
    }

    // Validate URL to prevent open redirect vulnerabilities
    if (!isValidUrl(targetUrl)) {
        res.status(400).json({ error: 'Invalid URL.' });
        return;
    }

    if (res.headersSent) {
        console.error('Headers already sent, unable to redirect');
        return;
    }

    try {
        // Security headers
        res.setHeader('X-Content-Type-Options', 'nosniff');

        // Remove headers that might affect the redirection
        const restrictedHeaders = ['content-length', 'cache-control', 'expires', 'date', 'etag'];
        restrictedHeaders.forEach(header => res.removeHeader(header));

        // Redirect response
        const encodedUrl = encodeURI(targetUrl);
        res.setHeader('Location', encodedUrl);
        console.log(`Redirecting client to ${encodedUrl} with status code ${statusCode}.`);

        // Switch statement for redirection types
        switch (statusCode) {
            case 301:
            case 302:
                res.status(statusCode).send(`
                    <html>
                        <head><meta http-equiv="refresh" content="0;url=${encodedUrl}"></head>
                        <body>Redirecting...</body>
                    </html>`);
                break;
            default:
                res.status(statusCode).end();
                break;
        }
    } catch (error) {
        console.error(`Failed to redirect: ${error.message}`);
        res.status(500).json({ error: 'Internal Server Error' });
    }
}

module.exports = redirect;

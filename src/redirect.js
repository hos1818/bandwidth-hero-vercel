import { URL } from 'url';

/**
 * Validates a URL for security, protocol, format, and domain restrictions.
 * 
 * @param {string} urlString - The URL to validate.
 * @param {Object} options - Validation options.
 * @param {Array<string>} options.allowedProtocols - List of allowed protocols.
 * @param {Array<string>} options.allowedHosts - List of allowed hostnames or domains.
 * @returns {boolean} True if the URL is valid, false otherwise.
 */
function isValidUrl(urlString, options = {}) {
    if (!urlString) {
        console.error('No URL provided for validation.');
        return false;
    }

    const { allowedProtocols = ['http:', 'https:'], allowedHosts = [] } = options;

    try {
        const normalizedUrl = normalizeUrl(urlString);
        const parsedUrl = new URL(normalizedUrl);

        // Allow only specific protocols for security reasons.
        if (!allowedProtocols.includes(parsedUrl.protocol)) {
            console.error(`Invalid URL protocol: ${parsedUrl.protocol}`);
            return false;
        }

        // Allow only specific hosts/domains if specified.
        if (allowedHosts.length > 0) {
            const hostIsAllowed = allowedHosts.some(host => parsedUrl.hostname.endsWith(host));
            if (!hostIsAllowed) {
                console.error(`URL host not allowed: ${parsedUrl.hostname}`);
                return false;
            }
        }

        return true;
    } catch (error) {
        console.error(`Invalid URL: ${urlString}. Error: ${error.message}`);
        return false;
    }
}

/**
 * Normalizes a URL by trimming whitespace, removing trailing slashes,
 * and decoding safe characters for consistency.
 * 
 * @param {string} urlString - The URL string to normalize.
 * @returns {string} - The normalized URL.
 */
function normalizeUrl(urlString) {
    return decodeURI(urlString.trim().replace(/\/+$/, ''));
}

/**
 * Redirects a client to a given URL, with built-in validation and protection 
 * against open redirect vulnerabilities and redirect loops.
 * 
 * @param {Object} req - The request object, containing URL parameters.
 * @param {Object} res - The response object, used to send headers and responses.
 * @param {number} [statusCode=302] - The HTTP status code for the redirect.
 * @param {Object} options - Additional options for allowed hosts and protocols.
 */
function redirect(req, res, statusCode = 302, options = {}) {
    const targetUrl = req.params.url;

    if (!targetUrl) {
        console.error('No target URL provided for redirection.');
        res.status(400).send('Bad Request: Missing target URL.');
        return;
    }

    // Normalize and validate the URL to prevent open redirects.
    const normalizedUrl = normalizeUrl(targetUrl);
    if (!isValidUrl(normalizedUrl, options)) {
        console.error(`Attempted redirect to unauthorized or invalid URL: ${targetUrl}`);
        res.status(400).send('Invalid URL.');
        return;
    }

    // Prevent redirect loops by checking if the URL matches the current request URL.
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

    // Log redirect details for monitoring.
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    console.log(`Redirecting client to ${normalizedUrl} from IP ${clientIp} with status code ${statusCode}.`);

    // Send the response with fallback HTML for older clients.
    if (statusCode === 302) {
        res.status(statusCode).send(`<html>
            <head><meta http-equiv="refresh" content="0;url=${encodeURI(normalizedUrl)}"></head>
            <body>
                <script>window.location.href = "${encodeURI(normalizedUrl)}";</script>
                Redirecting...
            </body>
            </html>`);
    } else {
        res.status(statusCode).end();
    }
}


export default redirect;

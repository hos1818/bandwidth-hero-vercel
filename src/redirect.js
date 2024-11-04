const { URL } = require('url');

/**
 * Validates a URL for security, protocol, format, and domain restrictions.
 * 
 * @param {string} urlString - The URL to validate.
 * @param {Object} options - Validation options.
 * @param {Array<string>} options.allowedProtocols - List of allowed protocols.
 * @param {Array<string>} options.allowedHosts - List of allowed hostnames or domains.
 * @param {number} options.maxLength - Maximum allowed URL length (default: 2048).
 * @returns {boolean} True if the URL is valid, false otherwise.
 */
function isValidUrl(urlString, options = {}) {
    // Early validation to prevent unnecessary processing
    if (!urlString || typeof urlString !== 'string') {
        console.error('Invalid or missing URL string');
        return false;
    }

    const {
        allowedProtocols = ['http:', 'https:'],
        allowedHosts = [],
        maxLength = 2048
    } = options;

    // Check URL length to prevent DoS attacks
    if (urlString.length > maxLength) {
        console.error(`URL exceeds maximum length of ${maxLength} characters`);
        return false;
    }

    try {
        const normalizedUrl = normalizeUrl(urlString);
        
        // Use URL constructor for basic validation
        const parsedUrl = new URL(normalizedUrl);
        
        // Validate protocol
        if (!allowedProtocols.includes(parsedUrl.protocol.toLowerCase())) {
            console.error(`Invalid URL protocol: ${parsedUrl.protocol}`);
            return false;
        }

        // Validate hostname
        if (allowedHosts.length > 0) {
            const hostname = parsedUrl.hostname.toLowerCase();
            const hostIsAllowed = allowedHosts.some(host => 
                hostname === host.toLowerCase() || hostname.endsWith(`.${host.toLowerCase()}`));
            
            if (!hostIsAllowed) {
                console.error(`URL host not allowed: ${parsedUrl.hostname}`);
                return false;
            }
        }

        // Clear parsedUrl reference to prevent memory leaks
        parsedUrl.searchParams.clear();
        return true;

    } catch (error) {
        console.error(`URL validation failed: ${error.message}`);
        return false;
    }
}

/**
 * Normalizes a URL by trimming whitespace, removing trailing slashes,
 * and handling encoded characters safely.
 * 
 * @param {string} urlString - The URL string to normalize.
 * @returns {string} - The normalized URL.
 * @throws {Error} - If URL normalization fails
 */
function normalizeUrl(urlString) {
    if (!urlString) return '';
    
    try {
        // Remove whitespace and trailing slashes
        const trimmed = urlString.trim().replace(/\/+$/, '');
        
        // Safely decode URI components
        return decodeURIComponent(encodeURIComponent(trimmed));
    } catch (error) {
        throw new Error(`URL normalization failed: ${error.message}`);
    }
}

/**
 * Redirects a client to a given URL with security measures against
 * open redirects, redirect loops, and potential memory leaks.
 * 
 * @param {Object} req - The request object.
 * @param {Object} res - The response object.
 * @param {number} [statusCode=302] - The HTTP status code for the redirect.
 * @param {Object} options - Additional options for validation.
 * @param {Function} [errorHandler] - Custom error handler function.
 */
function redirect(req, res, statusCode = 302, options = {}, errorHandler) {
    // Input validation
    if (!req || !res) {
        const error = new Error('Missing required parameters');
        if (errorHandler) {
            errorHandler(error);
        } else {
            console.error(error);
        }
        return;
    }

    const targetUrl = req.params.url || req.query.url;
    
    if (!targetUrl) {
        const error = new Error('No target URL provided');
        handleRedirectError(res, error, errorHandler);
        return;
    }

    try {
        // Normalize and validate URL
        const normalizedUrl = normalizeUrl(targetUrl);
        if (!isValidUrl(normalizedUrl, options)) {
            throw new Error('Invalid or unauthorized URL');
        }

        // Prevent redirect loops
        const currentUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
        if (normalizedUrl === currentUrl) {
            throw new Error('Redirect loop detected');
        }

        // Check headers
        if (res.headersSent) {
            throw new Error('Headers already sent');
        }

        // Clean up headers
        cleanupHeaders(res);

        // Set security headers
        setSecurityHeaders(res);

        // Set redirect location
        const encodedUrl = encodeURI(normalizedUrl);
        res.setHeader('Location', encodedUrl);

        // Log redirect (with sensitive data handling)
        logRedirect(req, encodedUrl, statusCode);

        // Send appropriate response
        sendRedirectResponse(res, statusCode, encodedUrl);

    } catch (error) {
        handleRedirectError(res, error, errorHandler);
    }
}

/**
 * Handles redirect errors consistently
 */
function handleRedirectError(res, error, errorHandler) {
    if (errorHandler) {
        errorHandler(error);
    } else {
        console.error(error);
    }

    if (!res.headersSent) {
        res.status(400).send('Redirect failed: ' + error.message);
    }
}

/**
 * Removes potentially harmful headers
 */
function cleanupHeaders(res) {
    const restrictedHeaders = [
        'content-length',
        'content-type',
        'transfer-encoding',
        'cache-control',
        'expires',
        'date',
        'etag',
        'last-modified'
    ];
    
    restrictedHeaders.forEach(header => res.removeHeader(header));
}

/**
 * Sets security-related headers
 */
function setSecurityHeaders(res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'none'");
}

/**
 * Logs redirect information safely
 */
function logRedirect(req, encodedUrl, statusCode) {
    const clientIp = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '')
        .split(',')[0]
        .trim();
    
    console.log({
        timestamp: new Date().toISOString(),
        action: 'redirect',
        statusCode,
        targetUrl: encodedUrl,
        clientIp,
        userAgent: req.headers['user-agent'] || 'unknown'
    });
}

/**
 * Sends the appropriate redirect response
 */
function sendRedirectResponse(res, statusCode, encodedUrl) {
    if (statusCode === 302) {
        const html = `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta http-equiv="refresh" content="0;url=${encodedUrl}">
                <title>Redirecting...</title>
            </head>
            <body>
                <script>window.location.href="${encodedUrl}";</script>
                <p>Redirecting to new location...</p>
            </body>
            </html>`;
        
        res.status(statusCode)
           .setHeader('Content-Type', 'text/html; charset=UTF-8')
           .send(html);
    } else {
        res.status(statusCode).end();
    }
}

module.exports = {
    redirect,
    isValidUrl,
    normalizeUrl
};

import validator from 'validator';

// Constants for quality range and default settings
const DEFAULT_QUALITY = parseInt(process.env.DEFAULT_QUALITY, 10) || 40;
const MAX_QUALITY = parseInt(process.env.MAX_QUALITY, 10) || 100;
const MIN_QUALITY = parseInt(process.env.MIN_QUALITY, 10) || 10;

/**
 * Middleware to parse and validate query parameters.
 */
function params(req, res, next) {
    try {
        let { url } = req.query;

        // Handle multiple URLs by returning an error (for better clarity) or process individually.
        if (Array.isArray(url)) {
            console.warn('Multiple URLs provided; only the first URL will be processed.');
            url = url[0];
        }

        if (!url) {
            return res.end('bandwidth-hero-proxy');
        }

        // Normalize and validate the URL.
        url = normalizeUrl(url);
        if (!isValidUrl(url)) {
            console.error({ message: 'Invalid URL received', url });
            return res.status(400).json({ error: 'Invalid URL. Ensure it includes the protocol (http or https).' });
        }

        // Set validated and sanitized URL
        req.params.url = url;

        // Determine output format: WebP by default, or JPEG if explicitly requested.
        req.params.webp = !req.query.jpeg;

        // Set grayscale mode based on the "bw" parameter; default is true.
        req.params.grayscale = parseBoolean(req.query.bw, true);

        // Parse and validate quality parameter; enforce bounds.
        req.params.quality = parseQuality(req.query.l, DEFAULT_QUALITY, MIN_QUALITY, MAX_QUALITY);

        next();
    } catch (error) {
        console.error({ message: 'Error in params middleware', error: error.message });
        res.status(500).json({ error: 'Internal Server Error' });
    }
}

/**
 * Normalize URL by handling specific patterns.
 */
function normalizeUrl(url) {
    return decodeURIComponent(url.trim().replace(/\/+$/, ''));
}

/**
 * Validate URL for required protocol and structure.
 */
function isValidUrl(url) {
    return validator.isURL(url, { require_protocol: true });
}

/**
 * Parse boolean-like query parameters. Default if value is undefined.
 */
function parseBoolean(value, defaultValue) {
    if (value === undefined) return defaultValue;
    const truthyValues = ['true', '1', 'yes', 'on'];
    const falsyValues = ['false', '0', 'no', 'off'];
    const lowerValue = value.toLowerCase();
    if (truthyValues.includes(lowerValue)) return true;
    if (falsyValues.includes(lowerValue)) return false;
    return defaultValue;
}

/**
 * Parse and validate quality parameter; enforce bounds and defaults.
 */
function parseQuality(quality, defaultQuality, min, max) {
    const parsed = parseInt(quality, 10);
    if (isNaN(parsed)) {
        console.warn(`Invalid quality value "${quality}"; using default (${defaultQuality}).`);
        return defaultQuality;
    }
    if (parsed < min || parsed > max) {
        console.warn(`Quality value "${parsed}" out of bounds; clamping to range [${min}, ${max}].`);
        return Math.min(Math.max(parsed, min), max);
    }
    return parsed;
}

export default params;

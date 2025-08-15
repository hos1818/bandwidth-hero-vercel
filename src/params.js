import validator from 'validator';

// Constants for quality range and defaults
const DEFAULT_QUALITY = clampInt(process.env.DEFAULT_QUALITY, 40, 10, 100);
const MAX_QUALITY = clampInt(process.env.MAX_QUALITY, 100, 10, 100);
const MIN_QUALITY = clampInt(process.env.MIN_QUALITY, 10, 1, 100);

// Middleware
function params(req, res, next) {
    try {
        let { url } = req.query;

        if (!url) {
            return res.end('bandwidth-hero-proxy');
        }

        if (Array.isArray(url)) {
            console.warn('Multiple URLs provided; using the first.');
            url = url[0];
        }

        // Quick reject if it doesn't even start with http(s)
        if (!/^https?:\/\//i.test(url)) {
            return res.status(400).json({ error: 'URL must include protocol (http or https).' });
        }

        // Normalize & validate
        url = normalizeUrl(url);
        if (!isValidUrl(url)) {
            console.error({ message: 'Invalid URL received', url });
            return res.status(400).json({ error: 'Invalid URL. Ensure it includes the protocol (http or https).' });
        }

        req.params.url = url;
        req.params.webp = !req.query.jpeg;
        req.params.grayscale = parseBoolean(req.query.bw, true);
        req.params.quality = parseQuality(req.query.l, DEFAULT_QUALITY, MIN_QUALITY, MAX_QUALITY);

        next();
    } catch (error) {
        console.error({ message: 'Error in params middleware', error: error.message });
        res.status(500).json({ error: 'Internal Server Error' });
    }
}

function normalizeUrl(url) {
    return decodeURIComponent(url.trim().replace(/\/+$/, ''));
}

function isValidUrl(url) {
    return validator.isURL(url, { require_protocol: true });
}

function parseBoolean(value, defaultValue) {
    if (value === undefined) return defaultValue;
    const v = String(value).trim().toLowerCase();
    const truthy = new Set(['true', '1', 'yes', 'on']);
    const falsy = new Set(['false', '0', 'no', 'off']);
    if (truthy.has(v)) return true;
    if (falsy.has(v)) return false;
    return defaultValue;
}

function parseQuality(quality, defaultQuality, min, max) {
    const parsed = parseInt(quality, 10);
    if (Number.isNaN(parsed)) {
        console.warn(`Invalid quality "${quality}"; using default (${defaultQuality}).`);
        return defaultQuality;
    }
    if (parsed < min || parsed > max) {
        console.warn(`Quality "${parsed}" out of bounds; clamping to [${min}, ${max}].`);
        return Math.min(Math.max(parsed, min), max);
    }
    return parsed;
}

function clampInt(value, fallback, min, max) {
    const parsed = parseInt(value, 10);
    if (Number.isNaN(parsed)) return fallback;
    return Math.min(Math.max(parsed, min), max);
}

export default params;

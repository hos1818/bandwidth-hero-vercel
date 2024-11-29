import validator from 'validator';

// Constants for quality range and default settings
const DEFAULT_QUALITY = 40;
const MAX_QUALITY = 100;
const MIN_QUALITY = 10;

/**
 * Middleware to parse and validate query parameters.
 */
function params(req, res, next) {
  try {
    let { url } = req.query;

    // Handle multiple URLs by joining them (warn for debugging purposes).
    if (Array.isArray(url)) {
      console.warn('Multiple URLs provided; concatenating for processing.');
      url = url.join('&url=');
    }

    if (!url) {
      return res.end('bandwidth-hero-proxy');
    }

    // Normalize the URL by removing specific "bmi" patterns.
    url = normalizeUrl(url);

    // Validate the URL for required protocol and overall structure.
    if (!validator.isURL(url, { require_protocol: true })) {
      console.error(`Invalid URL received: ${url}`);
      return res.status(400).json({ error: 'Invalid URL' });
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
    console.error(`Error in params middleware: ${error.message}`);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}

/**
 * Normalize URL by handling "bmi" patterns.
 */
function normalizeUrl(url) {
  return url.replace(/http:\/\/1\.1\.\d\.\d\/bmi\/(https?:\/\/)?/i, 'http://');
}

/**
 * Parse boolean-like query parameters. Default if value is undefined.
 */
function parseBoolean(value, defaultValue) {
  if (value === undefined) return defaultValue;
  return value !== '0' && value !== 'false';
}

/**
 * Parse and validate quality parameter; enforce bounds and defaults.
 */
function parseQuality(quality, defaultQuality, min, max) {
  const parsed = parseInt(quality, 10);
  if (isNaN(parsed)) return defaultQuality;
  return Math.min(Math.max(parsed, min), max);
}

export default params;

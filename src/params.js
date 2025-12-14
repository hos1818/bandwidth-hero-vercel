import validator from 'validator';

// Utility to safely clamp integer values
const clampInt = (value, fallback, min, max) => {
  const n = parseInt(value, 10);
  return Number.isNaN(n) ? fallback : Math.min(Math.max(n, min), max);
};

// Constants
const DEFAULT_QUALITY = clampInt(process.env.DEFAULT_QUALITY, 40, 10, 100);
const MAX_QUALITY = clampInt(process.env.MAX_QUALITY, 100, 10, 100);
const MIN_QUALITY = clampInt(process.env.MIN_QUALITY, 10, 1, 100);

/**
 * Normalizes a URL safely.
 */
function normalizeUrl(input) {
  if (typeof input !== 'string') return '';

  let decoded;

  // 1️⃣ Decode query param ONCE
  try {
    decoded = decodeURIComponent(input);
  } catch {
    decoded = input;
  }

  let url;
  try {
    url = new URL(decoded);
  } catch {
    return '';
  }

  // 2️⃣ Encode ONLY path segments
  url.pathname = url.pathname
    .split('/')
    .map(seg => encodeURIComponent(decodeURIComponent(seg)))
    .join('/');

  return url.href;
}

/**
 * Validates URL syntax and required protocol.
 */
function isValidUrl(url) {
  return validator.isURL(url, {
    require_protocol: true,
    protocols: ['http', 'https'],
    allow_underscores: true,
    disallow_auth: true,
  });
}

/**
 * Parses boolean-like query values (e.g. "1", "yes", "true").
 */
function parseBoolean(value, defaultValue) {
  if (value === undefined) return defaultValue;
  const str = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(str)) return true;
  if (['0', 'false', 'no', 'off'].includes(str)) return false;
  return defaultValue;
}

/**
 * Parses image quality within safe bounds.
 */
function parseQuality(q, defaultValue, min, max) {
  const n = parseInt(q, 10);
  if (Number.isNaN(n)) return defaultValue;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

/**
 * Main middleware to validate and prepare query parameters.
 */
function params(req, res, next) {
  try {
    let { url } = req.query;

    if (!url) {
      // Health-check / base response
      return res.status(200).send('bandwidth-hero-proxy');
    }

    if (Array.isArray(url)) {
      console.warn('[Params] Multiple URLs provided; using the first.');
      url = url[0];
    }

    // Fast precheck (saves CPU if malformed)
    if (!/^https?:\/\//i.test(url)) {
      return res.status(400).json({
        error: 'Invalid URL. Must include protocol (http or https).',
      });
    }

    // Normalize and validate
    url = normalizeUrl(url);
    if (!isValidUrl(url)) {
      console.error('[Params] Invalid URL:', url);
      return res.status(400).json({
        error: 'Invalid URL. Ensure it includes a valid protocol and domain.',
      });
    }

    // Safe params extraction
    req.params = {
      ...req.params,
      url,
      webp: !req.query.jpeg,
      grayscale: parseBoolean(req.query.bw, true),
      quality: parseQuality(req.query.l, DEFAULT_QUALITY, MIN_QUALITY, MAX_QUALITY),
    };

    return next();
  } catch (err) {
    console.error('[Params Middleware Error]', err);
    if (!res.headersSent)
      res.status(500).json({ error: 'Internal server error in params middleware.' });
  }
}

export default params;





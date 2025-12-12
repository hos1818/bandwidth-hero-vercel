import validator from 'validator';

// --- Configuration ---
const DEFAULT_QUALITY = 40;

// Helper: Safe integer parsing
const getInt = (val, def, min, max) => {
  const n = parseInt(val, 10);
  return Number.isNaN(n) ? def : Math.min(Math.max(n, min), max);
};

// Limits
const MIN_QUALITY = getInt(process.env.MIN_QUALITY, 10, 1, 100);
const MAX_QUALITY = getInt(process.env.MAX_QUALITY, 100, 10, 100);
const DEF_QUALITY = getInt(process.env.DEFAULT_QUALITY, DEFAULT_QUALITY, MIN_QUALITY, MAX_QUALITY);

/**
 * Parses boolean-like query values.
 * Handles: "1", "true", "yes", "on" -> true
 */
function parseBoolean(value, defaultValue = false) {
  if (value === undefined || value === null) return defaultValue;
  const str = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(str)) return true;
  if (['0', 'false', 'no', 'off'].includes(str)) return false;
  return defaultValue;
}

/**
 * Validates the URL structure.
 * Enforces protocol and prevents simple localhost strings.
 */
function isValidTargetUrl(url) {
  if (!url || typeof url !== 'string') return false;
  
  return validator.isURL(url, {
    protocols: ['http', 'https'],
    require_protocol: true,
    require_tld: true,       // Block "http://localhost" or "http://internal-server"
    require_valid_protocol: true,
    allow_underscores: true,
    allow_fragments: false,  // Fragments (#) are irrelevant for backend proxies
    allow_query_components: true
  });
}

/**
 * Main Middleware
 * Unifies query parameters into req.params for downstream consumption.
 */
function params(req, res, next) {
  try {
    // 1. Extract URL
    let { url } = req.query;

    if (!url) {
      // No URL provided? Return 200 OK so the proxy server itself can be pinged/monitored.
      return res.status(200).send('bandwidth-hero-proxy');
    }

    // Handle duplicate params (?url=a&url=b) - take the first one
    if (Array.isArray(url)) url = url[0];

    // 2. Cleanup
    // Note: Do NOT use decodeURIComponent here. Express req.query is already decoded.
    // Double decoding breaks URLs that have encoded params inside them.
    url = url.trim();

    // 3. Validation
    if (!isValidTargetUrl(url)) {
      // Log invalid attempts for security auditing
      console.warn(`[Params] Rejected invalid URL: ${url}`);
      return res.status(400).json({ 
        error: 'Invalid URL', 
        details: 'URL must be absolute, contain a valid scheme (http/s), and a valid TLD.' 
      });
    }

    // 4. Parse Options
    // Logic: If 'jpeg' is true, webp is false. Default to WebP (unless jpeg=1).
    const isJpeg = parseBoolean(req.query.jpeg, false);
    
    // Logic: Bandwidth saving usually implies Grayscale, but default should likely be Color 
    // unless 'bw' is explicitly set to 1.
    const isGrayscale = parseBoolean(req.query.bw, false);

    const quality = getInt(req.query.l, DEF_QUALITY, MIN_QUALITY, MAX_QUALITY);

    // 5. Attach to req.params
    // We normalize everything into req.params so downstream logic (compress/bypass) 
    // doesn't need to look at req.query.
    req.params.url = url;
    req.params.webp = !isJpeg;
    req.params.grayscale = isGrayscale;
    req.params.quality = quality;

    next();

  } catch (err) {
    console.error(`[Params] Error: ${err.message}`);
    return res.status(500).json({ error: 'Parameter parsing failed' });
  }
}

export default params;

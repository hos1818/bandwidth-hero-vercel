/**
 * Copies headers from a source object to a target response, with exclusions and optional value transformation.
 * Optimized for Vercel/serverless environments (lightweight, safe, minimal sync overhead).
 *
 * @param {Object} source - Object containing headers (e.g. response from Got).
 * @param {Object} target - Target object (e.g. Vercel/Express response) with setHeader().
 * @param {string[]} [excluded=[]] - Additional headers to exclude (case-insensitive).
 * @param {Function} [transform=null] - Optional (key, value) => newValue transformer.
 */
function copyHeaders(source, target, excluded = [], transform = null) {
  if (!source?.headers || typeof source.headers !== 'object') return;
  if (typeof target?.setHeader !== 'function') return;

  // Base exclusions (security & transport)
  const EXCLUDED = new Set([
    'host', 'connection', 'authorization', 'cookie', 'set-cookie',
    'content-length', 'transfer-encoding', 'keep-alive',
    ':status', ':method', ':path', ':scheme', ':authority',
    ...excluded.map(h => h.toLowerCase())
  ]);

  const headers = source.headers;
  const strictMode = process.env.STRICT_TRANSFORM === 'true';

  for (const [key, rawValue] of Object.entries(headers)) {
    const lowerKey = key.toLowerCase();
    if (EXCLUDED.has(lowerKey)) continue;

    let value = rawValue;
    if (transform) {
      try {
        value = transform(key, value);
        if (value === null || value === undefined) continue;
      } catch (err) {
        console.warn(`[copyHeaders] Transform failed for "${key}": ${err.message}`);
        if (strictMode) throw err;
        continue;
      }
    }

    try {
      // Normalize header value(s)
      if (Array.isArray(value)) {
        target.setHeader(key, value.map(String));
      }else {
        target.setHeader(key, String(value));
      }
    } catch (err) {
      console.error(`[copyHeaders] Failed to set header "${key}": ${err.message}`);
    }
  }
}

export default copyHeaders;


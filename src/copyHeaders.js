// --- Constants (Module Scope for Performance) ---

// 1. Hop-by-hop headers (RFC 2616) - These should never be forwarded by a proxy
const HOP_BY_HOP_HEADERS = [
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade'
];

// 2. Content headers that conflict with Proxy processing
// - content-length: We might recompress or resize.
// - content-encoding: We decompressed it, so it's likely 'identity' now.
// - host: We are the new host.
const CONFLICT_HEADERS = [
  'host', 
  'content-length', 
  'content-encoding'
];

// 3. Security & Context headers
// - access-control-*: The proxy should define CORS, not the upstream.
// - content-security-policy: Upstream CSP will likely block the proxy's domain.
// - cookie/set-cookie: Usually unsafe to forward blindly unless specific logic exists.
const SECURITY_HEADERS = [
  'authorization',
  'cookie', 
  'set-cookie',
  'content-security-policy',
  'content-security-policy-report-only',
  'strict-transport-security',
  'access-control-allow-origin',
  'access-control-allow-methods',
  'access-control-allow-headers',
  'access-control-expose-headers'
];

// Combine into a single fast lookup Set
const BLOCKED_HEADERS = new Set([
  ...HOP_BY_HOP_HEADERS,
  ...CONFLICT_HEADERS,
  ...SECURITY_HEADERS
]);

/**
 * Copies headers from a source object to a target response.
 * Handles exclusions, header normalization, and status codes.
 *
 * @param {Object} source - Object containing { headers, status/statusCode }.
 * @param {Object} target - Target response object (Express or Node http.ServerResponse).
 * @param {string[]} [customExcluded=[]] - Additional headers to exclude.
 * @param {Function} [transform=null] - Optional transformer (key, value) => newValue.
 */
export default function copyHeaders(source, target, customExcluded = [], transform = null) {
  if (!source?.headers || !target) return;

  // 1. Handle Status Code
  // Supports both Express (.status()) and Node native (.statusCode =)
  const status = source.status || source.statusCode;
  if (status && Number.isInteger(status)) {
    if (typeof target.status === 'function') {
      target.status(status); // Express
    } else {
      target.statusCode = status; // Native
    }
  }

  // 2. Iterate and Copy Headers
  const headers = source.headers;
  
  // Optimization: Pre-calculate custom exclusion check to avoid Set creation if empty
  const hasCustom = customExcluded.length > 0;
  
  for (const key in headers) {
    if (!Object.prototype.hasOwnProperty.call(headers, key)) continue;

    const lowerKey = key.toLowerCase();

    // Fast Exclusion Checks
    if (BLOCKED_HEADERS.has(lowerKey)) continue;
    if (hasCustom && customExcluded.includes(lowerKey)) continue;

    let value = headers[key];

    // 3. Optional Transformation
    if (transform) {
      try {
        value = transform(key, value);
        if (value === null || value === undefined) continue; // Skip if transform returns null
      } catch (err) {
        // In production, we skip the header rather than crashing request
        continue;
      }
    }

    // 4. Set Header Safely
    try {
      // Node.js setHeader handles array of strings (for set-cookie, etc) automatically.
      // We ensure strictly that we aren't passing objects/nulls.
      if (Array.isArray(value)) {
         // Filter out nulls/undefined in arrays
         const cleanValues = value.filter(v => v !== null && v !== undefined).map(String);
         if (cleanValues.length > 0) target.setHeader(key, cleanValues);
      } else {
        if (value !== null && value !== undefined) {
           target.setHeader(key, String(value));
        }
      }
    } catch (err) {
      // Ignore invalid header characters to prevent response splitting attacks
      // or crashing on malformed upstream headers.
    }
  }
}

import { URL } from 'url';

// --- Constants ---
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

// Headers that should NOT be present on a redirect response to prevent client confusion
const STRIPPED_HEADERS = [
  'content-length', 
  'content-type',
  'content-encoding',
  'cache-control', 
  'expires', 
  'date', 
  'etag', 
  'last-modified'
];

// Basic regex to detect loopback/private addresses (Simple SSRF protection)
// Note: For strict production environments, use a library like 'ipaddr.js'
const IS_LOCALHOST = /^127\.|^0\.0\.|^192\.168\.|^10\.|^172\.(1[6-9]|2[0-9]|3[0-1])\.|^localhost$|^::1$/i;

/**
 * Validates and parses a URL. Returns the URL object or null.
 * @param {string} urlString 
 * @returns {URL|null}
 */
function parseAndValidateUrl(urlString) {
  if (!urlString || typeof urlString !== 'string') return null;

  try {
    // 1. Basic trim and cleanup
    const cleanUrl = urlString.trim();
    const parsed = new URL(cleanUrl);

    // 2. Protocol Allowlist (No javascript: or file:)
    if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) return null;

    // 3. Hostname Validation
    if (!parsed.hostname) return null;

    // 4. SSRF Check: Block localhost/private IPs
    if (IS_LOCALHOST.test(parsed.hostname)) return null;

    return parsed;
  } catch {
    return null;
  }
}

/**
 * Escapes HTML characters to prevent XSS in the fallback body.
 */
function escapeHtml(str) {
  if (!str) return '';
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return str.replace(/[&<>"']/g, match => map[match]);
}

/**
 * Generates an HTML body for browsers that ignore headers (rare, but spec compliant).
 */
function generateRedirectHtml(url) {
  const safeUrl = escapeHtml(url);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="refresh" content="0;url=${safeUrl}">
  <title>Redirecting...</title>
</head>
<body>
  <p>Redirecting to <a href="${safeUrl}">${safeUrl}</a></p>
</body>
</html>`;
}

/**
 * Main Redirect Middleware
 * @param {object} req - Express/Node request
 * @param {object} res - Express/Node response
 * @param {number} statusCode - HTTP Status (default 302)
 */
export default function redirect(req, res, statusCode = 302) {
  // 1. Fail safe: Do nothing if headers are already sent
  if (res.headersSent) return;

  try {
    // 2. Validate Status Code
    if (!Number.isInteger(statusCode) || statusCode < 300 || statusCode >= 400) {
      console.warn(`[Redirect] Invalid status ${statusCode}, defaulting to 302`);
      statusCode = 302;
    }

    // 3. Extract and Validate URL
    // Supports params (path) or query string (?url=...)
    const inputUrl = req.params?.url || req.query?.url;
    const urlObj = parseAndValidateUrl(inputUrl);

    if (!urlObj) {
      console.error('[Redirect] Blocked invalid or unsafe URL:', inputUrl);
      return res.status(400).json({ error: 'Invalid, missing, or unsafe URL.' });
    }

    // 4. Serialize URL (Handles encoding automatically)
    const finalUrl = urlObj.toString();

    // 5. Clean Headers
    // Remove headers that might conflict with a redirect
    for (const name of STRIPPED_HEADERS) {
      res.removeHeader(name);
    }

    // 6. Set Redirect Headers
    res.setHeader('Location', finalUrl);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Expires', '0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('X-Content-Type-Options', 'nosniff'); // Security header

    // 7. Send Response
    // 301/302/303/307/308 all support an HTML body, but browsers usually ignore it.
    // It is good practice for non-browser clients or debugging.
    const html = generateRedirectHtml(finalUrl);
    
    // Explicitly set content type for the fallback body
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Length', Buffer.byteLength(html));
    
    res.status(statusCode).end(html);

  } catch (err) {
    console.error('[Redirect] Internal Error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error during redirect.' });
    }
  }
}

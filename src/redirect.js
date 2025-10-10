import { URL } from 'url';
import { STATUS_CODES } from 'http';

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);
const RESTRICTED_HEADERS = ['content-length', 'cache-control', 'expires', 'date', 'etag'];

/**
 * Checks if a status code is a valid redirect code..
 */
function isValidRedirectStatusCode(statusCode) {
  return Number.isInteger(statusCode) && statusCode >= 300 && statusCode < 400;
}

/**
 * Normalizes and sanitizes a URL string.
 */
function normalizeUrl(urlString) {
  return urlString.trim().replace(/\/+$/, '').replace(/\s+/g, '%20');
}

/**
 * Validates the given URL (protocol + hostname).
 */
function isValidUrl(urlString) {
  if (!urlString || typeof urlString !== 'string') return false;
  try {
    const parsed = new URL(normalizeUrl(urlString));
    return ALLOWED_PROTOCOLS.has(parsed.protocol) && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

/**
 * Escapes HTML special characters for fallback pages.
 */
function escapeHtml(str) {
  return str.replace(/[&<>"']/g, match =>
    ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[match])
  );
}

/**
 * Generates minimal fallback HTML for redirect.
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
  <body style="font-family:sans-serif;text-align:center;padding-top:2rem;">
    Redirecting to <a href="${safeUrl}">${safeUrl}</a>
  </body>
</html>`;
}

/**
 * Main redirect middleware.
 */
function redirect(req, res, statusCode = 302, includeHtmlFallback = true) {
  try {
    if (!isValidRedirectStatusCode(statusCode)) {
      console.error('[Redirect] Invalid status code:', statusCode);
      return res.status(500).json({
        error: 'Invalid redirect status code.',
        details: `Expected 3xx, got ${statusCode}.`,
      });
    }

    if (res.headersSent) {
      console.warn('[Redirect] Headers already sent; skipping redirect.');
      return;
    }

    const targetUrl = req.params?.url;
    if (!isValidUrl(targetUrl)) {
      console.error('[Redirect] Invalid or missing target URL:', targetUrl);
      return res.status(400).json({ error: 'Invalid or missing URL.' });
    }

    const normalizedUrl = normalizeUrl(targetUrl);
    const encodedUrl = encodeURI(normalizedUrl);

    // Remove potentially conflicting headers
    for (const header of RESTRICTED_HEADERS) {
      const name = header.toLowerCase();
      if (res.hasHeader(name)) res.removeHeader(name);
    }

    res.setHeader('Location', encodedUrl);
    res.setHeader('X-Redirect-Source', 'vercel-middleware');
    res.setHeader('Cache-Control', 'no-store');

    console.log(`[Redirect] → ${encodedUrl} [${statusCode}]`);

    if (includeHtmlFallback && statusCode === 302) {
      res.status(statusCode).send(generateRedirectHtml(encodedUrl));
    } else {
      res.status(statusCode).end();
    }
  } catch (err) {
    console.error('[Redirect Error]', err);
    if (!res.headersSent)
      res.status(500).json({ error: 'Internal server error during redirect.' });
  }
}

export default redirect;


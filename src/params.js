import validator from 'validator';

const DEFAULT_QUALITY = 40;
const MAX_QUALITY = 100;
const MIN_QUALITY = 10;

function params(req, res, next) {
  let { url } = req.query;

  // Handle multiple URLs by joining them, but warn about usage for potential debugging.
  if (Array.isArray(url)) {
    console.warn('Multiple URLs provided; concatenating for processing.');
    url = url.join('&url=');
  }

  if (!url) {
    return res.end('bandwidth-hero-proxy');
  }

  // Normalize URL by handling specific formatting issues, e.g., "bmi" transformation.
  url = url.replace(/http:\/\/1\.1\.\d\.\d\/bmi\/(https?:\/\/)?/i, 'http://');

  // Validate URL with protocol required for security.
  if (!validator.isURL(url, { require_protocol: true })) {
    console.error(`Invalid URL received: ${url}`);
    return res.status(400).send('Invalid URL');
  }

  // Set validated and sanitized URL.
  req.params.url = url;

  // Determine if WebP or JPEG should be used; default to WebP.
  req.params.webp = !req.query.jpeg;

  // Set grayscale mode based on the "bw" parameter, defaulting to `true`.
  req.params.grayscale = req.query.bw !== '0';

  // Parse and validate quality; enforce bounds and fallback to default if invalid.
  const quality = parseInt(req.query.l, 10);
  req.params.quality = isNaN(quality)
    ? DEFAULT_QUALITY
    : Math.min(Math.max(quality, MIN_QUALITY), MAX_QUALITY);

  next();
}

export default params;

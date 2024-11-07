const DEFAULT_QUALITY = 40;
const MAX_QUALITY = 100;
const MIN_QUALITY = 10;

const validator = require('validator');

function params(req, res, next) {
  let url = req.query.url;

  // Handle the case where multiple URLs are passed, by joining them, but clarify usage based on the app's context.
  if (Array.isArray(url)) {
    console.warn('Multiple URLs provided; concatenating for processing.');
    url = url.join('&url=');
  }

  if (!url) {
    return res.end('bandwidth-hero-proxy');
  }

  // Fix URL formatting issues, especially the "bmi" transformation in some images.
  url = url.replace(/http:\/\/1\.1\.\d\.\d\/bmi\/(https?:\/\/)?/i, 'http://');

  // Enhanced URL validation using 'validator'. We enforce the presence of a valid protocol for security.
  if (!validator.isURL(url, { require_protocol: true })) {
    console.error(`Invalid URL received: ${url}`);
    return res.status(400).send('Invalid URL');
  }

  // Pass the valid URL to the request parameters for further processing.
  req.params.url = url;

  // Determine whether to use WebP or JPEG based on query parameter. WebP is used by default.
  req.params.webp = !req.query.jpeg;

  // Check if the image should be in grayscale. Default is true, unless explicitly set to `0`.
  req.params.grayscale = req.query.bw != 0;

  // Parse the quality parameter and enforce minimum/maximum limits.
  let quality = parseInt(req.query.l, 10);

  // Handle invalid quality values (e.g., NaN) and restrict the quality to the defined bounds.
  req.params.quality = Math.min(Math.max(quality || DEFAULT_QUALITY, MIN_QUALITY), MAX_QUALITY);

  // Proceed to the next middleware or handler.
  next();
}

module.exports = params;

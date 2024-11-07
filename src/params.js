const DEFAULT_QUALITY = 40;
const MAX_QUALITY = 100;
const MIN_QUALITY = 10;

const validator = require('validator');

function params(req, res, next) {
  // Handle multiple URLs by joining with '&url=', otherwise assign directly.
  let url = Array.isArray(req.query.url) ? req.query.url.join('&url=') : req.query.url;

  // Default response if no URL is provided.
  if (!url) {
    console.log('No URL provided, sending default response.');
    return res.end('bandwidth-hero-proxy');
  }

  // Replace specific URL formatting issues, such as "bmi" transformations.
  url = url.replace(/http:\/\/1\.1\.\d\.\d\/bmi\/(https?:\/\/)?/i, 'http://');

  // Validate URL with required protocol.
  if (!validator.isURL(url, { require_protocol: true })) {
    console.error(`Invalid URL received: ${url}`);
    return res.status(400).send('Invalid URL');
  }

  // Assign cleaned URL to request parameters.
  req.params.url = url;

  // Determine image format (default is WebP; JPEG if specified).
  req.params.webp = !req.query.jpeg;

  // Set grayscale mode, defaulting to true unless explicitly set to `bw=0`.
  req.params.grayscale = req.query.bw !== '0';

  // Parse quality parameter, defaulting and clamping as necessary.
  req.params.quality = Math.min(
    Math.max(parseInt(req.query.l, 10) || DEFAULT_QUALITY, MIN_QUALITY),
    MAX_QUALITY
  );

  // Proceed to the next middleware.
  next();
}

module.exports = params;

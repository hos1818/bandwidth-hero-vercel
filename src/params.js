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

  // Return default response if no URL is provided.
  if (!url) {
    console.log('No URL provided, sending default response.');
    return res.end('bandwidth-hero-proxy');
  }

  // Replace URL formatting issues (e.g., "bmi" transformations).
  url = url.replace(/http:\/\/1\.1\.\d\.\d\/bmi\/(https?:\/\/)?/i, 'http://');

  // Validate the URL for security (ensure it includes a valid protocol).
  if (!validator.isURL(url, { require_protocol: true })) {
    console.error(`Invalid URL received: ${url}`);
    return res.status(400).send('Invalid URL');
  }

  // Pass the validated and cleaned URL to the request parameters.
  req.params.url = url;

  // Determine image format (WebP by default, unless `jpeg` is specified).
  req.params.webp = !req.query.jpeg;

  // Determine if grayscale (default to true unless `bw=0` is explicitly passed).
  req.params.grayscale = req.query.bw != 0;

  // Parse the quality parameter, using defaults if invalid.
  let quality = parseInt(req.query.l, 10);
  if (isNaN(quality)) {
    console.warn(`Invalid quality value provided: ${req.query.l}, defaulting to ${DEFAULT_QUALITY}`);
    quality = DEFAULT_QUALITY;
  }
  req.params.quality = Math.min(Math.max(quality, MIN_QUALITY), MAX_QUALITY);

  // Proceed to the next middleware or handler.
  next();
}

module.exports = params;

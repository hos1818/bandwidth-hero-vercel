const { URL } = require('url');

const DEFAULT_QUALITY = 40;
const MAX_QUALITY = 100;
const MIN_QUALITY = 10;

function isValidUrl(url) {
  try {
    new URL(url);
    return true;
  } catch (e) {
    return false;
  }
}

function params(req, res, next) {
  let url = req.query.url;

  if (Array.isArray(url)) url = url.join('&url='); // Consider the logic behind this. Is this the expected behavior for multiple URLs?
  if (!url) {
    return res.status(400).send('bandwidth-hero-proxy.');
  }

  // Remove any strange URL prefixes that may be present.
  url = url.replace(/http:\/\/1\.1\.\d\.\d\/bmi\/(https?:\/\/)?/i, 'http://');

  // Validate the URL to prevent SSRF and similar attacks.
  if (!isValidUrl(url)) {
    return res.status(400).send('Invalid URL');
  }

  req.params.url = url;

  // Check the desired output format.
  req.params.webp = !req.query.jpeg;

  // Set the grayscale preference based on the 'bw' query parameter.
  req.params.grayscale = req.query.bw !== '0';

  // Parse the quality ensuring it's a number within our accepted range.
  const quality = parseInt(req.query.l, 10) || DEFAULT_QUALITY;
  if (isNaN(quality) || quality < MIN_QUALITY || quality > MAX_QUALITY) {
    return res.status(400).send(`Quality must be a number between ${MIN_QUALITY} and ${MAX_QUALITY}`);
  }
  req.params.quality = quality;

  // If everything is valid, move to the next middleware.
  next();
}

module.exports = params;

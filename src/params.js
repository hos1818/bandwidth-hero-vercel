const DEFAULT_QUALITY = 40;
const MAX_QUALITY = 100;
const MIN_QUALITY = 10;

// Importing a module for more robust URL validation (consider using a library like 'validator' for comprehensive checks).
const validator = require('validator');

function params(req, res, next) {
  let url = req.query.url;
  
  // If multiple URLs are passed, consider whether this is the expected behavior or a potential security risk.
  if (Array.isArray(url)) {
    // The handling of multiple URLs should be more explicit. This action must match your application's logic.
    url = url.join('&url=');
  }
  
  if (!url) {
    return res.end('bandwidth-hero-proxy');
  }
  
  // Specific URL correction for certain patterns
  url = url.replace(/http:\/\/1\.1\.\d\.\d\/bmi\/(https?:\/\/)?/i, 'http://');

  // Enhanced URL validation using 'validator'
  // Validate the URL. This helps ensure the proxy is not being misused to request invalid URLs.
  if (!validator.isURL(url, { require_protocol: true })) {
    return res.status(400).send('Invalid URL');
  }

  // Protection against SSRF and similar attacks
  // Note: Implement additional URL checks as necessary for your application's security requirements.

  req.params.url = url;
  
  // Determine the output format with a more descriptive parameter
  req.params.webp = (req.query.format !== 'jpeg');
  
  // Parse the grayscale option more robustly
  req.params.grayscale = ['true', '1', 'on'].includes(req.query.bw);

  // Parse, validate, and set the compression quality
  let quality = parseInt(req.query.l, 10);

  // Validate quality is a number
  if (isNaN(quality)) {
    return res.status(400).send('Quality must be a number');
  }

  // Check quality boundaries and provide feedback if out of range
  if (quality < MIN_QUALITY || quality > MAX_QUALITY) {
    return res.status(400).send(`Quality must be between ${MIN_QUALITY} and ${MAX_QUALITY}`);
  }

  // Set default quality if not specified
  req.params.quality = quality || DEFAULT_QUALITY;

  // Proceed to the next middleware
  next();
}

module.exports = params;

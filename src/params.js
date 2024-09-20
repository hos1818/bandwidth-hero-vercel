const DEFAULT_QUALITY = 40;
const MAX_QUALITY = 100;
const MIN_QUALITY = 10;

const validator = require('validator');

function params(req, res, next) {
    let url = req.query.url;

    // Join multiple URLs with '&url=' if passed as an array. Adjust this logic if you expect different behavior.
    if (Array.isArray(url)) {
        url = url.join('&url=');
    }

    // Return a simple message if no URL is provided.
    if (!url) {
        return res.status(400).send('Missing URL parameter');
    }

    // Corrects some specific URL formatting issues.
    url = url.replace(/http:\/\/1\.1\.\d\.\d\/bmi\/(https?:\/\/)?/i, 'http://');

    // Enhanced URL validation using 'validator' and normalization.
    if (!validator.isURL(url, { require_protocol: true, allow_underscores: true })) {
        return res.status(400).send('Invalid URL format');
    }

    // Normalize URL to ensure a consistent format
    url = validator.normalizeURL(url);

    // Assign the validated and normalized URL to req.params
    req.params.url = url;

    // Determine the desired output format. Defaults to 'webp' unless 'jpeg' is specified.
    req.params.webp = !req.query.jpeg;

    // Checks if the image should be grayscale (if bw is not explicitly 0).
    req.params.grayscale = req.query.bw !== '0';

    // Parse and set the compression quality, ensuring it's within acceptable limits.
    const quality = parseInt(req.query.l, 10);
    req.params.quality = Number.isNaN(quality) ? DEFAULT_QUALITY : Math.min(Math.max(quality, MIN_QUALITY), MAX_QUALITY);

    // Optionally log the parsed parameters for debugging/monitoring purposes.
    console.log(`URL: ${req.params.url}, WebP: ${req.params.webp}, Grayscale: ${req.params.grayscale}, Quality: ${req.params.quality}`);

    // Proceed to the next middleware or route handler.
    next();
}

module.exports = params;

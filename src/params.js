const DEFAULT_QUALITY = 40;

function params(req, res, next) {
  // Get the URL from the query parameters.
  const url = req.query.url;

  // If the URL is not specified, return an error.
  if (!url) {
    return res.end("bandwidth-hero-proxy");
  }

  // Replace the protocol with "http://".
  url = url.replace(/^http:\/\/1\.1\.\d+\.\d\/bmi\/(https?:\/\/)?/i, "http://");

  // Set the request attributes.
  req.params.url = url;
  req.params.webp = !req.query.jpeg;
  req.params.grayscale = req.query.bw !== 0;
  req.params.quality = parseInt(req.query.l, 10) || DEFAULT_QUALITY;

  // Continue with the next middleware in the chain.
  next();
}

module.exports = params;

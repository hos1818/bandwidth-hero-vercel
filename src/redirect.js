function redirect(req, res, statusCode = 302) {
  if (res.headersSent) {
    return;
  }

  res.setHeader('content-length', 0);
  ['cache-control', 'expires', 'date', 'etag'].forEach(header => res.removeHeader(header));
  res.setHeader('location', encodeURI(req.params.url));

  res.status(statusCode).end();
}

module.exports = redirect;

const { URL } = require('url');

function forwardWithoutProcessing(req, res, buffer) {
  if (!buffer) {
    return res.status(500).send("Buffer is missing");
  }

  res.setHeader('x-proxy-bypass', 1);
  res.setHeader('content-length', buffer.length);

  const filename = (new URL(req.params.url).pathname.split('/').pop());
  if (filename) {
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  }

  res.status(200).end(buffer);
}

module.exports = forwardWithoutProcessing;

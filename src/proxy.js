const axios = require('axios');
const pick = require('lodash').pick;
const shouldCompress = require('./shouldCompress');
const redirect = require('./redirect');
const compress = require('./compress');
const bypass = require('./bypass');
const copyHeaders = require('./copyHeaders');

async function proxy(req, res) {
  try {
    const response = await axios.get(req.params.url, {
      headers: {
        ...pick(req.headers, ['cookie', 'dnt', 'referer']),
        'user-agent': 'Bandwidth-Hero Compressor',
        'x-forwarded-for': req.headers['x-forwarded-for'] || req.ip,
        via: '1.1 bandwidth-hero'
      },
      timeout: 10000,
      maxRedirects: 5,
      responseType: 'arraybuffer',
      validateStatus: status => status < 400, // Only reject if status code is >= 400
      decompress: true
    });

    copyHeaders(response.headers, res);
    req.params.originType = response.headers['content-type'] || '';
    req.params.originSize = response.data.length;

    if (shouldCompress(req, response.data)) {
      compress(req, res, response.data);
    } else {
      bypass(req, res, response.data);
    }

  } catch (err) {
    console.error('Error in proxy:', err.message);
    redirect(req, res);
  }
}

module.exports = proxy;

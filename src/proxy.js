const axios = require('axios');
const pick = require('lodash').pick;
const zlib = require('zlib');
const shouldCompress = require('./shouldCompress');
const redirect = require('./redirect');
const compress = require('./compress');
const bypass = require('./bypass');
const copyHeaders = require('./copyHeaders');

async function proxy(req, res) {
    const config = {
        url: req.params.url,
        method: 'get',
        headers: {
            ...pick(req.headers, ['cookie', 'dnt', 'referer']),
            'user-agent': 'Bandwidth-Hero Compressor',
            'x-forwarded-for': req.headers['x-forwarded-for'] || req.ip,
            via: '1.1 bandwidth-hero'
        },
        timeout: 10000,
        maxRedirects: 5,
        responseType: 'arraybuffer',
        validateStatus: status => status < 500,
        transformResponse: [(data, headers) => {
            if (headers['content-encoding'] === 'gzip') {
                return zlib.gunzipSync(data);
            }
            return data;
        }],
    };

    try {
        const origin = await axios(config);
        
        copyHeaders(origin, res);
        res.setHeader('content-encoding', 'identity');
        req.params.originType = origin.headers['content-type'] || '';
        req.params.originSize = origin.data.length;

        if (shouldCompress(req, origin.data)) {
            compress(req, res, origin.data);
        } else {
            bypass(req, res, origin.data);
        }
    } catch (error) {
        redirect(req, res);
    }
}

module.exports = proxy;

const axios = require('axios');

// Proxy request logic
async function proxyRequest(req, res) {
  return new Promise((resolve, reject) => {
        const client = http2.connect(config.url.origin);
        const headers = {
            ':method': 'GET',
            ':path': config.url.pathname,
            ...pick(config.headers, ['cookie', 'dnt', 'referer']),
            'user-agent': config.headers['user-agent'],
        };

        const req = client.request(headers);
        let data = [];

        req.on('response', (headers, flags) => resolve({ headers, flags, data }));
        req.on('data', chunk => data.push(chunk));
        req.on('end', () => resolve(Buffer.concat(data)));
        req.on('error', err => reject(err));

        req.end();
    });
}

module.exports = proxyRequest;

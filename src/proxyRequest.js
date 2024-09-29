const axios = require('axios');

// Proxy request logic
async function proxyRequest(req, res) {
  const url = req.query.url;

  if (!url) {
    return res.status(400).send('No URL provided.');
  }

  try {
    // Call your Cloudflare Worker with the target URL
    const workerUrl = `https://workerforcf.hoss78307926.workers.dev?url=${encodeURIComponent(url)}`;
    
    // Fetch content from Cloudflare Worker
    const response = await axios.get(workerUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      },
    });

    // Return the content from Cloudflare Worker
    res.status(response.status).send(response.data);
  } catch (err) {
    console.error(`Failed to fetch content from Cloudflare Worker for ${url}:`, err);
    res.status(500).send('Failed to fetch content.');
  }
}

module.exports = proxyRequest;

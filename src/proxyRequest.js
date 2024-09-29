const axios = require('axios');

// Proxy request logic
async function proxyRequest(req, res) {
  const url = req.query.url;

  if (!url) {
    return res.status(400).json({ error: 'No URL provided.' });
  }

  try {
    // Construct the Cloudflare Worker URL
    const workerUrl = `https://workerforcf.hoss78307926.workers.dev?url=${encodeURIComponent(url)}`;

    // Define request options
    const options = {
      method: req.method || 'GET', // Support various HTTP methods
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        ...req.headers, // Pass through any additional headers
      },
      data: req.body || null, // Pass body if applicable (for POST requests)
    };

    // Fetch content from the Cloudflare Worker
    const response = await axios(workerUrl, options);

    // Forward the response from the Worker
    res.status(response.status).send(response.data);
  } catch (err) {
    console.error(`Error fetching content from Cloudflare Worker for ${url}:`, err.message);
    
    // Handle specific error cases
    if (err.response) {
      // The request was made and the server responded with a status code outside of the 2xx range
      return res.status(err.response.status).json({
        error: `Error fetching content from Worker. Status: ${err.response.status}`,
        details: err.response.data,
      });
    } else if (err.request) {
      // The request was made, but no response was received
      return res.status(500).json({ error: 'No response received from Cloudflare Worker.' });
    } else {
      // Something happened in setting up the request
      return res.status(500).json({ error: 'Failed to make request to Cloudflare Worker.' });
    }
  }
}

module.exports = proxyRequest;

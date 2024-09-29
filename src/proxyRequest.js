const cloudscraper = require('cloudflare-scraper');

// Function to request a URL bypassing Cloudflare
async function bypassCloudflare(url) {
  try {
    const response = await cloudscraper.get(url); // Cloudflare scraper simulates a browser request.
    return response;
  } catch (error) {
    console.error(`Error bypassing Cloudflare for ${url}:`, error);
    throw error;
  }
}

// Example usage within your proxy logic
async function proxyRequest(req, res) {
  const url = req.params.url;

  try {
    // Bypass Cloudflare and get the response from the website
    const response = await bypassCloudflare(url);
    res.status(200).send(response);
  } catch (err) {
    res.status(500).send('Failed to bypass Cloudflare.');
  }
}

module.exports = proxyRequest;

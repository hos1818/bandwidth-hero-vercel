const puppeteer = require('puppeteer');

// Function to request a URL bypassing Cloudflare
async function bypassCloudflareWithPuppeteer(url) {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  
  // Try to navigate to the URL
  try {
    await page.goto(url, { waitUntil: 'networkidle2' });
    
    // Wait for page content to load
    const content = await page.content();
    await browser.close();
    
    return content;
  } catch (err) {
    console.error(`Error bypassing Cloudflare using Puppeteer for ${url}:`, err);
    await browser.close();
    throw err;
  }
}

// Example usage within your proxy logic
async function proxyRequest(req, res) {
  const url = req.params.url;

  try {
    // Bypass Cloudflare and get the response from the website
    const response = await bypassCloudflareWithPuppeteer(url);
    res.status(200).send(response);
  } catch (err) {
    res.status(500).send('Failed to bypass Cloudflare.');
  }
}

module.exports = proxyRequest;

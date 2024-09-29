const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

// Use the stealth plugin
puppeteer.use(StealthPlugin());

// Function to request a URL bypassing Cloudflare.
async function bypassCloudflareWithPuppeteer(url) {
  const browser = await puppeteer.launch({
    headless: true,
    targetFilter: (target) => !!target.url
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();

  // Set a random user agent
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

  // Retry logic
  for (let attempts = 0; attempts < 5; attempts++) {
    try {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
      await page.waitForSelector('body', { timeout: 30000 });

      const content = await page.content();
      await browser.close();
      
      return content;
    } catch (err) {
      console.warn(`Attempt ${attempts + 1} failed:`, err);
      await new Promise(resolve => setTimeout(resolve, Math.random() * 2000 + 1000)); // Random delay
    }
  }

  await browser.close();
  throw new Error(`Failed to load ${url} after multiple attempts.`);
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

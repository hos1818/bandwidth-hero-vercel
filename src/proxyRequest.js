const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

// Use the stealth plugin
puppeteer.use(StealthPlugin());

// Function to request a URL bypassing Cloudflare.
async function bypassCloudflareWithPuppeteer(url) {
  const browser = await puppeteer.launch({
    headless: true,
    targetFilter: (target) => !!target.url,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();

  // Set a random user agent
  await page.setUserAgent('Mozilla/5.0 (Windows NT 5.1; rv:5.0) Gecko/20100101 Firefox/5.0');

  // Enable/disable JavaScript based on the website's requirements
  await page.setJavaScriptEnabled(true);
  
  // Retry logic
  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // Set a timeout for the page loading
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
      await page.waitForSelector('body', { timeout: 30000 }); // Wait for the body element

      // Get the page content
      const content = await page.content();
      await browser.close();
      
      return content;
    } catch (error) {
      console.warn(`Attempt ${attempt} failed:`, error.message);

      // Specific error handling
      if (error.message.includes('Timeout')) {
        console.error('Timeout error, retrying...');
      } else if (error.message.includes('net::ERR_PROXY_CONNECTION_FAILED')) {
        console.error('Proxy connection failed, using a different proxy might help.');
      }

      // Wait before retrying
      const delay = Math.random() * 2000 + 1000; // Random delay between 1-3 seconds
      await new Promise(resolve => setTimeout(resolve, delay));
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

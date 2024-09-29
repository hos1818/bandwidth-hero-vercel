const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

// Use the stealth plugin
puppeteer.use(StealthPlugin());
const stealth = StealthPlugin(); // Initialize stealth plugin for further manipulation if needed
stealth.enabledEvasions.delete("user-agent-override");

// Function to request a URL bypassing Cloudflare
async function bypassCloudflareWithPuppeteer(url) {
  const browser = await puppeteer.launch({
    headless: true, // Change to true for production
    args: [
      '--no-sandbox', 
      '--disable-setuid-sandbox', 
      '--disable-notifications', 
      '--auto-open-devtools-for-tabs', 
      '--disable-dev-shm-usage',
    ],
  });
  const page = await browser.newPage();

  // Enable/disable JavaScript based on the website's requirements
  await page.setJavaScriptEnabled(false);
  
  // Retry logic
  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // Set a timeout for the page loading
      await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
      await page.waitForSelector('body', { timeout: 30000 }); // Wait for the body element

      // Get the page content
      const content = await page.content();
      return content; // Return content before closing the browser
    } catch (error) {
      console.warn(`Attempt ${attempt} failed:`, error); // Log the full error object

      // Specific error handling
      if (error.message.includes('Timeout')) {
        console.error('Timeout error, retrying...');
      } else if (error.message.includes('net::ERR_PROXY_CONNECTION_FAILED')) {
        console.error('Proxy connection failed, using a different proxy might help.');
      }

      // Wait before retrying
      const delay = Math.random() * 2000 + 1000; // Random delay between 1-3 seconds
      await new Promise(resolve => setTimeout(resolve, delay));
    } finally {
      await browser.close(); // Ensure the browser closes regardless of the outcome
    }
  }

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
    console.error(`Failed to bypass Cloudflare for ${url}:`, err);
    res.status(500).send('Failed to bypass Cloudflare.');
  }
}

module.exports = proxyRequest;

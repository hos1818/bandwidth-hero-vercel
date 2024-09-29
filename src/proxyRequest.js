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

  // Set viewport for a realistic browser window
  await page.setViewport({
    width: 1280,
    height: 720,
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
    isLandscape: true,
  });

  // Randomize User-Agent
  const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    // Add more user agents here
  ];
  await page.setUserAgent(userAgents[Math.floor(Math.random() * userAgents.length)]);

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

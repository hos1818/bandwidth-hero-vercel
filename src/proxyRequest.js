const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

// Use stealth plugin for Puppeteer to bypass detection
puppeteer.use(StealthPlugin());
const stealth = StealthPlugin();
stealth.enabledEvasions.delete("user-agent-override"); // Optional: preserve default user-agent

async function bypassCloudflareWithPuppeteer(url) {
  const browser = await puppeteer.launch({
    headless: true, // Run in headless mode for production
    args: [
      '--no-sandbox', 
      '--disable-setuid-sandbox',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-dev-shm-usage',
      '--incognito', // Start in incognito mode
      '--window-size=1280,720', // Set window size to avoid headless detection
    ],
  });

  const page = await browser.newPage();

  // Setting user agent
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

  // Setting realistic headers
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'en-US,en;q=0.9',
  });

  // Handle Cloudflare challenge by waiting for specific elements or time
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // Handle CAPTCHA if required (Optional: Integrate CAPTCHA solver API)
    const captchaDetected = await page.$('.g-recaptcha');
    if (captchaDetected) {
      throw new Error("CAPTCHA detected! Requires manual or automated solving.");
    }

    // Wait for the body or specific content to indicate Cloudflare has passed
    await page.waitForSelector('body', { timeout: 30000 });

    // Take a screenshot if needed (e.g., for debugging)
    // await page.screenshot({ path: 'cloudflare_bypass.png' });

    // Return the page content
    const content = await page.content();
    await browser.close();
    return content;

  } catch (error) {
    console.error('Error in bypassing Cloudflare:', error);
    await browser.close();
    throw error; // Re-throw to handle the error in the calling function
  }
}

// Proxy request logic
async function proxyRequest(req, res) {
  const url = req.params.url;

  try {
    // Bypass Cloudflare protection and retrieve page content
    const content = await bypassCloudflareWithPuppeteer(url);
    res.status(200).send(content);
  } catch (err) {
    console.error(`Failed to bypass Cloudflare for ${url}:`, err);
    res.status(500).send('Failed to bypass Cloudflare.');
  }
}

module.exports = proxyRequest;

const playwright = require('playwright-aws-lambda');

async function bypassCloudflareWithPlaywright(url) {
  const await playwright.launchChromium({
    headless: true, // Run headless for production
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-dev-shm-usage',
      '--incognito', // Use incognito mode for each request
    ],
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36', // Realistic User-Agent
    locale: 'en-US', // Language settings
    geolocation: { longitude: 12.4924, latitude: 41.8902 }, // Fake geolocation (optional)
    permissions: ['geolocation'], // Allow geolocation (optional)
  });

  const page = await context.newPage();

  // Set additional headers
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'en-US,en;q=0.9',
  });

  // Custom retry logic to handle Cloudflare or connection issues
  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // Navigate to the URL
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

      // Check for CAPTCHA or Cloudflare block
      const captchaDetected = await page.$('.g-recaptcha');
      if (captchaDetected) {
        throw new Error("CAPTCHA detected! Requires manual or automated solving.");
      }

      // Ensure the page loaded successfully
      await page.waitForSelector('body', { timeout: 30000 });

      // Capture and return the page content
      const content = await page.content();
      await browser.close();
      return content;

    } catch (error) {
      console.warn(`Attempt ${attempt} failed:`, error.message);
      if (attempt === maxAttempts) {
        await browser.close();
        throw new Error(`Failed to load ${url} after ${maxAttempts} attempts.`);
      }
    }
  }
}

// Proxy request logic
async function proxyRequest(req, res) {
  const url = req.params.url;

  try {
    // Bypass Cloudflare protection and retrieve page content
    const content = await bypassCloudflareWithPlaywright(url);
    res.status(200).send(content);
  } catch (err) {
    console.error(`Failed to bypass Cloudflare for ${url}:`, err);
    res.status(500).send('Failed to bypass Cloudflare.');
  }
}

module.exports = proxyRequest;

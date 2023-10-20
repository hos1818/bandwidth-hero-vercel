const sharp = require('sharp');
const redirect = require('./redirect');
const isAnimated = require('is-animated');
const { execFile } = require('child_process');
const gif2webp = require('gif2webp-bin');
const fs = require('fs').promises;
const os = require('os');
const { URL } = require('url');


// Process animated GIFs
async function processAnimatedGif(req, input) {
  const { hostname, pathname } = new URL(req.params.url);
  const path = `${os.tmpdir()}/${hostname + encodeURIComponent(pathname)}`;
  await fs.writeFile(`${path}.gif`, input);

  return new Promise((resolve, reject) => {
    execFile(gif2webp, ['-lossy', '-m', 2, '-q', req.params.quality, '-mt', `${path}.gif`, '-o', `${path}.webp`], async (convErr) => {
      if (convErr) {
        console.error("Error in conversion:", convErr);
        reject(convErr);
        return;
      }
      console.log('GIF Image converted!');
      const data = await fs.readFile(`${path}.webp`);
      resolve(data);

      // Cleanup the temporary files
      await fs.unlink(`${path}.gif`);
      await fs.unlink(`${path}.webp`);
    });
  });
}

// Handle the compression process
async function handleCompression(input, format, quality, grayscale) {
  return sharp(input)
    .grayscale(grayscale)
    .toFormat(format, {
      quality: quality,
      progressive: true,
      optimizeScans: true
    })
    .toBuffer();
}

// Main compress function
async function compress(req, res) {
  try {
    const input = /* ... input should be defined or passed ... */;
    const format = req.params.webp ? 'webp' : 'jpeg';
    const originType = req.params.originType;

    let output;

    if (!req.params.grayscale && format === 'webp' && originType.endsWith('gif') && isAnimated(input)) {
      output = await processAnimatedGif(req, input);
    } else {
      // Define quality and other parameters required for handleCompression
      const quality = adjustCompressionQuality(/* args */);
      const grayscale = req.params.grayscale;
      output = await handleCompression(input, format, quality, grayscale);
    }

    sendImage(res, output, format, req.params.url, req.params.originSize);
  } catch (error) {
    console.error("Error during compression:", error);
    redirect(req, res);
  }
}



function calculateQualityFactor(pixelCount, size) {
  // These thresholds can be adjusted or even made configurable.
  const thresholds = [
    { pixels: 3000000, size: 1536000, factor: 0.1 },
    { pixels: 2000000, size: 1024000, factor: 0.25 },
    { pixels: 1000000, size: 512000, factor: 0.5 },
    { pixels: 500000, size: 256000, factor: 0.75 },
  ];

  for (let threshold of thresholds) {
    if (pixelCount > threshold.pixels && size > threshold.size) {
      return threshold.factor;
    }
  }
  return 1; // default factor
}

function adjustCompressionQuality(pixelCount, size, quality) {
  const factor = calculateQualityFactor(pixelCount, size);
  return Math.ceil(quality * factor);
}

function sendImage(res, data, imgFormat, url, originSize) {
    res.setHeader('content-type', `image/${imgFormat}`);
    res.setHeader('content-length', data.length);
    let filename = (new URL(url).pathname.split('/').pop() || "image") + '.' + imgFormat;
    res.setHeader('Content-Disposition', 'inline; filename="' + filename + '"');
    res.setHeader('x-original-size', originSize);
    res.setHeader('x-bytes-saved', originSize - data.length);
    res.status(200);
    res.end(data);
}

module.exports = compress;

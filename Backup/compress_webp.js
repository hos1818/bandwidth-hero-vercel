const sharp = require('sharp');
const redirect = require('./redirect');
const isAnimated = require('is-animated');
const { URL } = require('url');

const sharpenParams = {
  sigma: 1.0, // Controls the radius of the sharpening
  flat: 1.0,  // Adjusts sharpening in flat areas
  jagged: 0.5 // Adjusts sharpening in areas with jagged edges
};

async function compress(req, res, input) {
  try {
    const format = req.params.webp ? 'webp' : 'jpeg';
    const { quality, grayscale, originSize, url } = req.params;

    // Get image metadata
    const metadata = await sharp(input).metadata();

    const pixelCount = metadata.width * metadata.height;
    const compressionQuality = adjustCompressionQuality(pixelCount, metadata.size, quality);

    // Handle animated WebP differently
    const isWebPAnimated = format === 'webp' && isAnimated(input);

    const sharpInstance = sharp(input, { animated: isWebPAnimated })
      .grayscale(grayscale)
      .sharpen(sharpenParams.sigma, sharpenParams.flat, sharpenParams.jagged)
      .toFormat(format, {
        quality: compressionQuality,
        alphaQuality: 80,
        smartSubsample: true,
        progressive: true,
        optimizeScans: true,
        loop: isWebPAnimated ? 0 : undefined
      });

    const output = await sharpInstance.toBuffer();
    
    // If response headers are already sent, log and skip sending.
    if (res.headersSent) {
      console.error('Headers already sent, unable to compress the image.');
      return;
    }

    // Send the compressed image as a response
    sendImage(res, output, format, url, originSize);

  } catch (err) {
    console.error('Error during image compression:', err);
    return redirect(req, res);
  }
}

// Function to adjust compression quality based on image properties
function adjustCompressionQuality(pixelCount, size, quality) {
  const thresholds = [
    { pixels: 3000000, size: 1536000, factor: 0.1 },
    { pixels: 2000000, size: 1024000, factor: 0.25 },
    { pixels: 1000000, size: 512000, factor: 0.5 },
    { pixels: 500000, size: 256000, factor: 0.75 }
  ];

  for (let threshold of thresholds) {
    if (pixelCount > threshold.pixels && size > threshold.size) {
      return Math.ceil(quality * threshold.factor);
    }
  }

  return quality; // Return the default quality if no thresholds are met
}

// Function to send the compressed image response
function sendImage(res, data, imgFormat, url, originSize) {
  const filename = encodeURIComponent(new URL(url).pathname.split('/').pop() || 'image') + `.${imgFormat}`;
  
  res.setHeader('Content-Type', `image/${imgFormat}`);
  res.setHeader('Content-Length', data.length);
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');

  const safeOriginSize = Math.max(originSize, 0);
  res.setHeader('x-original-size', safeOriginSize);
  res.setHeader('x-bytes-saved', Math.max(safeOriginSize - data.length, 0));

  res.status(200).end(data);
}

module.exports = compress;

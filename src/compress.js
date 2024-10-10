const sharp = require('sharp');
const redirect = require('./redirect');
const { URL } = require('url');

const sharpenParams = {
  sigma: 1.0, // Controls the radius of the sharpening
  flat: 1.0,  // Adjusts sharpening in flat areas
  jagged: 0.5 // Adjusts sharpening in areas with jagged edges
};

// Optimized compress function for limited resources
async function compress(req, res, input) {
  try {
    const format = req.params.webp ? 'avif' : 'jpeg';
    const { quality, grayscale, originSize, url } = req.params;

    // Get image metadata to dynamically adjust parameters
    const metadata = await sharp(input).metadata();
    const { width, height } = metadata;
    const pixelCount = width * height;

    // Adjust compression quality based on image size
    const compressionQuality = adjustCompressionQuality(pixelCount, metadata.size, quality);

    // Optimize AVIF parameters based on image size and available resources
    const { tileRows, tileCols, minQuantizer, maxQuantizer, effort } = optimizeAvifParams(width, height);

    // Only apply grayscale or sharpening if requested to save resources
    let sharpInstance = sharp(input);

    if (grayscale) {
      sharpInstance = sharpInstance.grayscale();
    }

    // Conditionally apply sharpening only for certain image types or sizes
    if (pixelCount > 500000) { // Apply sharpening for large or detailed images
      sharpInstance = sharpInstance.sharpen(sharpenParams.sigma, sharpenParams.flat, sharpenParams.jagged);
    }

    sharpInstance = sharpInstance.toFormat(format, {
      quality: compressionQuality,
      alphaQuality: 80,
      smartSubsample: true,
      chromaSubsampling: '4:2:0', // Efficient color subsampling
      tileRows: format === 'avif' ? tileRows : undefined,
      tileCols: format === 'avif' ? tileCols : undefined,
      minQuantizer: format === 'avif' ? minQuantizer : undefined,
      maxQuantizer: format === 'avif' ? maxQuantizer : undefined,
      effort: format === 'avif' ? effort : undefined // Lower effort for faster encoding
    });

    // Use a stream to handle large images without excessive memory usage
    const outputStream = sharpInstance.toBuffer({ resolveWithObject: true });

    const { data: output, info } = await outputStream;

    if (res.headersSent) {
      console.error('Headers already sent, unable to compress the image.');
      return;
    }

    sendImage(res, output, format, url, originSize, info.size);

  } catch (err) {
    console.error('Error during image compression:', err);
    return redirect(req, res);
  }
}

// Dynamically adjust AVIF parameters for limited resources
function optimizeAvifParams(width, height) {
  const largeImageThreshold = 2000;
  const mediumImageThreshold = 1000;

  let tileRows = 1, tileCols = 1, minQuantizer = 26, maxQuantizer = 48, effort = 4;

  if (width > largeImageThreshold || height > largeImageThreshold) {
    tileRows = 4;
    tileCols = 4;
    minQuantizer = 30;
    maxQuantizer = 50;
    effort = 3; // Reduce effort for faster encoding
  } else if (width > mediumImageThreshold || height > mediumImageThreshold) {
    tileRows = 2;
    tileCols = 2;
    minQuantizer = 28;
    maxQuantizer = 48;
    effort = 4; // Moderate effort
  }

  // Lower effort to reduce CPU usage and encoding time
  return { tileRows, tileCols, minQuantizer, maxQuantizer, effort };
}

// Adjust compression quality based on image size and pixel count
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

// Send the compressed image as response
function sendImage(res, data, imgFormat, url, originSize, compressedSize) {
  const filename = encodeURIComponent(new URL(url).pathname.split('/').pop() || 'image') + `.${imgFormat}`;

  res.setHeader('Content-Type', `image/${imgFormat}`);
  res.setHeader('Content-Length', data.length);
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');

  const safeOriginSize = Math.max(originSize, 0);
  res.setHeader('x-original-size', safeOriginSize);
  res.setHeader('x-bytes-saved', Math.max(safeOriginSize - compressedSize, 0));

  res.status(200).end(data);
}

module.exports = compress;

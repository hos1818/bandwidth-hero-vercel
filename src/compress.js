const sharp = require('sharp');
const redirect = require('./redirect');
const { URL } = require('url');

const sharpenParams = { sigma: 1.0, flat: 1.0, jagged: 0.5 };

// Optimized compress function for limited resources
async function compress(req, res, input) {
  try {
    const format = req.params.webp ? 'avif' : 'jpeg';
    const { quality, grayscale, originSize, url } = req.params;

    const metadata = await sharp(input).metadata();
    const { width, height, pages, size } = metadata;
    const pixelCount = width * height;

    // Determine animation and format
    const isAnimated = pages && pages > 1;
    const outputFormat = isAnimated ? 'webp' : format;

    const compressionQuality = adjustCompressionQuality(pixelCount, size, quality);
    const { tileRows, tileCols, minQuantizer, maxQuantizer, effort } = optimizeAvifParams(width, height);

    let sharpInstance = sharp(input, { animated: isAnimated });

    if (grayscale) sharpInstance = sharpInstance.grayscale();

    if (!isAnimated) {
      if (outputFormat === 'jpeg' || outputFormat === 'avif') {
        sharpInstance = applyArtifactReduction(sharpInstance, pixelCount);
      }
      if (pixelCount > 500000) {
        sharpInstance = sharpInstance.sharpen(sharpenParams.sigma, sharpenParams.flat, sharpenParams.jagged);
      }
    }

    sharpInstance = sharpInstance.toFormat(outputFormat, {
      quality: compressionQuality,
      alphaQuality: 80,
      smartSubsample: true,
      chromaSubsampling: '4:2:0',
      tileRows: outputFormat === 'avif' ? tileRows : undefined,
      tileCols: outputFormat === 'avif' ? tileCols : undefined,
      minQuantizer: outputFormat === 'avif' ? minQuantizer : undefined,
      maxQuantizer: outputFormat === 'avif' ? maxQuantizer : undefined,
      effort: outputFormat === 'avif' ? effort : undefined,
      loop: isAnimated ? 0 : undefined,
    });

    const { data: output, info } = await sharpInstance.toBuffer({ resolveWithObject: true });
    
    if (res.headersSent) return console.error('Headers already sent, unable to compress the image.');

    sendImage(res, output, outputFormat, url, originSize, info.size);
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
    effort = 3;
  } else if (width > mediumImageThreshold || height > mediumImageThreshold) {
    tileRows = 2;
    tileCols = 2;
    minQuantizer = 28;
    maxQuantizer = 48;
    effort = 4;
  }

  return { tileRows, tileCols, minQuantizer, maxQuantizer, effort };
}

// Adjust compression quality based on image size and pixel count
function adjustCompressionQuality(pixelCount, size, quality) {
  const pixelFactor = 1.5;
  const sizeFactor = 0.002;
  const baseQuality = Math.min(quality, 100);

  const pixelSizeScale = Math.log10(Math.max(pixelCount / 1e6, 1));
  const sizeScale = Math.log2(Math.max(size / 1e6, 1));

  let adjustedQuality = baseQuality - (pixelSizeScale * pixelFactor + sizeScale * sizeFactor) * baseQuality;

  adjustedQuality = Math.max(adjustedQuality, 40);

  return Math.ceil(adjustedQuality);
}

// Apply artifact reduction before sharpening and compression
function applyArtifactReduction(sharpInstance, pixelCount) {
  const largeImageThreshold = 3000000;
  const mediumImageThreshold = 1000000;
  const smallImageThreshold = 500000;

  let blurRadius = 0.3;
  let denoiseStrength = 0.1;
  let sharpenSigma = 0.5;
  let saturationReduction = 1.0;

  if (pixelCount > largeImageThreshold) {
    blurRadius = 0.4;
    denoiseStrength = 0.15;
    sharpenSigma = 0.8;
    saturationReduction = 0.85;
  } else if (pixelCount > mediumImageThreshold) {
    blurRadius = 0.35;
    denoiseStrength = 0.12;
    sharpenSigma = 0.6;
    saturationReduction = 0.9;
  } else if (pixelCount > smallImageThreshold) {
    blurRadius = 0.3;
    denoiseStrength = 0.1;
    sharpenSigma = 0.5;
    saturationReduction = 0.95;
  }

  return sharpInstance
    .modulate({ saturation: saturationReduction })
    .blur(blurRadius)
    .sharpen(sharpenSigma)
    .gamma();
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

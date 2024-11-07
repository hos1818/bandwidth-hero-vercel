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
    const { width, height, pages } = metadata;
    const pixelCount = width * height;

    // Check if the image is animated
    const isAnimated = pages && pages > 1;
    const outputFormat = isAnimated ? 'webp' : format;
    const compressionQuality = req.params.quality;
    const avifParams = optimizeAvifParams(width, height);

    // Stream sharp process
    let sharpInstance = sharp(input, { animated: isAnimated }).withMetadata();

    if (grayscale) sharpInstance = sharpInstance.grayscale();

    if (!isAnimated && (outputFormat === 'jpeg' || outputFormat === 'avif')) {
      sharpInstance = applyArtifactReduction(sharpInstance, pixelCount);
    }

    if (!isAnimated && pixelCount > 500000) {
      sharpInstance = sharpInstance.sharpen(sharpenParams.sigma, sharpenParams.flat, sharpenParams.jagged);
    }

    // Set output format options
    sharpInstance = sharpInstance.toFormat(outputFormat, {
      quality: compressionQuality,
      alphaQuality: 80,
      smartSubsample: true,
      chromaSubsampling: '4:2:0',
      ...avifParams, // Only applies if format is AVIF
      loop: isAnimated ? 0 : undefined, // Set loop for animated WebP
    });

    // Stream the output to the response
    res.setHeader('Content-Type', `image/${outputFormat}`);
    const filename = encodeURIComponent(new URL(url).pathname.split('/').pop() || 'image') + `.${outputFormat}`;
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('x-original-size', Math.max(originSize, 0));

    sharpInstance
      .pipe(res)
      .on('finish', () => {
        // Set x-bytes-saved only after finishing
        const compressedSize = res.getHeader('Content-Length') || 0;
        res.setHeader('x-bytes-saved', Math.max(originSize - compressedSize, 0));
      })
      .on('error', (err) => {
        console.error('Error streaming image:', err);
        redirect(req, res);
      });

  } catch (err) {
    console.error('Error during image compression:', err);
    redirect(req, res);
  }
}

// Dynamically adjust AVIF parameters for limited resources
function optimizeAvifParams(width, height) {
  const largeImageThreshold = 2000;
  const mediumImageThreshold = 1000;

  if (width > largeImageThreshold || height > largeImageThreshold) {
    return { tileRows: 4, tileCols: 4, minQuantizer: 30, maxQuantizer: 50, effort: 3 };
  } else if (width > mediumImageThreshold || height > mediumImageThreshold) {
    return { tileRows: 2, tileCols: 2, minQuantizer: 28, maxQuantizer: 48, effort: 4 };
  }

  return { tileRows: 1, tileCols: 1, minQuantizer: 26, maxQuantizer: 48, effort: 4 };
}

// Apply artifact reduction before sharpening and compression
function applyArtifactReduction(sharpInstance, pixelCount) {
  const largeImageThreshold = 3000000;
  const mediumImageThreshold = 1000000;
  const smallImageThreshold = 500000;

  let blurRadius = 0.3, denoiseStrength = 0.1, sharpenSigma = 0.5, saturationReduction = 1.0;

  if (pixelCount > largeImageThreshold) {
    blurRadius = 0.4; denoiseStrength = 0.15; sharpenSigma = 0.8; saturationReduction = 0.85;
  } else if (pixelCount > mediumImageThreshold) {
    blurRadius = 0.35; denoiseStrength = 0.12; sharpenSigma = 0.6; saturationReduction = 0.9;
  } else if (pixelCount > smallImageThreshold) {
    blurRadius = 0.3; denoiseStrength = 0.1; sharpenSigma = 0.5; saturationReduction = 0.95;
  }

  return sharpInstance
    .modulate({ saturation: saturationReduction })
    .blur(blurRadius)
    .sharpen(sharpenSigma)
    .gamma();
}

module.exports = compress;

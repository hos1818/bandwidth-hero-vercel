import sharp from 'sharp';
import redirect from './redirect.js';
import { URL } from 'url';

// Sharpening parameters
const sharpenParams = { sigma: 1.0, flat: 1.0, jagged: 0.5 };

// Max dimensions for AVIF to avoid HEIF format size limits
const MAX_HEIF_DIMENSION = 16384;

// Optimized compress function for limited resources
async function compress(req, res, input) {
  try {
    const format = req.params.webp ? 'avif' : 'jpeg';
    const { grayscale, originSize, url } = req.params;
    const compressionQuality = req.params.quality;

    // Pre-validate input dimensions to avoid errors with HEIF
    const metadata = await sharp(input).metadata();
    const { width, height, pages } = metadata;
    const pixelCount = width * height;
    const isAnimated = pages > 1;

    let outputFormat = isAnimated ? 'webp' : format;

    // Pre-calculate AVIF parameters
    const avifParams = outputFormat === 'avif' ? optimizeAvifParams(width, height) : {};

    // Initialize sharp instance with only necessary options
    let sharpInstance = sharp(input, {animated: isAnimated});

    // Apply grayscale if requested
    if (grayscale) sharpInstance = sharpInstance.grayscale();

    // Apply artifact reduction for non-animated images
    if (!isAnimated) sharpInstance = applyArtifactReduction(sharpInstance, pixelCount);

    // Resize for AVIF max dimensions if necessary
    if (width > MAX_HEIF_DIMENSION || height > MAX_HEIF_DIMENSION) {
      sharpInstance = sharpInstance.resize({
        width: Math.min(width, MAX_HEIF_DIMENSION),
        height: Math.min(height, MAX_HEIF_DIMENSION),
        fit: 'inside',
      });
    }

    // Configure output format options
    const formatOptions = {
      quality: compressionQuality,
      alphaQuality: 80,
      smartSubsample: true,
      chromaSubsampling: '4:2:0',
      tileRows: avifParams.tileRows,
      tileCols: avifParams.tileCols,
      minQuantizer: avifParams.minQuantizer,
      maxQuantizer: avifParams.maxQuantizer,
      effort: avifParams.effort,
      loop: isAnimated ? 0 : undefined,
    };

    try {
      // Use streams for processing and output
      const { data: output, info } = await sharpInstance
        .toFormat(outputFormat, formatOptions)
        .toBuffer({ resolveWithObject: true });

      // Send processed image response
      sendImage(res, output, outputFormat, url, originSize, info.size);
    } catch (heifError) {
      // Handle fallback for HEIF-related issues
      if (heifError.message.includes('too large for the HEIF format')) {
        console.warn('Image too large for HEIF format, falling back to JPEG/WebP.');
        outputFormat = isAnimated ? 'webp' : 'jpeg';
        const { data: fallbackOutput, info } = await sharpInstance
          .toFormat(outputFormat, { quality: compressionQuality })
          .toBuffer({ resolveWithObject: true });
        sendImage(res, fallbackOutput, outputFormat, url, originSize, info.size);
      } else {
        throw heifError;
      }
    }
  } catch (err) {
    console.error('Error during image compression:', err);
    return redirect(req, res);
  }
}

// Dynamically adjust AVIF parameters for limited resources
function optimizeAvifParams(width, height) {
  const area = width * height;
  const largeThreshold = 4000000; // Large image threshold
  const mediumThreshold = 1000000; // Medium image threshold

  if (area > largeThreshold) {
    return { tileRows: 4, tileCols: 4, minQuantizer: 30, maxQuantizer: 50, effort: 3 };
  } else if (area > mediumThreshold) {
    return { tileRows: 2, tileCols: 2, minQuantizer: 28, maxQuantizer: 48, effort: 4 };
  } else {
    return { tileRows: 1, tileCols: 1, minQuantizer: 26, maxQuantizer: 46, effort: 5 };
  }
}


// Apply artifact reduction before sharpening and compression
function applyArtifactReduction(sharpInstance, pixelCount) {
  const thresholds = { large: 3000000, medium: 1000000, small: 500000 };
  const settings = {
    large: { blurRadius: 0.4, denoiseStrength: 0.15, sharpenSigma: 0.8, saturationReduction: 0.85 },
    medium: { blurRadius: 0.35, denoiseStrength: 0.12, sharpenSigma: 0.6, saturationReduction: 0.9 },
    small: { blurRadius: 0.3, denoiseStrength: 0.1, sharpenSigma: 0.5, saturationReduction: 0.95 },
  };

  const { blurRadius, denoiseStrength, sharpenSigma, saturationReduction } =
    pixelCount > thresholds.large
      ? settings.large
      : pixelCount > thresholds.medium
      ? settings.medium
      : settings.small;

  return sharpInstance
    .modulate({ saturation: saturationReduction })
    .blur(blurRadius)
    .sharpen(sharpenSigma)
    .gamma();
}

// Send the compressed image
function sendImage(res, data, imgFormat, url, originSize, compressedSize) {
  const filename = encodeURIComponent(new URL(url).pathname.split('/').pop() || 'image') + `.${imgFormat}`;

  res.setHeader('Content-Type', `image/${imgFormat}`);
  res.setHeader('Content-Length', data.length);
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('x-original-size', originSize || 0);
  res.setHeader('x-bytes-saved', Math.max((originSize || 0) - compressedSize, 0));

  res.status(200).end(data);
}


export default compress;

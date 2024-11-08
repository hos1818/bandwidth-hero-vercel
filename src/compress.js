import sharp from 'sharp';
import redirect from './redirect.js';
import { URL } from 'url';

// Sharpening parameters
const sharpenParams = { sigma: 1.0, flat: 1.0, jagged: 0.5 };

// Main compression function
async function compress(req, res, input) {
  try {
    // Determine format and options from request parameters
    const format = req.params.webp ? 'avif' : 'jpeg';
    const { grayscale, originSize, url, quality } = req.params;

    const metadata = await sharp(input).metadata();
    const { width, height, pages } = metadata;
    const pixelCount = width * height;

    // Determine animation and output format
    const isAnimated = pages && pages > 1;
    const outputFormat = isAnimated ? 'webp' : format;
    const compressionQuality = quality || 75;

    // Optimize AVIF parameters based on image dimensions
    const { tileRows, tileCols, minQuantizer, maxQuantizer, effort } = optimizeAvifParams(width, height);

    // Initialize sharp instance with grayscale option
    let sharpInstance = sharp(input, { animated: isAnimated });
    if (grayscale) {
      sharpInstance = sharpInstance.grayscale();
    }

    // Apply artifact reduction for large images
    if (!isAnimated && (outputFormat === 'jpeg' || outputFormat === 'avif') && pixelCount > 500000) {
      sharpInstance = applyArtifactReduction(sharpInstance, pixelCount);
    }

    // Apply sharpening for detailed or large images
    if (!isAnimated && pixelCount > 500000) {
      sharpInstance = sharpInstance.sharpen(sharpenParams.sigma, sharpenParams.flat, sharpenParams.jagged);
    }

    // Configure output format options
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

    if (res.headersSent) {
      console.error('Headers already sent, unable to send the compressed image.');
      return;
    }

    sendImage(res, output, outputFormat, url, originSize, info.size);
  } catch (err) {
    console.error('Error during image compression:', err);
    return redirect(req, res);
  }
}

// Adjust AVIF parameters dynamically
function optimizeAvifParams(width, height) {
  const thresholds = { large: 2000, medium: 1000 };
  if (width > thresholds.large || height > thresholds.large) {
    return { tileRows: 4, tileCols: 4, minQuantizer: 30, maxQuantizer: 50, effort: 3 };
  } else if (width > thresholds.medium || height > thresholds.medium) {
    return { tileRows: 2, tileCols: 2, minQuantizer: 28, maxQuantizer: 48, effort: 4 };
  } else {
    return { tileRows: 1, tileCols: 1, minQuantizer: 26, maxQuantizer: 48, effort: 4 };
  }
}

// Apply artifact reduction based on pixel count
function applyArtifactReduction(sharpInstance, pixelCount) {
  const thresholds = {
    large: 3000000,
    medium: 1000000,
    small: 500000,
  };
  const settings = {
    large: { blur: 0.4, denoise: 0.15, sigma: 0.8, saturation: 0.85 },
    medium: { blur: 0.35, denoise: 0.12, sigma: 0.6, saturation: 0.9 },
    small: { blur: 0.3, denoise: 0.1, sigma: 0.5, saturation: 0.95 },
  };
  const { blur, denoise, sigma, saturation } =
    pixelCount > thresholds.large ? settings.large :
    pixelCount > thresholds.medium ? settings.medium : settings.small;

  return sharpInstance
    .modulate({ saturation })
    .blur(blur)
    .sharpen(sigma)
    .gamma();
}

// Send the compressed image as response
function sendImage(res, data, imgFormat, url, originSize, compressedSize) {
  const filename = encodeURIComponent(new URL(url).pathname.split('/').pop() || 'image') + `.${imgFormat}`;
  res.set('Content-Type', `image/${imgFormat}`);
  res.set('Content-Length', data.length);
  res.set('Content-Disposition', `inline; filename="${filename}"`);
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('x-original-size', originSize || 0);
  res.set('x-bytes-saved', Math.max((originSize || 0) - compressedSize, 0));
  res.status(200).end(data);
}

// Export compress as default
export default compress;

import sharp from 'sharp';
import redirect from './redirect.js';
import { URL } from 'url';

const sharpenParams = {
  sigma: 1.0,
  flat: 1.0,
  jagged: 0.5
};

// Optimized compress function for limited resources
async function compress(req, res, input) {
  try {
    const format = req.params.webp ? 'avif' : 'jpeg';
    const { grayscale, originSize, url } = req.params;

    const metadata = await sharp(input).metadata();
    const { width, height, pages } = metadata;
    const pixelCount = width * height;
    const isAnimated = pages && pages > 1;
    const initialFormat = isAnimated ? 'webp' : format;

    const compressionQuality = req.params.quality;
    const { tileRows, tileCols, minQuantizer, maxQuantizer, effort } = optimizeAvifParams(width, height);

    let sharpInstance = sharp(input, { animated: isAnimated });

    if (grayscale) {
      sharpInstance = sharpInstance.grayscale();
    }

    if (!isAnimated) {
      if (initialFormat === 'jpeg' || initialFormat === 'avif') {
        sharpInstance = applyArtifactReduction(sharpInstance, pixelCount);
      }

      if (pixelCount > 500000) {
        sharpInstance = sharpInstance.sharpen(sharpenParams.sigma, sharpenParams.flat, sharpenParams.jagged);
      }
    }

    // Set up the initial format options
    let formatOptions = {
      format: initialFormat,
      options: {
        quality: compressionQuality,
        alphaQuality: 80,
        smartSubsample: true,
        chromaSubsampling: '4:2:0',
        tileRows: initialFormat === 'avif' ? tileRows : undefined,
        tileCols: initialFormat === 'avif' ? tileCols : undefined,
        minQuantizer: initialFormat === 'avif' ? minQuantizer : undefined,
        maxQuantizer: initialFormat === 'avif' ? maxQuantizer : undefined,
        effort: initialFormat === 'avif' ? effort : undefined,
        loop: isAnimated ? 0 : undefined,
      },
    };

    try {
      // Attempt initial format compression
      const { data: output, info } = await sharpInstance
        .toFormat(formatOptions.format, formatOptions.options)
        .toBuffer({ resolveWithObject: true });

      sendImage(res, output, formatOptions.format, url, originSize, info.size);
    } catch (err) {
      if (formatOptions.format === 'avif' && err.message.includes('too large for the HEIF format')) {
        console.warn('Image too large for HEIF, falling back to WebP format.');

        // Update format to WebP on fallback
        formatOptions = {
          format: 'webp',
          options: {
            quality: compressionQuality,
            alphaQuality: 80,
            smartSubsample: true,
            chromaSubsampling: '4:2:0',
            loop: isAnimated ? 0 : undefined,
          },
        };

        const { data: output, info } = await sharpInstance
          .toFormat(formatOptions.format, formatOptions.options)
          .toBuffer({ resolveWithObject: true });

        sendImage(res, output, formatOptions.format, url, originSize, info.size);
      } else {
        console.error('Compression error:', err);
        return redirect(req, res);
      }
    }
  } catch (err) {
    console.error('Error during image compression:', err);
    return redirect(req, res);
  }
}

function optimizeAvifParams(width, height) {
  const largeImageThreshold = 2000;
  const mediumImageThreshold = 1000;

  if (width > largeImageThreshold || height > largeImageThreshold) {
    return { tileRows: 4, tileCols: 4, minQuantizer: 30, maxQuantizer: 50, effort: 3 };
  } else if (width > mediumImageThreshold || height > mediumImageThreshold) {
    return { tileRows: 2, tileCols: 2, minQuantizer: 28, maxQuantizer: 48, effort: 4 };
  } else {
    return { tileRows: 1, tileCols: 1, minQuantizer: 26, maxQuantizer: 48, effort: 4 };
  }
}

function applyArtifactReduction(sharpInstance, pixelCount) {
  const thresholds = {
    large: 3000000,
    medium: 1000000,
    small: 500000,
  };

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
      : pixelCount > thresholds.small
      ? settings.small
      : { blurRadius: 0.3, denoiseStrength: 0.1, sharpenSigma: 0.5, saturationReduction: 1.0 };

  return sharpInstance
    .modulate({ saturation: saturationReduction })
    .blur(blurRadius)
    .sharpen(sharpenSigma)
    .gamma();
}

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

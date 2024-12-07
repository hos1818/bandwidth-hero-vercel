import sharp from 'sharp';
import redirect from './redirect.js';
import { URL } from 'url';

const MAX_DIMENSION = 16384;
const LARGE_IMAGE_THRESHOLD = 4000000;
const MEDIUM_IMAGE_THRESHOLD = 1000000;

async function compress(req, res, input) {
  try {
    const { format, compressionQuality, grayscale } = getCompressionParams(req);

    const sharpInstance = sharp(input);
    const metadata = await sharpInstance.metadata();

    const isAnimated = metadata.pages > 1;
    const pixelCount = metadata.width * metadata.height;
    const outputFormat = isAnimated ? 'webp' : format;

    const avifParams = outputFormat === 'avif' ? optimizeAvifParams(metadata.width, metadata.height) : {};
    let processedImage = sharp(input, { animated: isAnimated });

    if (grayscale) processedImage = processedImage.grayscale();
    if (!isAnimated) processedImage = applyArtifactReduction(processedImage, pixelCount);

    if (metadata.width > MAX_DIMENSION || metadata.height > MAX_DIMENSION) {
      processedImage = processedImage.resize({
        width: Math.min(metadata.width, MAX_DIMENSION),
        height: Math.min(metadata.height, MAX_DIMENSION),
        fit: 'inside',
      });
    }

    const formatOptions = getFormatOptions(outputFormat, compressionQuality, avifParams, isAnimated);

    processedImage.toFormat(outputFormat, formatOptions)
      .toBuffer({ resolveWithObject: true })
      .then(({ data, info }) => {
        sendImage(res, data, outputFormat, req.params.url, req.params.originSize, info.size);
      })
      .catch((error) => {
        handleSharpError(error, res, processedImage, outputFormat, req, compressionQuality);
      });
  } catch (err) {
    console.error('Error during image compression:', err);
    redirect(req, res);
  }
}

function getCompressionParams(req) {
  const format = req.params.webp ? 'avif' : 'jpeg';
  const compressionQuality = Math.min(Math.max(parseInt(req.params.quality, 10) || 75, 10), 100);
  const grayscale = req.params.grayscale === 'true' || req.params.grayscale === true;

  return { format, compressionQuality, grayscale };
}

function optimizeAvifParams(width, height) {
  const area = width * height;
  if (area > LARGE_IMAGE_THRESHOLD) {
    return { tileRows: 4, tileCols: 4, minQuantizer: 30, maxQuantizer: 50, effort: 3 };
  } else if (area > MEDIUM_IMAGE_THRESHOLD) {
    return { tileRows: 2, tileCols: 2, minQuantizer: 28, maxQuantizer: 48, effort: 4 };
  } else {
    return { tileRows: 1, tileCols: 1, minQuantizer: 26, maxQuantizer: 46, effort: 5 };
  }
}

function getFormatOptions(outputFormat, quality, avifParams, isAnimated) {
  return {
    quality,
    alphaQuality: 80,
    smartSubsample: true,
    chromaSubsampling: '4:2:0',
    ...(outputFormat === 'avif' ? avifParams : {}),
    loop: isAnimated ? 0 : undefined,
  };
}

function applyArtifactReduction(sharpInstance, pixelCount) {
  const settings = pixelCount > LARGE_IMAGE_THRESHOLD
    ? { blur: 0.4, denoise: 0.15, sharpen: 0.8, saturation: 0.85 }
    : pixelCount > MEDIUM_IMAGE_THRESHOLD
    ? { blur: 0.35, denoise: 0.12, sharpen: 0.6, saturation: 0.9 }
    : { blur: 0.3, denoise: 0.1, sharpen: 0.5, saturation: 0.95 };

  return sharpInstance
    .modulate({ saturation: settings.saturation })
    .blur(settings.blur)
    .sharpen(settings.sharpen)
    .gamma();
}

function handleSharpError(error, res, sharpInstance, outputFormat, req, quality) {
  if (error.message.includes('too large for the HEIF format')) {
    console.warn('Image too large for HEIF format, falling back to JPEG/WebP.');
    const fallbackFormat = outputFormat === 'avif' ? 'jpeg' : outputFormat;
    sharpInstance.toFormat(fallbackFormat, { quality })
      .toBuffer({ resolveWithObject: true })
      .then(({ data, info }) => {
        sendImage(res, data, fallbackFormat, req.params.url, req.params.originSize, info.size);
      })
      .catch((err) => redirect(req, res));
  } else {
    console.error('Unhandled sharp error:', error);
    redirect(req, res);
  }
}

function sendImage(res, data, format, url, originSize, compressedSize) {
  const filename = encodeURIComponent(new URL(url).pathname.split('/').pop() || 'image') + `.${format}`;
  res.setHeader('Content-Type', `image/${format}`);
  res.setHeader('Content-Length', data.length);
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('x-original-size', originSize || 0);
  res.setHeader('x-bytes-saved', Math.max((originSize || 0) - compressedSize, 0));
  res.status(200).end(data);
}

export default compress;

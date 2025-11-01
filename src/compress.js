import sharp from 'sharp';
import redirect from './redirect.js';
import { URL } from 'url';
import sanitizeFilename from 'sanitize-filename';

const MAX_DIMENSION = 16384;
const LARGE_IMAGE_THRESHOLD = 4_000_000;
const MEDIUM_IMAGE_THRESHOLD = 1_000_000;
const MAX_PIXEL_LIMIT = 100_000_000; // safety for serverless memory

export default async function compress(req, res, input) {
  try {
    // --- Input validation ---
    if (!Buffer.isBuffer(input) && typeof input !== 'string') {
      return fail('Invalid input: must be Buffer or file path', req, res);
    }

    const { format, compressionQuality, grayscale } = getCompressionParams(req);
    const sharpInstance = sharp(input, {
      animated: true,
      limitInputPixels: MAX_PIXEL_LIMIT // prevent decompression bombs
    });

    const metadata = await sharpInstance.metadata();

    if (!metadata?.width || !metadata?.height) {
      return fail('Invalid or missing metadata', req, res);
    }

    const { width, height } = metadata;
    const isAnimated = (metadata.pages || 1) > 1;
    const pixelCount = width * height;

    // --- Safety guard for extremely large files ---
    if (pixelCount > MAX_PIXEL_LIMIT) {
      return fail('Image too large for processing', req, res);
    }

    const outputFormat = isAnimated ? 'webp' : format;
    const avifParams = outputFormat === 'avif'
      ? optimizeAvifParams(width, height)
      : {};

    // --- Processing chain (built dynamically) ---
    let processed = sharpInstance.clone();

    if (grayscale) processed = processed.grayscale();

    if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
      processed = processed.resize({
        width: Math.min(width, MAX_DIMENSION),
        height: Math.min(height, MAX_DIMENSION),
        fit: 'inside',
        withoutEnlargement: true
      });
    }

    // --- Compression and output ---
    const formatOptions = getFormatOptions(outputFormat, compressionQuality, avifParams, isAnimated);

    // If file >2MB, stream to response (saves RAM)
    if (Buffer.isBuffer(input) && input.length > 2_000_000) {
      res.setHeader('Content-Type', `image/${outputFormat}`);
      res.setHeader('Content-Disposition', 'inline');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      processed
        .toFormat(outputFormat, formatOptions)
        .pipe(res)
        .on('error', err => fail('Streaming compression failed', req, res, err));
      return;
    }

    const { data, info } = await processed
      .toFormat(outputFormat, formatOptions)
      .toBuffer({ resolveWithObject: true });

    sendImage(res, data, outputFormat, req.params.url || '', req.params.originSize || 0, info.size);

  } catch (err) {
    fail('Error during image compression', req, res, err);
  }
}

function getCompressionParams(req) {
  const format = req.params?.webp ? 'avif' : 'jpeg';
  const compressionQuality = clamp(parseInt(req.params?.quality, 10) || 75, 10, 100);
  const grayscale = req.params?.grayscale === 'true' || req.params?.grayscale === true;
  return { format, compressionQuality, grayscale };
}

function clamp(v, min, max) {
  return Math.min(Math.max(v, min), max);
}

function optimizeAvifParams(width, height) {
  const area = width * height;
  if (area > LARGE_IMAGE_THRESHOLD)
    return { tileRows: 4, tileCols: 4, minQuantizer: 20, maxQuantizer: 40, effort: 4 };
  if (area > MEDIUM_IMAGE_THRESHOLD)
    return { tileRows: 2, tileCols: 2, minQuantizer: 28, maxQuantizer: 48, effort: 4 };
  return { tileRows: 1, tileCols: 1, minQuantizer: 26, maxQuantizer: 46, effort: 5 };
}

function getFormatOptions(format, quality, avifParams, isAnimated) {
  const base = {
    quality,
    alphaQuality: 80,
    chromaSubsampling: '4:2:0',
    loop: isAnimated ? 0 : undefined
  };
  return format === 'avif' ? { ...base, ...avifParams } : base;
}

function sendImage(res, data, format, url, originSize, compressedSize) {
  const filename = sanitizeFilename(new URL(url).pathname.split('/').pop() || 'image') + `.${format}`;
  res.setHeader('Content-Type', `image/${format}`);
  res.setHeader('Content-Length', data.length);
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('x-original-size', originSize);
  res.setHeader('x-bytes-saved', Math.max(originSize - compressedSize, 0));
  res.status(200).end(data);
}

function fail(message, req, res, err = null) {
  console.error(JSON.stringify({
    level: 'error',
    message,
    url: req?.params?.url,
    error: err?.message
  }));
  redirect(req, res);
}



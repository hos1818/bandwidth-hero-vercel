import sharp from 'sharp';
import redirect from './redirect.js';
import { URL } from 'url';
import sanitizeFilename from 'sanitize-filename';

// --- Sharp global configuration ---
sharp.cache({ memory: 50, files: 0 });
sharp.concurrency(1);
sharp.simd(true);

// --- Constants ---
const MAX_DIMENSION = 16384;
const MAX_PIXEL_LIMIT = 100_000_000; // safety against decompression bombs
const PROCESSING_TIMEOUT_MS = 60_000; // max 60s per image

export default async function compress(req, res, input) {
  let sharpInstance = null;
  let processed = null;
  let timeout;

  try {
    // ---- Validate input ----
    if (!Buffer.isBuffer(input) && typeof input !== 'string') {
      return fail('Invalid input: must be Buffer or file path', req, res);
    }

    const { quality, grayscale } = getCompressionParams(req);

    // ---- Timeout protection ----
    timeout = setTimeout(() => {
      processed?.destroy?.();
      sharpInstance?.destroy?.();
      fail('Image processing timeout', req, res);
    }, PROCESSING_TIMEOUT_MS);

    // ---- Initialize Sharp ----
    sharpInstance = sharp(input, {
      animated: true,
      limitInputPixels: MAX_PIXEL_LIMIT
    });

    const metadata = await sharpInstance.metadata();
    if (!metadata?.width || !metadata?.height) {
      return fail('Invalid or missing metadata', req, res);
    }

    const { width, height } = metadata;
    const pixelCount = width * height;
    const isAnimated = (metadata.pages || 1) > 1;

    if (pixelCount > MAX_PIXEL_LIMIT) {
      return fail('Image too large for processing', req, res);
    }

    // ---- Build image pipeline ----
    processed = sharpInstance.clone();

    if (grayscale) processed = processed.grayscale();

    // Resize if dimensions exceed limits
    if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
      processed = processed.resize({
        width: Math.min(width, MAX_DIMENSION),
        height: Math.min(height, MAX_DIMENSION),
        fit: 'inside',
        withoutEnlargement: true
      });
    }

    // ---- WebP Format Options ----
    const formatOptions = {
      quality,
      alphaQuality: 80,
      lossless: false,
      effort: 4,
      smartSubsample: true,
      loop: isAnimated ? 0 : undefined
    };

    const outputFormat = 'webp';

    // ---- Large inputs streamed directly (better RAM usage) ----
    if (Buffer.isBuffer(input) && input.length > 2_000_000) {
      setResponseHeaders(res, outputFormat);

      const stream = processed.toFormat(outputFormat, formatOptions);

      req.socket.on('close', () => {
        stream.destroy?.();
      });

      stream.pipe(res).on('error', err => {
        if (!res.headersSent) fail('Streaming failed', req, res, err);
      });

      clearTimeout(timeout);
      return;
    }

    // ---- Full buffer mode ----
    const { data, info } = await processed
      .toFormat(outputFormat, formatOptions)
      .toBuffer({ resolveWithObject: true });

    clearTimeout(timeout);

    sendImage(
      res,
      data,
      outputFormat,
      req.params.url || '',
      req.params.originSize || 0,
      info.size
    );

  } catch (err) {
    clearTimeout(timeout);
    sharpInstance?.destroy?.();
    processed?.destroy?.();
    fail('Error during image compression', req, res, err);
  }
}

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

function getCompressionParams(req) {
  return {
    quality: clamp(Number(req.params?.quality) || 75, 10, 100),
    grayscale: req.params?.grayscale === 'true'
  };
}

const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

function sendImage(res, data, format, url, originSize, compressedSize) {
  const filename = sanitizeFilename(
    new URL(url).pathname.split('/').pop() || 'image'
  ) + `.${format}`;

  setResponseHeaders(res, format);

  res.setHeader('Content-Length', data.length);
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  res.setHeader('x-original-size', originSize);
  res.setHeader('x-bytes-saved', Math.max(originSize - compressedSize, 0));

  res.status(200).end(data);
}

function setResponseHeaders(res, format) {
  res.setHeader('Content-Type', `image/${format}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'public, max-age=31536000');
  res.setHeader('CDN-Cache-Control', 'public, max-age=31536000');
  res.setHeader('Vercel-CDN-Cache-Control', 'public, max-age=31536000');
}

function fail(message, req, res, err = null) {
  console.error(
    JSON.stringify({
      level: 'error',
      message,
      url: req?.params?.url,
      error: err?.message
    })
  );
  redirect(req, res);
}

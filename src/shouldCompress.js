import isAnimated from 'is-animated';
import dotenv from 'dotenv';

dotenv.config();

// --- Configuration (initialized once) ---
const DEFAULT_MIN_COMPRESS_LENGTH = 512;
const ENV_MIN_LENGTH = Number(process.env.MIN_COMPRESS_LENGTH);
const MIN_COMPRESS_LENGTH = Number.isFinite(ENV_MIN_LENGTH)
  ? ENV_MIN_LENGTH
  : DEFAULT_MIN_COMPRESS_LENGTH;

const MIN_TRANSPARENT_COMPRESS_LENGTH = MIN_COMPRESS_LENGTH * 50; // ~100KB
const APNG_THRESHOLD_LENGTH = MIN_COMPRESS_LENGTH * 100;          // ~200KB

/**
 * Utility: Safe integer validation.
 */
const isPositiveNumber = (n) => typeof n === 'number' && Number.isFinite(n) && n > 0;

/**
 * Utility: Valid buffer check.
 */
const isBufferValid = (buffer) => Buffer.isBuffer(buffer) && buffer.length > 0;

/**
 * Returns true if MIME type represents an image.
 */
const isImageType = (type) => typeof type === 'string' && type.startsWith('image/');

/**
 * Returns true if file size meets threshold.
 */
const hasSufficientSize = (size, threshold) => isPositiveNumber(size) && size >= threshold;

/**
 * Transparent PNG/GIF optimization: skip compression for very small images.
 */
const isTransparentImage = (type, size, webp) =>
  !webp &&
  (type === 'image/png' || type === 'image/gif') &&
  !hasSufficientSize(size, MIN_TRANSPARENT_COMPRESS_LENGTH);

/**
 * Detects small animated PNGs (APNG) to skip unnecessary recompression.
 */
const isSmallAnimatedPng = (type, buffer, size) => {
  if (type !== 'image/png' || hasSufficientSize(size, APNG_THRESHOLD_LENGTH) || !isBufferValid(buffer)) {
    return false;
  }
  try {
    return isAnimated(buffer);
  } catch (err) {
    console.warn(`[WARN] Animation check failed: ${err.message}`);
    return false;
  }
};

/**
 * Determines if compression should be applied based on thresholds and content.
 */
function shouldCompress(req, buffer) {
  const params = req?.params || {};
  const { originType: rawType, originSize, webp } = params;

  const validBuffer = isBufferValid(buffer);
  if (!rawType || !isPositiveNumber(originSize) || !validBuffer) {
    logSkip('invalid-input', { rawType, originSize, bufferValid: validBuffer });
    return false;
  }

  const originType = rawType.toLowerCase();

  if (!isImageType(originType)) {
    return logSkip('non-image', { originType });
  }
  if (!hasSufficientSize(originSize, MIN_COMPRESS_LENGTH)) {
    return logSkip('too-small', { originSize });
  }
  if (isTransparentImage(originType, originSize, webp)) {
    return logSkip('transparent-small', { originType, originSize });
  }
  if (isSmallAnimatedPng(originType, buffer, originSize)) {
    return logSkip('animated-small', { originType, originSize });
  }

  console.log(`[INFO] compress reason="eligible" type=${originType} size=${originSize}`);
  return true;
}

/**
 * Centralized structured logging for skips.
 */
function logSkip(reason, context = {}) {
  const ctx = Object.entries(context)
    .map(([k, v]) => `${k}=${v}`)
    .join(' ');
  console.log(`[INFO] skip reason="${reason}" ${ctx}`);
  return false;
}

export default shouldCompress;

import isAnimated from 'is-animated';

// --- Configuration ---
const ENV_MIN_LENGTH = parseInt(process.env.MIN_COMPRESS_LENGTH, 10);
const MIN_COMPRESS_LENGTH = !isNaN(ENV_MIN_LENGTH) ? ENV_MIN_LENGTH : 1024; // Default 1KB

// Thresholds
const MIN_TRANSPARENT_COMPRESS_LENGTH = MIN_COMPRESS_LENGTH * 50; // ~50KB
const ALREADY_COMPRESSED_THRESHOLD = MIN_COMPRESS_LENGTH * 100;   // ~100KB for WebP/AVIF

// Content Types
const EXCLUDED_TYPES = new Set(['image/svg+xml', 'application/pdf', 'image/x-icon']);
const LEGACY_TYPES = new Set(['image/png', 'image/gif']);
const MODERN_TYPES = new Set(['image/webp', 'image/avif']);

/**
 * Utility: Structured Logging
 */
function logSkip(reason, details) {
  if (process.env.NODE_ENV !== 'production') {
    // Only log distinct skip reasons in dev/debug mode to reduce noise
    console.log(`[SKIP] Reason: ${reason}`, details);
  }
  return false;
}

/**
 * Determines if an image should be compressed/converted.
 * 
 * Logic Flow:
 * 1. Validate Input
 * 2. Check Blocklist (SVG, etc)
 * 3. Check Size (Too small = overhead > savings)
 * 4. Check Format Specifics (Don't recompress small WebPs, don't break animations)
 */
export default function shouldCompress(req, buffer) {
  const { originType, originSize, webp, grayscale, quality } = req.params || {};

  // 1. Validate Input
  if (!originType || !originSize || !Buffer.isBuffer(buffer)) {
    return false;
  }

  // 2. Non-Image and Vector Checks
  if (!originType.startsWith('image/') || EXCLUDED_TYPES.has(originType)) {
    return false; // Pass through SVGs, Icons, and non-images
  }

  // 3. Size Checks: Too Small
  if (originSize < MIN_COMPRESS_LENGTH) {
    return false;
  }

  // 4. "Already Modern" Check
  // If the source is already WebP/AVIF, re-compressing it causes quality loss 
  // and CPU waste, unless the file is huge or user explicitly requested edits (grayscale/quality).
  if (MODERN_TYPES.has(originType)) {
    const isEditing = Boolean(grayscale || quality);
    const isLarge = originSize > ALREADY_COMPRESSED_THRESHOLD;
    
    if (!isEditing && !isLarge) {
      return logSkip('already-compressed', { originType, originSize });
    }
  }

  // 5. Transparent/Legacy Check (PNG/GIF)
  // If we are NOT converting to WebP (req.params.webp is false), 
  // we shouldn't compress small PNGs because converting them to JPEG kills transparency.
  if (LEGACY_TYPES.has(originType) && !webp) {
    if (originSize < MIN_TRANSPARENT_COMPRESS_LENGTH) {
      return logSkip('transparent-small', { originType, originSize });
    }
  }

  // 6. Animation Check
  // Re-encoding animations (GIF/APNG/WebP-Anim) is extremely CPU heavy.
  // Unless your 'compress' module explicitly handles frame extraction and re-encoding,
  // it is safer to bypass them.
  try {
    if (isAnimated(buffer)) {
      return logSkip('animated', { originType });
    }
  } catch (err) {
    console.warn(`⚠️ Animation check error: ${err.message}`);
    return false; // Fail safe: don't compress if we can't verify
  }

  return true;
}

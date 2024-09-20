const isAnimated = require('is-animated');

const DEFAULT_MIN_COMPRESS_LENGTH = 2048;
const MIN_COMPRESS_LENGTH = process.env.MIN_COMPRESS_LENGTH || DEFAULT_MIN_COMPRESS_LENGTH;
const MIN_TRANSPARENT_COMPRESS_LENGTH = process.env.MIN_TRANSPARENT_COMPRESS_LENGTH || MIN_COMPRESS_LENGTH * 50; // ~100KB
const APNG_THRESH_LENGTH = process.env.APNG_THRESH_LENGTH || MIN_COMPRESS_LENGTH * 100; // ~200KB

// Utility function to check image type and size eligibility for compression
function isEligibleForCompression(originType, originSize, buffer, webp) {
    // Skip non-image types
    if (!originType.startsWith('image')) {
        console.log(`Skipping compression: non-image type (${originType})`);
        return false;
    }

    // Skip zero-size content
    if (originSize === 0) {
        console.log('Skipping compression: zero-size content.');
        return false;
    }

    // Skip small images for WebP compression
    if (webp && originSize < MIN_COMPRESS_LENGTH) {
        console.log(`Skipping compression: WebP, size below threshold (${originSize} < ${MIN_COMPRESS_LENGTH}).`);
        return false;
    }

    // Skip small transparent PNG or GIF images
    if (!webp && (originType.endsWith('png') || originType.endsWith('gif')) && originSize < MIN_TRANSPARENT_COMPRESS_LENGTH) {
        console.log(`Skipping compression: transparent image, size below threshold (${originSize} < ${MIN_TRANSPARENT_COMPRESS_LENGTH}).`);
        return false;
    }

    // Skip small animated PNGs
    if (originType.endsWith('png') && isAnimated(buffer) && originSize < APNG_THRESH_LENGTH) {
        console.log(`Skipping compression: small animated PNG, size below threshold (${originSize} < ${APNG_THRESH_LENGTH}).`);
        return false;
    }

    // If none of the above conditions apply, the image is eligible for compression
    return true;
}

// Main function to decide if compression should be applied
function shouldCompress(req, buffer) {
    const { originType, originSize, webp } = req.params;

    // Check if the image is eligible for compression
    return isEligibleForCompression(originType, originSize, buffer, webp);
}

module.exports = shouldCompress;

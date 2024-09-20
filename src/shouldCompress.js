const isAnimated = require('is-animated')

const DEFAULT_MIN_COMPRESS_LENGTH = 2048;
const MIN_COMPRESS_LENGTH = process.env.MIN_COMPRESS_LENGTH || DEFAULT_MIN_COMPRESS_LENGTH;
const MIN_TRANSPARENT_COMPRESS_LENGTH = MIN_COMPRESS_LENGTH * 50; // ~100KB
const APNG_THRESH_LENGTH = MIN_COMPRESS_LENGTH * 100; // ~200KB


// Utility functions for specific checks
function isImageType(originType) {
    return originType.startsWith('image');
}

function hasSufficientSize(originSize, threshold) {
    return originSize >= threshold;
}

function isNotEligibleForWebpCompression(webp, originSize) {
    return webp && originSize < MIN_COMPRESS_LENGTH;
}

function isBelowSizeThresholdForCompression(originType, originSize, webp) {
    if (!webp && (originType.endsWith('png') || originType.endsWith('gif'))) {
        return originSize < MIN_TRANSPARENT_COMPRESS_LENGTH;
    }
    return false;
}

function isSmallAnimatedPng(originType, buffer, originSize) {
    return originType.endsWith('png') && isAnimated(buffer) && originSize < APNG_THRESH_LENGTH;
}

// Main function to decide if compression should be applied
function shouldCompress(req, buffer) {
    const { originType, originSize, webp } = req.params;

    // Validate image type
    if (!isImageType(originType)) {
        console.log(Skipping compression for non-image type: ${originType});
        return false;
    }

    // Check for zero size
    if (originSize === 0) {
        console.log('Skipping compression for zero-size content.');
        return false;
    }

    // Conditions to check if the image is not eligible for compression
    if (isNotEligibleForWebpCompression(webp, originSize) ||
        isBelowSizeThresholdForCompression(originType, originSize, webp) ||
        isSmallAnimatedPng(originType, buffer, originSize)) {
        console.log(No compression applied for content of type: ${originType} and size: ${originSize});
        return false;
    }

    // If none of the conditions apply, the image should be compressed
    return true;
}

module.exports = shouldCompress;


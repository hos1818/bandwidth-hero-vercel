const isAnimated = require('is-animated');

// Define default compression size thresholds and allow overrides through environment variables.
const DEFAULT_MIN_COMPRESS_LENGTH = 2048;
const MIN_COMPRESS_LENGTH = parseInt(process.env.MIN_COMPRESS_LENGTH, 10) || DEFAULT_MIN_COMPRESS_LENGTH;
const MIN_TRANSPARENT_COMPRESS_LENGTH = MIN_COMPRESS_LENGTH * 50; // ~100KB for PNG/GIFs
const APNG_THRESH_LENGTH = MIN_COMPRESS_LENGTH * 100; // ~200KB for animated PNGs

// Utility functions for specific checks
function isImageType(originType) {
    return originType && originType.startsWith('image');
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

// Consolidated function for checking size thresholds
function isSizeBelowThreshold({ originType, originSize, webp }, buffer) {
    return isNotEligibleForWebpCompression(webp, originSize) ||
           isBelowSizeThresholdForCompression(originType, originSize, webp) ||
           isSmallAnimatedPng(originType, buffer, originSize);
}

// Main function to decide if compression should be applied
function shouldCompress(req, buffer) {
    const { originType, originSize, webp } = req.params;

    // Validate parameters
    if (!originType || typeof originSize !== 'number' || originSize < 0) {
        console.error('Invalid parameters: originType or originSize missing/invalid.');
        return false;
    }

    // Ensure it's an image type
    if (!isImageType(originType)) {
        console.log(`Skipping compression for non-image type: ${originType}`);
        return false;
    }

    // Skip zero-size content
    if (originSize === 0) {
        console.log('Skipping compression for zero-size content.');
        return false;
    }

    // Apply thresholds for size and other conditions
    if (isSizeBelowThreshold(req.params, buffer)) {
        console.log(`No compression applied for content of type: ${originType} and size: ${originSize}`);
        return false;
    }

    // If none of the conditions match, apply compression
    console.log(`Compressing content of type: ${originType} and size: ${originSize}`);
    return true;
}

module.exports = shouldCompress;

import isAnimated from 'is-animated';

// Define default compression size thresholds and allow overrides through environment variables.
const DEFAULT_MIN_COMPRESS_LENGTH = 512;
const MIN_COMPRESS_LENGTH = process.env.MIN_COMPRESS_LENGTH || DEFAULT_MIN_COMPRESS_LENGTH;
const MIN_TRANSPARENT_COMPRESS_LENGTH = MIN_COMPRESS_LENGTH * 50; // ~100KB for PNG/GIFs
const APNG_THRESH_LENGTH = MIN_COMPRESS_LENGTH * 100; // ~200KB for animated PNGs

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

// Optional: A helper to gather all the size threshold conditions into a single function for readability.
function isSizeBelowThreshold(req, buffer) {
    const { originType, originSize, webp } = req.params;
    return isNotEligibleForWebpCompression(webp, originSize) ||
           isBelowSizeThresholdForCompression(originType, originSize, webp) ||
           isSmallAnimatedPng(originType, buffer, originSize);
}

// Main function to decide if compression should be applied
function shouldCompress(req, buffer) {
    const { originType, originSize, webp } = req.params;

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

    // Apply thresholds for various conditions
    if (isSizeBelowThreshold(req, buffer)) {
        console.log(`No compression applied for content of type: ${originType} and size: ${originSize}`);
        return false;
    }

    // If none of the conditions match, apply compression
    console.log(`Compressing content of type: ${originType} and size: ${originSize}`);
    return true;
}
export default shouldCompress;

// Define default compression size thresholds and allow overrides through environment variables.
const DEFAULT_MIN_COMPRESS_LENGTH = 2048;
const MIN_COMPRESS_LENGTH = parseInt(process.env.MIN_COMPRESS_LENGTH, 10) || DEFAULT_MIN_COMPRESS_LENGTH;
const MIN_TRANSPARENT_COMPRESS_LENGTH = MIN_COMPRESS_LENGTH * 50; // ~100KB for PNG/GIFs
const APNG_THRESH_LENGTH = MIN_COMPRESS_LENGTH * 100; // ~200KB for animated PNGs

// Utility functions for specific checks
function isImageType(originType) {
    return originType.startsWith('image');
}

function hasSufficientSize(originSize, threshold) {
    return originSize >= threshold;
}

// Custom function to detect animated GIF and PNG files
function isAnimatedImage(originType, buffer) {
    if (originType.endsWith('gif')) {
        // Check for animated GIF by inspecting the header
        // GIF format uses "NETSCAPE2.0" in application extension for animation
        return buffer.includes('NETSCAPE2.0');
    } else if (originType.endsWith('png')) {
        // Check for animated PNG (APNG) by inspecting specific chunks
        const acTLIndex = buffer.indexOf('acTL'); // acTL chunk is present in APNG files
        return acTLIndex !== -1;
    }
    return false;
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
    return originType.endsWith('png') && isAnimatedImage(originType, buffer) && originSize < APNG_THRESH_LENGTH;
}

// Consolidated function to gather size threshold checks for readability
function isSizeBelowThreshold(req, buffer) {
    const { originType, originSize, webp } = req.params;
    return (
        isNotEligibleForWebpCompression(webp, originSize) ||
        isBelowSizeThresholdForCompression(originType, originSize, webp) ||
        isSmallAnimatedPng(originType, buffer, originSize)
    );
}

// Main function to decide if compression should be applied
function shouldCompress(req, buffer) {
    const { originType, originSize, webp } = req.params;

    if (!isImageType(originType)) {
        console.log(`Skipping compression for non-image type: ${originType}`);
        return false;
    }

    if (originSize === 0) {
        console.log('Skipping compression for zero-size content.');
        return false;
    }

    if (isSizeBelowThreshold(req, buffer)) {
        console.log(`No compression applied for content of type: ${originType} and size: ${originSize}`);
        return false;
    }

    console.log(`Compressing content of type: ${originType} and size: ${originSize}`);
    return true;
}

export default shouldCompress;

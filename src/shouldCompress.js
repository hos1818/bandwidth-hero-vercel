import isAnimated from 'is-animated';

// Configuration: Compression size thresholds
const DEFAULT_MIN_COMPRESS_LENGTH = 512;
const MIN_COMPRESS_LENGTH = parseInt(process.env.MIN_COMPRESS_LENGTH, 10) || DEFAULT_MIN_COMPRESS_LENGTH;
const MIN_TRANSPARENT_COMPRESS_LENGTH = MIN_COMPRESS_LENGTH * 50; // ~100KB for PNG/GIFs
const APNG_THRESHOLD_LENGTH = MIN_COMPRESS_LENGTH * 100; // ~200KB for animated PNGs;

/**
 * Determines if the origin type is an image type.
 * @param {string} originType - The content type of the original file.
 * @returns {boolean} - True if the type starts with "image".
 */
function isImageType(originType) {
    return originType.startsWith('image');
}

/**
 * Checks if the content size is above the minimum threshold for compression.
 * @param {number} originSize - The size of the original content in bytes.
 * @param {number} threshold - The size threshold to compare against.
 * @returns {boolean} - True if the size is above the threshold.
 */
function hasSufficientSize(originSize, threshold) {
    return originSize >= threshold;
}

/**
 * Determines if a small WebP image should not be compressed.
 * @param {boolean} webp - Whether the output format is WebP.
 * @param {number} originSize - The size of the original content in bytes.
 * @returns {boolean} - True if WebP and below the compression threshold.
 */
function isNotEligibleForWebpCompression(webp, originSize) {
    return webp && originSize < MIN_COMPRESS_LENGTH;
}

/**
 * Checks if the content is a transparent image below the compression threshold.
 * @param {string} originType - The content type of the original file.
 * @param {number} originSize - The size of the original content in bytes.
 * @param {boolean} webp - Whether the output format is WebP.
 * @returns {boolean} - True if the content is a PNG/GIF and below the threshold.
 */
function isTransparentImage(originType, originSize, webp) {
    if (!webp && (originType.endsWith('png') || originType.endsWith('gif'))) {
        return originSize < MIN_TRANSPARENT_COMPRESS_LENGTH;
    }
    return false;
}

/**
 * Checks if the content is a small animated PNG below the compression threshold.
 * @param {string} originType - The content type of the original file.
 * @param {Buffer} buffer - The content buffer.
 * @param {number} originSize - The size of the original content in bytes.
 * @returns {boolean} - True if the content is a small animated PNG.
 */
function isSmallAnimatedPng(originType, buffer, originSize) {
    return originType.endsWith('png') && isAnimated(buffer) && originSize < APNG_THRESHOLD_LENGTH;
}

/**
 * Determines whether compression should be applied based on the content type and size.
 * @param {Object} req - The HTTP request object.
 * @param {Buffer} buffer - The content buffer.
 * @returns {boolean} - True if compression should be applied.
 */
function shouldCompress(req, buffer) {
    const { originType, originSize, webp } = req.params;

    // Validate inputs
    if (!isImageType(originType)) {
        console.log(`Skipping compression: Non-image type ${originType}`);
        return false;
    }
    if (originSize === 0) {
        console.log('Skipping compression: Zero-size content.');
        return false;
    }

    // Evaluate compression eligibility
    if (
        isNotEligibleForWebpCompression(webp, originSize) ||
        isTransparentImage(originType, originSize, webp) ||
        isSmallAnimatedPng(originType, buffer, originSize)
    ) {
        console.log(`Skipping compression: ${originType}, size=${originSize}`);
        return false;
    }

    // If none of the conditions match, compression is applied
    console.log(`Compression applied: ${originType}, size=${originSize}`);
    return true;
}

export default shouldCompress;

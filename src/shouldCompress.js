import isAnimated from 'is-animated';
import dotenv from 'dotenv';


// Load environment variables
dotenv.config();

// Configuration: Compression size thresholds
const DEFAULT_MIN_COMPRESS_LENGTH = 512;
const MIN_COMPRESS_LENGTH = parseInt(process.env.MIN_COMPRESS_LENGTH, 10) || DEFAULT_MIN_COMPRESS_LENGTH;
const MIN_TRANSPARENT_COMPRESS_LENGTH = MIN_COMPRESS_LENGTH * 50; // ~100KB for PNG/GIFs
const APNG_THRESHOLD_LENGTH = MIN_COMPRESS_LENGTH * 100; // ~200KB for animated PNGs

/**
 * Checks if the MIME type indicates an image.
 * @param {string} originType - The MIME type of the file.
 * @returns {boolean} True if it's an image type, false otherwise.
 */
function isImageType(originType) {
    return typeof originType === 'string' && /^image\//i.test(originType);
}

/**
 * Checks if the origin size meets the required threshold.
 * @param {number} originSize - Size of the original file.
 * @param {number} threshold - Minimum size threshold.
 * @returns {boolean} True if the size is sufficient, false otherwise.
 */
function hasSufficientSize(originSize, threshold) {
    return typeof originSize === 'number' && originSize >= threshold;
}

/**
 * Determines if an image is a transparent PNG/GIF that should not be compressed.
 * @param {string} originType - The MIME type of the image.
 * @param {number} originSize - Size of the original file.
 * @param {boolean} webp - Indicates if WebP compression is requested.
 * @returns {boolean} True if it's a small transparent image, false otherwise.
 */
function isTransparentImage(originType, originSize, webp) {
    return (
        !webp &&
        ['image/png', 'image/gif'].includes(originType?.toLowerCase()) &&
        !hasSufficientSize(originSize, MIN_TRANSPARENT_COMPRESS_LENGTH)
    );
}

/**
 * Determines if a PNG is a small animated PNG that should not be compressed.
 * @param {string} originType - The MIME type of the image.
 * @param {Buffer} buffer - The file buffer.
 * @param {number} originSize - Size of the original file.
 * @returns {boolean} True if it's a small animated PNG, false otherwise.
 */
function isSmallAnimatedPng(originType, buffer, originSize) {
    return (
        originType?.toLowerCase() === 'image/png' &&
        !hasSufficientSize(originSize, APNG_THRESHOLD_LENGTH) &&
        isBufferValid(buffer) &&
        isAnimated(buffer)
    );
}

/**
 * Validates if a buffer is non-null, non-empty, and of the expected type.
 * @param {Buffer} buffer - The file buffer to validate.
 * @returns {boolean} True if the buffer is valid, false otherwise.
 */
function isBufferValid(buffer) {
    return Buffer.isBuffer(buffer) && buffer.length > 0;
}

/**
 * Determines if an image should be compressed based on type, size, and properties.
 * @param {Object} req - The HTTP request object.
 * @param {Buffer} buffer - The file buffer.
 * @returns {boolean} True if the image should be compressed, false otherwise.
 */
function shouldCompress(req, buffer) {
    const { originType, originSize, webp } = req.params || {};

    // Validate inputs
    if (!originType || typeof originSize !== 'number' || !isBufferValid(buffer)) {
        logInfo(`Skipping compression: Invalid input. originType=${originType}, originSize=${originSize}, bufferValid=${isBufferValid(buffer)}`);
        return false;
    }

    // Check if the file is an image
    if (!isImageType(originType)) {
        logInfo(`Skipping compression: Non-image type "${originType}"`);
        return false;
    }

    // Check if the file size meets the minimum threshold
    if (!hasSufficientSize(originSize, MIN_COMPRESS_LENGTH)) {
        logInfo(`Skipping compression: Insufficient size (${originSize} bytes).`);
        return false;
    }

    // Check for small transparent images
    if (isTransparentImage(originType, originSize, webp)) {
        logInfo(`Skipping compression: Transparent image, size=${originSize}`);
        return false;
    }

    // Check for small animated PNGs
    if (isSmallAnimatedPng(originType, buffer, originSize)) {
        logInfo(`Skipping compression: Small animated PNG, size=${originSize}`);
        return false;
    }

    logInfo(`Compression applied: ${originType}, size=${originSize}`);
    return true;
}

/**
 * Logs informational messages in a consistent format.
 * @param {string} message - The message to log.
 */
function logInfo(message) {
    console.log(`[INFO] ${message}`);
}

export default shouldCompress;

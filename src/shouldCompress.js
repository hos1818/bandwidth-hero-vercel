import isAnimated from 'is-animated';

// Configuration: Compression size thresholds
const DEFAULT_MIN_COMPRESS_LENGTH = 512;
const MIN_COMPRESS_LENGTH = parseInt(process.env.MIN_COMPRESS_LENGTH, 10) || DEFAULT_MIN_COMPRESS_LENGTH;
const MIN_TRANSPARENT_COMPRESS_LENGTH = MIN_COMPRESS_LENGTH * 50; // ~100KB for PNG/GIFs
const APNG_THRESHOLD_LENGTH = MIN_COMPRESS_LENGTH * 100; // ~200KB for animated PNGs;

function isImageType(originType) {
    return originType && originType.startsWith('image');
}

function hasSufficientSize(originSize, threshold) {
    return typeof originSize === 'number' && originSize >= threshold;
}

function isNotEligibleForWebpCompression(webp, originSize) {
    return webp && typeof originSize === 'number' && originSize < MIN_COMPRESS_LENGTH;
}

function isTransparentImage(originType, originSize, webp) {
    if (!webp && originType && (originType.endsWith('png') || originType.endsWith('gif'))) {
        return typeof originSize === 'number' && originSize < MIN_TRANSPARENT_COMPRESS_LENGTH;
    }
    return false;
}

function isSmallAnimatedPng(originType, buffer, originSize) {
    return originType && originType.endsWith('png') && isAnimated(buffer) && typeof originSize === 'number' && originSize < APNG_THRESHOLD_LENGTH;
}

function shouldCompress(req, buffer) {
    const { originType, originSize, webp } = req.params || {};

    if (!isImageType(originType)) {
        console.log(`Skipping compression: Non-image type ${originType}`);
        return false;
    }
    if (typeof originSize !== 'number' || originSize === 0) {
        console.log('Skipping compression: Zero or invalid size content.');
        return false;
    }

    if (
        isNotEligibleForWebpCompression(webp, originSize) ||
        isTransparentImage(originType, originSize, webp) ||
        isSmallAnimatedPng(originType, buffer, originSize)
    ) {
        console.log(`Skipping compression: ${originType}, size=${originSize}`);
        return false;
    }

    console.log(`Compression applied: ${originType}, size=${originSize}`);
    return true;
}

export default shouldCompress;

import isAnimated from 'is-animated';

// Configuration: Compression size thresholds
const DEFAULT_MIN_COMPRESS_LENGTH = 512;
const MIN_COMPRESS_LENGTH = parseInt(process.env.MIN_COMPRESS_LENGTH, 10) || DEFAULT_MIN_COMPRESS_LENGTH;
const MIN_TRANSPARENT_COMPRESS_LENGTH = MIN_COMPRESS_LENGTH * 50; // ~100KB for PNG/GIFs
const APNG_THRESHOLD_LENGTH = MIN_COMPRESS_LENGTH * 100; // ~200KB for animated PNGs;

function isImageType(originType) {
    return originType?.startsWith('image');
}

function hasSufficientSize(originSize, threshold) {
    return typeof originSize === 'number' && originSize >= threshold;
}

function isTransparentImage(originType, originSize, webp) {
    return (
        !webp &&
        (originType?.endsWith('png') || originType?.endsWith('gif')) &&
        !hasSufficientSize(originSize, MIN_TRANSPARENT_COMPRESS_LENGTH)
    );
}

function isSmallAnimatedPng(originType, buffer, originSize) {
    return (
        originType?.endsWith('png') &&
        typeof originSize === 'number' &&
        originSize < APNG_THRESHOLD_LENGTH &&
        isAnimated(buffer)
    );
}

function shouldCompress(req, buffer) {
    const { originType, originSize, webp } = req.params || {};

    if (!isImageType(originType)) {
        console.log(`Skipping compression: Non-image type ${originType}`);
        return false;
    }

    if (!hasSufficientSize(originSize, MIN_COMPRESS_LENGTH)) {
        console.log(`Skipping compression: Insufficient size (${originSize} bytes).`);
        return false;
    }

    if (isTransparentImage(originType, originSize, webp)) {
        console.log(`Skipping compression: Transparent image, size=${originSize}`);
        return false;
    }

    if (isSmallAnimatedPng(originType, buffer, originSize)) {
        console.log(`Skipping compression: Small animated PNG, size=${originSize}`);
        return false;
    }

    console.log(`Compression applied: ${originType}, size=${originSize}`);
    return true;
}

export default shouldCompress;

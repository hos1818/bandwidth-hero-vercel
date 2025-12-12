import isAnimated from 'is-animated';
import dotenv from 'dotenv';

dotenv.config();

// Compression thresholds
const DEFAULT_MIN_COMPRESS_LENGTH = 512;
const parsedEnvThreshold = Number(process.env.MIN_COMPRESS_LENGTH);
const MIN_COMPRESS_LENGTH = Number.isFinite(parsedEnvThreshold) ? parsedEnvThreshold : DEFAULT_MIN_COMPRESS_LENGTH;
const MIN_TRANSPARENT_COMPRESS_LENGTH = MIN_COMPRESS_LENGTH * 50;  // ~100KB
const APNG_THRESHOLD_LENGTH = MIN_COMPRESS_LENGTH * 100;          // ~200KB

function isImageType(originType) {
    return typeof originType === 'string' && originType.startsWith('image/');
}

function hasSufficientSize(originSize, threshold) {
    return typeof originSize === 'number' && originSize >= threshold;
}

function isTransparentImage(originType, originSize, webp) {
    return (
        !webp &&
        (originType === 'image/png' || originType === 'image/gif') &&
        !hasSufficientSize(originSize, MIN_TRANSPARENT_COMPRESS_LENGTH)
    );
}

function isSmallAnimatedPng(originType, buffer, originSize) {
    if (originType !== 'image/png' || hasSufficientSize(originSize, APNG_THRESHOLD_LENGTH) || !isBufferValid(buffer)) {
        return false;
    }
    try {
        return isAnimated(buffer);
    } catch (err) {
        logInfo(`Skipping animation check due to error: ${err.message}`);
        return false;
    }
}

function isBufferValid(buffer) {
    return Buffer.isBuffer(buffer) && buffer.length > 0;
}

function shouldCompress(req, buffer) {
    const { originType: rawType, originSize, webp } = req.params || {};
    const bufferValid = isBufferValid(buffer);

    if (!rawType || typeof originSize !== 'number' || !bufferValid) {
        logInfo(`skip reason="invalid-input" originType=${rawType} originSize=${originSize} bufferValid=${bufferValid}`);
        return false;
    }

    const originType = rawType.toLowerCase();

    if (!isImageType(originType)) {
        logInfo(`skip reason="non-image" type=${originType}`);
        return false;
    }

    if (!hasSufficientSize(originSize, MIN_COMPRESS_LENGTH)) {
        logInfo(`skip reason="too-small" size=${originSize} threshold=${MIN_COMPRESS_LENGTH}`);
        return false;
    }

    if (isTransparentImage(originType, originSize, webp)) {
        logInfo(`skip reason="transparent-small" type=${originType} size=${originSize}`);
        return false;
    }

    if (isSmallAnimatedPng(originType, buffer, originSize)) {
        logInfo(`skip reason="animated-small" type=${originType} size=${originSize}`);
        return false;
    }

    logInfo(`compress reason="eligible" type=${originType} size=${originSize}`);
    return true;
}

function logInfo(message) {
    console.log(`[INFO] ${message}`);
}

export default shouldCompress;

'use strict';

/**
 * Configuration object for compression thresholds
 * Using Object.freeze to prevent accidental modifications
 */
const CONFIG = Object.freeze({
  DEFAULT_MIN_COMPRESS_LENGTH: 512,
  get MIN_COMPRESS_LENGTH() {
    return parseInt(process.env.MIN_COMPRESS_LENGTH, 10) || this.DEFAULT_MIN_COMPRESS_LENGTH;
  },
  get MIN_TRANSPARENT_COMPRESS_LENGTH() {
    return this.MIN_COMPRESS_LENGTH * 50;
  },
  get APNG_THRESH_LENGTH() {
    return this.MIN_COMPRESS_LENGTH * 100;
  }
});

/**
 * Type definitions for better code organization and validation
 * @typedef {Object} CompressionParams
 * @property {string} originType - MIME type of the original image
 * @property {number} originSize - Size of the original image in bytes
 * @property {boolean} webp - Whether WebP compression should be applied
 */

/**
 * Cache for isAnimated results to prevent redundant processing
 * Using WeakMap to allow garbage collection of buffer keys
 */
const animatedCache = new WeakMap();

/**
 * Checks if the content type is an image
 * @param {string} originType 
 * @returns {boolean}
 */
const isImageType = (originType) => {
  return typeof originType === 'string' && originType.startsWith('image/');
};

/**
 * Checks if the size meets the compression threshold
 * @param {number} originSize 
 * @param {number} threshold 
 * @returns {boolean}
 */
const hasSufficientSize = (originSize, threshold) => {
  return typeof originSize === 'number' && originSize >= threshold;
};

/**
 * Checks if WebP compression should be skipped
 * @param {boolean} webp 
 * @param {number} originSize 
 * @returns {boolean}
 */
const isNotEligibleForWebpCompression = (webp, originSize) => {
  return webp && originSize < CONFIG.MIN_COMPRESS_LENGTH;
};

/**
 * Checks if the image is below the size threshold for compression
 * @param {string} originType 
 * @param {number} originSize 
 * @param {boolean} webp 
 * @returns {boolean}
 */
const isBelowSizeThresholdForCompression = (originType, originSize, webp) => {
  if (!webp && (originType.endsWith('png') || originType.endsWith('gif'))) {
    return originSize < CONFIG.MIN_TRANSPARENT_COMPRESS_LENGTH;
  }
  return false;
};

/**
 * Checks if the image is a small animated PNG
 * @param {string} originType 
 * @param {Buffer} buffer 
 * @param {number} originSize 
 * @returns {boolean}
 */
const isSmallAnimatedPng = (originType, buffer, originSize) => {
  // Check if the file is PNG and if it meets the size criteria
  if (!originType.endsWith('png') || originSize >= CONFIG.APNG_THRESH_LENGTH) {
    return false;
  }

  // Check the cache first
  if (animatedCache.has(buffer)) {
    return animatedCache.get(buffer);
  }

  // Helper function to find the APNG signature in the buffer
  const isAnimatedPng = (buffer) => {
    const acTLChunk = Buffer.from('acTL', 'ascii'); // Chunk identifier for animated PNGs
    let index = 8;  // Start after the PNG signature (first 8 bytes)

    // Parse chunks in the PNG file
    while (index < buffer.length) {
      const chunkLength = buffer.readUInt32BE(index);
      const chunkType = buffer.slice(index + 4, index + 8);

      if (chunkType.equals(acTLChunk)) {
        return true;  // Animated PNG detected
      }

      index += 8 + chunkLength + 4;  // Move to the next chunk (length + type + data + CRC)
    }

    return false;
  };

  try {
    const isAnimatedResult = isAnimatedPng(buffer);
    animatedCache.set(buffer, isAnimatedResult);
    return isAnimatedResult;
  } catch (error) {
    console.error('Error checking animation:', error);
    return false;
  }
};


/**
 * Checks if the image size is below threshold for compression
 * @param {CompressionParams} params 
 * @param {Buffer} buffer 
 * @returns {boolean}
 */
const isSizeBelowThreshold = ({ originType, originSize, webp }, buffer) => {
  return isNotEligibleForWebpCompression(webp, originSize) ||
         isBelowSizeThresholdForCompression(originType, originSize, webp) ||
         isSmallAnimatedPng(originType, buffer, originSize);
};

/**
 * Validates compression parameters
 * @param {CompressionParams} params 
 * @returns {boolean}
 */
const validateParams = ({ originType, originSize }) => {
  return originType && 
         typeof originSize === 'number' && 
         originSize >= 0;
};

/**
 * Main function to determine if compression should be applied
 * @param {Object} req - Request object containing compression parameters
 * @param {Buffer} buffer - Image buffer
 * @returns {boolean}
 */
function shouldCompress(req, buffer) {
  if (!req?.params || !Buffer.isBuffer(buffer)) {
    console.error('Invalid request or buffer');
    return false;
  }

  const { originType, originSize } = req.params;

  // Validate parameters
  if (!validateParams(req.params)) {
    console.error('Invalid parameters: originType or originSize missing/invalid');
    return false;
  }

  // Early returns for obvious cases
  if (!isImageType(originType)) {
    console.log(`Skipping compression for non-image type: ${originType}`);
    return false;
  }

  if (originSize === 0) {
    console.log('Skipping compression for zero-size content');
    return false;
  }

  // Check size thresholds
  if (isSizeBelowThreshold(req.params, buffer)) {
    console.log(`No compression applied for content of type: ${originType} and size: ${originSize}`);
    return false;
  }

  console.log(`Compressing content of type: ${originType} and size: ${originSize}`);
  return true;
}

// Clean up the cache periodically
setInterval(() => {
  if (global.gc) {
    global.gc();
  }
}, 30 * 60 * 1000); // Run every 30 minutes

module.exports = shouldCompress;

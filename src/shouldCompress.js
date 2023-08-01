"use strict";

const isAnimated = require('is-animated');

const MIN_COMPRESS_LENGTH = process.env.MIN_COMPRESS_LENGTH || 2048;
const MIN_TRANSPARENT_COMPRESS_LENGTH = MIN_COMPRESS_LENGTH * 50; // ~100KB
const APNG_THRESH_LENGTH = MIN_COMPRESS_LENGTH * 100; // ~200KB

function shouldCompress(request, imageBuffer) {
  const { mimeType, size, isWebp } = request.params
  
  if (!mimeType.startsWith('image')) {
    return false;
  }

  if (size === 0 || (isWebp && size < MIN_COMPRESS_LENGTH)) {
    return false;
  }

  if (!isWebp && (mimeType.endsWith('png') || mimeType.endsWith('gif'))) {
    if (size < MIN_TRANSPARENT_COMPRESS_LENGTH) {
      return false;
    }

    if (mimeType.endsWith('png') && isAnimated(imageBuffer) && size < APNG_THRESH_LENGTH) {
      // It's an animated png file, let it pass through if small enough
      return false;
    }
  }

  return true;
}

module.exports = shouldCompress

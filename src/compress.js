const sharp = require('sharp');
const redirect = require('./redirect');
const { URL } = require('url');

// Cache frequently used parameters
const COMPRESSION_PARAMS = {
  SHARP: { sigma: 1.0, flat: 1.0, jagged: 0.5 },
  THRESHOLDS: {
    LARGE_IMAGE: 2000,
    MEDIUM_IMAGE: 1000,
    LARGE_PIXEL: 3000000,
    MEDIUM_PIXEL: 1000000,
    SMALL_PIXEL: 500000
  }
};

// Dispose sharp instances properly
async function disposeSharpInstance(instance) {
  if (instance && typeof instance.destroy === 'function') {
    try {
      await instance.destroy();
    } catch (error) {
      console.error('Error disposing sharp instance:', error);
    }
  }
}

// Memory-efficient compress function
async function compress(req, res, input) {
  let sharpInstance = null;
  
  try {
    const format = req.params.webp ? 'avif' : 'jpeg';
    const { quality, grayscale, originSize, url } = req.params;

    // Create initial sharp instance with resource limits
    sharpInstance = sharp(input, {
      limitInputPixels: 268402689, // 16384 × 16384 pixels
      density: 72, // Limit density to prevent memory issues
      pages: -1, // Read all pages for animated images
      failOn: 'truncated' // Fail fast on corrupted images
    });

    // Get metadata with timeout
    const metadata = await Promise.race([
      sharpInstance.metadata(),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Metadata timeout')), 10000)
      )
    ]);

    const { width, height, pages, size } = metadata;
    const pixelCount = width * height;

    // Determine animation and format
    const isAnimated = pages && pages > 1;
    const outputFormat = isAnimated ? 'webp' : format;

    // Calculate optimization parameters
    const compressionQuality = adjustCompressionQuality(pixelCount, size, quality);
    const avifParams = optimizeAvifParams(width, height);

    // Reset sharp instance for processing
    sharpInstance = sharp(input, { 
      animated: isAnimated,
      limitInputPixels: 268402689,
      density: 72
    });

    if (grayscale) {
      sharpInstance = sharpInstance.grayscale();
    }

    if (!isAnimated) {
      if (outputFormat === 'jpeg' || outputFormat === 'avif') {
        sharpInstance = applyArtifactReduction(sharpInstance, pixelCount);
      }
      if (pixelCount > 500000) {
        const { sigma, flat, jagged } = COMPRESSION_PARAMS.SHARP;
        sharpInstance = sharpInstance.sharpen(sigma, flat, jagged);
      }
    }

    // Apply format-specific optimizations
    const formatOptions = {
      quality: compressionQuality,
      alphaQuality: 80,
      smartSubsample: true,
      chromaSubsampling: '4:2:0',
      ...(outputFormat === 'avif' ? avifParams : {}),
      ...(isAnimated ? { loop: 0 } : {})
    };

    sharpInstance = sharpInstance.toFormat(outputFormat, formatOptions);

    // Process image with timeout
    const { data: output, info } = await Promise.race([
      sharpInstance.toBuffer({ resolveWithObject: true }),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Processing timeout')), 30000)
      )
    ]);

    if (res.headersSent) {
      throw new Error('Headers already sent');
    }

    await sendImage(res, output, outputFormat, url, originSize, info.size);
  } catch (err) {
    console.error('Error during image compression:', err);
    return redirect(req, res);
  } finally {
    // Clean up resources
    if (sharpInstance) {
      await disposeSharpInstance(sharpInstance);
    }
    
    // Suggest garbage collection
    if (global.gc) {
      global.gc();
    }
  }
}

function optimizeAvifParams(width, height) {
  const { LARGE_IMAGE, MEDIUM_IMAGE } = COMPRESSION_PARAMS.THRESHOLDS;
  
  if (width > LARGE_IMAGE || height > LARGE_IMAGE) {
    return {
      tileRows: 4,
      tileCols: 4,
      minQuantizer: 30,
      maxQuantizer: 50,
      effort: 3
    };
  } 
  
  if (width > MEDIUM_IMAGE || height > MEDIUM_IMAGE) {
    return {
      tileRows: 2,
      tileCols: 2,
      minQuantizer: 28,
      maxQuantizer: 48,
      effort: 4
    };
  }
  
  return {
    tileRows: 1,
    tileCols: 1,
    minQuantizer: 26,
    maxQuantizer: 48,
    effort: 4
  };
}

function adjustCompressionQuality(pixelCount, size, quality) {
  const pixelFactor = 1.5;
  const sizeFactor = 0.002;
  const baseQuality = Math.min(quality, 100);

  const pixelSizeScale = Math.log10(Math.max(pixelCount / 1e6, 1));
  const sizeScale = Math.log2(Math.max(size / 1e6, 1));

  const adjustedQuality = Math.max(
    baseQuality - (pixelSizeScale * pixelFactor + sizeScale * sizeFactor) * baseQuality,
    40
  );

  return Math.ceil(adjustedQuality);
}

function applyArtifactReduction(sharpInstance, pixelCount) {
  const { LARGE_PIXEL, MEDIUM_PIXEL, SMALL_PIXEL } = COMPRESSION_PARAMS.THRESHOLDS;
  
  let params = {
    blurRadius: 0.3,
    denoiseStrength: 0.1,
    sharpenSigma: 0.5,
    saturationReduction: 1.0
  };

  if (pixelCount > LARGE_PIXEL) {
    params = {
      blurRadius: 0.4,
      denoiseStrength: 0.15,
      sharpenSigma: 0.8,
      saturationReduction: 0.85
    };
  } else if (pixelCount > MEDIUM_PIXEL) {
    params = {
      blurRadius: 0.35,
      denoiseStrength: 0.12,
      sharpenSigma: 0.6,
      saturationReduction: 0.9
    };
  } else if (pixelCount > SMALL_PIXEL) {
    params = {
      blurRadius: 0.3,
      denoiseStrength: 0.1,
      sharpenSigma: 0.5,
      saturationReduction: 0.95
    };
  }

  return sharpInstance
    .modulate({ saturation: params.saturationReduction })
    .blur(params.blurRadius)
    .sharpen(params.sharpenSigma)
    .gamma();
}

async function sendImage(res, data, imgFormat, url, originSize, compressedSize) {
  try {
    const filename = encodeURIComponent(new URL(url).pathname.split('/').pop() || 'image') + `.${imgFormat}`;

    const headers = {
      'Content-Type': `image/${imgFormat}`,
      'Content-Length': data.length,
      'Content-Disposition': `inline; filename="${filename}"`,
      'X-Content-Type-Options': 'nosniff',
      'x-original-size': Math.max(originSize, 0),
      'x-bytes-saved': Math.max(originSize - compressedSize, 0),
      'Cache-Control': 'public, max-age=31536000' // Add caching headers
    };

    Object.entries(headers).forEach(([key, value]) => res.setHeader(key, value));
    return res.status(200).end(data);
  } catch (error) {
    console.error('Error sending image:', error);
    throw error;
  }
}

module.exports = compress;

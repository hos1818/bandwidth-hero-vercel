import sharp from 'sharp';
import redirect from './redirect.js';
import { URL } from 'url';
import sanitizeFilename from 'sanitize-filename';

// --- Sharp Configuration ---
// Disable cache completely for serverless/proxy to prevent OOM
sharp.cache(false);
sharp.concurrency(1); // Keep concurrency low for consistent latency
sharp.simd(true);     // Enable SIMD instructions for speed

// --- Constants ---
const MAX_DIMENSION = 16384;
const MAX_PIXEL_LIMIT = 100_000_000;
const STREAM_THRESHOLD = 2 * 1024 * 1024; // Stream files > 2MB
const PROCESSING_TIMEOUT = 45000; // 45s hard timeout

export default async function compress(req, res, input) {
  let sharpInstance = null;
  let processingTimer = null;

  try {
    // 1. Timeout Race Condition
    // Creates a promise that rejects after X seconds to prevent hung processes
    const timeoutPromise = new Promise((_, reject) => {
      processingTimer = setTimeout(() => {
        reject(new Error('Processing Timeout'));
      }, PROCESSING_TIMEOUT);
    });

    // 2. Input Validation
    if (!Buffer.isBuffer(input) && typeof input !== 'string') {
      throw new Error('Invalid input: must be Buffer or file path');
    }

    // 3. Initialize Sharp
    sharpInstance = sharp(input, {
      animated: true,
      limitInputPixels: MAX_PIXEL_LIMIT,
      failOn: 'none'
    });

    // Race metadata extraction against timeout
    const metadata = await Promise.race([sharpInstance.metadata(), timeoutPromise]);

    if (!metadata?.width || !metadata?.height) {
      throw new Error('Invalid or missing metadata');
    }

    // 4. Determine Format & Compression Settings
    const { width, height, pages } = metadata;
    const isAnimated = (pages || 0) > 1;
    
    // Switch logic: If 'webp' param is present, default to WebP (not AVIF)
    // to utilize the tuned settings.
    const targetFormat = req.params?.webp || isAnimated ? 'webp' : 'jpeg';
    
    // Calculate Tuned Options (The core improvement)
    const options = getTunedFormatOptions(
      targetFormat, 
      req.params?.quality, 
      isAnimated, 
      width
    );

    // 5. Processing Pipeline
    let pipeline = sharpInstance.clone();

    // Apply Grayscale
    if (req.params?.grayscale) {
      pipeline = pipeline.grayscale();
    }

    // Apply Resize (Downscale only)
    if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
      pipeline = pipeline.resize({
        width: Math.min(width, MAX_DIMENSION),
        height: Math.min(height, MAX_DIMENSION),
        fit: 'inside',
        withoutEnlargement: true
      });
    }

    // 6. Output Strategy: Stream vs Buffer
    // Stream large files to save RAM, Buffer small ones to calculate savings.
    const isLargeFile = Buffer.isBuffer(input) && input.length > STREAM_THRESHOLD;

    if (isLargeFile) {
      clearTimeout(processingTimer);
      return streamResponse(req, res, pipeline, targetFormat, options);
    }

    // Buffer processing
    const { data, info } = await Promise.race([
      pipeline
        .toFormat(targetFormat, options)
        .toBuffer({ resolveWithObject: true }),
      timeoutPromise
    ]);

    clearTimeout(processingTimer);

    sendImage(
      res, 
      data, 
      targetFormat, 
      req.params.url || '', 
      req.params.originSize || 0, 
      info.size
    );

  } catch (err) {
    if (processingTimer) clearTimeout(processingTimer);
    if (sharpInstance) sharpInstance.destroy(); // Force cleanup
    
    fail(err.message || 'Compression Error', req, res, err);
  }
}

/**
 * --- Tuned WebP Settings ---
 * Applies the 3-step strategy:
 * 1. Adaptive Quality (Retina scaling)
 * 2. High Effort (MozJPEG effect)
 * 3. Smart Subsampling (Sharp text/edges)
 */
function getTunedFormatOptions(format, qualityParam, isAnimated, width) {
  // Parse base quality (default 75)
  const baseQuality = clamp(parseInt(qualityParam, 10) || 75, 10, 100);
  
  // Strategy 1: Adaptive Quality
  // High-density images (>1500px) hide artifacts well.
  // We can safely drop quality by ~10-15% to save significant space.
  let targetQuality = baseQuality;
  if (width > 1500 && baseQuality > 50) {
    targetQuality = Math.max(baseQuality - 10, 50);
  }

  const common = {
    quality: targetQuality,
  };

  if (format === 'webp') {
    return {
      ...common,
      // Strategy 2: Maximize Effort
      // Level 6 squeezes ~10-15% more size out vs default 4.
      // Slower, but much faster than AVIF.
      effort: 6,
      
      // Strategy 3: Smart Subsampling
      // Prevents color blurring on sharp edges/text.
      smartSubsample: true,
      
      // Additional Tuning
      alphaQuality: 80, // Keep transparency clean
      loop: isAnimated ? 0 : undefined,
      force: true // Ensure output is WebP
    };
  }

  if (format === 'jpeg') {
    return {
      ...common,
      mozjpeg: true, // Use Mozilla's efficient encoder
      progressive: true,
      chromaSubsampling: '4:2:0'
    };
  }
  
  // Fallback for others
  return common;
}

function streamResponse(req, res, pipeline, format, options) {
  res.setHeader('Content-Type', `image/${format}`);
  res.setHeader('Content-Disposition', 'inline');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Long cache for immutable content
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); 

  const stream = pipeline.toFormat(format, options);

  // Safety: Destroy stream if client disconnects to save CPU
  req.on('close', () => stream.destroy());

  stream
    .on('error', (err) => {
      // If headers aren't sent, we can try to fail gracefully, 
      // otherwise the stream just dies (expected behavior).
      if (!res.headersSent) fail('Streaming failed', req, res, err);
      else console.error(`[Stream Error] ${err.message}`);
    })
    .pipe(res);
}

function sendImage(res, data, format, url, originSize, compressedSize) {
  const filename = sanitizeFilename(new URL(url).pathname.split('/').pop() || 'image') + `.${format}`;
  
  res.setHeader('Content-Type', `image/${format}`);
  res.setHeader('Content-Length', data.length);
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('x-original-size', originSize);
  res.setHeader('x-bytes-saved', Math.max(originSize - compressedSize, 0));
  
  // Cache Control
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.setHeader('CDN-Cache-Control', 'public, max-age=31536000');
  res.setHeader('Vercel-CDN-Cache-Control', 'public, max-age=31536000');
  
  res.status(200).end(data);
}

function fail(message, req, res, err = null) {
  console.error(JSON.stringify({
    level: 'error',
    message,
    url: req?.params?.url?.slice(0, 100),
    error: err?.message,
    // Only show stack trace in dev
    stack: process.env.NODE_ENV === 'development' ? err?.stack : undefined
  }));
  
  // Fallback to original
  if (!res.headersSent) {
    redirect(req, res);
  }
}

function clamp(v, min, max) {
  return Math.min(Math.max(v, min), max);
}

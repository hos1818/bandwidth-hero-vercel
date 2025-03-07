import sharp from 'sharp';
import redirect from './redirect.js';
import { URL } from 'url';
import sanitizeFilename from 'sanitize-filename';

const MAX_DIMENSION = 16384;
const LARGE_IMAGE_THRESHOLD = 4_000_000; // Use underscores for readability
const MEDIUM_IMAGE_THRESHOLD = 1_000_000;


/**
 * Compress an image based on request parameters.
 * @param {Request} req - Express request object.
 * @param {Response} res - Express response object.
 * @param {Buffer|string} input - Input image buffer or file path.
 */
async function compress(req, res, input) {
    try {
        if (!Buffer.isBuffer(input) && typeof input !== 'string') {
            logError('Invalid input: must be a Buffer or file path.');
            return redirect(req, res);
        }

        const { format, compressionQuality, grayscale } = getCompressionParams(req);

        // Use a single sharp instance to avoid redundant metadata reads
        const sharpInstance = sharp(input, { animated: true }); // Enable animated support upfront
        const metadata = await sharpInstance.metadata();

        if (!isValidMetadata(metadata)) {
            logError('Invalid or missing metadata.');
            return redirect(req, res);
        }

        const isAnimated = metadata.pages > 1;
        const pixelCount = metadata.width * metadata.height;
        const outputFormat = isAnimated ? 'webp' : format;
        const avifParams = outputFormat === 'avif' ? optimizeAvifParams(metadata.width, metadata.height) : {};

        // Apply transformations in a pipeline to minimize intermediate buffers
        const processedImage = prepareImage(sharpInstance, grayscale, isAnimated, metadata, pixelCount);

        // Use toFormat with options directly in the pipeline
        const { data, info } = await processedImage
            .toFormat(outputFormat, getFormatOptions(outputFormat, compressionQuality, avifParams, isAnimated))
            .toBuffer({ resolveWithObject: true });

        sendImage(res, data, outputFormat, req.params.url || '', req.params.originSize || 0, info.size);
    } catch (err) {
        logError('Error during image compression:', err);
        redirect(req, res);
    }
}

function getCompressionParams(req) {
    const format = req.params?.webp ? 'avif' : 'jpeg';
    const compressionQuality = Math.min(Math.max(parseInt(req.params?.quality, 10) || 75, 10), 100);
    const grayscale = req.params?.grayscale === 'true' || req.params?.grayscale === true;
    return { format, compressionQuality, grayscale };
}

function isValidMetadata(metadata) {
    return metadata && metadata.width && metadata.height;
}

function optimizeAvifParams(width, height) {
    const area = width * height;
    if (area > LARGE_IMAGE_THRESHOLD) {
        return { tileRows: 4, tileCols: 4, minQuantizer: 28, maxQuantizer: 48, effort: 3 };
    } else if (area > MEDIUM_IMAGE_THRESHOLD) {
        return { tileRows: 2, tileCols: 2, minQuantizer: 26, maxQuantizer: 46, effort: 4 };
    } else {
        return { tileRows: 1, tileCols: 1, minQuantizer: 24, maxQuantizer: 44, effort: 5 };
    }
}

function getFormatOptions(outputFormat, quality, avifParams, isAnimated) {
    const options = {
        quality,
        alphaQuality: 80,
        chromaSubsampling: '4:2:0',
        loop: isAnimated ? 0 : undefined,
    };
    return outputFormat === 'avif' ? { ...options, ...avifParams } : options;
}

function prepareImage(sharpInstance, grayscale, isAnimated, metadata, pixelCount) {
    let processedImage = sharpInstance.clone(); // Clone to avoid mutating the original instance

    if (grayscale) {
        processedImage = processedImage.grayscale();
    }

    if (!isAnimated) {
        processedImage = applyArtifactReduction(processedImage, pixelCount);
    }

    if (metadata.width > MAX_DIMENSION || metadata.height > MAX_DIMENSION) {
        processedImage = processedImage.resize({
            width: Math.min(metadata.width, MAX_DIMENSION),
            height: Math.min(metadata.height, MAX_DIMENSION),
            fit: 'inside',
            withoutEnlargement: true,
        });
    }

    return processedImage;
}

function applyArtifactReduction(sharpInstance, pixelCount) {
    const settings = pixelCount > LARGE_IMAGE_THRESHOLD
        ? { blur: 0.5, sharpen: 0.7, saturation: 0.8 }
        : pixelCount > MEDIUM_IMAGE_THRESHOLD
        ? { blur: 0.4, sharpen: 0.6, saturation: 0.85 }
        : { blur: 0.3, sharpen: 0.5, saturation: 0.9 };

    return sharpInstance
        .modulate({ saturation: settings.saturation })
        .blur(settings.blur)
        .sharpen(settings.sharpen);
}

function handleSharpError(error, res, sharpInstance, outputFormat, req, quality) {
    logError('Unhandled sharp error:', error);
    redirect(req, res);
}

function sendImage(res, data, format, url, originSize, compressedSize) {
    const filename = sanitizeFilename(new URL(url).pathname.split('/').pop() || 'image') + `.${format}`;
    res.setHeader('Content-Type', `image/${format}`);
    res.setHeader('Content-Length', data.length);
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('x-original-size', originSize);
    res.setHeader('x-bytes-saved', Math.max(originSize - compressedSize, 0));
    res.status(200).end(data);
}

function logError(message, error = null) {
    console.error({ message, error: error?.message || null });
}

export default compress;

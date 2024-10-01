const sharp = require('sharp');
const redirect = require('./redirect');
const isAnimated = require('is-animated');
const { URL } = require('url');

async function compress(req, res, input) {
    try {
        // Determine format based on request parameters
        const isWebP = req.params.webp === 'true'; // Explicit boolean check
        const format = isWebP ? 'avif' : 'jpeg';
        const { originType, grayscale, quality, url, originSize } = req.params;

        // Initialize Sharp with animated support
        const sanimated = isAnimated(input); // Function to detect if input is animated
        let transformations = sharp(input, { animated: sanimated });

        // Get metadata for image properties
        const metadata = await transformations.metadata();
        if (!metadata.width || !metadata.height) {
            throw new Error('Invalid image metadata');
        }

        // Calculate compression quality based on metadata and request parameters
        const pixelCount = metadata.width * metadata.height;
        const compressionQuality = adjustCompressionQuality(pixelCount, metadata.size, quality);

        // Apply grayscale only if requested
        if (grayscale) transformations = transformations.grayscale();

        // Common transformations for both static and animated images
        transformations = transformations
            .sharpen(1, 1, 0.5) // Moderate sharpening
            .gamma(2.2) // Gamma correction for brightness/contrast
            .modulate({
                brightness: 1.1, // Brighten slightly
                saturation: 1.2, // Enhance colors
            })
            .median(3); // Aggressive noise reduction

        // Format conversion and compression for animated or static images
        if (animated) {
            // Specific handling for animated images
            transformations = transformations.toFormat(format, {
                quality: compressionQuality,
                chromaSubsampling: '4:2:0',
                loop: 0, // Enable animated output
            });
        } else {
            // Static image transformations
            transformations = transformations.toFormat(format, {
                quality: compressionQuality,
                chromaSubsampling: '4:2:0',
            });
        }

        // Apply transformations and output buffer
        const output = await transformations.toBuffer();

        // Send the transformed image back to the client
        sendImage(res, output, format, url, originSize);
    } catch (err) {
        console.error('Error in image compression:', err.message); // Log error
        return redirect(req, res); // Redirect on failure
    }
}

// Function to calculate quality factor based on pixel count and size
function calculateQualityFactor(pixelCount, size) {
    const thresholds = [
        { pixels: 3000000, size: 1536000, factor: 0.1 },
        { pixels: 2000000, size: 1024000, factor: 0.25 },
        { pixels: 1000000, size: 512000, factor: 0.5 },
        { pixels: 500000, size: 256000, factor: 0.75 },
    ];

    for (let threshold of thresholds) {
        if (pixelCount > threshold.pixels && size > threshold.size) {
            return threshold.factor;
        }
    }
    return 1; // Default factor
}

// Function to adjust compression quality based on image properties
function adjustCompressionQuality(pixelCount, size, quality) {
    const factor = calculateQualityFactor(pixelCount, size);
    return Math.ceil(quality * factor);
}

// Function to send the compressed image response
function sendImage(res, data, imgFormat, url, originSize) {
    res.setHeader('content-type', `image/${imgFormat}`);
    res.setHeader('content-length', data.length);
    
    const filename = encodeURIComponent(new URL(url).pathname.split('/').pop() || "image") + `.${imgFormat}`;
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');

    // Ensure valid original size and bytes saved
    const safeOriginSize = Math.max(originSize, 0);
    res.setHeader('x-original-size', safeOriginSize);
    res.setHeader('x-bytes-saved', Math.max(safeOriginSize - data.length, 0));
    
    res.status(200).end(data);
}

module.exports = compress;

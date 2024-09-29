const sharp = require('sharp');
const redirect = require('./redirect');
const isAnimated = require('is-animated');
const { URL } = require('url');

async function compress(req, res, input) {
    try {
        const format = req.params.webp ? 'avif' : 'jpeg';
        const originType = req.params.originType;
        const metadata = await sharp(input).metadata(); // Fetch metadata asynchronously
        const pixelCount = metadata.width * metadata.height;
        const compressionQuality = adjustCompressionQuality(pixelCount, metadata.size, req.params.quality);

        const transformations = sharp(input)
            .grayscale(req.params.grayscale)
            .sharpen(1, 1, 0.5) // Moderate sharpening
            .gamma(2.2) // Gamma correction for brightness/contrast
            .modulate({
                brightness: 1.1, // Brighten slightly
                saturation: 1.2, // Enhance colors
            })
            .median(3) // Aggressive noise reduction
            .toFormat(format, {
                chromaSubsampling: '4:2:0',
                quality: compressionQuality,
            });

        // Apply transformations and convert
        const output = await (format === 'avif' && isAnimated(input) 
            ? transformations.animated(true).toBuffer()
            : transformations.toBuffer());

        // Send the transformed image
        sendImage(res, output, format, req.params.url, req.params.originSize);
    } catch (err) {
        console.error("Error in image compression:", err);
        return redirect(req, res);
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

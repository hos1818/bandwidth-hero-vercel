const sharp = require('sharp');
const redirect = require('./redirect');
const isAnimated = require('is-animated');
const { URL } = require('url');

// Main function to compress the image
async function compress(req, res, input) {
    const format = req.params.webp ? 'webp' : 'jpeg';
    const originType = req.params.originType;

    try {
        const metadata = await sharp(input).metadata();
        const pixelCount = metadata.width * metadata.height;
        const compressionQuality = adjustCompressionQuality(pixelCount, metadata.size, req.params.quality);

        // Apply image processing
        let image = sharp(input).grayscale(req.params.grayscale);

        if (format === 'webp' && isAnimated(input)) {
            image = image.animated(true);
        }

        image = image.toFormat(format, {
            quality: compressionQuality,
            alphaQuality: 80,
            smartSubsample: true,
            progressive: true,
            optimizeScans: true
        });

        const { data, info } = await image.toBuffer({ resolveWithObject: true });

        if (!info || res.headersSent) {
            throw new Error("Headers sent or no image info available.");
        }

        sendImage(res, data, format, req.params.url, req.params.originSize);
    } catch (err) {
        console.error("Error in image compression:", err);
        return redirect(req, res);
    }
}

// Adjust compression quality based on image properties
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

function adjustCompressionQuality(pixelCount, size, quality) {
    const factor = calculateQualityFactor(pixelCount, size);
    return Math.ceil(quality * factor);
}

// Send the compressed image as a response
function sendImage(res, data, imgFormat, url, originSize) {
    res.setHeader('content-type', `image/${imgFormat}`);
    res.setHeader('content-length', data.length);

    const filename = encodeURIComponent(new URL(url).pathname.split('/').pop() || "image") + `.${imgFormat}`;
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');

    const safeOriginSize = Math.max(originSize, 0);
    const bytesSaved = Math.max(safeOriginSize - data.length, 0);

    res.setHeader('x-original-size', safeOriginSize);
    res.setHeader('x-bytes-saved', bytesSaved);

    res.status(200).end(data);
}

module.exports = compress;

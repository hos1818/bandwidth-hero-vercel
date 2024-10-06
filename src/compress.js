const sharp = require('sharp');
const redirect = require('./redirect');
const isAnimated = require('is-animated');
const { URL } = require('url');

async function compress(req, res, input) {
    const format = req.params.webp ? 'webp' : 'jpeg';
    const originType = req.params.originType;
    sharp(input)
        .metadata(async (err, metadata) => {
            if (err) {
                console.error("Error fetching metadata:", err);
                return redirect(req, res);
            }
            let pixelCount = metadata.width * metadata.height;
            let compressionQuality = adjustCompressionQuality(pixelCount, metadata.size, req.params.quality);
            if (format === 'webp' && isAnimated(input)) {
                sharp(input, { animated: true })
                    .grayscale(req.params.grayscale)
	            .gamma(2.2) // Gamma correction for brightness/contrast
	            .modulate({
	                brightness: 1.1, // Brighten slightly
	                saturation: 1.1, // Enhance colors
	            })
	            .median(3) // Aggressive noise reduction
		    .sharpen(1, 1, 0.5) // Moderate sharpening
                    .toFormat(format, {
                        quality: compressionQuality, //output image quality.
                        loop: 0,
			alphaQuality: 100, //quality of alpha layer, integer 0-100.
                        smartSubsample: true, //use high quality chroma subsampling.
                        progressive: true,
                        optimizeScans: true,
		    	palette: true,
		    	dither: 1.0,
	    		compressionLevel: 9
                    })
                    .toBuffer((err, output, info) => {
                        if (err || !info || res.headersSent) {
                            console.error("Error in image compression:", err);
                            return redirect(req, res);
                        }
                        sendImage(res, output, format, req.params.url, req.params.originSize);
                    });
            } else {
                sharp(input)
                    .grayscale(req.params.grayscale)
	            //.gamma(2.2) // Gamma correction for brightness/contrast
	            //.modulate({
	                //brightness: 1.1, // Brighten slightly
	              //  saturation: 1.1, // Enhance colors
	            //})
	            //.median(3) // Aggressive noise reduction
		    //.sharpen(1, 1, 0.5) // Moderate sharpening
                    .toFormat(format, {
                        quality: compressionQuality, //output image quality.
                        alphaQuality: 100, //quality of alpha layer, integer 0-100.
                        smartSubsample: true, //use high quality chroma subsampling.
                        progressive: true,
                        optimizeScans: true
                    })
                    .toBuffer((err, output, info) => {
                        if (err || !info || res.headersSent) {
                            console.error("Error in image compression:", err);
                            return redirect(req, res);
                        }
                        sendImage(res, output, format, req.params.url, req.params.originSize);
                    });
            }
        });
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

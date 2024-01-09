const sharp = require('sharp');
const redirect = require('./redirect');
const isAnimated = require('is-animated');
const { execFile } = require('child_process');
const gif2webp = require('gif2webp-bin');
const fs = require('fs').promises;
const os = require('os');
const { URL } = require('url');
const CleanCSS = require('clean-css');

async function compress(req, res, input) {
	
	const cssMinify = async (cssContent) => {
        try {
            const minifiedCSS = new CleanCSS().minify(cssContent).styles;
            return minifiedCSS;
        } catch (error) {
            console.error('Error during CSS minification:', error);
            throw error;
        }
    };

    const minifyAndSendCSS = async (cssContent, url, originSize) => {
        try {
            const minifiedCSS = await cssMinify(cssContent);
            sendCSS(res, minifiedCSS, url, originSize);
        } catch (error) {
            redirect(req, res);
        }
    };
	
    const format = req.params.webp ? 'webp' : 'jpeg';
    const originType = req.params.originType;
    if (!req.params.grayscale && format === 'webp' && originType.endsWith('gif') && isAnimated(input)) {
        try {
            const { hostname, pathname } = new URL(req.params.url);
            const path = `${os.tmpdir()}/${hostname + encodeURIComponent(pathname)}`;
            await fs.writeFile(`${path}.gif`, input);
            execFile(gif2webp, ['-lossy', '-m', 2, '-q', req.params.quality, '-mt', `${path}.gif`, '-o', `${path}.webp`], async (convErr) => {
                if (convErr) {
                    console.error("Error in conversion:", convErr);
                    return redirect(req, res);
                }
                console.log('GIF Image converted!');
                const data = await fs.readFile(`${path}.webp`);
                sendImage(res, data, 'webp', req.params.url, req.params.originSize);
                
                await fs.unlink(`${path}.gif`);
                await fs.unlink(`${path}.webp`);
            });
        } catch (error) {
            console.error("Error in GIF processing:", error);
            redirect(req, res);
        }
    } else {
        sharp(input)
            .metadata(async (err, metadata) => {
                if (err) {
                    console.error("Error fetching metadata:", err);
                    return redirect(req, res);
                }
				
				if (metadata.format === 'css') {
					// Handle CSS minification for CSS files
					const cssContent = input.toString('utf-8');
					minifyAndSendCSS(cssContent, req.params.url, req.params.originSize);
				} else {
					// Handle other image formats
					let pixelCount = metadata.width * metadata.height;
					let compressionQuality = adjustCompressionQuality(pixelCount, metadata.size, req.params.quality);

					// ... (rest of the existing code)
					
					sharp(input)
                    .grayscale(req.params.grayscale)
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
}

//t
function calculateQualityFactor(pixelCount, size) {
  // These thresholds can be adjusted or even made configurable.
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
  return 1; // default factor
}

function adjustCompressionQuality(pixelCount, size, quality) {
  const factor = calculateQualityFactor(pixelCount, size);
  return Math.ceil(quality * factor);
}


function sendImage(res, data, imgFormat, url, originSize) {
    res.setHeader('content-type', `image/${imgFormat}`);
    res.setHeader('content-length', data.length);
    let filename = (new URL(url).pathname.split('/').pop() || "image") + '.' + imgFormat;
    res.setHeader('Content-Disposition', 'inline; filename="' + filename + '"');
    res.setHeader('x-original-size', originSize);
    res.setHeader('x-bytes-saved', originSize - data.length);
    res.status(200);
    res.end(data);
}

function sendCSS(res, data, url, originSize) {
    res.setHeader('content-type', 'text/css');
    res.setHeader('content-length', Buffer.byteLength(data));
    let filename = (new URL(url).pathname.split('/').pop() || 'style') + '.css';
    res.setHeader('Content-Disposition', 'inline; filename="' + filename + '"');
    res.setHeader('x-original-size', originSize);
    res.setHeader('x-bytes-saved', originSize - Buffer.byteLength(data));
    res.status(200);
    res.end(data);
}

module.exports = compress;

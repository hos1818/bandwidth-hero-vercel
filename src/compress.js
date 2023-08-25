const sharp = require('sharp');
const redirect = require('./redirect');
const isAnimated = require('is-animated');
const { execFile } = require('child_process');
const gif2webp = require('gif2webp-bin');
const fs = require('fs').promises;
const os = require('os');
const { URL } = require('url');

async function compress(req, res, input) {
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

                let pixelCount = metadata.width * metadata.height;
                let compressionQuality = adjustCompressionQuality(pixelCount, metadata.size, req.params.quality);
                
                sharp(input)
                    .grayscale(req.params.grayscale)
                    .toFormat(format, {
                        quality: compressionQuality,
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
            });
    }
}

function adjustCompressionQuality(pixelCount, size, quality) {
    if (pixelCount > 3000000 || size > 1536000) {
        quality *= 0.1;
    } else if (pixelCount > 2000000 && size > 1024000) {
        quality *= 0.25;
    } else if (pixelCount > 1000000 && size > 512000) {
        quality *= 0.5;
    } else if (pixelCount > 500000 && size > 256000) {
        quality *= 0.75;
    }
    return Math.ceil(quality);
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

module.exports = compress;

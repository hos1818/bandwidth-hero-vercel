# Bandwidth Hero Data Compression Service

This data compression service is used by
[Bandwidth Hero](https://github.com/ayastreb/bandwidth-hero) browser extension. It compresses given
image to low-res [WebP](https://developers.google.com/speed/webp/) or JPEG image. Optionally it also
converts image to greyscale to save even more data.

It downloads original image and transforms it with [Sharp](https://github.com/lovell/sharp) on the
fly without saving images on disk.

This is **NOT** an anonymizing proxy &mdash; it downloads images on user's behalf, passing cookies
and user's IP address through to the origin host.

## Deployment

### Google Cloud Functions

Options to set when deploying to google cloud
- **Memory Allocated:** between 256MB - 512MB recommended
- **Runtime:** NodeJS 8+ _(Sharp doesn't build on Node 6 default)_
- **Function to Execute:** `bandwidthHeroProxy`

ENVIRONMENT_VARIABLES
`MIN_COMPRESS_LENGTH=2048` (minimum byte length for an image to be compressible; default 2048 ~2kB)


## Development
`node ./express-wrapper.js`

## Note - VIP
### increase Function Max Duration to 60 - Don't forget to press save

![image](https://github.com/user-attachments/assets/347cdf4c-b42b-4ad4-839f-8fd3aa63ef10)

because the the conversion to avif takes more time than the default value of Function Max Duration of vercel

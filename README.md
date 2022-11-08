# Bandwidth Hero Data Compression Service

[![NSP Status](https://nodesecurity.io/orgs/bandwidth-hero/projects/1f035cf0-00f2-43db-9bc0-8e39adb24642/badge)](https://nodesecurity.io/orgs/bandwidth-hero/projects/1f035cf0-00f2-43db-9bc0-8e39adb24642)

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

const DEFAULT_QUALITY = 40

function params(req, res, next) {
  const { url = '', jpeg, bw = '0', l = DEFAULT_QUALITY } = req.query
  const urlSearchParams = new URLSearchParams({url: Array.isArray(url) ? url.join('&url=') : url})
  const formattedUrl = urlSearchParams.toString().replace(/http:\/\/1\.1\.\d\.\d\/bmi\/(https?:\/\/)?/i, 'http://')

  req.params.url = formattedUrl
  req.params.webp = !jpeg
  req.params.grayscale = bw !== '0'
  req.params.quality = parseInt(l, 10)

  next()
}

module.exports = params

const auth = require('basic-auth')
const LOGIN = process.env.LOGIN
const PASSWORD = process.env.PASSWORD

function authenticate(req, res, next) {
  if (LOGIN && PASSWORD) {
    const credentials = auth(req)
    
    if (!credentials || credentials.name !== LOGIN || credentials.pass !== PASSWORD) {
      res.setHeader('WWW-Authenticate', `Basic realm="Bandwidth-Hero Compression Service"`)
      return res.status(401).json({ error: 'Access denied' }) // Changed to send a JSON response
    }
  } else {
    return res.status(500).json({ error: 'Server misconfiguration, credentials not set.' }) // If environment variables are not set
  }

  next()
}

module.exports = authenticate

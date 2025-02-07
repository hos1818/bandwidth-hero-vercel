import auth from 'basic-auth';
import crypto from 'crypto';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const LOGIN = process.env.LOGIN;
const PASSWORD = process.env.PASSWORD;
const REALM = process.env.REALM || 'Bandwidth-Hero Compression Service';

/**
 * Secure timing-safe comparison using Node.js `crypto` module.
 * 
 * @param {string} a - The first string to compare.
 * @param {string} b - The second string to compare.
 * @returns {boolean} - Whether the strings are equal.
 */
function safeCompare(a, b) {
  const bufferA = Buffer.from(a, 'utf-8');
  const bufferB = Buffer.from(b, 'utf-8');
  if (bufferA.length !== bufferB.length) return false;
  return crypto.timingSafeEqual(bufferA, bufferB);
}

/**
 * Middleware to authenticate requests using basic authentication.
 * 
 * @param {Object} req - The HTTP request object.
 * @param {Object} res - The HTTP response object.
 * @param {Function} next - The next middleware function.
 */
function authenticate(req, res, next) {
  // Ensure credentials are configured
  if (LOGIN && PASSWORD) {
    const credentials = auth(req);

    if (!credentials || !safeCompare(credentials.name, LOGIN) || !safeCompare(credentials.pass, PASSWORD)) {
      // Log unauthorized access attempts
      console.warn(`Unauthorized access attempt: IP=${req.ip}, UA=${req.get('User-Agent')}`);

      // Respond with a `401 Unauthorized` and a `WWW-Authenticate` header
      res.set('WWW-Authenticate', `Basic realm="${REALM}", charset="UTF-8"`);
      return res.status(401).send('Unauthorized');
    }
  }

  // Proceed to the next middleware
  next();
}

export default authenticate;

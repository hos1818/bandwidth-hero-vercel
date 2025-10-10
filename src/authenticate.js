import auth from 'basic-auth';
import crypto from 'crypto';

const { LOGIN, PASSWORD } = process.env;

/**
 * Timing-safe comparison to prevent subtle side-channel attacks.
 */
function safeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  return (
    bufferA.length === bufferB.length &&
    crypto.timingSafeEqual(bufferA, bufferB)
  );
}

/**
 * Express middleware for HTTP Basic Authentication.
 */
export default function authenticate(req, res, next) {
  // Skip authentication if no credentials are set (development mode)
  if (!LOGIN || !PASSWORD) return next();

  const credentials = auth(req);

  if (
    !credentials ||
    !safeCompare(credentials.name, LOGIN) ||
    !safeCompare(credentials.pass, PASSWORD)
  ) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Bandwidth-Hero Compression Service"');
    return res.status(401).end('Access denied');
  }

  next();
}

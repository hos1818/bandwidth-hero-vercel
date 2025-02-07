import auth from 'basic-auth';
import crypto from 'crypto';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const LOGIN = process.env.LOGIN;
const PASSWORD = process.env.PASSWORD;
const REALM = process.env.REALM || 'Bandwidth-Hero Compression Service';

if (!LOGIN || !PASSWORD) {
    console.error('Missing LOGIN or PASSWORD in environment variables.');
    process.exit(1);
}

const PASSWORD_HASH = crypto.createHash('sha256').update(PASSWORD).digest('hex');

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
    try {
        // Ensure credentials are configured
        if (LOGIN && PASSWORD_HASH) {
            const credentials = auth(req);
            if (credentials && 
                safeCompare(credentials.name, LOGIN) && 
                safeCompare(crypto.createHash('sha256').update(credentials.pass).digest('hex'), PASSWORD_HASH)) {
                return next();
            }
        }
            
        // Log unauthorized access attempt
        logger.warn({ message: 'Unauthorized access attempt', ip: req.ip, userAgent: req.get('User-Agent') });

        // Respond with 401 Unauthorized
        res.set({
            'WWW-Authenticate': `Basic realm="${REALM}", charset="UTF-8"`,
            'X-Content-Type-Options': 'nosniff',
            'X-Frame-Options': 'DENY',
        });
        res.status(401).send('Unauthorized');
    } catch (error) {
        logger.error({ message: 'Authentication error', error: error.message });
        res.status(500).send('Internal Server Error');
    }
}

export default authenticate;

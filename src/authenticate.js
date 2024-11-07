import auth from 'basic-auth';

const LOGIN = process.env.LOGIN;
const PASSWORD = process.env.PASSWORD;

// Timing-safe comparison to prevent timing attacks
function safeCompare(a, b) {
  if (a.length !== b.length) return false;
  return a.split('').reduce((acc, char, idx) => acc & (char === b[idx]), true);
}

function authenticate(req, res, next) {
  // If LOGIN and PASSWORD are set, require authentication
  if (LOGIN && PASSWORD) {
    const credentials = auth(req);

    // Validate credentials with timing-safe comparisons
    if (!credentials || !safeCompare(credentials.name, LOGIN) || !safeCompare(credentials.pass, PASSWORD)) {
      res.setHeader('WWW-Authenticate', 'Basic realm="Bandwidth-Hero Compression Service"');
      console.warn('Unauthorized access attempt.');
      return res.status(401).end('Access denied');
    }
  }

  // Proceed to the next middleware if authentication is successful or not required
  next();
}

// Export the authenticate function
export default authenticate;

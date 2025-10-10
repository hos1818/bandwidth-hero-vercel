import express from 'express';
import helmet from 'helmet';
import dotenv from 'dotenv';
import authenticate from './src/authenticate.js';
import params from './src/params.js';
import proxy from './src/proxy.js';

// Load environment variables early
dotenv.config();

const app = express();

// ✅ Modern Helmet configuration
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'https:'],
      },
    },
    crossOriginEmbedderPolicy: false, // for images from multiple origins
  })
);

// ✅ Lightweight, structured logging (replaces morgan)
app.use((req, _, next) => {
  console.info(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// ✅ Trust proxy for HTTPS headers
app.enable('trust proxy');

// ✅ Core route
app.get('/', authenticate, params, proxy);

// ✅ Health and favicon routes
app.get('/healthz', (_, res) => res.status(200).send('OK'));
app.get('/favicon.ico', (_, res) => res.status(204).end());

// ✅ Centralized error handler (prevents unhandled exceptions)
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal Server Error' });
});

// ❗️No app.listen() — export handler for Vercel
export default app;

#!/usr/bin/env node
'use strict';

import express from 'express';
import morgan from 'morgan';
import helmet from 'helmet';
import dotenv from 'dotenv';
import authenticate from './src/authenticate.js';
import params from './src/params.js';
import proxy from './src/proxy.js';

// Load environment variables
dotenv.config();

const app = express();
const PORT = parseInt(process.env.PORT, 10) || 443;

// Security Middleware
app.use(helmet.hidePoweredBy());
app.use(helmet.xssFilter());
app.use(helmet.noSniff());
app.use(helmet.ieNoOpen());
app.use(helmet.frameguard({ action: 'deny' }));
app.use(
  helmet.contentSecurityPolicy({
    useDefaults: true,
    directives: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'https:'],
    },
  })
);

// HTTP request logging
app.use(morgan('combined'));

// Trust proxy for secure cookies and HTTPS redirection
app.enable('trust proxy');

// Routes
app.get('/', authenticate, params, proxy);

// Health check route
app.get('/healthz', (req, res) => res.status(200).send('OK'));

// Handle favicon requests
app.get('/favicon.ico', (req, res) => res.status(204).end());

// Start server
app.listen(PORT, () => {
  console.log(`Listening on port ${PORT}`);
});

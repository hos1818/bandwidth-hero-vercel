#!/usr/bin/env node
'use strict'
const express = require('express')
const helmet = require('helmet')
const authenticate = require('./src/authenticate')
const params = require('./src/params')
const proxy = require('./src/proxy')

const app = express()
const PORT = process.env.PORT || 8080

/*
app.use(helmet({
    contentSecurityPolicy: false,   // Depending on your needs, you might not want to set a CSP for a proxy.
    dnsPrefetchControl: false,      // No need to control browser DNS prefetching for a proxy.
    frameguard: {
        action: 'deny'              // Deny anyone from putting your proxy in an iframe. This is good to prevent clickjacking.
    },
    hidePoweredBy: true,            // Hide X-Powered-By header for some degree of obscurity.
    hsts: {
        maxAge: 0,                  // Disable HSTS. In a proxy, you may not want to force users' browsers to only request the proxied site over HTTPS for a long duration.
        includeSubDomains: false,   // No need to apply the rule on subdomains.
        preload: false
    },
    ieNoOpen: true,                 // Sets X-Download-Options for IE8+ to prevent certain types of attacks.
    noSniff: true,                  // Sets X-Content-Type-Options to prevent MIME type sniffing.
    referrerPolicy: { policy: 'no-referrer' } // Do not send a referrer header.
}));
*/

app.enable('trust proxy')
app.get('/', authenticate, params, proxy)
app.get('/favicon.ico', (req, res) => res.status(204).end())
app.listen(PORT, () => {
    console.log(`Listening on ${PORT}`)
    // For additional setup like initializing performance monitoring agents, add here.
})

#!/usr/bin/env node
'use strict'

import express from 'express'
import morgan from 'morgan'
import helmet from 'helmet'
import authenticate from './src/authenticate.js'
import params from './src/params.js'
import proxy from './src/proxy.js'

const app = express()
const PORT = process.env.PORT || 443

// Use specific helmet modules to avoid conflicts on Vercel
app.use(helmet.hidePoweredBy())
app.use(helmet.xssFilter())
app.use(helmet.noSniff())
app.use(helmet.ieNoOpen())
app.use(helmet.frameguard({ action: 'deny' }))

// HTTP request logging
app.use(morgan('combined'))

app.enable('trust proxy')
app.get('/', authenticate, params, proxy)
app.get('/favicon.ico', (req, res) => res.status(204).end())
app.listen(PORT, () => {
    console.log(`Listening on ${PORT}`)
    // For additional setup like initializing performance monitoring agents, add here.
})

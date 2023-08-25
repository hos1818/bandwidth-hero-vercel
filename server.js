#!/usr/bin/env node
'use strict'

const express = require('express')
const helmet = require('helmet')
const cors = require('cors')
const morgan = require('morgan')
const winston = require('winston')

const authenticate = require('./src/authenticate')
const params = require('./src/params')
const proxy = require('./src/proxy')

const app = express()
const PORT = process.env.PORT || 8080

// Basic Security Headers
app.use(helmet())

// Enable CORS (Modify as per your requirements)
app.use(cors())

// Enable Logging
app.use(morgan('combined'))

// Trust the Proxy Headers (e.g., X-Forwarded-For)
app.enable('trust proxy')

app.get('/', authenticate, params, proxy)
app.get('/favicon.ico', (req, res) => res.status(204).end())

// Generic Error Handler
app.use((err, req, res, next) => {
    winston.error(err.message, err)
    res.status(500).send('Something went wrong!')
})

app.listen(PORT, () => {
    console.log(`Listening on ${PORT}`)
    // For additional setup like initializing performance monitoring agents, add here.
})

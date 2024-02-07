#!/usr/bin/env node
'use strict'
const express = require('express')
const morgan = require('morgan')
const expressValidator = require('express-validator')
const helmet = require('helmet')
const authenticate = require('./src/authenticate')
const params = require('./src/params')
const proxy = require('./src/proxy')

const app = express()
const PORT = process.env.PORT || 8080

app.enable('trust proxy')
app.get('/', authenticate, params, proxy)
app.get('/favicon.ico', (req, res) => res.status(204).end())
app.listen(PORT, () => {
    console.log(`Listening on ${PORT}`)
    // For additional setup like initializing performance monitoring agents, add here.
})

// HTTP request logging
app.use(morgan('combined'))

// Body Parsing and Validation
app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use(expressValidator())

// Error Handling
app.use((err, req, res, next) => {
  console.error(err.stack)
  res.status(500).send('Something broke!')
})

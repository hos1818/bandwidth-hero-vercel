#!/usr/bin/env node

'use strict'

const express = require('express')
const authenticate = require('./src/authenticate')
const params = require('./src/params')
const proxy = require('./src/proxy')

const PORT = process.env.PORT || 8080

const app = express()

app.enable('trust proxy')

app.get('/', (req, res) => {
  authenticate(req, res)
  params(req, res)
  proxy(req, res)
})

app.get('/favicon.ico', (req, res) => res.status(204).end())

app.use((err, req, res, next) => {
  console.error(err.stack)
  res.status(500).send('Internal Server Error')
})

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`)
})

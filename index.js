'use strict'

//const http = require('http');

const authenticate = require('./src/authenticate')
const params = require('./src/params')
const proxy = require('./src/proxy')

exports.bandwidthHeroProxy = (req, res) => {
    
    authenticate(req, res, function(){});
    if(!res.headersSent){
        params(req, res, function(){});
        proxy(req, res, function(){});
    }
};

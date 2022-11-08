var express = require('express');
var app = express();
var bandwidthHeroProxy = require('./index.js').bandwidthHeroProxy;

app.use('/bandwidth-hero', bandwidthHeroProxy);

// app.post('/test', function(req,res){
//     res.send('Hello World!');
//     return;
// });

app.get('/test', function(req,res){
    res.send('Hello World!');
    return;
});

app.listen(3000, function() {
    console.log('Listening...');
});

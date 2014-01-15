"use strict";

var path = require('path');
var fs = require('fs');
var Protobuf = require('../');
var Schema = require('../test/schema');
var client = new Protobuf(Schema);

var testfile = path.dirname(__filename) + '/image.png';

var buf = fs.readFileSync(testfile);

function measure() {
    var start = Date.now();

    var count = 100;

    for (var i = 0; i < count; i++) {
        client.encode('Test1', { bytes: buf });
    }

    var end = Date.now();

    console.log(1000 / ((end - start) / count) + ' op/s');
}

measure();


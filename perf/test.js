"use strict";

var path = require('path');
var fs = require('fs');

var testfile = path.dirname(__filename) + '/image.png';

var buf = fs.readFileSync(testfile);

function testWithArray() {
    var result = [];
    result = result.concat(buf);
    result = new Buffer(result);
    return result;
}

function testWithBuffer() {
    var result = new Buffer(buf.length);
    buf.copy(result);
    return result;
}

function measure(fn) {
    var start = Date.now();

    var count = 100;

    for (var i = 0; i < count; i++) {
        fn();
    }

    var end = Date.now();

    console.log(fn.name + ':', 1000 / ((end - start) / count), 'op/s');
}

measure(testWithBuffer);
measure(testWithArray);


"use strict";

var path = require('path');
var fs = require('fs');

var testfile = path.dirname(__filename) + '/image.png';

var buf = fs.readFileSync(testfile);

function varintByteLength(number, signed) {
    var n = 0;

    if (signed) {
        number = (number << 1) ^ (number >> 31);
    }

    while (number !== 0) {
        number = number >>> 7;
        n ++;
    }

    return n;
}

function testWithArray() {
    var result = [];
    var value = Array.prototype.slice.call(buf);
    result = result.concat(value);
    result = new Buffer(result);
    return result;
}

function testWithBuffer() {
    for (var i = 0; i < 50; i++) {
        varintByteLength(i * 1024);
    }
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


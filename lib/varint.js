var bignum = require('bignum');

exports.read = function (buffer, offset, signed) {
    var byte;
    var result = 0;
    var position = offset || 0;

    do {
        byte = buffer[position];
        result += (byte & 0x7F) << (7 * (position - offset));
        position++;
    } while (byte >= 0x80);

    if (signed) {
        result = (result >>> 1) ^ -(result & 1);
    }

    return { length: (position - offset), value: result };
};

exports.read64 = function (buffer, offset, signed) {
    var byte;
    var result = bignum(0);
    var position = offset || 0;
    var shifted, anded;

    do {
        byte = buffer[position];
        result = result.add((byte & 0x7F) << (7 * (position - offset)));
        position++;
    } while (byte >= 0x80);

    if (signed) {
        shifted = result.shiftRight(1);
        anded = result.and(1);
        anded = anded.mul(-1);
        result = shifted.xor(anded);
    }

    return { length: (position - offset), value: result };
};

exports.write = function (buffer, number, offset, signed) {
    var position = offset || 0;
    
    if (signed) {
        number = (number << 1) ^ (number >> 31);
    }

    while (number >= 0x80) {
        buffer[position] = number | 0x80;
        number = number >> 7;
        position++;
    }

    buffer[position] = number;

    return position - offset + 1;
};

exports.write64 = function (buffer, number, offset, signed) {
    var position = offset || 0;
    number = bignum(number);

    if (signed) {
        number = number.shiftLeft(1).xor(number.shiftRight(63));
    }

    while (number.ge(0x80)) {
        buffer[position] = number.or(0x80).toNumber();
        number = number.shiftRight(7);
        position++;
    }

    buffer[position] = number.toNumber();

    return position - offset + 1;
};

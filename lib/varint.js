var long = require('long');

exports.read = function (buffer, offset, signed) {
    var byte, temp;
    var result = 0;
    var position = offset || 0;
    var shift = 0;

    do {
        byte = buffer[position];
        if (shift < 28) {
            result += (byte & 0x7F) << shift;
        } else {
            result += (byte & 0x7F) * Math.pow(2, shift);
        }
        shift += 7;
        position++;
    } while (byte >= 0x80);

    if (signed) {
        result = (result >>> 1) ^ -(result & 1);
    }

    return { length: (position - offset), value: result };
};

exports.read64 = function (buffer, offset, signed) {
    var byte;
    var result = long.fromNumber(0, !signed);
    var position = offset || 0;
    var shift = 0;

    do {
        byte = buffer[position];
        if (shift < 28) {
            result = result.add(long.fromNumber((byte & 0x7F) << shift));
        } else if (shift < 49) {
            result = result.add(long.fromNumber((byte & 0x7F) * Math.pow(2, shift)));
        } else {
            result = result.add(long.fromNumber(1).shiftLeft(shift).multiply(long.fromNumber(byte & 0x7F)));
        }
        shift += 7;
        position++;
    } while (byte >= 0x80);

    if (signed) {
        result = result.shiftRightUnsigned(1).xor(result.and(long.fromNumber(1)).negate());
    }

    return { length: (position - offset), value: result };
};

exports.write = function (buffer, number, offset, signed) {
    var position = offset || 0;

    if (signed) {
        number = ((number << 1) ^ (number >> 31)) >>> 0;
    }

    while ((number & ~0x7F) >>> 0) {
        buffer[position] = ((number & 0xFF) >>> 0) | 0x80;
        number = number >>> 7;
        position++;
    }

    buffer[position] = number;

    return position - offset + 1;
};

exports.write64 = function (buffer, number, offset, signed) {
    var position = offset || 0;

    if (typeof number === 'number') {
        number = long.fromNumber(number, !signed);
    }

    if (signed) {
        number = number.shiftLeft(1).xor(number.shiftRight(63)).toUnsigned();
    }

    while (number.and(long.fromNumber(~0x7F)).greaterThan(long.fromNumber(0))) {
        buffer[position] = number.and(long.fromNumber(0xFF)).or(long.fromNumber(0x80)).toNumber();
        number = number.shiftRightUnsigned(7);
        position++;
    }

    buffer[position] = number.toNumber();

    return position - offset + 1;
};

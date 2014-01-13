var long = require('long');
var varint = require('./lib/varint');

function Protobuf(schema) {
    this.schema = schema;
}

Protobuf.prototype._findField = function (message, tag) {
    var field, key;

    for (key in this.schema.messages[message].fields) {
        if (this.schema.messages[message].fields[key].tag === tag) {
            field = this.schema.messages[message].fields[key];
            field.name = key;
        }
    }

    return field;
};

Protobuf.prototype.decode = function (message, data) {
    if (!Buffer.isBuffer(data)) return new Error('Data must be a buffer');
    if (!this.schema.messages[message]) return new Error('Unknown message');

    var mc, type, tag, field, value, repeated, meta, low, high;
    var enums = this.schema.messages[message].enums;
    var position = 0;
    var length = data.length;
    var result = {};

    while (position < length) {
        mc = varint.read(data, position);
        type = mc.value & 0x07;
        tag = mc.value >> 3;
        position += mc.length;
        field = this._findField(message, tag);
        if (!field) return new Error('Encountered unknown message tag');

        repeated = field.rule === 'repeated';
        if (!result.hasOwnProperty(field.name) && repeated) result[field.name] = [];

        switch (field.type) {
            case 'uint32':
            case 'bool':
                // read varint
                value = varint.read(data, position);
                position += value.length;
                value = value.value;
                // coerce to boolean if correct
                if (field.type === 'bool') {
                    value = Boolean(value);
                }
                break;

            case 'int32':
                value = varint.read(data, position, true);
                position += value.length;
                value = value.value;
                break;

            case 'sint32':
                // read zigzag encoded varint
                value = varint.read(data, position, true);
                position += value.length;
                value = varint.dezigzag(value.value);
                break;

            case 'uint64':
                // read 64 bit varint
                value = varint.read64(data, position);
                position += value.length;
                value = value.value;
                break;

            case 'int64':
                value = varint.read64(data, position, true);
                position += value.length;
                value = value.value;
                break;

            case 'sint64':
                // read zigzag encoded 64 bit varint
                value = varint.read64(data, position, true);
                position += value.length;
                value = varint.dezigzag64(value.value);
                break;

            case 'fixed64':
            case 'sfixed64':
            case 'double':
                // read 64 bit number
                low = data.readUInt32LE(position);
                high = data.readUInt32LE(position + 4);
                value = new long(low, high, field.type !== 'sfixed64');
                position += 8;
                break;

            case 'bytes':
            case 'string':
                // read raw bytes
                meta = varint.read(data, position);
                position += meta.length;
                value = data.slice(position, position + meta.value);
                position += meta.value;
                // stringify raw bytes if string
                if (field.type === 'string') value = value.toString();
                break;

            case 'fixed32':
            case 'sfixed32':
            case 'float':
                // read 32 bit number
                value = data.readInt32LE(position);
                position += 4;
                break;

            default:
                // check if it's an enum
                if (enums && enums[field.type]) {
                    value = varint.read(data, position);
                    position += value.length;
                    value = value.value;
                } else {
                    // decode embedded message
                    meta = varint.read(data, position);
                    position += meta.length;
                    value = this.decode(field.type, data.slice(position, position + meta.value));
                    position += meta.value;
                }
                break;
        }


        if (repeated) {
            result[field.name].push(value);
        } else {
            result[field.name] = value;
        }
    }

    return result;
};

Protobuf.prototype.encode = function (message, data, preserve) {
    if (!this.schema.messages[message]) return new Error('Unknown message');

    var self = this;
    var key, repeated, value;
    var result = [];
    var position = 0;
    var length = 0;
    var field, fieldLength, fieldPosition;
    var fields = this.schema.messages[message].fields;
    var enums = this.schema.messages[message].enums;

    function encodeField(key, item) {
        switch (fields[key].type) {
            case 'uint32':
            case 'bool':
                if (fields[key].type === 'bool') {
                    value = Number(item);
                } else {
                    value = item;
                }

                fieldPosition = 0;
                fieldLength = varint.write(null, fields[key].tag << 3) + varint.write(null, value);
                length += fieldLength;
                field = new Buffer(fieldLength);

                fieldPosition += varint.write(field, fields[key].tag << 3, fieldPosition);
                fieldPosition += varint.write(field, value, fieldPosition);
                result.push(field);
                break;

            case 'int32':
                value = item;

                fieldPosition = 0;
                fieldLength = varint.write(null, fields[key].tag << 3) + varint.write(null, value);
                length += fieldLength;
                field = new Buffer(fieldLength);

                fieldPosition += varint.write(field, fields[key].tag << 3, fieldPosition);
                fieldPosition += varint.write(field, value, fieldPosition);
                result.push(field);
                break;

            case 'sint32':
                value = item;

                fieldPosition = 0;
                fieldLength = varint.write(null, fields[key].tag << 3) + varint.write(null, varint.zigzag(value), 0, true);
                length += fieldLength;
                field = new Buffer(fieldLength);

                fieldPosition += varint.write(field, fields[key].tag << 3, fieldPosition);
                fieldPosition += varint.write(field, varint.zigzag(value), fieldPosition, true);
                result.push(field);
                break;

            case 'uint64':
                if (typeof item === 'number') {
                    value = long.fromNumber(item, true);
                } else if (typeof item === 'string') {
                    value = long.fromString(item, true);
                } else {
                    value = item;
                }

                fieldPosition = 0;
                fieldLength = varint.write(null, fields[key].tag << 3) + varint.write64(null, value);
                length += fieldLength;
                field = new Buffer(fieldLength);

                fieldPosition += varint.write(field, fields[key].tag << 3, fieldPosition);
                fieldPosition += varint.write64(field, value, fieldPosition);
                result.push(field);
                break;

            case 'int64':
                if (typeof item === 'number') {
                    value = long.fromNumber(item);
                } else if (typeof item === 'string') {
                    value = long.fromString(item);
                } else {
                    value = item;
                }

                fieldPosition = 0;
                fieldLength = varint.write(null, fields[key].tag << 3) + varint.write64(null, value);
                length += fieldLength;
                field = new Buffer(fieldLength);

                fieldPosition += varint.write(field, fields[key].tag << 3, fieldPosition);
                fieldPosition += varint.write64(field, value, fieldPosition);
                result.push(field);
                break;

            case 'sint64':
                if (typeof item === 'number') {
                    value = long.fromNumber(item);
                } else if (typeof item === 'string') {
                    value = long.fromString(item);
                } else {
                    value = item;
                }

                fieldPosition = 0;
                fieldLength = varint.write(null, fields[key].tag << 3) + varint.write64(null, varint.zigzag64(value));
                length += fieldLength;
                field = new Buffer(fieldLength);

                fieldPosition += varint.write(field, fields[key].tag << 3, fieldPosition);
                fieldPosition += varint.write64(field, varint.zigzag64(value), fieldPosition);
                result.push(field);
                break;

            case 'fixed64':
            case 'sfixed64':
            case 'double':
                if (typeof item === 'number') {
                    item = long.fromNumber(item, fields[key].type !== 'sfixed64');
                } else if (typeof item === 'string') {
                    item = long.fromString(item, fields[key].type !== 'sfixed64');
                }

                fieldPosition = 0;
                fieldLength = varint.write(null, (fields[key].tag << 3) + 1) + 8;
                length += fieldLength;
                field = new Buffer(fieldLength);

                fieldPosition += varint.write(field, (fields[key].tag << 3) + 1, fieldPosition);
                if (fields[key].type === 'sfixed64') {
                    field.writeInt32LE(item.getLowBitsUnsigned(), 1);
                    field.writeInt32LE(item.getHighBitsUnsigned(), 5);
                } else {
                    field.writeInt32LE(item.getLowBits(), 1);
                    field.writeInt32LE(item.getHighBits(), 5);
                }
                result.push(field);
                break;

            case 'bytes':
            case 'string':
                if (!Buffer.isBuffer(item)) {
                    if (typeof item !== 'string') {
                        item = String(item);
                    }
                    value = new Buffer(item, 'utf8');
                } else {
                    value = item;
                }

                fieldPosition = 0;
                fieldLength = varint.write(null, (fields[key].tag << 3) + 2) + varint.write(null, value.length) + value.length;
                length += fieldLength;
                field = new Buffer(fieldLength);

                fieldPosition += varint.write(field, (fields[key].tag << 3) + 2, fieldPosition);
                fieldPosition += varint.write(field, value.length, fieldPosition);
                value.copy(field, fieldPosition);
                result.push(field);
                break;

            case 'fixed32':
            case 'sfixed32':
            case 'float':
                if (typeof item !== 'number') {
                    item = Number(item);
                }

                fieldPosition = 0;
                fieldLength = varint.write(null, (fields[key].tag << 3) + 5) + 4;
                length += fieldLength;
                field = new Buffer(fieldLength);

                fieldPosition += varint.write(field, (fields[key].tag << 3) + 5, fieldPosition);
                field.writeInt32LE(item, fieldPosition);
                result.push(field);
                break;

            default:
                if (enums && enums[fields[key].type]) {
                    value = item;

                    fieldPosition = 0;
                    fieldLength = varint.write(null, fields[key].tag << 3) + varint.write(null, value);
                    length += fieldLength;
                    field = new Buffer(fieldLength);

                    fieldPosition += varint.write(field, fields[key].tag << 3, fieldPosition);
                    fieldPosition += varint.write(field, value, fieldPosition);
                    result.push(field);
                } else {
                    value = self.encode(fields[key].type, item);

                    fieldPosition = 0;
                    fieldLength = varint.write(null, (fields[key].tag << 3) + 2) + varint.write(null, value.length) + value.length;
                    length += fieldLength;
                    field = new Buffer(fieldLength);

                    fieldPosition += varint.write(field, (fields[key].tag << 3) + 2, fieldPosition);
                    fieldPosition += varint.write(field, value.length, fieldPosition);
                    value.copy(field, fieldPosition);
                    result.push(field);
                }
                break;
        }
    }

    for (key in data) {
        if (!fields[key]) return new Error('Unknown field');
        repeated = fields[key].rule === 'repeated';

        if (repeated) {
            if (!Array.isArray(data[key])) {
                data[key] = [data[key]];
            }
            data[key].forEach(function (item) {
                encodeField(key, item);
            });
        } else {
            encodeField(key, data[key]);
        }
    }

    result = Buffer.concat(result, length);

    return result;
};

module.exports = Protobuf;

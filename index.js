var fs = require('fs'),
    path = require('path');

function Protobuf(schema) {
    this.schema = readMessages(schema);
}

function bufferToArray(buffer) {
    var bytes = [];
    for (var i = 0; i < buffer.length; i++) {
        bytes.push(buffer[i]);
    }
    return bytes;
}

function encode(num) {
    function _rshift(num, bits) {
        return num / Math.pow(2, bits);
    }

    if (num === 0) return new Buffer([0x00]);
    var bytes = [];
    while (num >= 0x80) {
        bytes.push(num | 0x80);
        num = _rshift(num, 7);
    }
    bytes.push(num);
    return new Buffer(bytes);
}

function decode(varint) {
    function _lshift(num, bits) {
        return num * Math.pow(2, bits);
    }

    var nextByte,
        result = 0,
        bytesRead = 0;
    do {
        nextByte = varint[bytesRead];
        result += _lshift((nextByte & 0x7F), (7 * bytesRead));
        bytesRead++;
    } while (nextByte >= 0x80);
    return { num: result, bytes: bytesRead };
}

function parseSchema(file, filepath) {
    var lines = file.split('\n'),
        new_lines = [],
        mlc = false,
        in_msg = false,
        schema = {};

    lines.forEach(function (line) {
        if (line.match(/^\/\*/)) mlc = true;
        if (!mlc && !line.match(/^\/\//)) new_lines.push(line);
        if (line.match(/^\*\//)) mlc = false;
    });
    new_lines = new_lines.filter(function (line) {
        if (line.length === 0) return false;
        if (line.match(/^option/)) return false;
        return true;
    });
    new_lines = new_lines.map(function (line) {
        if (line.match(/\/\//)) line = line.replace(/\s?\/\/.*$/, '');
        if (line.match(/^import/)) {
            var f = fs.readFileSync(path.dirname(filepath) + '/' + line.replace(/import\s|\"|;/g, ''), 'utf8');
            line = parseSchema(f);
        }
        return line;
    });
    return new_lines.join('\n');
}

function readMessages(schema) {
    var new_schema = {},
        msg,
        line_enum,
        in_msg = false,
        in_enum = false;

    schema.split('\n').forEach(function (line) {
        line = line.replace(/;/g, '');
        if (line.match(/^message/)) {
            in_msg = true;
            msg = line.match(/^message\s(\w+)\s{/)[1];
            new_schema[msg] = {};
        } else if (line.match(/^}$/)) {
            in_msg = false;
        } else if (in_msg && !in_enum) {
            var this_msg = line.trim().split(' ');
            if (this_msg[0] !== 'enum') {
                new_schema[msg][this_msg[2]] = {};
                switch (this_msg[1]) {
                    case 'int32':
                    case 'int64':
                    case 'uint32':
                    case 'uint64':
                    case 'sint32':
                    case 'sint64':
                    case 'bool':
                    case 'enum':
                        new_schema[msg][this_msg[2]].type = 0;
                        break;
                    case 'fixed64':
                    case 'sfixed64':
                    case 'double':
                        new_schema[msg][this_msg[2]].type = 1;
                        break;
                    case 'fixed32':
                    case 'sfixed32':
                    case 'float':
                        new_schema[msg][this_msg[2]].type = 5;
                        break;
                    case 'string':
                    case 'bytes':
                        new_schema[msg][this_msg[2]].type = 2;
                        break;
                    default:
                        if (new_schema[msg][this_msg[1]] && new_schema[msg][this_msg[1]].raw_type === 'enum') {
                            new_schema[msg][this_msg[2]].type = 0;
                        } else {
                            new_schema[msg][this_msg[2]].type = 2;
                        }
                }
                new_schema[msg][this_msg[2]].raw_type = this_msg[1];
                new_schema[msg][this_msg[2]].field = parseInt(this_msg[4], 10);
                if (this_msg[0] === 'required') {
                    new_schema[msg][this_msg[2]].required = true;
                } else if (this_msg[0] === 'optional') {
                    new_schema[msg][this_msg[2]].required = false;
                } else if (this_msg[0] === 'repeated') {
                    new_schema[msg][this_msg[2]].required = false;
                    new_schema[msg][this_msg[2]].repeated = true;
                }
            } else {
                line_enum = line.match(/^\s*enum\s(\w+)\s{/)[1];
                in_enum = true;
            }
        } else if (in_enum) {
            if (line.match(/\s*}$/)) {
                in_enum = false;
            } else {
                var this_enum = line.trim().split(' ');
                if (!new_schema[msg][line_enum]) new_schema[msg][line_enum] = { raw_type: 'enum' };
                new_schema[msg][line_enum][this_enum[0]] = parseInt(this_enum[2], 10);
            }
        }

    });
    return new_schema;
}

exports.loadSchema = function (schema) {
    var f = fs.readFileSync(schema, 'utf8');
    return new Protobuf(parseSchema(f, schema));
};

Protobuf.prototype.decode = function (message, data) {
    var self = this;

    function parseMessage(name, buffer) {
        var type, field, varint, len, val, key, ret = {}, schema = self.schema[name];
        while (buffer.length > 0) {
            type = buffer[0] & 0x07;
            field = buffer[0] >> 3;
            key = Object.keys(schema).filter(function (key) {
                return schema[key].field === field;
            })[0];
            if (schema[key].type === 0) {
                varint = decode(buffer.slice(1));
                len = varint.bytes + 1;
                val = varint.num;
                if (schema[key].raw_type === 'bool') val = Boolean(val);
            } else if (schema[key].type === 2) {
                varint = decode(buffer.slice(1));
                len = varint.num + varint.bytes + 1;
                if (schema[key].raw_type === 'string' || schema[key].raw_type === 'bytes') {
                    if (key === 'vclock') {
                        val = bufferToArray(buffer.slice(2, len));
                    } else {
                        val = buffer.slice(2, len).toString();
                    }
                } else {
                    val = parseMessage(schema[key].raw_type, buffer.slice(2, len));
                }
            }
            if (schema[key].repeated) {
                if (!ret.hasOwnProperty(key)) ret[key] = [];
                ret[key].push(val);
            } else {
                ret[key] = val;
            }
            buffer = buffer.slice(len);
        }
        return ret;
    };

    return parseMessage(message, data);
};

Protobuf.prototype.encode = function (message, params) {
    if (!~Object.keys(this.schema).indexOf(message) || !params) return new Buffer([]);
    var schema = this.schema[message],
        bytes = [];

    Object.keys(params).forEach(function (key) {
        if (schema.hasOwnProperty(key)) {
            bytes.push((schema[key].field << 3) + schema[key].type);
            if (schema[key].type === 2) {
                if (Array.isArray(params[key])) {
                    bytes.push(params[key].length);
                    bytes.concat(params[key]);
                } else {
                    var encoded = encode(Buffer.byteLength(params[key]));
                    for (var i = 0; i < encoded.length; i++) {
                        bytes.push(encoded[i]);
                    }
                    for (var i = 0; i < params[key].length; i++) {
                        bytes.push(params[key].charCodeAt(i));
                    }
                }
            } else if (schema[key].type === 0) {
                bytes.push(encode(params[key]));
            }
        }
    });

    return new Buffer(bytes);
};

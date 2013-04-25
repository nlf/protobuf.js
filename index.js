var fs = require('fs'),
    path = require('path'),
    butils = require('butils'),
    wtf = require('wtf8');

function Protobuf(schema) {
    this.schema = readMessages(schema);
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
            msg = line.match(/^message\s(\w+)\s\{/)[1];
            new_schema[msg] = {};
        } else if (line.match(/^\}$/)) {
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
                line_enum = line.match(/^\s*enum\s(\w+)\s\{/)[1];
                in_enum = true;
            }
        } else if (in_enum) {
            if (line.match(/\s*\}$/)) {
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

    function parseMessage(name, buffer, start, end) {
        start = start || 0;
        end = end || buffer.length;
        var pos = start;
        var type, field, varint, len, val, keys, key, ret = {}, schema = self.schema[name];
        while (pos < end) {
            type = buffer[pos] & 0x07;
            field = buffer[pos] >> 3;
            keys = Object.keys(schema);
            for (var i = 0; i < keys.length; i++) {
                if (schema[keys[i]].field === field) key = keys[i];
            }
            /*key = Object.keys(schema).filter(function (key) {
                return schema[key].field === field;
            })[0];*/
            if (schema[key].type === 0) {
                varint = butils.readVarint(buffer, pos + 1);
                len = varint.bytes + 1;
                val = varint.num;
                if (schema[key].raw_type === 'bool') val = Boolean(val);
            } else if (schema[key].type === 2) {
                varint = butils.readVarint(buffer, pos + 1);
                len = varint.num + varint.bytes + 1;
                if (schema[key].raw_type === 'string' || schema[key].raw_type === 'bytes') {
                    if (key === 'vclock' || (key === 'value' && !schema.hasOwnProperty('key'))) {
                        val = buffer.slice(pos + varint.bytes + 1, pos + len);
                    } else {
                        val = wtf.decode(buffer.slice(pos + varint.bytes + 1, pos + len));
                    }
                } else {
                    val = parseMessage(schema[key].raw_type, buffer, pos + varint.bytes + 1, pos + len);
                }
            }
            if (schema[key].repeated) {
                if (!ret.hasOwnProperty(key)) ret[key] = [];
                ret[key].push(val);
            } else {
                ret[key] = val;
            }
            pos += len;
        }
        return ret;
    }

    return parseMessage(message, data);
};

Protobuf.prototype.encode = function (message, params) {
    if (!~Object.keys(this.schema).indexOf(message) || !params) return [];
    var self = this,
        schema = this.schema[message],
        bytes = [];

    Object.keys(params).forEach(function (key) {
        if (schema.hasOwnProperty(key) && typeof params[key] !== 'undefined') {
            if (schema[key].type === 2) {
                if (Buffer.isBuffer(params[key])) {
                    bytes.push((schema[key].field << 3) + schema[key].type);
                    butils.writeVarint(bytes, params[key].length, bytes.length);
                    Array.prototype.slice.call(params[key], 0).forEach(function (byte) {
                        bytes.push(byte);
                    });
                } else if (typeof params[key] === 'object') {
                    if (Array.isArray(params[key])) {
                        if (params[key].length > 0) {
                            var ret;
                            params[key].forEach(function (item) {
                                bytes.push((schema[key].field << 3) + schema[key].type);
                                ret = self.encode(schema[key].raw_type, item);
                                butils.writeVarint(bytes, ret.length, bytes.length);
                                bytes = bytes.concat(ret);
                            });
                        }
                    } else {
                        params[key] = self.encode(schema[key].raw_type, params[key]);
                        bytes.push((schema[key].field << 3) + schema[key].type);
                        butils.writeVarint(bytes, params[key].length, bytes.length);
                        bytes = bytes.concat(params[key]);
                    }
                } else {
                    bytes.push((schema[key].field << 3) + schema[key].type);
                    var buf = wtf.encode(params[key]);
                    butils.writeVarint(bytes, buf.length, bytes.length);
                    Array.prototype.slice.call(buf, 0).forEach(function(byte) {
	                      bytes.push(byte);
                    });
                }
            } else if (schema[key].type === 0) {
                bytes.push((schema[key].field << 3) + schema[key].type);
                butils.writeVarint(bytes, params[key], bytes.length);
            }
        }
    });

    return bytes;
};

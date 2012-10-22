Protobuf.js
-----------

This is an extremely lightweight, stripped down, ugly implementation of protocol buffers written specifically for use in making a Riak library. As such, it lacks support for many of the data types, and handles a few Riak specific fields in special ways (vclocks, for one). I will happily accept pull requests to make it more compatible with the full spec.

What it does:
=============

* parses .proto files to build a schema (including imports) in a very very rough way
* encodes objects to buffers
* decodes buffers to objects
* supports the string/bytes and varint types

What it does not do:
====================

* have full support for every directive in .proto files
* have support for any types other than varint or string/bytes
* make your breakfast


Usage
=====

```javascript
var protobuf = require('protobuf.js'),
    translator = protobuf.loadSchema('./riak_kv.proto');

var msg = translator.encode('RpbGetReq', { bucket: 'test', key: 'test' });
//msg will *only* contain the protobuf encoded message, *NOT* the full riak packet

var decoded = translator.decode('RpbGetResp', responsePacket);
//again, this will *only* decode the protobuf message. you have to remove the riak header yourself
```

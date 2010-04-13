/*
    Redis client module for Node.js

    Copyright (C) 2010 Fictorial LLC.

    Permission is hereby granted, free of charge, to any person obtaining
    a copy of this software and associated documentation files (the
    "Software"), to deal in the Software without restriction, including without
    limitation the rights to use, copy, modify, merge, publish, distribute,
    sublicense, and/or sell copies of the Software, and to permit persons to
    whom the Software is furnished to do so, subject to the following
    conditions:

    The above copyright notice and this permission notice shall be included in
    all copies or substantial portions of the Software.

    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
    IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
    FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
    AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
    LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
    FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
    DEALINGS IN THE SOFTWARE.
*/

// To add support for new commands, edit the array called "commands" at the
// bottom of this file.

// Set this to true to aid in debugging wire protocol input/output,
// parsing methods, etc.

exports.debugMode = false;

var net = require("net"),
    sys = require("sys"),
    Buffer = require('buffer').Buffer,

    CRLF = "\r\n",
    CRLF_LEN = 2,
    MAX_RECONNECTION_ATTEMPTS = 10,

    PLUS      = exports.PLUS      = 0x2B, // +
    MINUS     = exports.MINUS     = 0x2D, // -
    DOLLAR    = exports.DOLLAR    = 0x24, // $
    STAR      = exports.STAR      = 0x2A, // *
    COLON     = exports.COLON     = 0x3A, // :
    CR        = exports.CR        = 0x0D, // \r
    LF        = exports.LF        = 0x0A, // \n
                                
    NONE      = exports.NONE      = "NONE",
    BULK      = exports.BULK      = "BULK",     
    MULTIBULK = exports.MULTIBULK = "MULTIBULK",
    INLINE    = exports.INLINE    = "INLINE",   
    INTEGER   = exports.INTEGER   = "INTEGER",  
    ERROR     = exports.ERROR     = "ERROR";    

function debugFilter(buffer, len) {
    // Redis is binary-safe but assume for debug display that 
    // the encoding of textual data is UTF-8.

    var filtered = buffer.utf8Slice(0, len);

    filtered = filtered.replace(/\r\n/g, '<CRLF>');
    filtered = filtered.replace(/\r/g, '<CR>');
    filtered = filtered.replace(/\n/g, '<LF>');

    return filtered;
}

// fnmatch mirrors (mostly) the functionality of fnmatch(3) at least
// in the same way as Redis.  

var qmarkRE = /\?/g;
var starRE  = /\*/g;
var dotRE   = /\./g;

function fnmatch (pattern, test) {
    var newPattern = pattern.replace(dotRE, '(\\.)')
                            .replace(qmarkRE, '(.)')
                            .replace(starRE, '(.*?)');
    return (new RegExp(newPattern)).test(test);
}

// A fully interruptable, binary-safe Redis reply parser.
// 'callback' is called with each reply parsed in 'feed'.
// 'thisArg' is the "thisArg" for the callback "call".

function ReplyParser(callback, thisArg) {
    this.onReply = callback;
    this.thisArg = thisArg;
    this.clearState();
    this.clearMultiBulkState();
}

exports.ReplyParser = ReplyParser;

ReplyParser.prototype.clearState = function () {
    this.type = NONE;
    this.bulkLengthExpected = null;
    this.valueBufferLen = 0;
    this.skip = 0;
    this.valueBuffer = new Buffer(4096);
};

ReplyParser.prototype.clearMultiBulkState = function () {
    this.multibulkReplies = null; 
    this.multibulkRepliesExpected = null;
};

ReplyParser.prototype.feed = function (inbound) {
    for (var i=0; i < inbound.length; ++i) {
        if (this.skip > 0) {
            this.skip--;
            continue;
        }

        var typeBefore = this.type;

        if (this.type === NONE) {
            switch (inbound[i]) {
                case DOLLAR: this.type = BULK;      break;
                case STAR:   this.type = MULTIBULK; break;
                case COLON:  this.type = INTEGER;   break;
                case PLUS:   this.type = INLINE;    break;
                case MINUS:  this.type = ERROR;     break;
            }
        }

        // Just a state transition on '*', '+', etc.?  

        if (typeBefore != this.type)
            continue;

        // If the reply is a part of a multi-bulk reply.  Save it.  If we have
        // received all the expected replies of a multi-bulk reply, then
        // callback.  If the reply is not part of a multi-bulk. Call back
        // immediately.

        var self = this;

        var maybeCallbackWithReply = function (reply) {
            if (self.multibulkReplies != null) {
                self.multibulkReplies.push(reply);
                if (--self.multibulkRepliesExpected == 0) {
                    self.onReply.call(self.thisArg, { 
                        type:  MULTIBULK, 
                        value: self.multibulkReplies 
                    });
                    self.clearMultiBulkState();
                }
            } else {
                self.onReply.call(self.thisArg, reply);
            }
            self.clearState();
            self.skip = 1; // Skip LF
        };

        switch (inbound[i]) {
        case CR:
            switch (this.type) {
                case INLINE:
                case ERROR:
                    // CR denotes end of the inline/error value.  
                    // +OK\r\n
                    //    ^

                    var inlineBuf = new Buffer(this.valueBufferLen);
                    this.valueBuffer.copy(inlineBuf, 0, 0, this.valueBufferLen);
                    maybeCallbackWithReply({ type:this.type, value:inlineBuf });
                    break;

                case INTEGER:
                    // CR denotes the end of the integer value.  
                    // :42\r\n
                    //    ^

                    var n = parseInt(this.valueBuffer.asciiSlice(0, this.valueBufferLen), 10);
                    maybeCallbackWithReply({ type:INTEGER, value:n });
                    break;

                case BULK:
                    if (this.bulkLengthExpected == null) {
                        // CR denotes end of first line of a bulk reply,
                        // which is the length of the bulk reply value.
                        // $5\r\nhello\r\n
                        //   ^

                        var bulkLengthExpected = 
                            parseInt(this.valueBuffer.asciiSlice(0, this.valueBufferLen), 10);

                        if (bulkLengthExpected <= 0) {
                            maybeCallbackWithReply({ type:BULK, value:null });
                        } else {
                            this.clearState();

                            this.bulkLengthExpected = bulkLengthExpected;
                            this.type = BULK;
                            this.skip = 1;  // skip LF
                        }
                    } else if (this.valueBufferLen == this.bulkLengthExpected) {
                        // CR denotes end of the bulk reply value.
                        // $5\r\nhello\r\n
                        //            ^

                        var bulkBuf = new Buffer(this.valueBufferLen);
                        this.valueBuffer.copy(bulkBuf, 0, 0, this.valueBufferLen);
                        maybeCallbackWithReply({ type:BULK, value:bulkBuf });
                    } else {
                        // CR is just an embedded CR and has nothing to do
                        // with the reply specification.
                        // $11\r\nhello\rworld\r\n
                        //             ^
                        
                        this.valueBuffer[this.valueBufferLen++] = inbound[i];
                    }
                    break;

                case MULTIBULK:
                    // Parse the count which is the number of expected replies
                    // in the multi-bulk reply.
                    // *2\r\n$5\r\nhello\r\n$5\r\nworld\r\n
                    //   ^

                    var multibulkRepliesExpected = 
                        parseInt(this.valueBuffer.asciiSlice(0, this.valueBufferLen), 10);

                    if (multibulkRepliesExpected <= 0) {
                        maybeCallbackWithReply({ type:MULTIBULK, value:null });
                    } else {
                        this.clearState();
                        this.skip = 1;    // skip LF
                        this.multibulkReplies = [];
                        this.multibulkRepliesExpected = multibulkRepliesExpected;
                    }
                    break;
            }
            break;

        default:
            this.valueBuffer[this.valueBufferLen++] = inbound[i];
            break;
        }

        // If the current value buffer is too big, create a new buffer, copy in
        // the old buffer, and replace the old buffer with the new buffer.
 
        if (this.valueBufferLen === this.valueBuffer.length) {
            var newBuffer = new Buffer(this.valueBuffer.length * 2);
            this.valueBuffer.copy(newBuffer, 0, 0);
            this.valueBufferLen = 0;
            this.valueBuffer = newBuffer;
        }
    }
};

function Client(stream) {
    this.callbacks = [];
    this.channelCallbacks = {};

    this.replyParser = new ReplyParser(this.onReply_, this);

    var client = this;
    this.stream = stream;

    this.stream.addListener("connect", function () {
        if (exports.debugMode)
            sys.debug("[CONNECTED]");

        this.setNoDelay();
        this.setTimeout(0);

        client.noReconnect = false;
        client.reconnectionAttempts = 0;
    });

    this.stream.addListener("data", function (buffer) {
        if (exports.debugMode)
            sys.debug("[RECV] " + debugFilter(buffer, buffer.length));

        client.replyParser.feed(buffer);
    });

    this.stream.addListener("end", function () {
        this.end();
    });

    stream.addListener("close", function (inError) {
        if (exports.debugMode)
            sys.debug("[DISCONNECTED]");

        if (!client.noReconnect &&
            client.reconnectionAttempts++ < MAX_RECONNECTION_ATTEMPTS) {
            this.setTimeout(30);
            this.connect(this.port, this.host);
        }
    });
}

exports.Client = Client;

exports.createClient = function (port, host) {
    var port = port || 6379;
    var host = host || '127.0.0.1';

    var client = new Client(new net.createConnection(port, host));

    client.port = port;
    client.host = host;

    return client;
};

Client.prototype.close = function () {
    this.noReconnect = true;
    this.stream.end();
};

Client.prototype.onReply_ = function (reply) {
    if (reply.type == ERROR) {
        var errorMessage = reply.value.utf8Slice(0, reply.value.length);
        if (exports.debugMode) sys.debug("error: " + errorMessage);
        this.callbacks.shift()(errorMessage, null); // err, reply
        return;
    } 

    // PUBSUB message?  

    if (reply.type === MULTIBULK && 
        reply.value instanceof Array &&
        reply.value.length === 3 &&            // ['message', channel, payload]
        reply.value[0].value.length === 7 &&   // 'message'
        reply.value[0].value.asciiSlice(0, 7) === 'message' &&
        Object.getOwnPropertyNames(this.channelCallbacks).length > 0) {

        var channelNameOrPattern = reply.value[1].value;
        var channelCallback = this.channelCallbacks[channelNameOrPattern];

        if (typeof(channelCallback) == 'undefined') {
            // No 1:1 channel name match. 
            //
            // Perhaps the subscription was for a pattern (PSUBSCRIBE)?
            // Redis does not send the pattern that matched from an
            // original PSUBSCRIBE request.  It sends the (fn)matching
            // channel name instead.  Thus, let's try to fnmatch the
            // channel the message was published to/on to a subscribed
            // pattern, and callback the associated function.
            // 
            // A -> Redis     PSUBSCRIBE foo.*
            // B -> Redis     PUBLISH foo.bar hello
            // Redis -> A     MESSAGE foo.bar hello   (no pattern specified)

            var channelNamesOrPatterns = 
                Object.getOwnPropertyNames(this.channelCallbacks);

            for (var i=0; i < channelNamesOrPatterns.length; ++i) {
                var thisNameOrPattern = channelNamesOrPatterns[i];
                if (fnmatch(thisNameOrPattern, channelNameOrPattern)) {
                    channelCallback = this.channelCallbacks[thisNameOrPattern];
                    break;
                }
            }
        }

        if (typeof(channelCallback) === 'function') {
            // Good, we found a function to callback.

            var payload = reply.value[2].value;
            channelCallback(channelNameOrPattern, payload);
        }

        return;
    }

    // Non-PUBSUB reply (e.g. GET command reply).

    var callback = this.callbacks.shift();
    reply.value = maybeConvertReplyValue(callback.commandName, reply);

    if (exports.debugMode) {
        sys.debug("reply: " + JSON.stringify(reply));
        sys.debug("from command: " + callback.commandName);
    }

    callback(null, reply.value);   // null => no Redis error.
};

function maybeAsNumber(str) {
    var value = parseInt(str, 10);

    if (isNaN(value)) 
        value = parseFloat(str);

    if (isNaN(value)) 
        return str;

    return value;
}

function maybeConvertReplyValue(commandName, reply) {
    if (reply.value === null)
        return null;

    // Redis' INFO command returns a BULK reply of the form:
    // "redis_version:1.3.8
    // arch_bits:64
    // multiplexing_api:kqueue
    // process_id:11604
    // ..."
    // 
    // We convert that to a JS object like:
    // { redis_version: '1.3.8'
    // , arch_bits: '64'
    // , multiplexing_api: 'kqueue'
    // , process_id: '11604'
    // , ... }

    if (commandName === 'info' && reply.type === BULK) {
        var info = {};
        reply.value.asciiSlice(0, reply.value.length).split(/\r\n/g)
            .forEach(function (line) {
                var parts = line.split(':');
                if (parts.length === 2)
                    info[parts[0]] = parts[1];
            });
        return info;
    }

    // HGETALL returns a MULTIBULK where each consecutive reply-pair
    // is a key and value for the Redis HASH.  We convert this into
    // a JS object.

    if (commandName === 'hgetall' && 
        reply.type === MULTIBULK &&
        reply.value.length % 2 === 0) {

        var hash = {};
        for (var i=0; i<reply.value.length; i += 2) 
            hash[reply.value[i].value] = reply.value[i + 1].value;
        return hash;
    }

    // Redis returns "+OK\r\n" to signify success.
    // We convert this into a JS boolean with value true.
    
    if (reply.type === INLINE && reply.value.asciiSlice(0,2) === 'OK')
        return true;

    // ZSCORE returns a string representation of a floating point number.
    // We convert this into a JS number.

    if (commandName === "zscore")
        return maybeAsNumber(reply.value);

    // Multibulk replies are returned from our reply parser as an
    // array like: [ {type:BULK, value:"foo"}, {type:BULK, value:"bar"} ]
    // But, end-users want the value and don't care about the
    // Redis protocol reply types.  We here extract the value from each
    // object in the multi-bulk array.

    if (reply.type === MULTIBULK)
        return reply.value.map(function (element) { return element.value; });

    // Otherwise, we have no conversions to offer.

    return reply.value;
}

exports.maybeConvertReplyValue_ = maybeConvertReplyValue;

var commands = [ 
    "append",
    "auth",
    "bgsave",
    "blpop",
    "brpop",
    "dbsize",
    "decr",
    "decrby",
    "del",
    "exists",
    "expire",
    "expireat",
    "flushall",
    "flushdb",
    "get",
    "getset",
    "hdel",
    "hexists",
    "hget",
    "hgetall",
    "hincrby",
    "hkeys",
    "hlen",
    "hmget",
    "hmset",
    "hset",
    "hvals",
    "incr",
    "incrby",
    "info",
    "keys",
    "lastsave",
    "len",
    "lindex",
    "llen",
    "lpop",
    "lpush",
    "lrange",
    "lrem",
    "lset",
    "ltrim",
    "mget",
    "move",
    "mset",
    "msetnx",
    "psubscribe",
    "publish",
    "punsubscribe",
    "randomkey",
    "rename",
    "renamenx",
    "rpop",
    "rpoplpush",
    "rpush",
    "sadd",
    "save",
    "scard",
    "sdiff",
    "sdiffstore",
    "select",
    "set",
    "setnx",
    "shutdown",
    "sinter",
    "sinterstore",
    "sismember",
    "smembers",
    "smove",
    "sort",
    "spop",
    "srandmember",
    "srem",
    "subscribe",
    "sunion",
    "sunionstore",
    "ttl",
    "type",
    "unsubscribe",
    "zadd",
    "zcard",
    "zcount",
    "zincrby",
    "zinter",
    "zrange",
    "zrangebyscore",
    "zrank",
    "zrem",
    "zrembyrank",
    "zremrangebyrank",
    "zremrangebyscore",
    "zrevrange",
    "zrevrank",
    "zscore",
    "zunion",
];

// For internal use but maybe useful in rare cases or when the client command
// set is not 100% up to date with Redis' latest commands.
// client.sendCommand('GET', 'foo', function (err, value) {...});
//
// arguments[0]      = commandName
// arguments[1..N-2] = Redis command arguments
// arguments[N-1]    = callback function

Client.prototype.sendCommand = function () {
    var commandName = arguments[0].toLowerCase();

    // Invariant: number of queued callbacks == number of commands sent to
    // Redis whose replies have not yet been received and processed.  Thus,
    // if no callback was given, we create a dummy callback.

    var argCount = arguments.length;
    var callback = null;

    if (typeof(arguments[argCount - 1]) == 'function') {
        callback = arguments[argCount - 1];
        --argCount;
    } else {
        callback = function () {};
    }

    callback.commandName = commandName;

    // All requests are formatted as multi-bulk.
    // The first line of a multi-bulk request is "*<number of parts to follow>\r\n".
    // Next is: "$<length of the command name>\r\n<command name>\r\n".

    var commandNameLength = commandName.length;
    var offset = 1 + argCount.toString().length + CRLF_LEN +
                 1 + commandNameLength.toString().length + CRLF_LEN +
                 commandNameLength + CRLF_LEN;

    // Then, each argument is serialized as:
    //   "$<length of arg>\r\n<arg>\r\n".  
    //
    // Note that we wish to be "binary safe" which means that an 
    // argument may be a String, Number, or even a Buffer.
    //
    // Any argument that is not a Buffer but responds to toString()
    // has its toString() method called.  Then the string rep is
    // written to the request/command buffer as UTF-8.

    for (var i=1; i < argCount; ++i) {
        offset += 1;     // '$'
        var arg = arguments[i];
        if (arg instanceof Buffer) {
            if (arg.length === 0) throw new Error("0-sized Buffer");
            offset += arg.length.toString().length + CRLF_LEN + arg.length + CRLF_LEN;
        } else if (typeof(arg.toString) === 'function') {
            var asString = arg.toString();
            if (asString.length === 0) throw new Error("0-sized arg");
            offset += asString.length.toString().length + CRLF_LEN + asString.length + CRLF_LEN;
        } else {
            throw new Error("Sorry, I have no idea what to do with arg at index " + i);
        }
    }

    // Now serialize the command into the request buffer.
    // We assume that Redis command names are encoded in ASCII.
    // FUTURE: would be good to use a free list of various fixed-sized buffers,
    //         get a free one in which our request will fit, and slice
    //         it in order to write, then put it back in the free list.
    //         at this time, I am not sure how much overhead there is to
    //         doing a little memory allocation per request.  probably not
    //         much.

    var requestBuffer = new Buffer(offset);

    offset = requestBuffer.asciiWrite('*' + argCount.toString() + CRLF +
                                      '$' + commandNameLength + CRLF +
                                      commandName + CRLF, 0);

    for (var i=1; i < argCount; ++i) {
        var arg = arguments[i];
        if (arg instanceof Buffer) {
            offset += requestBuffer.asciiWrite('$' + arg.length + CRLF, offset);
            offset += arg.copy(requestBuffer, offset, 0);
            offset += requestBuffer.asciiWrite(CRLF, offset);
        } else if (typeof(arg.toString) === 'function') {
            var asString = arg.toString();
            offset += requestBuffer.asciiWrite('$' + asString.length + CRLF, offset);
            offset += requestBuffer.binaryWrite(asString, offset);
            offset += requestBuffer.asciiWrite(CRLF, offset);
        }
    }

    // Store the callback and write the buffer to Redis.

    if (exports.debugMode) callback.commandName = commandName;
    this.callbacks.push(callback);
    this.stream.write(requestBuffer);

    if (exports.debugMode) 
        sys.debug("[SEND (" + offset + " bytes)] " + 
                  debugFilter(requestBuffer, requestBuffer.length));
};

commands.forEach(function (commandName) {
    Client.prototype[commandName] = function () {
        if (this.stream.readyState != "open") 
            throw new Error("Sorry, the command cannot be sent to Redis. " +
                            "The connection state is '" + 
                            this.stream.readyState + "'.");

        var args = Array.prototype.slice.call(arguments);
        args.unshift(commandName);
        this.sendCommand.apply(this, args);
    };
});

// Wraps 'subscribe' and 'psubscribe' methods to manage a single
// callback function per subscribed channel name/pattern.
//
// 'nameOrPattern' is a channel name like "hello" or a pattern like 
// "h*llo", "h?llo", or "h[ae]llo".
//
// 'callback' is a function that is called back with 2 args: 
// channel name/pattern and message payload.
//
// Note: You are not permitted to do anything but subscribe to 
// additional channels or unsubscribe from subscribed channels 
// when there are >= 1 subscriptions active.  Should you need to
// issue other commands, use a second client instance.

Client.prototype.subscribeTo = function (nameOrPattern, callback) {
    if (typeof(this.channelCallbacks[nameOrPattern]) === 'function')
        return;

    if (typeof(callback) !== 'function')
        throw new Error("requires a callback function");

    this.channelCallbacks[nameOrPattern] = callback;

    var method = nameOrPattern.match(/[\*\?\[]/) 
               ? "psubscribe" 
               : "subscribe";

    this[method](nameOrPattern);
};

Client.prototype.unsubscribeFrom = function (nameOrPattern) {
    if (typeof(this.channelCallbacks[nameOrPattern]) === 'undefined')
        return;

    delete this.channelCallbacks[nameOrPattern];

    var method = nameOrPattern.match(/[\*\?\[]/) 
               ? "punsubscribe" 
               : "unsubscribe";

    this[method](nameOrPattern);
};

// Multi-bulk replies return an array of other replies.  Perhaps all you care
// about is the representation of such buffers as UTF-8 encoded strings? Use
// this to convert each such Buffer to a (UTF-8 encoded) String in-place.

exports.convertMultiBulkBuffersToUTF8Strings = function (o) {
    if (o instanceof Array) {
        for (var i=0; i<o.length; ++i) 
            if (o[i] instanceof Buffer) 
                o[i] = o[i].utf8Slice(0, o[i].length);
    } else if (o instanceof Object) {
        var props = Object.getOwnPropertyNames(o);
        for (var i=0; i<props.length; ++i) 
            if (o[props[i]] instanceof Buffer) 
                o[props[i]] = o[props[i]].utf8Slice(0, o[props[i]].length);
    }
};
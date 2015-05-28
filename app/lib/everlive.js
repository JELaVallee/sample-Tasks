if (typeof define !== "undefined" && define.amd) { define(function () { return Everlive; }); }(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){

},{}],2:[function(require,module,exports){
/*!
 * The buffer module from node.js, for the browser.
 *
 * @author   Feross Aboukhadijeh <feross@feross.org> <http://feross.org>
 * @license  MIT
 */

var base64 = require('base64-js')
var ieee754 = require('ieee754')
var isArray = require('is-array')

exports.Buffer = Buffer
exports.SlowBuffer = SlowBuffer
exports.INSPECT_MAX_BYTES = 50
Buffer.poolSize = 8192 // not used by this implementation

var kMaxLength = 0x3fffffff
var rootParent = {}

/**
 * If `Buffer.TYPED_ARRAY_SUPPORT`:
 *   === true    Use Uint8Array implementation (fastest)
 *   === false   Use Object implementation (most compatible, even IE6)
 *
 * Browsers that support typed arrays are IE 10+, Firefox 4+, Chrome 7+, Safari 5.1+,
 * Opera 11.6+, iOS 4.2+.
 *
 * Note:
 *
 * - Implementation must support adding new properties to `Uint8Array` instances.
 *   Firefox 4-29 lacked support, fixed in Firefox 30+.
 *   See: https://bugzilla.mozilla.org/show_bug.cgi?id=695438.
 *
 *  - Chrome 9-10 is missing the `TypedArray.prototype.subarray` function.
 *
 *  - IE10 has a broken `TypedArray.prototype.subarray` function which returns arrays of
 *    incorrect length in some situations.
 *
 * We detect these buggy browsers and set `Buffer.TYPED_ARRAY_SUPPORT` to `false` so they will
 * get the Object implementation, which is slower but will work correctly.
 */
Buffer.TYPED_ARRAY_SUPPORT = (function () {
  try {
    var buf = new ArrayBuffer(0)
    var arr = new Uint8Array(buf)
    arr.foo = function () { return 42 }
    return arr.foo() === 42 && // typed array instances can be augmented
        typeof arr.subarray === 'function' && // chrome 9-10 lack `subarray`
        new Uint8Array(1).subarray(1, 1).byteLength === 0 // ie10 has broken `subarray`
  } catch (e) {
    return false
  }
})()

/**
 * Class: Buffer
 * =============
 *
 * The Buffer constructor returns instances of `Uint8Array` that are augmented
 * with function properties for all the node `Buffer` API functions. We use
 * `Uint8Array` so that square bracket notation works as expected -- it returns
 * a single octet.
 *
 * By augmenting the instances, we can avoid modifying the `Uint8Array`
 * prototype.
 */
function Buffer (subject, encoding) {
  var self = this
  if (!(self instanceof Buffer)) return new Buffer(subject, encoding)

  var type = typeof subject
  var length

  if (type === 'number') {
    length = +subject
  } else if (type === 'string') {
    length = Buffer.byteLength(subject, encoding)
  } else if (type === 'object' && subject !== null) {
    // assume object is array-like
    if (subject.type === 'Buffer' && isArray(subject.data)) subject = subject.data
    length = +subject.length
  } else {
    throw new TypeError('must start with number, buffer, array or string')
  }

  if (length > kMaxLength) {
    throw new RangeError('Attempt to allocate Buffer larger than maximum size: 0x' +
      kMaxLength.toString(16) + ' bytes')
  }

  if (length < 0) length = 0
  else length >>>= 0 // coerce to uint32

  if (Buffer.TYPED_ARRAY_SUPPORT) {
    // Preferred: Return an augmented `Uint8Array` instance for best performance
    self = Buffer._augment(new Uint8Array(length)) // eslint-disable-line consistent-this
  } else {
    // Fallback: Return THIS instance of Buffer (created by `new`)
    self.length = length
    self._isBuffer = true
  }

  var i
  if (Buffer.TYPED_ARRAY_SUPPORT && typeof subject.byteLength === 'number') {
    // Speed optimization -- use set if we're copying from a typed array
    self._set(subject)
  } else if (isArrayish(subject)) {
    // Treat array-ish objects as a byte array
    if (Buffer.isBuffer(subject)) {
      for (i = 0; i < length; i++) {
        self[i] = subject.readUInt8(i)
      }
    } else {
      for (i = 0; i < length; i++) {
        self[i] = ((subject[i] % 256) + 256) % 256
      }
    }
  } else if (type === 'string') {
    self.write(subject, 0, encoding)
  } else if (type === 'number' && !Buffer.TYPED_ARRAY_SUPPORT) {
    for (i = 0; i < length; i++) {
      self[i] = 0
    }
  }

  if (length > 0 && length <= Buffer.poolSize) self.parent = rootParent

  return self
}

function SlowBuffer (subject, encoding) {
  if (!(this instanceof SlowBuffer)) return new SlowBuffer(subject, encoding)

  var buf = new Buffer(subject, encoding)
  delete buf.parent
  return buf
}

Buffer.isBuffer = function isBuffer (b) {
  return !!(b != null && b._isBuffer)
}

Buffer.compare = function compare (a, b) {
  if (!Buffer.isBuffer(a) || !Buffer.isBuffer(b)) {
    throw new TypeError('Arguments must be Buffers')
  }

  if (a === b) return 0

  var x = a.length
  var y = b.length
  for (var i = 0, len = Math.min(x, y); i < len && a[i] === b[i]; i++) {}
  if (i !== len) {
    x = a[i]
    y = b[i]
  }
  if (x < y) return -1
  if (y < x) return 1
  return 0
}

Buffer.isEncoding = function isEncoding (encoding) {
  switch (String(encoding).toLowerCase()) {
    case 'hex':
    case 'utf8':
    case 'utf-8':
    case 'ascii':
    case 'binary':
    case 'base64':
    case 'raw':
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      return true
    default:
      return false
  }
}

Buffer.concat = function concat (list, totalLength) {
  if (!isArray(list)) throw new TypeError('list argument must be an Array of Buffers.')

  if (list.length === 0) {
    return new Buffer(0)
  } else if (list.length === 1) {
    return list[0]
  }

  var i
  if (totalLength === undefined) {
    totalLength = 0
    for (i = 0; i < list.length; i++) {
      totalLength += list[i].length
    }
  }

  var buf = new Buffer(totalLength)
  var pos = 0
  for (i = 0; i < list.length; i++) {
    var item = list[i]
    item.copy(buf, pos)
    pos += item.length
  }
  return buf
}

Buffer.byteLength = function byteLength (str, encoding) {
  var ret
  str = str + ''
  switch (encoding || 'utf8') {
    case 'ascii':
    case 'binary':
    case 'raw':
      ret = str.length
      break
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      ret = str.length * 2
      break
    case 'hex':
      ret = str.length >>> 1
      break
    case 'utf8':
    case 'utf-8':
      ret = utf8ToBytes(str).length
      break
    case 'base64':
      ret = base64ToBytes(str).length
      break
    default:
      ret = str.length
  }
  return ret
}

// pre-set for values that may exist in the future
Buffer.prototype.length = undefined
Buffer.prototype.parent = undefined

// toString(encoding, start=0, end=buffer.length)
Buffer.prototype.toString = function toString (encoding, start, end) {
  var loweredCase = false

  start = start >>> 0
  end = end === undefined || end === Infinity ? this.length : end >>> 0

  if (!encoding) encoding = 'utf8'
  if (start < 0) start = 0
  if (end > this.length) end = this.length
  if (end <= start) return ''

  while (true) {
    switch (encoding) {
      case 'hex':
        return hexSlice(this, start, end)

      case 'utf8':
      case 'utf-8':
        return utf8Slice(this, start, end)

      case 'ascii':
        return asciiSlice(this, start, end)

      case 'binary':
        return binarySlice(this, start, end)

      case 'base64':
        return base64Slice(this, start, end)

      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return utf16leSlice(this, start, end)

      default:
        if (loweredCase) throw new TypeError('Unknown encoding: ' + encoding)
        encoding = (encoding + '').toLowerCase()
        loweredCase = true
    }
  }
}

Buffer.prototype.equals = function equals (b) {
  if (!Buffer.isBuffer(b)) throw new TypeError('Argument must be a Buffer')
  if (this === b) return true
  return Buffer.compare(this, b) === 0
}

Buffer.prototype.inspect = function inspect () {
  var str = ''
  var max = exports.INSPECT_MAX_BYTES
  if (this.length > 0) {
    str = this.toString('hex', 0, max).match(/.{2}/g).join(' ')
    if (this.length > max) str += ' ... '
  }
  return '<Buffer ' + str + '>'
}

Buffer.prototype.compare = function compare (b) {
  if (!Buffer.isBuffer(b)) throw new TypeError('Argument must be a Buffer')
  if (this === b) return 0
  return Buffer.compare(this, b)
}

Buffer.prototype.indexOf = function indexOf (val, byteOffset) {
  if (byteOffset > 0x7fffffff) byteOffset = 0x7fffffff
  else if (byteOffset < -0x80000000) byteOffset = -0x80000000
  byteOffset >>= 0

  if (this.length === 0) return -1
  if (byteOffset >= this.length) return -1

  // Negative offsets start from the end of the buffer
  if (byteOffset < 0) byteOffset = Math.max(this.length + byteOffset, 0)

  if (typeof val === 'string') {
    if (val.length === 0) return -1 // special case: looking for empty string always fails
    return String.prototype.indexOf.call(this, val, byteOffset)
  }
  if (Buffer.isBuffer(val)) {
    return arrayIndexOf(this, val, byteOffset)
  }
  if (typeof val === 'number') {
    if (Buffer.TYPED_ARRAY_SUPPORT && Uint8Array.prototype.indexOf === 'function') {
      return Uint8Array.prototype.indexOf.call(this, val, byteOffset)
    }
    return arrayIndexOf(this, [ val ], byteOffset)
  }

  function arrayIndexOf (arr, val, byteOffset) {
    var foundIndex = -1
    for (var i = 0; byteOffset + i < arr.length; i++) {
      if (arr[byteOffset + i] === val[foundIndex === -1 ? 0 : i - foundIndex]) {
        if (foundIndex === -1) foundIndex = i
        if (i - foundIndex + 1 === val.length) return byteOffset + foundIndex
      } else {
        foundIndex = -1
      }
    }
    return -1
  }

  throw new TypeError('val must be string, number or Buffer')
}

// `get` will be removed in Node 0.13+
Buffer.prototype.get = function get (offset) {
  console.log('.get() is deprecated. Access using array indexes instead.')
  return this.readUInt8(offset)
}

// `set` will be removed in Node 0.13+
Buffer.prototype.set = function set (v, offset) {
  console.log('.set() is deprecated. Access using array indexes instead.')
  return this.writeUInt8(v, offset)
}

function hexWrite (buf, string, offset, length) {
  offset = Number(offset) || 0
  var remaining = buf.length - offset
  if (!length) {
    length = remaining
  } else {
    length = Number(length)
    if (length > remaining) {
      length = remaining
    }
  }

  // must be an even number of digits
  var strLen = string.length
  if (strLen % 2 !== 0) throw new Error('Invalid hex string')

  if (length > strLen / 2) {
    length = strLen / 2
  }
  for (var i = 0; i < length; i++) {
    var parsed = parseInt(string.substr(i * 2, 2), 16)
    if (isNaN(parsed)) throw new Error('Invalid hex string')
    buf[offset + i] = parsed
  }
  return i
}

function utf8Write (buf, string, offset, length) {
  var charsWritten = blitBuffer(utf8ToBytes(string, buf.length - offset), buf, offset, length)
  return charsWritten
}

function asciiWrite (buf, string, offset, length) {
  var charsWritten = blitBuffer(asciiToBytes(string), buf, offset, length)
  return charsWritten
}

function binaryWrite (buf, string, offset, length) {
  return asciiWrite(buf, string, offset, length)
}

function base64Write (buf, string, offset, length) {
  var charsWritten = blitBuffer(base64ToBytes(string), buf, offset, length)
  return charsWritten
}

function utf16leWrite (buf, string, offset, length) {
  var charsWritten = blitBuffer(utf16leToBytes(string, buf.length - offset), buf, offset, length)
  return charsWritten
}

Buffer.prototype.write = function write (string, offset, length, encoding) {
  // Support both (string, offset, length, encoding)
  // and the legacy (string, encoding, offset, length)
  if (isFinite(offset)) {
    if (!isFinite(length)) {
      encoding = length
      length = undefined
    }
  } else {  // legacy
    var swap = encoding
    encoding = offset
    offset = length
    length = swap
  }

  offset = Number(offset) || 0

  if (length < 0 || offset < 0 || offset > this.length) {
    throw new RangeError('attempt to write outside buffer bounds')
  }

  var remaining = this.length - offset
  if (!length) {
    length = remaining
  } else {
    length = Number(length)
    if (length > remaining) {
      length = remaining
    }
  }
  encoding = String(encoding || 'utf8').toLowerCase()

  var ret
  switch (encoding) {
    case 'hex':
      ret = hexWrite(this, string, offset, length)
      break
    case 'utf8':
    case 'utf-8':
      ret = utf8Write(this, string, offset, length)
      break
    case 'ascii':
      ret = asciiWrite(this, string, offset, length)
      break
    case 'binary':
      ret = binaryWrite(this, string, offset, length)
      break
    case 'base64':
      ret = base64Write(this, string, offset, length)
      break
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      ret = utf16leWrite(this, string, offset, length)
      break
    default:
      throw new TypeError('Unknown encoding: ' + encoding)
  }
  return ret
}

Buffer.prototype.toJSON = function toJSON () {
  return {
    type: 'Buffer',
    data: Array.prototype.slice.call(this._arr || this, 0)
  }
}

function base64Slice (buf, start, end) {
  if (start === 0 && end === buf.length) {
    return base64.fromByteArray(buf)
  } else {
    return base64.fromByteArray(buf.slice(start, end))
  }
}

function utf8Slice (buf, start, end) {
  var res = ''
  var tmp = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; i++) {
    if (buf[i] <= 0x7F) {
      res += decodeUtf8Char(tmp) + String.fromCharCode(buf[i])
      tmp = ''
    } else {
      tmp += '%' + buf[i].toString(16)
    }
  }

  return res + decodeUtf8Char(tmp)
}

function asciiSlice (buf, start, end) {
  var ret = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; i++) {
    ret += String.fromCharCode(buf[i] & 0x7F)
  }
  return ret
}

function binarySlice (buf, start, end) {
  var ret = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; i++) {
    ret += String.fromCharCode(buf[i])
  }
  return ret
}

function hexSlice (buf, start, end) {
  var len = buf.length

  if (!start || start < 0) start = 0
  if (!end || end < 0 || end > len) end = len

  var out = ''
  for (var i = start; i < end; i++) {
    out += toHex(buf[i])
  }
  return out
}

function utf16leSlice (buf, start, end) {
  var bytes = buf.slice(start, end)
  var res = ''
  for (var i = 0; i < bytes.length; i += 2) {
    res += String.fromCharCode(bytes[i] + bytes[i + 1] * 256)
  }
  return res
}

Buffer.prototype.slice = function slice (start, end) {
  var len = this.length
  start = ~~start
  end = end === undefined ? len : ~~end

  if (start < 0) {
    start += len
    if (start < 0) start = 0
  } else if (start > len) {
    start = len
  }

  if (end < 0) {
    end += len
    if (end < 0) end = 0
  } else if (end > len) {
    end = len
  }

  if (end < start) end = start

  var newBuf
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    newBuf = Buffer._augment(this.subarray(start, end))
  } else {
    var sliceLen = end - start
    newBuf = new Buffer(sliceLen, undefined)
    for (var i = 0; i < sliceLen; i++) {
      newBuf[i] = this[i + start]
    }
  }

  if (newBuf.length) newBuf.parent = this.parent || this

  return newBuf
}

/*
 * Need to make sure that buffer isn't trying to write out of bounds.
 */
function checkOffset (offset, ext, length) {
  if ((offset % 1) !== 0 || offset < 0) throw new RangeError('offset is not uint')
  if (offset + ext > length) throw new RangeError('Trying to access beyond buffer length')
}

Buffer.prototype.readUIntLE = function readUIntLE (offset, byteLength, noAssert) {
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var val = this[offset]
  var mul = 1
  var i = 0
  while (++i < byteLength && (mul *= 0x100)) {
    val += this[offset + i] * mul
  }

  return val
}

Buffer.prototype.readUIntBE = function readUIntBE (offset, byteLength, noAssert) {
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert) {
    checkOffset(offset, byteLength, this.length)
  }

  var val = this[offset + --byteLength]
  var mul = 1
  while (byteLength > 0 && (mul *= 0x100)) {
    val += this[offset + --byteLength] * mul
  }

  return val
}

Buffer.prototype.readUInt8 = function readUInt8 (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 1, this.length)
  return this[offset]
}

Buffer.prototype.readUInt16LE = function readUInt16LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length)
  return this[offset] | (this[offset + 1] << 8)
}

Buffer.prototype.readUInt16BE = function readUInt16BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length)
  return (this[offset] << 8) | this[offset + 1]
}

Buffer.prototype.readUInt32LE = function readUInt32LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)

  return ((this[offset]) |
      (this[offset + 1] << 8) |
      (this[offset + 2] << 16)) +
      (this[offset + 3] * 0x1000000)
}

Buffer.prototype.readUInt32BE = function readUInt32BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset] * 0x1000000) +
    ((this[offset + 1] << 16) |
    (this[offset + 2] << 8) |
    this[offset + 3])
}

Buffer.prototype.readIntLE = function readIntLE (offset, byteLength, noAssert) {
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var val = this[offset]
  var mul = 1
  var i = 0
  while (++i < byteLength && (mul *= 0x100)) {
    val += this[offset + i] * mul
  }
  mul *= 0x80

  if (val >= mul) val -= Math.pow(2, 8 * byteLength)

  return val
}

Buffer.prototype.readIntBE = function readIntBE (offset, byteLength, noAssert) {
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var i = byteLength
  var mul = 1
  var val = this[offset + --i]
  while (i > 0 && (mul *= 0x100)) {
    val += this[offset + --i] * mul
  }
  mul *= 0x80

  if (val >= mul) val -= Math.pow(2, 8 * byteLength)

  return val
}

Buffer.prototype.readInt8 = function readInt8 (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 1, this.length)
  if (!(this[offset] & 0x80)) return (this[offset])
  return ((0xff - this[offset] + 1) * -1)
}

Buffer.prototype.readInt16LE = function readInt16LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length)
  var val = this[offset] | (this[offset + 1] << 8)
  return (val & 0x8000) ? val | 0xFFFF0000 : val
}

Buffer.prototype.readInt16BE = function readInt16BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length)
  var val = this[offset + 1] | (this[offset] << 8)
  return (val & 0x8000) ? val | 0xFFFF0000 : val
}

Buffer.prototype.readInt32LE = function readInt32LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset]) |
    (this[offset + 1] << 8) |
    (this[offset + 2] << 16) |
    (this[offset + 3] << 24)
}

Buffer.prototype.readInt32BE = function readInt32BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset] << 24) |
    (this[offset + 1] << 16) |
    (this[offset + 2] << 8) |
    (this[offset + 3])
}

Buffer.prototype.readFloatLE = function readFloatLE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)
  return ieee754.read(this, offset, true, 23, 4)
}

Buffer.prototype.readFloatBE = function readFloatBE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)
  return ieee754.read(this, offset, false, 23, 4)
}

Buffer.prototype.readDoubleLE = function readDoubleLE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 8, this.length)
  return ieee754.read(this, offset, true, 52, 8)
}

Buffer.prototype.readDoubleBE = function readDoubleBE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 8, this.length)
  return ieee754.read(this, offset, false, 52, 8)
}

function checkInt (buf, value, offset, ext, max, min) {
  if (!Buffer.isBuffer(buf)) throw new TypeError('buffer must be a Buffer instance')
  if (value > max || value < min) throw new RangeError('value is out of bounds')
  if (offset + ext > buf.length) throw new RangeError('index out of range')
}

Buffer.prototype.writeUIntLE = function writeUIntLE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert) checkInt(this, value, offset, byteLength, Math.pow(2, 8 * byteLength), 0)

  var mul = 1
  var i = 0
  this[offset] = value & 0xFF
  while (++i < byteLength && (mul *= 0x100)) {
    this[offset + i] = (value / mul) >>> 0 & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeUIntBE = function writeUIntBE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert) checkInt(this, value, offset, byteLength, Math.pow(2, 8 * byteLength), 0)

  var i = byteLength - 1
  var mul = 1
  this[offset + i] = value & 0xFF
  while (--i >= 0 && (mul *= 0x100)) {
    this[offset + i] = (value / mul) >>> 0 & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeUInt8 = function writeUInt8 (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 1, 0xff, 0)
  if (!Buffer.TYPED_ARRAY_SUPPORT) value = Math.floor(value)
  this[offset] = value
  return offset + 1
}

function objectWriteUInt16 (buf, value, offset, littleEndian) {
  if (value < 0) value = 0xffff + value + 1
  for (var i = 0, j = Math.min(buf.length - offset, 2); i < j; i++) {
    buf[offset + i] = (value & (0xff << (8 * (littleEndian ? i : 1 - i)))) >>>
      (littleEndian ? i : 1 - i) * 8
  }
}

Buffer.prototype.writeUInt16LE = function writeUInt16LE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 2, 0xffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = value
    this[offset + 1] = (value >>> 8)
  } else {
    objectWriteUInt16(this, value, offset, true)
  }
  return offset + 2
}

Buffer.prototype.writeUInt16BE = function writeUInt16BE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 2, 0xffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 8)
    this[offset + 1] = value
  } else {
    objectWriteUInt16(this, value, offset, false)
  }
  return offset + 2
}

function objectWriteUInt32 (buf, value, offset, littleEndian) {
  if (value < 0) value = 0xffffffff + value + 1
  for (var i = 0, j = Math.min(buf.length - offset, 4); i < j; i++) {
    buf[offset + i] = (value >>> (littleEndian ? i : 3 - i) * 8) & 0xff
  }
}

Buffer.prototype.writeUInt32LE = function writeUInt32LE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 4, 0xffffffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset + 3] = (value >>> 24)
    this[offset + 2] = (value >>> 16)
    this[offset + 1] = (value >>> 8)
    this[offset] = value
  } else {
    objectWriteUInt32(this, value, offset, true)
  }
  return offset + 4
}

Buffer.prototype.writeUInt32BE = function writeUInt32BE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 4, 0xffffffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 24)
    this[offset + 1] = (value >>> 16)
    this[offset + 2] = (value >>> 8)
    this[offset + 3] = value
  } else {
    objectWriteUInt32(this, value, offset, false)
  }
  return offset + 4
}

Buffer.prototype.writeIntLE = function writeIntLE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) {
    checkInt(
      this, value, offset, byteLength,
      Math.pow(2, 8 * byteLength - 1) - 1,
      -Math.pow(2, 8 * byteLength - 1)
    )
  }

  var i = 0
  var mul = 1
  var sub = value < 0 ? 1 : 0
  this[offset] = value & 0xFF
  while (++i < byteLength && (mul *= 0x100)) {
    this[offset + i] = ((value / mul) >> 0) - sub & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeIntBE = function writeIntBE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) {
    checkInt(
      this, value, offset, byteLength,
      Math.pow(2, 8 * byteLength - 1) - 1,
      -Math.pow(2, 8 * byteLength - 1)
    )
  }

  var i = byteLength - 1
  var mul = 1
  var sub = value < 0 ? 1 : 0
  this[offset + i] = value & 0xFF
  while (--i >= 0 && (mul *= 0x100)) {
    this[offset + i] = ((value / mul) >> 0) - sub & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeInt8 = function writeInt8 (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 1, 0x7f, -0x80)
  if (!Buffer.TYPED_ARRAY_SUPPORT) value = Math.floor(value)
  if (value < 0) value = 0xff + value + 1
  this[offset] = value
  return offset + 1
}

Buffer.prototype.writeInt16LE = function writeInt16LE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 2, 0x7fff, -0x8000)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = value
    this[offset + 1] = (value >>> 8)
  } else {
    objectWriteUInt16(this, value, offset, true)
  }
  return offset + 2
}

Buffer.prototype.writeInt16BE = function writeInt16BE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 2, 0x7fff, -0x8000)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 8)
    this[offset + 1] = value
  } else {
    objectWriteUInt16(this, value, offset, false)
  }
  return offset + 2
}

Buffer.prototype.writeInt32LE = function writeInt32LE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = value
    this[offset + 1] = (value >>> 8)
    this[offset + 2] = (value >>> 16)
    this[offset + 3] = (value >>> 24)
  } else {
    objectWriteUInt32(this, value, offset, true)
  }
  return offset + 4
}

Buffer.prototype.writeInt32BE = function writeInt32BE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000)
  if (value < 0) value = 0xffffffff + value + 1
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 24)
    this[offset + 1] = (value >>> 16)
    this[offset + 2] = (value >>> 8)
    this[offset + 3] = value
  } else {
    objectWriteUInt32(this, value, offset, false)
  }
  return offset + 4
}

function checkIEEE754 (buf, value, offset, ext, max, min) {
  if (value > max || value < min) throw new RangeError('value is out of bounds')
  if (offset + ext > buf.length) throw new RangeError('index out of range')
  if (offset < 0) throw new RangeError('index out of range')
}

function writeFloat (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    checkIEEE754(buf, value, offset, 4, 3.4028234663852886e+38, -3.4028234663852886e+38)
  }
  ieee754.write(buf, value, offset, littleEndian, 23, 4)
  return offset + 4
}

Buffer.prototype.writeFloatLE = function writeFloatLE (value, offset, noAssert) {
  return writeFloat(this, value, offset, true, noAssert)
}

Buffer.prototype.writeFloatBE = function writeFloatBE (value, offset, noAssert) {
  return writeFloat(this, value, offset, false, noAssert)
}

function writeDouble (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    checkIEEE754(buf, value, offset, 8, 1.7976931348623157E+308, -1.7976931348623157E+308)
  }
  ieee754.write(buf, value, offset, littleEndian, 52, 8)
  return offset + 8
}

Buffer.prototype.writeDoubleLE = function writeDoubleLE (value, offset, noAssert) {
  return writeDouble(this, value, offset, true, noAssert)
}

Buffer.prototype.writeDoubleBE = function writeDoubleBE (value, offset, noAssert) {
  return writeDouble(this, value, offset, false, noAssert)
}

// copy(targetBuffer, targetStart=0, sourceStart=0, sourceEnd=buffer.length)
Buffer.prototype.copy = function copy (target, target_start, start, end) {
  if (!start) start = 0
  if (!end && end !== 0) end = this.length
  if (target_start >= target.length) target_start = target.length
  if (!target_start) target_start = 0
  if (end > 0 && end < start) end = start

  // Copy 0 bytes; we're done
  if (end === start) return 0
  if (target.length === 0 || this.length === 0) return 0

  // Fatal error conditions
  if (target_start < 0) {
    throw new RangeError('targetStart out of bounds')
  }
  if (start < 0 || start >= this.length) throw new RangeError('sourceStart out of bounds')
  if (end < 0) throw new RangeError('sourceEnd out of bounds')

  // Are we oob?
  if (end > this.length) end = this.length
  if (target.length - target_start < end - start) {
    end = target.length - target_start + start
  }

  var len = end - start

  if (len < 1000 || !Buffer.TYPED_ARRAY_SUPPORT) {
    for (var i = 0; i < len; i++) {
      target[i + target_start] = this[i + start]
    }
  } else {
    target._set(this.subarray(start, start + len), target_start)
  }

  return len
}

// fill(value, start=0, end=buffer.length)
Buffer.prototype.fill = function fill (value, start, end) {
  if (!value) value = 0
  if (!start) start = 0
  if (!end) end = this.length

  if (end < start) throw new RangeError('end < start')

  // Fill 0 bytes; we're done
  if (end === start) return
  if (this.length === 0) return

  if (start < 0 || start >= this.length) throw new RangeError('start out of bounds')
  if (end < 0 || end > this.length) throw new RangeError('end out of bounds')

  var i
  if (typeof value === 'number') {
    for (i = start; i < end; i++) {
      this[i] = value
    }
  } else {
    var bytes = utf8ToBytes(value.toString())
    var len = bytes.length
    for (i = start; i < end; i++) {
      this[i] = bytes[i % len]
    }
  }

  return this
}

/**
 * Creates a new `ArrayBuffer` with the *copied* memory of the buffer instance.
 * Added in Node 0.12. Only available in browsers that support ArrayBuffer.
 */
Buffer.prototype.toArrayBuffer = function toArrayBuffer () {
  if (typeof Uint8Array !== 'undefined') {
    if (Buffer.TYPED_ARRAY_SUPPORT) {
      return (new Buffer(this)).buffer
    } else {
      var buf = new Uint8Array(this.length)
      for (var i = 0, len = buf.length; i < len; i += 1) {
        buf[i] = this[i]
      }
      return buf.buffer
    }
  } else {
    throw new TypeError('Buffer.toArrayBuffer not supported in this browser')
  }
}

// HELPER FUNCTIONS
// ================

var BP = Buffer.prototype

/**
 * Augment a Uint8Array *instance* (not the Uint8Array class!) with Buffer methods
 */
Buffer._augment = function _augment (arr) {
  arr.constructor = Buffer
  arr._isBuffer = true

  // save reference to original Uint8Array set method before overwriting
  arr._set = arr.set

  // deprecated, will be removed in node 0.13+
  arr.get = BP.get
  arr.set = BP.set

  arr.write = BP.write
  arr.toString = BP.toString
  arr.toLocaleString = BP.toString
  arr.toJSON = BP.toJSON
  arr.equals = BP.equals
  arr.compare = BP.compare
  arr.indexOf = BP.indexOf
  arr.copy = BP.copy
  arr.slice = BP.slice
  arr.readUIntLE = BP.readUIntLE
  arr.readUIntBE = BP.readUIntBE
  arr.readUInt8 = BP.readUInt8
  arr.readUInt16LE = BP.readUInt16LE
  arr.readUInt16BE = BP.readUInt16BE
  arr.readUInt32LE = BP.readUInt32LE
  arr.readUInt32BE = BP.readUInt32BE
  arr.readIntLE = BP.readIntLE
  arr.readIntBE = BP.readIntBE
  arr.readInt8 = BP.readInt8
  arr.readInt16LE = BP.readInt16LE
  arr.readInt16BE = BP.readInt16BE
  arr.readInt32LE = BP.readInt32LE
  arr.readInt32BE = BP.readInt32BE
  arr.readFloatLE = BP.readFloatLE
  arr.readFloatBE = BP.readFloatBE
  arr.readDoubleLE = BP.readDoubleLE
  arr.readDoubleBE = BP.readDoubleBE
  arr.writeUInt8 = BP.writeUInt8
  arr.writeUIntLE = BP.writeUIntLE
  arr.writeUIntBE = BP.writeUIntBE
  arr.writeUInt16LE = BP.writeUInt16LE
  arr.writeUInt16BE = BP.writeUInt16BE
  arr.writeUInt32LE = BP.writeUInt32LE
  arr.writeUInt32BE = BP.writeUInt32BE
  arr.writeIntLE = BP.writeIntLE
  arr.writeIntBE = BP.writeIntBE
  arr.writeInt8 = BP.writeInt8
  arr.writeInt16LE = BP.writeInt16LE
  arr.writeInt16BE = BP.writeInt16BE
  arr.writeInt32LE = BP.writeInt32LE
  arr.writeInt32BE = BP.writeInt32BE
  arr.writeFloatLE = BP.writeFloatLE
  arr.writeFloatBE = BP.writeFloatBE
  arr.writeDoubleLE = BP.writeDoubleLE
  arr.writeDoubleBE = BP.writeDoubleBE
  arr.fill = BP.fill
  arr.inspect = BP.inspect
  arr.toArrayBuffer = BP.toArrayBuffer

  return arr
}

var INVALID_BASE64_RE = /[^+\/0-9A-z\-]/g

function base64clean (str) {
  // Node strips out invalid characters like \n and \t from the string, base64-js does not
  str = stringtrim(str).replace(INVALID_BASE64_RE, '')
  // Node converts strings with length < 2 to ''
  if (str.length < 2) return ''
  // Node allows for non-padded base64 strings (missing trailing ===), base64-js does not
  while (str.length % 4 !== 0) {
    str = str + '='
  }
  return str
}

function stringtrim (str) {
  if (str.trim) return str.trim()
  return str.replace(/^\s+|\s+$/g, '')
}

function isArrayish (subject) {
  return isArray(subject) || Buffer.isBuffer(subject) ||
      subject && typeof subject === 'object' &&
      typeof subject.length === 'number'
}

function toHex (n) {
  if (n < 16) return '0' + n.toString(16)
  return n.toString(16)
}

function utf8ToBytes (string, units) {
  units = units || Infinity
  var codePoint
  var length = string.length
  var leadSurrogate = null
  var bytes = []
  var i = 0

  for (; i < length; i++) {
    codePoint = string.charCodeAt(i)

    // is surrogate component
    if (codePoint > 0xD7FF && codePoint < 0xE000) {
      // last char was a lead
      if (leadSurrogate) {
        // 2 leads in a row
        if (codePoint < 0xDC00) {
          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
          leadSurrogate = codePoint
          continue
        } else {
          // valid surrogate pair
          codePoint = leadSurrogate - 0xD800 << 10 | codePoint - 0xDC00 | 0x10000
          leadSurrogate = null
        }
      } else {
        // no lead yet

        if (codePoint > 0xDBFF) {
          // unexpected trail
          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
          continue
        } else if (i + 1 === length) {
          // unpaired lead
          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
          continue
        } else {
          // valid lead
          leadSurrogate = codePoint
          continue
        }
      }
    } else if (leadSurrogate) {
      // valid bmp char, but last char was a lead
      if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
      leadSurrogate = null
    }

    // encode utf8
    if (codePoint < 0x80) {
      if ((units -= 1) < 0) break
      bytes.push(codePoint)
    } else if (codePoint < 0x800) {
      if ((units -= 2) < 0) break
      bytes.push(
        codePoint >> 0x6 | 0xC0,
        codePoint & 0x3F | 0x80
      )
    } else if (codePoint < 0x10000) {
      if ((units -= 3) < 0) break
      bytes.push(
        codePoint >> 0xC | 0xE0,
        codePoint >> 0x6 & 0x3F | 0x80,
        codePoint & 0x3F | 0x80
      )
    } else if (codePoint < 0x200000) {
      if ((units -= 4) < 0) break
      bytes.push(
        codePoint >> 0x12 | 0xF0,
        codePoint >> 0xC & 0x3F | 0x80,
        codePoint >> 0x6 & 0x3F | 0x80,
        codePoint & 0x3F | 0x80
      )
    } else {
      throw new Error('Invalid code point')
    }
  }

  return bytes
}

function asciiToBytes (str) {
  var byteArray = []
  for (var i = 0; i < str.length; i++) {
    // Node's code seems to be doing this and not & 0x7F..
    byteArray.push(str.charCodeAt(i) & 0xFF)
  }
  return byteArray
}

function utf16leToBytes (str, units) {
  var c, hi, lo
  var byteArray = []
  for (var i = 0; i < str.length; i++) {
    if ((units -= 2) < 0) break

    c = str.charCodeAt(i)
    hi = c >> 8
    lo = c % 256
    byteArray.push(lo)
    byteArray.push(hi)
  }

  return byteArray
}

function base64ToBytes (str) {
  return base64.toByteArray(base64clean(str))
}

function blitBuffer (src, dst, offset, length) {
  for (var i = 0; i < length; i++) {
    if ((i + offset >= dst.length) || (i >= src.length)) break
    dst[i + offset] = src[i]
  }
  return i
}

function decodeUtf8Char (str) {
  try {
    return decodeURIComponent(str)
  } catch (err) {
    return String.fromCharCode(0xFFFD) // UTF 8 invalid char
  }
}

},{"base64-js":3,"ieee754":4,"is-array":5}],3:[function(require,module,exports){
var lookup = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

;(function (exports) {
	'use strict';

  var Arr = (typeof Uint8Array !== 'undefined')
    ? Uint8Array
    : Array

	var PLUS   = '+'.charCodeAt(0)
	var SLASH  = '/'.charCodeAt(0)
	var NUMBER = '0'.charCodeAt(0)
	var LOWER  = 'a'.charCodeAt(0)
	var UPPER  = 'A'.charCodeAt(0)
	var PLUS_URL_SAFE = '-'.charCodeAt(0)
	var SLASH_URL_SAFE = '_'.charCodeAt(0)

	function decode (elt) {
		var code = elt.charCodeAt(0)
		if (code === PLUS ||
		    code === PLUS_URL_SAFE)
			return 62 // '+'
		if (code === SLASH ||
		    code === SLASH_URL_SAFE)
			return 63 // '/'
		if (code < NUMBER)
			return -1 //no match
		if (code < NUMBER + 10)
			return code - NUMBER + 26 + 26
		if (code < UPPER + 26)
			return code - UPPER
		if (code < LOWER + 26)
			return code - LOWER + 26
	}

	function b64ToByteArray (b64) {
		var i, j, l, tmp, placeHolders, arr

		if (b64.length % 4 > 0) {
			throw new Error('Invalid string. Length must be a multiple of 4')
		}

		// the number of equal signs (place holders)
		// if there are two placeholders, than the two characters before it
		// represent one byte
		// if there is only one, then the three characters before it represent 2 bytes
		// this is just a cheap hack to not do indexOf twice
		var len = b64.length
		placeHolders = '=' === b64.charAt(len - 2) ? 2 : '=' === b64.charAt(len - 1) ? 1 : 0

		// base64 is 4/3 + up to two characters of the original data
		arr = new Arr(b64.length * 3 / 4 - placeHolders)

		// if there are placeholders, only get up to the last complete 4 chars
		l = placeHolders > 0 ? b64.length - 4 : b64.length

		var L = 0

		function push (v) {
			arr[L++] = v
		}

		for (i = 0, j = 0; i < l; i += 4, j += 3) {
			tmp = (decode(b64.charAt(i)) << 18) | (decode(b64.charAt(i + 1)) << 12) | (decode(b64.charAt(i + 2)) << 6) | decode(b64.charAt(i + 3))
			push((tmp & 0xFF0000) >> 16)
			push((tmp & 0xFF00) >> 8)
			push(tmp & 0xFF)
		}

		if (placeHolders === 2) {
			tmp = (decode(b64.charAt(i)) << 2) | (decode(b64.charAt(i + 1)) >> 4)
			push(tmp & 0xFF)
		} else if (placeHolders === 1) {
			tmp = (decode(b64.charAt(i)) << 10) | (decode(b64.charAt(i + 1)) << 4) | (decode(b64.charAt(i + 2)) >> 2)
			push((tmp >> 8) & 0xFF)
			push(tmp & 0xFF)
		}

		return arr
	}

	function uint8ToBase64 (uint8) {
		var i,
			extraBytes = uint8.length % 3, // if we have 1 byte left, pad 2 bytes
			output = "",
			temp, length

		function encode (num) {
			return lookup.charAt(num)
		}

		function tripletToBase64 (num) {
			return encode(num >> 18 & 0x3F) + encode(num >> 12 & 0x3F) + encode(num >> 6 & 0x3F) + encode(num & 0x3F)
		}

		// go through the array every three bytes, we'll deal with trailing stuff later
		for (i = 0, length = uint8.length - extraBytes; i < length; i += 3) {
			temp = (uint8[i] << 16) + (uint8[i + 1] << 8) + (uint8[i + 2])
			output += tripletToBase64(temp)
		}

		// pad the end with zeros, but make sure to not forget the extra bytes
		switch (extraBytes) {
			case 1:
				temp = uint8[uint8.length - 1]
				output += encode(temp >> 2)
				output += encode((temp << 4) & 0x3F)
				output += '=='
				break
			case 2:
				temp = (uint8[uint8.length - 2] << 8) + (uint8[uint8.length - 1])
				output += encode(temp >> 10)
				output += encode((temp >> 4) & 0x3F)
				output += encode((temp << 2) & 0x3F)
				output += '='
				break
		}

		return output
	}

	exports.toByteArray = b64ToByteArray
	exports.fromByteArray = uint8ToBase64
}(typeof exports === 'undefined' ? (this.base64js = {}) : exports))

},{}],4:[function(require,module,exports){
exports.read = function(buffer, offset, isLE, mLen, nBytes) {
  var e, m,
      eLen = nBytes * 8 - mLen - 1,
      eMax = (1 << eLen) - 1,
      eBias = eMax >> 1,
      nBits = -7,
      i = isLE ? (nBytes - 1) : 0,
      d = isLE ? -1 : 1,
      s = buffer[offset + i];

  i += d;

  e = s & ((1 << (-nBits)) - 1);
  s >>= (-nBits);
  nBits += eLen;
  for (; nBits > 0; e = e * 256 + buffer[offset + i], i += d, nBits -= 8);

  m = e & ((1 << (-nBits)) - 1);
  e >>= (-nBits);
  nBits += mLen;
  for (; nBits > 0; m = m * 256 + buffer[offset + i], i += d, nBits -= 8);

  if (e === 0) {
    e = 1 - eBias;
  } else if (e === eMax) {
    return m ? NaN : ((s ? -1 : 1) * Infinity);
  } else {
    m = m + Math.pow(2, mLen);
    e = e - eBias;
  }
  return (s ? -1 : 1) * m * Math.pow(2, e - mLen);
};

exports.write = function(buffer, value, offset, isLE, mLen, nBytes) {
  var e, m, c,
      eLen = nBytes * 8 - mLen - 1,
      eMax = (1 << eLen) - 1,
      eBias = eMax >> 1,
      rt = (mLen === 23 ? Math.pow(2, -24) - Math.pow(2, -77) : 0),
      i = isLE ? 0 : (nBytes - 1),
      d = isLE ? 1 : -1,
      s = value < 0 || (value === 0 && 1 / value < 0) ? 1 : 0;

  value = Math.abs(value);

  if (isNaN(value) || value === Infinity) {
    m = isNaN(value) ? 1 : 0;
    e = eMax;
  } else {
    e = Math.floor(Math.log(value) / Math.LN2);
    if (value * (c = Math.pow(2, -e)) < 1) {
      e--;
      c *= 2;
    }
    if (e + eBias >= 1) {
      value += rt / c;
    } else {
      value += rt * Math.pow(2, 1 - eBias);
    }
    if (value * c >= 2) {
      e++;
      c /= 2;
    }

    if (e + eBias >= eMax) {
      m = 0;
      e = eMax;
    } else if (e + eBias >= 1) {
      m = (value * c - 1) * Math.pow(2, mLen);
      e = e + eBias;
    } else {
      m = value * Math.pow(2, eBias - 1) * Math.pow(2, mLen);
      e = 0;
    }
  }

  for (; mLen >= 8; buffer[offset + i] = m & 0xff, i += d, m /= 256, mLen -= 8);

  e = (e << mLen) | m;
  eLen += mLen;
  for (; eLen > 0; buffer[offset + i] = e & 0xff, i += d, e /= 256, eLen -= 8);

  buffer[offset + i - d] |= s * 128;
};

},{}],5:[function(require,module,exports){

/**
 * isArray
 */

var isArray = Array.isArray;

/**
 * toString
 */

var str = Object.prototype.toString;

/**
 * Whether or not the given `val`
 * is an array.
 *
 * example:
 *
 *        isArray([]);
 *        // > true
 *        isArray(arguments);
 *        // > false
 *        isArray('');
 *        // > false
 *
 * @param {mixed} val
 * @return {bool}
 */

module.exports = isArray || function (val) {
  return !! val && '[object Array]' == str.call(val);
};

},{}],6:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

function EventEmitter() {
  this._events = this._events || {};
  this._maxListeners = this._maxListeners || undefined;
}
module.exports = EventEmitter;

// Backwards-compat with node 0.10.x
EventEmitter.EventEmitter = EventEmitter;

EventEmitter.prototype._events = undefined;
EventEmitter.prototype._maxListeners = undefined;

// By default EventEmitters will print a warning if more than 10 listeners are
// added to it. This is a useful default which helps finding memory leaks.
EventEmitter.defaultMaxListeners = 10;

// Obviously not all Emitters should be limited to 10. This function allows
// that to be increased. Set to zero for unlimited.
EventEmitter.prototype.setMaxListeners = function(n) {
  if (!isNumber(n) || n < 0 || isNaN(n))
    throw TypeError('n must be a positive number');
  this._maxListeners = n;
  return this;
};

EventEmitter.prototype.emit = function(type) {
  var er, handler, len, args, i, listeners;

  if (!this._events)
    this._events = {};

  // If there is no 'error' event listener then throw.
  if (type === 'error') {
    if (!this._events.error ||
        (isObject(this._events.error) && !this._events.error.length)) {
      er = arguments[1];
      if (er instanceof Error) {
        throw er; // Unhandled 'error' event
      }
      throw TypeError('Uncaught, unspecified "error" event.');
    }
  }

  handler = this._events[type];

  if (isUndefined(handler))
    return false;

  if (isFunction(handler)) {
    switch (arguments.length) {
      // fast cases
      case 1:
        handler.call(this);
        break;
      case 2:
        handler.call(this, arguments[1]);
        break;
      case 3:
        handler.call(this, arguments[1], arguments[2]);
        break;
      // slower
      default:
        len = arguments.length;
        args = new Array(len - 1);
        for (i = 1; i < len; i++)
          args[i - 1] = arguments[i];
        handler.apply(this, args);
    }
  } else if (isObject(handler)) {
    len = arguments.length;
    args = new Array(len - 1);
    for (i = 1; i < len; i++)
      args[i - 1] = arguments[i];

    listeners = handler.slice();
    len = listeners.length;
    for (i = 0; i < len; i++)
      listeners[i].apply(this, args);
  }

  return true;
};

EventEmitter.prototype.addListener = function(type, listener) {
  var m;

  if (!isFunction(listener))
    throw TypeError('listener must be a function');

  if (!this._events)
    this._events = {};

  // To avoid recursion in the case that type === "newListener"! Before
  // adding it to the listeners, first emit "newListener".
  if (this._events.newListener)
    this.emit('newListener', type,
              isFunction(listener.listener) ?
              listener.listener : listener);

  if (!this._events[type])
    // Optimize the case of one listener. Don't need the extra array object.
    this._events[type] = listener;
  else if (isObject(this._events[type]))
    // If we've already got an array, just append.
    this._events[type].push(listener);
  else
    // Adding the second element, need to change to array.
    this._events[type] = [this._events[type], listener];

  // Check for listener leak
  if (isObject(this._events[type]) && !this._events[type].warned) {
    var m;
    if (!isUndefined(this._maxListeners)) {
      m = this._maxListeners;
    } else {
      m = EventEmitter.defaultMaxListeners;
    }

    if (m && m > 0 && this._events[type].length > m) {
      this._events[type].warned = true;
      console.error('(node) warning: possible EventEmitter memory ' +
                    'leak detected. %d listeners added. ' +
                    'Use emitter.setMaxListeners() to increase limit.',
                    this._events[type].length);
      if (typeof console.trace === 'function') {
        // not supported in IE 10
        console.trace();
      }
    }
  }

  return this;
};

EventEmitter.prototype.on = EventEmitter.prototype.addListener;

EventEmitter.prototype.once = function(type, listener) {
  if (!isFunction(listener))
    throw TypeError('listener must be a function');

  var fired = false;

  function g() {
    this.removeListener(type, g);

    if (!fired) {
      fired = true;
      listener.apply(this, arguments);
    }
  }

  g.listener = listener;
  this.on(type, g);

  return this;
};

// emits a 'removeListener' event iff the listener was removed
EventEmitter.prototype.removeListener = function(type, listener) {
  var list, position, length, i;

  if (!isFunction(listener))
    throw TypeError('listener must be a function');

  if (!this._events || !this._events[type])
    return this;

  list = this._events[type];
  length = list.length;
  position = -1;

  if (list === listener ||
      (isFunction(list.listener) && list.listener === listener)) {
    delete this._events[type];
    if (this._events.removeListener)
      this.emit('removeListener', type, listener);

  } else if (isObject(list)) {
    for (i = length; i-- > 0;) {
      if (list[i] === listener ||
          (list[i].listener && list[i].listener === listener)) {
        position = i;
        break;
      }
    }

    if (position < 0)
      return this;

    if (list.length === 1) {
      list.length = 0;
      delete this._events[type];
    } else {
      list.splice(position, 1);
    }

    if (this._events.removeListener)
      this.emit('removeListener', type, listener);
  }

  return this;
};

EventEmitter.prototype.removeAllListeners = function(type) {
  var key, listeners;

  if (!this._events)
    return this;

  // not listening for removeListener, no need to emit
  if (!this._events.removeListener) {
    if (arguments.length === 0)
      this._events = {};
    else if (this._events[type])
      delete this._events[type];
    return this;
  }

  // emit removeListener for all listeners on all events
  if (arguments.length === 0) {
    for (key in this._events) {
      if (key === 'removeListener') continue;
      this.removeAllListeners(key);
    }
    this.removeAllListeners('removeListener');
    this._events = {};
    return this;
  }

  listeners = this._events[type];

  if (isFunction(listeners)) {
    this.removeListener(type, listeners);
  } else {
    // LIFO order
    while (listeners.length)
      this.removeListener(type, listeners[listeners.length - 1]);
  }
  delete this._events[type];

  return this;
};

EventEmitter.prototype.listeners = function(type) {
  var ret;
  if (!this._events || !this._events[type])
    ret = [];
  else if (isFunction(this._events[type]))
    ret = [this._events[type]];
  else
    ret = this._events[type].slice();
  return ret;
};

EventEmitter.listenerCount = function(emitter, type) {
  var ret;
  if (!emitter._events || !emitter._events[type])
    ret = 0;
  else if (isFunction(emitter._events[type]))
    ret = 1;
  else
    ret = emitter._events[type].length;
  return ret;
};

function isFunction(arg) {
  return typeof arg === 'function';
}

function isNumber(arg) {
  return typeof arg === 'number';
}

function isObject(arg) {
  return typeof arg === 'object' && arg !== null;
}

function isUndefined(arg) {
  return arg === void 0;
}

},{}],7:[function(require,module,exports){
if (typeof Object.create === 'function') {
  // implementation from standard node.js 'util' module
  module.exports = function inherits(ctor, superCtor) {
    ctor.super_ = superCtor
    ctor.prototype = Object.create(superCtor.prototype, {
      constructor: {
        value: ctor,
        enumerable: false,
        writable: true,
        configurable: true
      }
    });
  };
} else {
  // old school shim for old browsers
  module.exports = function inherits(ctor, superCtor) {
    ctor.super_ = superCtor
    var TempCtor = function () {}
    TempCtor.prototype = superCtor.prototype
    ctor.prototype = new TempCtor()
    ctor.prototype.constructor = ctor
  }
}

},{}],8:[function(require,module,exports){
module.exports = Array.isArray || function (arr) {
  return Object.prototype.toString.call(arr) == '[object Array]';
};

},{}],9:[function(require,module,exports){
// shim for using process in browser

var process = module.exports = {};
var queue = [];
var draining = false;

function drainQueue() {
    if (draining) {
        return;
    }
    draining = true;
    var currentQueue;
    var len = queue.length;
    while(len) {
        currentQueue = queue;
        queue = [];
        var i = -1;
        while (++i < len) {
            currentQueue[i]();
        }
        len = queue.length;
    }
    draining = false;
}
process.nextTick = function (fun) {
    queue.push(fun);
    if (!draining) {
        setTimeout(drainQueue, 0);
    }
};

process.title = 'browser';
process.browser = true;
process.env = {};
process.argv = [];
process.version = ''; // empty string to avoid regexp issues
process.versions = {};

function noop() {}

process.on = noop;
process.addListener = noop;
process.once = noop;
process.off = noop;
process.removeListener = noop;
process.removeAllListeners = noop;
process.emit = noop;

process.binding = function (name) {
    throw new Error('process.binding is not supported');
};

// TODO(shtylman)
process.cwd = function () { return '/' };
process.chdir = function (dir) {
    throw new Error('process.chdir is not supported');
};
process.umask = function() { return 0; };

},{}],10:[function(require,module,exports){
module.exports = require("./lib/_stream_duplex.js")

},{"./lib/_stream_duplex.js":11}],11:[function(require,module,exports){
(function (process){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

// a duplex stream is just a stream that is both readable and writable.
// Since JS doesn't have multiple prototypal inheritance, this class
// prototypally inherits from Readable, and then parasitically from
// Writable.

module.exports = Duplex;

/*<replacement>*/
var objectKeys = Object.keys || function (obj) {
  var keys = [];
  for (var key in obj) keys.push(key);
  return keys;
}
/*</replacement>*/


/*<replacement>*/
var util = require('core-util-is');
util.inherits = require('inherits');
/*</replacement>*/

var Readable = require('./_stream_readable');
var Writable = require('./_stream_writable');

util.inherits(Duplex, Readable);

forEach(objectKeys(Writable.prototype), function(method) {
  if (!Duplex.prototype[method])
    Duplex.prototype[method] = Writable.prototype[method];
});

function Duplex(options) {
  if (!(this instanceof Duplex))
    return new Duplex(options);

  Readable.call(this, options);
  Writable.call(this, options);

  if (options && options.readable === false)
    this.readable = false;

  if (options && options.writable === false)
    this.writable = false;

  this.allowHalfOpen = true;
  if (options && options.allowHalfOpen === false)
    this.allowHalfOpen = false;

  this.once('end', onend);
}

// the no-half-open enforcer
function onend() {
  // if we allow half-open state, or if the writable side ended,
  // then we're ok.
  if (this.allowHalfOpen || this._writableState.ended)
    return;

  // no more data can be written.
  // But allow more writes to happen in this tick.
  process.nextTick(this.end.bind(this));
}

function forEach (xs, f) {
  for (var i = 0, l = xs.length; i < l; i++) {
    f(xs[i], i);
  }
}

}).call(this,require('_process'))

},{"./_stream_readable":13,"./_stream_writable":15,"_process":9,"core-util-is":16,"inherits":7}],12:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

// a passthrough stream.
// basically just the most minimal sort of Transform stream.
// Every written chunk gets output as-is.

module.exports = PassThrough;

var Transform = require('./_stream_transform');

/*<replacement>*/
var util = require('core-util-is');
util.inherits = require('inherits');
/*</replacement>*/

util.inherits(PassThrough, Transform);

function PassThrough(options) {
  if (!(this instanceof PassThrough))
    return new PassThrough(options);

  Transform.call(this, options);
}

PassThrough.prototype._transform = function(chunk, encoding, cb) {
  cb(null, chunk);
};

},{"./_stream_transform":14,"core-util-is":16,"inherits":7}],13:[function(require,module,exports){
(function (process){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

module.exports = Readable;

/*<replacement>*/
var isArray = require('isarray');
/*</replacement>*/


/*<replacement>*/
var Buffer = require('buffer').Buffer;
/*</replacement>*/

Readable.ReadableState = ReadableState;

var EE = require('events').EventEmitter;

/*<replacement>*/
if (!EE.listenerCount) EE.listenerCount = function(emitter, type) {
  return emitter.listeners(type).length;
};
/*</replacement>*/

var Stream = require('stream');

/*<replacement>*/
var util = require('core-util-is');
util.inherits = require('inherits');
/*</replacement>*/

var StringDecoder;


/*<replacement>*/
var debug = require('util');
if (debug && debug.debuglog) {
  debug = debug.debuglog('stream');
} else {
  debug = function () {};
}
/*</replacement>*/


util.inherits(Readable, Stream);

function ReadableState(options, stream) {
  var Duplex = require('./_stream_duplex');

  options = options || {};

  // the point at which it stops calling _read() to fill the buffer
  // Note: 0 is a valid value, means "don't call _read preemptively ever"
  var hwm = options.highWaterMark;
  var defaultHwm = options.objectMode ? 16 : 16 * 1024;
  this.highWaterMark = (hwm || hwm === 0) ? hwm : defaultHwm;

  // cast to ints.
  this.highWaterMark = ~~this.highWaterMark;

  this.buffer = [];
  this.length = 0;
  this.pipes = null;
  this.pipesCount = 0;
  this.flowing = null;
  this.ended = false;
  this.endEmitted = false;
  this.reading = false;

  // a flag to be able to tell if the onwrite cb is called immediately,
  // or on a later tick.  We set this to true at first, because any
  // actions that shouldn't happen until "later" should generally also
  // not happen before the first write call.
  this.sync = true;

  // whenever we return null, then we set a flag to say
  // that we're awaiting a 'readable' event emission.
  this.needReadable = false;
  this.emittedReadable = false;
  this.readableListening = false;


  // object stream flag. Used to make read(n) ignore n and to
  // make all the buffer merging and length checks go away
  this.objectMode = !!options.objectMode;

  if (stream instanceof Duplex)
    this.objectMode = this.objectMode || !!options.readableObjectMode;

  // Crypto is kind of old and crusty.  Historically, its default string
  // encoding is 'binary' so we have to make this configurable.
  // Everything else in the universe uses 'utf8', though.
  this.defaultEncoding = options.defaultEncoding || 'utf8';

  // when piping, we only care about 'readable' events that happen
  // after read()ing all the bytes and not getting any pushback.
  this.ranOut = false;

  // the number of writers that are awaiting a drain event in .pipe()s
  this.awaitDrain = 0;

  // if true, a maybeReadMore has been scheduled
  this.readingMore = false;

  this.decoder = null;
  this.encoding = null;
  if (options.encoding) {
    if (!StringDecoder)
      StringDecoder = require('string_decoder/').StringDecoder;
    this.decoder = new StringDecoder(options.encoding);
    this.encoding = options.encoding;
  }
}

function Readable(options) {
  var Duplex = require('./_stream_duplex');

  if (!(this instanceof Readable))
    return new Readable(options);

  this._readableState = new ReadableState(options, this);

  // legacy
  this.readable = true;

  Stream.call(this);
}

// Manually shove something into the read() buffer.
// This returns true if the highWaterMark has not been hit yet,
// similar to how Writable.write() returns true if you should
// write() some more.
Readable.prototype.push = function(chunk, encoding) {
  var state = this._readableState;

  if (util.isString(chunk) && !state.objectMode) {
    encoding = encoding || state.defaultEncoding;
    if (encoding !== state.encoding) {
      chunk = new Buffer(chunk, encoding);
      encoding = '';
    }
  }

  return readableAddChunk(this, state, chunk, encoding, false);
};

// Unshift should *always* be something directly out of read()
Readable.prototype.unshift = function(chunk) {
  var state = this._readableState;
  return readableAddChunk(this, state, chunk, '', true);
};

function readableAddChunk(stream, state, chunk, encoding, addToFront) {
  var er = chunkInvalid(state, chunk);
  if (er) {
    stream.emit('error', er);
  } else if (util.isNullOrUndefined(chunk)) {
    state.reading = false;
    if (!state.ended)
      onEofChunk(stream, state);
  } else if (state.objectMode || chunk && chunk.length > 0) {
    if (state.ended && !addToFront) {
      var e = new Error('stream.push() after EOF');
      stream.emit('error', e);
    } else if (state.endEmitted && addToFront) {
      var e = new Error('stream.unshift() after end event');
      stream.emit('error', e);
    } else {
      if (state.decoder && !addToFront && !encoding)
        chunk = state.decoder.write(chunk);

      if (!addToFront)
        state.reading = false;

      // if we want the data now, just emit it.
      if (state.flowing && state.length === 0 && !state.sync) {
        stream.emit('data', chunk);
        stream.read(0);
      } else {
        // update the buffer info.
        state.length += state.objectMode ? 1 : chunk.length;
        if (addToFront)
          state.buffer.unshift(chunk);
        else
          state.buffer.push(chunk);

        if (state.needReadable)
          emitReadable(stream);
      }

      maybeReadMore(stream, state);
    }
  } else if (!addToFront) {
    state.reading = false;
  }

  return needMoreData(state);
}



// if it's past the high water mark, we can push in some more.
// Also, if we have no data yet, we can stand some
// more bytes.  This is to work around cases where hwm=0,
// such as the repl.  Also, if the push() triggered a
// readable event, and the user called read(largeNumber) such that
// needReadable was set, then we ought to push more, so that another
// 'readable' event will be triggered.
function needMoreData(state) {
  return !state.ended &&
         (state.needReadable ||
          state.length < state.highWaterMark ||
          state.length === 0);
}

// backwards compatibility.
Readable.prototype.setEncoding = function(enc) {
  if (!StringDecoder)
    StringDecoder = require('string_decoder/').StringDecoder;
  this._readableState.decoder = new StringDecoder(enc);
  this._readableState.encoding = enc;
  return this;
};

// Don't raise the hwm > 128MB
var MAX_HWM = 0x800000;
function roundUpToNextPowerOf2(n) {
  if (n >= MAX_HWM) {
    n = MAX_HWM;
  } else {
    // Get the next highest power of 2
    n--;
    for (var p = 1; p < 32; p <<= 1) n |= n >> p;
    n++;
  }
  return n;
}

function howMuchToRead(n, state) {
  if (state.length === 0 && state.ended)
    return 0;

  if (state.objectMode)
    return n === 0 ? 0 : 1;

  if (isNaN(n) || util.isNull(n)) {
    // only flow one buffer at a time
    if (state.flowing && state.buffer.length)
      return state.buffer[0].length;
    else
      return state.length;
  }

  if (n <= 0)
    return 0;

  // If we're asking for more than the target buffer level,
  // then raise the water mark.  Bump up to the next highest
  // power of 2, to prevent increasing it excessively in tiny
  // amounts.
  if (n > state.highWaterMark)
    state.highWaterMark = roundUpToNextPowerOf2(n);

  // don't have that much.  return null, unless we've ended.
  if (n > state.length) {
    if (!state.ended) {
      state.needReadable = true;
      return 0;
    } else
      return state.length;
  }

  return n;
}

// you can override either this method, or the async _read(n) below.
Readable.prototype.read = function(n) {
  debug('read', n);
  var state = this._readableState;
  var nOrig = n;

  if (!util.isNumber(n) || n > 0)
    state.emittedReadable = false;

  // if we're doing read(0) to trigger a readable event, but we
  // already have a bunch of data in the buffer, then just trigger
  // the 'readable' event and move on.
  if (n === 0 &&
      state.needReadable &&
      (state.length >= state.highWaterMark || state.ended)) {
    debug('read: emitReadable', state.length, state.ended);
    if (state.length === 0 && state.ended)
      endReadable(this);
    else
      emitReadable(this);
    return null;
  }

  n = howMuchToRead(n, state);

  // if we've ended, and we're now clear, then finish it up.
  if (n === 0 && state.ended) {
    if (state.length === 0)
      endReadable(this);
    return null;
  }

  // All the actual chunk generation logic needs to be
  // *below* the call to _read.  The reason is that in certain
  // synthetic stream cases, such as passthrough streams, _read
  // may be a completely synchronous operation which may change
  // the state of the read buffer, providing enough data when
  // before there was *not* enough.
  //
  // So, the steps are:
  // 1. Figure out what the state of things will be after we do
  // a read from the buffer.
  //
  // 2. If that resulting state will trigger a _read, then call _read.
  // Note that this may be asynchronous, or synchronous.  Yes, it is
  // deeply ugly to write APIs this way, but that still doesn't mean
  // that the Readable class should behave improperly, as streams are
  // designed to be sync/async agnostic.
  // Take note if the _read call is sync or async (ie, if the read call
  // has returned yet), so that we know whether or not it's safe to emit
  // 'readable' etc.
  //
  // 3. Actually pull the requested chunks out of the buffer and return.

  // if we need a readable event, then we need to do some reading.
  var doRead = state.needReadable;
  debug('need readable', doRead);

  // if we currently have less than the highWaterMark, then also read some
  if (state.length === 0 || state.length - n < state.highWaterMark) {
    doRead = true;
    debug('length less than watermark', doRead);
  }

  // however, if we've ended, then there's no point, and if we're already
  // reading, then it's unnecessary.
  if (state.ended || state.reading) {
    doRead = false;
    debug('reading or ended', doRead);
  }

  if (doRead) {
    debug('do read');
    state.reading = true;
    state.sync = true;
    // if the length is currently zero, then we *need* a readable event.
    if (state.length === 0)
      state.needReadable = true;
    // call internal read method
    this._read(state.highWaterMark);
    state.sync = false;
  }

  // If _read pushed data synchronously, then `reading` will be false,
  // and we need to re-evaluate how much data we can return to the user.
  if (doRead && !state.reading)
    n = howMuchToRead(nOrig, state);

  var ret;
  if (n > 0)
    ret = fromList(n, state);
  else
    ret = null;

  if (util.isNull(ret)) {
    state.needReadable = true;
    n = 0;
  }

  state.length -= n;

  // If we have nothing in the buffer, then we want to know
  // as soon as we *do* get something into the buffer.
  if (state.length === 0 && !state.ended)
    state.needReadable = true;

  // If we tried to read() past the EOF, then emit end on the next tick.
  if (nOrig !== n && state.ended && state.length === 0)
    endReadable(this);

  if (!util.isNull(ret))
    this.emit('data', ret);

  return ret;
};

function chunkInvalid(state, chunk) {
  var er = null;
  if (!util.isBuffer(chunk) &&
      !util.isString(chunk) &&
      !util.isNullOrUndefined(chunk) &&
      !state.objectMode) {
    er = new TypeError('Invalid non-string/buffer chunk');
  }
  return er;
}


function onEofChunk(stream, state) {
  if (state.decoder && !state.ended) {
    var chunk = state.decoder.end();
    if (chunk && chunk.length) {
      state.buffer.push(chunk);
      state.length += state.objectMode ? 1 : chunk.length;
    }
  }
  state.ended = true;

  // emit 'readable' now to make sure it gets picked up.
  emitReadable(stream);
}

// Don't emit readable right away in sync mode, because this can trigger
// another read() call => stack overflow.  This way, it might trigger
// a nextTick recursion warning, but that's not so bad.
function emitReadable(stream) {
  var state = stream._readableState;
  state.needReadable = false;
  if (!state.emittedReadable) {
    debug('emitReadable', state.flowing);
    state.emittedReadable = true;
    if (state.sync)
      process.nextTick(function() {
        emitReadable_(stream);
      });
    else
      emitReadable_(stream);
  }
}

function emitReadable_(stream) {
  debug('emit readable');
  stream.emit('readable');
  flow(stream);
}


// at this point, the user has presumably seen the 'readable' event,
// and called read() to consume some data.  that may have triggered
// in turn another _read(n) call, in which case reading = true if
// it's in progress.
// However, if we're not ended, or reading, and the length < hwm,
// then go ahead and try to read some more preemptively.
function maybeReadMore(stream, state) {
  if (!state.readingMore) {
    state.readingMore = true;
    process.nextTick(function() {
      maybeReadMore_(stream, state);
    });
  }
}

function maybeReadMore_(stream, state) {
  var len = state.length;
  while (!state.reading && !state.flowing && !state.ended &&
         state.length < state.highWaterMark) {
    debug('maybeReadMore read 0');
    stream.read(0);
    if (len === state.length)
      // didn't get any data, stop spinning.
      break;
    else
      len = state.length;
  }
  state.readingMore = false;
}

// abstract method.  to be overridden in specific implementation classes.
// call cb(er, data) where data is <= n in length.
// for virtual (non-string, non-buffer) streams, "length" is somewhat
// arbitrary, and perhaps not very meaningful.
Readable.prototype._read = function(n) {
  this.emit('error', new Error('not implemented'));
};

Readable.prototype.pipe = function(dest, pipeOpts) {
  var src = this;
  var state = this._readableState;

  switch (state.pipesCount) {
    case 0:
      state.pipes = dest;
      break;
    case 1:
      state.pipes = [state.pipes, dest];
      break;
    default:
      state.pipes.push(dest);
      break;
  }
  state.pipesCount += 1;
  debug('pipe count=%d opts=%j', state.pipesCount, pipeOpts);

  var doEnd = (!pipeOpts || pipeOpts.end !== false) &&
              dest !== process.stdout &&
              dest !== process.stderr;

  var endFn = doEnd ? onend : cleanup;
  if (state.endEmitted)
    process.nextTick(endFn);
  else
    src.once('end', endFn);

  dest.on('unpipe', onunpipe);
  function onunpipe(readable) {
    debug('onunpipe');
    if (readable === src) {
      cleanup();
    }
  }

  function onend() {
    debug('onend');
    dest.end();
  }

  // when the dest drains, it reduces the awaitDrain counter
  // on the source.  This would be more elegant with a .once()
  // handler in flow(), but adding and removing repeatedly is
  // too slow.
  var ondrain = pipeOnDrain(src);
  dest.on('drain', ondrain);

  function cleanup() {
    debug('cleanup');
    // cleanup event handlers once the pipe is broken
    dest.removeListener('close', onclose);
    dest.removeListener('finish', onfinish);
    dest.removeListener('drain', ondrain);
    dest.removeListener('error', onerror);
    dest.removeListener('unpipe', onunpipe);
    src.removeListener('end', onend);
    src.removeListener('end', cleanup);
    src.removeListener('data', ondata);

    // if the reader is waiting for a drain event from this
    // specific writer, then it would cause it to never start
    // flowing again.
    // So, if this is awaiting a drain, then we just call it now.
    // If we don't know, then assume that we are waiting for one.
    if (state.awaitDrain &&
        (!dest._writableState || dest._writableState.needDrain))
      ondrain();
  }

  src.on('data', ondata);
  function ondata(chunk) {
    debug('ondata');
    var ret = dest.write(chunk);
    if (false === ret) {
      debug('false write response, pause',
            src._readableState.awaitDrain);
      src._readableState.awaitDrain++;
      src.pause();
    }
  }

  // if the dest has an error, then stop piping into it.
  // however, don't suppress the throwing behavior for this.
  function onerror(er) {
    debug('onerror', er);
    unpipe();
    dest.removeListener('error', onerror);
    if (EE.listenerCount(dest, 'error') === 0)
      dest.emit('error', er);
  }
  // This is a brutally ugly hack to make sure that our error handler
  // is attached before any userland ones.  NEVER DO THIS.
  if (!dest._events || !dest._events.error)
    dest.on('error', onerror);
  else if (isArray(dest._events.error))
    dest._events.error.unshift(onerror);
  else
    dest._events.error = [onerror, dest._events.error];



  // Both close and finish should trigger unpipe, but only once.
  function onclose() {
    dest.removeListener('finish', onfinish);
    unpipe();
  }
  dest.once('close', onclose);
  function onfinish() {
    debug('onfinish');
    dest.removeListener('close', onclose);
    unpipe();
  }
  dest.once('finish', onfinish);

  function unpipe() {
    debug('unpipe');
    src.unpipe(dest);
  }

  // tell the dest that it's being piped to
  dest.emit('pipe', src);

  // start the flow if it hasn't been started already.
  if (!state.flowing) {
    debug('pipe resume');
    src.resume();
  }

  return dest;
};

function pipeOnDrain(src) {
  return function() {
    var state = src._readableState;
    debug('pipeOnDrain', state.awaitDrain);
    if (state.awaitDrain)
      state.awaitDrain--;
    if (state.awaitDrain === 0 && EE.listenerCount(src, 'data')) {
      state.flowing = true;
      flow(src);
    }
  };
}


Readable.prototype.unpipe = function(dest) {
  var state = this._readableState;

  // if we're not piping anywhere, then do nothing.
  if (state.pipesCount === 0)
    return this;

  // just one destination.  most common case.
  if (state.pipesCount === 1) {
    // passed in one, but it's not the right one.
    if (dest && dest !== state.pipes)
      return this;

    if (!dest)
      dest = state.pipes;

    // got a match.
    state.pipes = null;
    state.pipesCount = 0;
    state.flowing = false;
    if (dest)
      dest.emit('unpipe', this);
    return this;
  }

  // slow case. multiple pipe destinations.

  if (!dest) {
    // remove all.
    var dests = state.pipes;
    var len = state.pipesCount;
    state.pipes = null;
    state.pipesCount = 0;
    state.flowing = false;

    for (var i = 0; i < len; i++)
      dests[i].emit('unpipe', this);
    return this;
  }

  // try to find the right one.
  var i = indexOf(state.pipes, dest);
  if (i === -1)
    return this;

  state.pipes.splice(i, 1);
  state.pipesCount -= 1;
  if (state.pipesCount === 1)
    state.pipes = state.pipes[0];

  dest.emit('unpipe', this);

  return this;
};

// set up data events if they are asked for
// Ensure readable listeners eventually get something
Readable.prototype.on = function(ev, fn) {
  var res = Stream.prototype.on.call(this, ev, fn);

  // If listening to data, and it has not explicitly been paused,
  // then call resume to start the flow of data on the next tick.
  if (ev === 'data' && false !== this._readableState.flowing) {
    this.resume();
  }

  if (ev === 'readable' && this.readable) {
    var state = this._readableState;
    if (!state.readableListening) {
      state.readableListening = true;
      state.emittedReadable = false;
      state.needReadable = true;
      if (!state.reading) {
        var self = this;
        process.nextTick(function() {
          debug('readable nexttick read 0');
          self.read(0);
        });
      } else if (state.length) {
        emitReadable(this, state);
      }
    }
  }

  return res;
};
Readable.prototype.addListener = Readable.prototype.on;

// pause() and resume() are remnants of the legacy readable stream API
// If the user uses them, then switch into old mode.
Readable.prototype.resume = function() {
  var state = this._readableState;
  if (!state.flowing) {
    debug('resume');
    state.flowing = true;
    if (!state.reading) {
      debug('resume read 0');
      this.read(0);
    }
    resume(this, state);
  }
  return this;
};

function resume(stream, state) {
  if (!state.resumeScheduled) {
    state.resumeScheduled = true;
    process.nextTick(function() {
      resume_(stream, state);
    });
  }
}

function resume_(stream, state) {
  state.resumeScheduled = false;
  stream.emit('resume');
  flow(stream);
  if (state.flowing && !state.reading)
    stream.read(0);
}

Readable.prototype.pause = function() {
  debug('call pause flowing=%j', this._readableState.flowing);
  if (false !== this._readableState.flowing) {
    debug('pause');
    this._readableState.flowing = false;
    this.emit('pause');
  }
  return this;
};

function flow(stream) {
  var state = stream._readableState;
  debug('flow', state.flowing);
  if (state.flowing) {
    do {
      var chunk = stream.read();
    } while (null !== chunk && state.flowing);
  }
}

// wrap an old-style stream as the async data source.
// This is *not* part of the readable stream interface.
// It is an ugly unfortunate mess of history.
Readable.prototype.wrap = function(stream) {
  var state = this._readableState;
  var paused = false;

  var self = this;
  stream.on('end', function() {
    debug('wrapped end');
    if (state.decoder && !state.ended) {
      var chunk = state.decoder.end();
      if (chunk && chunk.length)
        self.push(chunk);
    }

    self.push(null);
  });

  stream.on('data', function(chunk) {
    debug('wrapped data');
    if (state.decoder)
      chunk = state.decoder.write(chunk);
    if (!chunk || !state.objectMode && !chunk.length)
      return;

    var ret = self.push(chunk);
    if (!ret) {
      paused = true;
      stream.pause();
    }
  });

  // proxy all the other methods.
  // important when wrapping filters and duplexes.
  for (var i in stream) {
    if (util.isFunction(stream[i]) && util.isUndefined(this[i])) {
      this[i] = function(method) { return function() {
        return stream[method].apply(stream, arguments);
      }}(i);
    }
  }

  // proxy certain important events.
  var events = ['error', 'close', 'destroy', 'pause', 'resume'];
  forEach(events, function(ev) {
    stream.on(ev, self.emit.bind(self, ev));
  });

  // when we try to consume some more bytes, simply unpause the
  // underlying stream.
  self._read = function(n) {
    debug('wrapped _read', n);
    if (paused) {
      paused = false;
      stream.resume();
    }
  };

  return self;
};



// exposed for testing purposes only.
Readable._fromList = fromList;

// Pluck off n bytes from an array of buffers.
// Length is the combined lengths of all the buffers in the list.
function fromList(n, state) {
  var list = state.buffer;
  var length = state.length;
  var stringMode = !!state.decoder;
  var objectMode = !!state.objectMode;
  var ret;

  // nothing in the list, definitely empty.
  if (list.length === 0)
    return null;

  if (length === 0)
    ret = null;
  else if (objectMode)
    ret = list.shift();
  else if (!n || n >= length) {
    // read it all, truncate the array.
    if (stringMode)
      ret = list.join('');
    else
      ret = Buffer.concat(list, length);
    list.length = 0;
  } else {
    // read just some of it.
    if (n < list[0].length) {
      // just take a part of the first list item.
      // slice is the same for buffers and strings.
      var buf = list[0];
      ret = buf.slice(0, n);
      list[0] = buf.slice(n);
    } else if (n === list[0].length) {
      // first list is a perfect match
      ret = list.shift();
    } else {
      // complex case.
      // we have enough to cover it, but it spans past the first buffer.
      if (stringMode)
        ret = '';
      else
        ret = new Buffer(n);

      var c = 0;
      for (var i = 0, l = list.length; i < l && c < n; i++) {
        var buf = list[0];
        var cpy = Math.min(n - c, buf.length);

        if (stringMode)
          ret += buf.slice(0, cpy);
        else
          buf.copy(ret, c, 0, cpy);

        if (cpy < buf.length)
          list[0] = buf.slice(cpy);
        else
          list.shift();

        c += cpy;
      }
    }
  }

  return ret;
}

function endReadable(stream) {
  var state = stream._readableState;

  // If we get here before consuming all the bytes, then that is a
  // bug in node.  Should never happen.
  if (state.length > 0)
    throw new Error('endReadable called on non-empty stream');

  if (!state.endEmitted) {
    state.ended = true;
    process.nextTick(function() {
      // Check that we didn't get one last unshift.
      if (!state.endEmitted && state.length === 0) {
        state.endEmitted = true;
        stream.readable = false;
        stream.emit('end');
      }
    });
  }
}

function forEach (xs, f) {
  for (var i = 0, l = xs.length; i < l; i++) {
    f(xs[i], i);
  }
}

function indexOf (xs, x) {
  for (var i = 0, l = xs.length; i < l; i++) {
    if (xs[i] === x) return i;
  }
  return -1;
}

}).call(this,require('_process'))

},{"./_stream_duplex":11,"_process":9,"buffer":2,"core-util-is":16,"events":6,"inherits":7,"isarray":8,"stream":21,"string_decoder/":22,"util":1}],14:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.


// a transform stream is a readable/writable stream where you do
// something with the data.  Sometimes it's called a "filter",
// but that's not a great name for it, since that implies a thing where
// some bits pass through, and others are simply ignored.  (That would
// be a valid example of a transform, of course.)
//
// While the output is causally related to the input, it's not a
// necessarily symmetric or synchronous transformation.  For example,
// a zlib stream might take multiple plain-text writes(), and then
// emit a single compressed chunk some time in the future.
//
// Here's how this works:
//
// The Transform stream has all the aspects of the readable and writable
// stream classes.  When you write(chunk), that calls _write(chunk,cb)
// internally, and returns false if there's a lot of pending writes
// buffered up.  When you call read(), that calls _read(n) until
// there's enough pending readable data buffered up.
//
// In a transform stream, the written data is placed in a buffer.  When
// _read(n) is called, it transforms the queued up data, calling the
// buffered _write cb's as it consumes chunks.  If consuming a single
// written chunk would result in multiple output chunks, then the first
// outputted bit calls the readcb, and subsequent chunks just go into
// the read buffer, and will cause it to emit 'readable' if necessary.
//
// This way, back-pressure is actually determined by the reading side,
// since _read has to be called to start processing a new chunk.  However,
// a pathological inflate type of transform can cause excessive buffering
// here.  For example, imagine a stream where every byte of input is
// interpreted as an integer from 0-255, and then results in that many
// bytes of output.  Writing the 4 bytes {ff,ff,ff,ff} would result in
// 1kb of data being output.  In this case, you could write a very small
// amount of input, and end up with a very large amount of output.  In
// such a pathological inflating mechanism, there'd be no way to tell
// the system to stop doing the transform.  A single 4MB write could
// cause the system to run out of memory.
//
// However, even in such a pathological case, only a single written chunk
// would be consumed, and then the rest would wait (un-transformed) until
// the results of the previous transformed chunk were consumed.

module.exports = Transform;

var Duplex = require('./_stream_duplex');

/*<replacement>*/
var util = require('core-util-is');
util.inherits = require('inherits');
/*</replacement>*/

util.inherits(Transform, Duplex);


function TransformState(options, stream) {
  this.afterTransform = function(er, data) {
    return afterTransform(stream, er, data);
  };

  this.needTransform = false;
  this.transforming = false;
  this.writecb = null;
  this.writechunk = null;
}

function afterTransform(stream, er, data) {
  var ts = stream._transformState;
  ts.transforming = false;

  var cb = ts.writecb;

  if (!cb)
    return stream.emit('error', new Error('no writecb in Transform class'));

  ts.writechunk = null;
  ts.writecb = null;

  if (!util.isNullOrUndefined(data))
    stream.push(data);

  if (cb)
    cb(er);

  var rs = stream._readableState;
  rs.reading = false;
  if (rs.needReadable || rs.length < rs.highWaterMark) {
    stream._read(rs.highWaterMark);
  }
}


function Transform(options) {
  if (!(this instanceof Transform))
    return new Transform(options);

  Duplex.call(this, options);

  this._transformState = new TransformState(options, this);

  // when the writable side finishes, then flush out anything remaining.
  var stream = this;

  // start out asking for a readable event once data is transformed.
  this._readableState.needReadable = true;

  // we have implemented the _read method, and done the other things
  // that Readable wants before the first _read call, so unset the
  // sync guard flag.
  this._readableState.sync = false;

  this.once('prefinish', function() {
    if (util.isFunction(this._flush))
      this._flush(function(er) {
        done(stream, er);
      });
    else
      done(stream);
  });
}

Transform.prototype.push = function(chunk, encoding) {
  this._transformState.needTransform = false;
  return Duplex.prototype.push.call(this, chunk, encoding);
};

// This is the part where you do stuff!
// override this function in implementation classes.
// 'chunk' is an input chunk.
//
// Call `push(newChunk)` to pass along transformed output
// to the readable side.  You may call 'push' zero or more times.
//
// Call `cb(err)` when you are done with this chunk.  If you pass
// an error, then that'll put the hurt on the whole operation.  If you
// never call cb(), then you'll never get another chunk.
Transform.prototype._transform = function(chunk, encoding, cb) {
  throw new Error('not implemented');
};

Transform.prototype._write = function(chunk, encoding, cb) {
  var ts = this._transformState;
  ts.writecb = cb;
  ts.writechunk = chunk;
  ts.writeencoding = encoding;
  if (!ts.transforming) {
    var rs = this._readableState;
    if (ts.needTransform ||
        rs.needReadable ||
        rs.length < rs.highWaterMark)
      this._read(rs.highWaterMark);
  }
};

// Doesn't matter what the args are here.
// _transform does all the work.
// That we got here means that the readable side wants more data.
Transform.prototype._read = function(n) {
  var ts = this._transformState;

  if (!util.isNull(ts.writechunk) && ts.writecb && !ts.transforming) {
    ts.transforming = true;
    this._transform(ts.writechunk, ts.writeencoding, ts.afterTransform);
  } else {
    // mark that we need a transform, so that any data that comes in
    // will get processed, now that we've asked for it.
    ts.needTransform = true;
  }
};


function done(stream, er) {
  if (er)
    return stream.emit('error', er);

  // if there's nothing in the write buffer, then that means
  // that nothing more will ever be provided
  var ws = stream._writableState;
  var ts = stream._transformState;

  if (ws.length)
    throw new Error('calling transform done when ws.length != 0');

  if (ts.transforming)
    throw new Error('calling transform done when still transforming');

  return stream.push(null);
}

},{"./_stream_duplex":11,"core-util-is":16,"inherits":7}],15:[function(require,module,exports){
(function (process){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

// A bit simpler than readable streams.
// Implement an async ._write(chunk, cb), and it'll handle all
// the drain event emission and buffering.

module.exports = Writable;

/*<replacement>*/
var Buffer = require('buffer').Buffer;
/*</replacement>*/

Writable.WritableState = WritableState;


/*<replacement>*/
var util = require('core-util-is');
util.inherits = require('inherits');
/*</replacement>*/

var Stream = require('stream');

util.inherits(Writable, Stream);

function WriteReq(chunk, encoding, cb) {
  this.chunk = chunk;
  this.encoding = encoding;
  this.callback = cb;
}

function WritableState(options, stream) {
  var Duplex = require('./_stream_duplex');

  options = options || {};

  // the point at which write() starts returning false
  // Note: 0 is a valid value, means that we always return false if
  // the entire buffer is not flushed immediately on write()
  var hwm = options.highWaterMark;
  var defaultHwm = options.objectMode ? 16 : 16 * 1024;
  this.highWaterMark = (hwm || hwm === 0) ? hwm : defaultHwm;

  // object stream flag to indicate whether or not this stream
  // contains buffers or objects.
  this.objectMode = !!options.objectMode;

  if (stream instanceof Duplex)
    this.objectMode = this.objectMode || !!options.writableObjectMode;

  // cast to ints.
  this.highWaterMark = ~~this.highWaterMark;

  this.needDrain = false;
  // at the start of calling end()
  this.ending = false;
  // when end() has been called, and returned
  this.ended = false;
  // when 'finish' is emitted
  this.finished = false;

  // should we decode strings into buffers before passing to _write?
  // this is here so that some node-core streams can optimize string
  // handling at a lower level.
  var noDecode = options.decodeStrings === false;
  this.decodeStrings = !noDecode;

  // Crypto is kind of old and crusty.  Historically, its default string
  // encoding is 'binary' so we have to make this configurable.
  // Everything else in the universe uses 'utf8', though.
  this.defaultEncoding = options.defaultEncoding || 'utf8';

  // not an actual buffer we keep track of, but a measurement
  // of how much we're waiting to get pushed to some underlying
  // socket or file.
  this.length = 0;

  // a flag to see when we're in the middle of a write.
  this.writing = false;

  // when true all writes will be buffered until .uncork() call
  this.corked = 0;

  // a flag to be able to tell if the onwrite cb is called immediately,
  // or on a later tick.  We set this to true at first, because any
  // actions that shouldn't happen until "later" should generally also
  // not happen before the first write call.
  this.sync = true;

  // a flag to know if we're processing previously buffered items, which
  // may call the _write() callback in the same tick, so that we don't
  // end up in an overlapped onwrite situation.
  this.bufferProcessing = false;

  // the callback that's passed to _write(chunk,cb)
  this.onwrite = function(er) {
    onwrite(stream, er);
  };

  // the callback that the user supplies to write(chunk,encoding,cb)
  this.writecb = null;

  // the amount that is being written when _write is called.
  this.writelen = 0;

  this.buffer = [];

  // number of pending user-supplied write callbacks
  // this must be 0 before 'finish' can be emitted
  this.pendingcb = 0;

  // emit prefinish if the only thing we're waiting for is _write cbs
  // This is relevant for synchronous Transform streams
  this.prefinished = false;

  // True if the error was already emitted and should not be thrown again
  this.errorEmitted = false;
}

function Writable(options) {
  var Duplex = require('./_stream_duplex');

  // Writable ctor is applied to Duplexes, though they're not
  // instanceof Writable, they're instanceof Readable.
  if (!(this instanceof Writable) && !(this instanceof Duplex))
    return new Writable(options);

  this._writableState = new WritableState(options, this);

  // legacy.
  this.writable = true;

  Stream.call(this);
}

// Otherwise people can pipe Writable streams, which is just wrong.
Writable.prototype.pipe = function() {
  this.emit('error', new Error('Cannot pipe. Not readable.'));
};


function writeAfterEnd(stream, state, cb) {
  var er = new Error('write after end');
  // TODO: defer error events consistently everywhere, not just the cb
  stream.emit('error', er);
  process.nextTick(function() {
    cb(er);
  });
}

// If we get something that is not a buffer, string, null, or undefined,
// and we're not in objectMode, then that's an error.
// Otherwise stream chunks are all considered to be of length=1, and the
// watermarks determine how many objects to keep in the buffer, rather than
// how many bytes or characters.
function validChunk(stream, state, chunk, cb) {
  var valid = true;
  if (!util.isBuffer(chunk) &&
      !util.isString(chunk) &&
      !util.isNullOrUndefined(chunk) &&
      !state.objectMode) {
    var er = new TypeError('Invalid non-string/buffer chunk');
    stream.emit('error', er);
    process.nextTick(function() {
      cb(er);
    });
    valid = false;
  }
  return valid;
}

Writable.prototype.write = function(chunk, encoding, cb) {
  var state = this._writableState;
  var ret = false;

  if (util.isFunction(encoding)) {
    cb = encoding;
    encoding = null;
  }

  if (util.isBuffer(chunk))
    encoding = 'buffer';
  else if (!encoding)
    encoding = state.defaultEncoding;

  if (!util.isFunction(cb))
    cb = function() {};

  if (state.ended)
    writeAfterEnd(this, state, cb);
  else if (validChunk(this, state, chunk, cb)) {
    state.pendingcb++;
    ret = writeOrBuffer(this, state, chunk, encoding, cb);
  }

  return ret;
};

Writable.prototype.cork = function() {
  var state = this._writableState;

  state.corked++;
};

Writable.prototype.uncork = function() {
  var state = this._writableState;

  if (state.corked) {
    state.corked--;

    if (!state.writing &&
        !state.corked &&
        !state.finished &&
        !state.bufferProcessing &&
        state.buffer.length)
      clearBuffer(this, state);
  }
};

function decodeChunk(state, chunk, encoding) {
  if (!state.objectMode &&
      state.decodeStrings !== false &&
      util.isString(chunk)) {
    chunk = new Buffer(chunk, encoding);
  }
  return chunk;
}

// if we're already writing something, then just put this
// in the queue, and wait our turn.  Otherwise, call _write
// If we return false, then we need a drain event, so set that flag.
function writeOrBuffer(stream, state, chunk, encoding, cb) {
  chunk = decodeChunk(state, chunk, encoding);
  if (util.isBuffer(chunk))
    encoding = 'buffer';
  var len = state.objectMode ? 1 : chunk.length;

  state.length += len;

  var ret = state.length < state.highWaterMark;
  // we must ensure that previous needDrain will not be reset to false.
  if (!ret)
    state.needDrain = true;

  if (state.writing || state.corked)
    state.buffer.push(new WriteReq(chunk, encoding, cb));
  else
    doWrite(stream, state, false, len, chunk, encoding, cb);

  return ret;
}

function doWrite(stream, state, writev, len, chunk, encoding, cb) {
  state.writelen = len;
  state.writecb = cb;
  state.writing = true;
  state.sync = true;
  if (writev)
    stream._writev(chunk, state.onwrite);
  else
    stream._write(chunk, encoding, state.onwrite);
  state.sync = false;
}

function onwriteError(stream, state, sync, er, cb) {
  if (sync)
    process.nextTick(function() {
      state.pendingcb--;
      cb(er);
    });
  else {
    state.pendingcb--;
    cb(er);
  }

  stream._writableState.errorEmitted = true;
  stream.emit('error', er);
}

function onwriteStateUpdate(state) {
  state.writing = false;
  state.writecb = null;
  state.length -= state.writelen;
  state.writelen = 0;
}

function onwrite(stream, er) {
  var state = stream._writableState;
  var sync = state.sync;
  var cb = state.writecb;

  onwriteStateUpdate(state);

  if (er)
    onwriteError(stream, state, sync, er, cb);
  else {
    // Check if we're actually ready to finish, but don't emit yet
    var finished = needFinish(stream, state);

    if (!finished &&
        !state.corked &&
        !state.bufferProcessing &&
        state.buffer.length) {
      clearBuffer(stream, state);
    }

    if (sync) {
      process.nextTick(function() {
        afterWrite(stream, state, finished, cb);
      });
    } else {
      afterWrite(stream, state, finished, cb);
    }
  }
}

function afterWrite(stream, state, finished, cb) {
  if (!finished)
    onwriteDrain(stream, state);
  state.pendingcb--;
  cb();
  finishMaybe(stream, state);
}

// Must force callback to be called on nextTick, so that we don't
// emit 'drain' before the write() consumer gets the 'false' return
// value, and has a chance to attach a 'drain' listener.
function onwriteDrain(stream, state) {
  if (state.length === 0 && state.needDrain) {
    state.needDrain = false;
    stream.emit('drain');
  }
}


// if there's something in the buffer waiting, then process it
function clearBuffer(stream, state) {
  state.bufferProcessing = true;

  if (stream._writev && state.buffer.length > 1) {
    // Fast case, write everything using _writev()
    var cbs = [];
    for (var c = 0; c < state.buffer.length; c++)
      cbs.push(state.buffer[c].callback);

    // count the one we are adding, as well.
    // TODO(isaacs) clean this up
    state.pendingcb++;
    doWrite(stream, state, true, state.length, state.buffer, '', function(err) {
      for (var i = 0; i < cbs.length; i++) {
        state.pendingcb--;
        cbs[i](err);
      }
    });

    // Clear buffer
    state.buffer = [];
  } else {
    // Slow case, write chunks one-by-one
    for (var c = 0; c < state.buffer.length; c++) {
      var entry = state.buffer[c];
      var chunk = entry.chunk;
      var encoding = entry.encoding;
      var cb = entry.callback;
      var len = state.objectMode ? 1 : chunk.length;

      doWrite(stream, state, false, len, chunk, encoding, cb);

      // if we didn't call the onwrite immediately, then
      // it means that we need to wait until it does.
      // also, that means that the chunk and cb are currently
      // being processed, so move the buffer counter past them.
      if (state.writing) {
        c++;
        break;
      }
    }

    if (c < state.buffer.length)
      state.buffer = state.buffer.slice(c);
    else
      state.buffer.length = 0;
  }

  state.bufferProcessing = false;
}

Writable.prototype._write = function(chunk, encoding, cb) {
  cb(new Error('not implemented'));

};

Writable.prototype._writev = null;

Writable.prototype.end = function(chunk, encoding, cb) {
  var state = this._writableState;

  if (util.isFunction(chunk)) {
    cb = chunk;
    chunk = null;
    encoding = null;
  } else if (util.isFunction(encoding)) {
    cb = encoding;
    encoding = null;
  }

  if (!util.isNullOrUndefined(chunk))
    this.write(chunk, encoding);

  // .end() fully uncorks
  if (state.corked) {
    state.corked = 1;
    this.uncork();
  }

  // ignore unnecessary end() calls.
  if (!state.ending && !state.finished)
    endWritable(this, state, cb);
};


function needFinish(stream, state) {
  return (state.ending &&
          state.length === 0 &&
          !state.finished &&
          !state.writing);
}

function prefinish(stream, state) {
  if (!state.prefinished) {
    state.prefinished = true;
    stream.emit('prefinish');
  }
}

function finishMaybe(stream, state) {
  var need = needFinish(stream, state);
  if (need) {
    if (state.pendingcb === 0) {
      prefinish(stream, state);
      state.finished = true;
      stream.emit('finish');
    } else
      prefinish(stream, state);
  }
  return need;
}

function endWritable(stream, state, cb) {
  state.ending = true;
  finishMaybe(stream, state);
  if (cb) {
    if (state.finished)
      process.nextTick(cb);
    else
      stream.once('finish', cb);
  }
  state.ended = true;
}

}).call(this,require('_process'))

},{"./_stream_duplex":11,"_process":9,"buffer":2,"core-util-is":16,"inherits":7,"stream":21}],16:[function(require,module,exports){
(function (Buffer){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

// NOTE: These type checking functions intentionally don't use `instanceof`
// because it is fragile and can be easily faked with `Object.create()`.
function isArray(ar) {
  return Array.isArray(ar);
}
exports.isArray = isArray;

function isBoolean(arg) {
  return typeof arg === 'boolean';
}
exports.isBoolean = isBoolean;

function isNull(arg) {
  return arg === null;
}
exports.isNull = isNull;

function isNullOrUndefined(arg) {
  return arg == null;
}
exports.isNullOrUndefined = isNullOrUndefined;

function isNumber(arg) {
  return typeof arg === 'number';
}
exports.isNumber = isNumber;

function isString(arg) {
  return typeof arg === 'string';
}
exports.isString = isString;

function isSymbol(arg) {
  return typeof arg === 'symbol';
}
exports.isSymbol = isSymbol;

function isUndefined(arg) {
  return arg === void 0;
}
exports.isUndefined = isUndefined;

function isRegExp(re) {
  return isObject(re) && objectToString(re) === '[object RegExp]';
}
exports.isRegExp = isRegExp;

function isObject(arg) {
  return typeof arg === 'object' && arg !== null;
}
exports.isObject = isObject;

function isDate(d) {
  return isObject(d) && objectToString(d) === '[object Date]';
}
exports.isDate = isDate;

function isError(e) {
  return isObject(e) &&
      (objectToString(e) === '[object Error]' || e instanceof Error);
}
exports.isError = isError;

function isFunction(arg) {
  return typeof arg === 'function';
}
exports.isFunction = isFunction;

function isPrimitive(arg) {
  return arg === null ||
         typeof arg === 'boolean' ||
         typeof arg === 'number' ||
         typeof arg === 'string' ||
         typeof arg === 'symbol' ||  // ES6 symbol
         typeof arg === 'undefined';
}
exports.isPrimitive = isPrimitive;

function isBuffer(arg) {
  return Buffer.isBuffer(arg);
}
exports.isBuffer = isBuffer;

function objectToString(o) {
  return Object.prototype.toString.call(o);
}
}).call(this,require("buffer").Buffer)

},{"buffer":2}],17:[function(require,module,exports){
module.exports = require("./lib/_stream_passthrough.js")

},{"./lib/_stream_passthrough.js":12}],18:[function(require,module,exports){
exports = module.exports = require('./lib/_stream_readable.js');
exports.Stream = require('stream');
exports.Readable = exports;
exports.Writable = require('./lib/_stream_writable.js');
exports.Duplex = require('./lib/_stream_duplex.js');
exports.Transform = require('./lib/_stream_transform.js');
exports.PassThrough = require('./lib/_stream_passthrough.js');

},{"./lib/_stream_duplex.js":11,"./lib/_stream_passthrough.js":12,"./lib/_stream_readable.js":13,"./lib/_stream_transform.js":14,"./lib/_stream_writable.js":15,"stream":21}],19:[function(require,module,exports){
module.exports = require("./lib/_stream_transform.js")

},{"./lib/_stream_transform.js":14}],20:[function(require,module,exports){
module.exports = require("./lib/_stream_writable.js")

},{"./lib/_stream_writable.js":15}],21:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

module.exports = Stream;

var EE = require('events').EventEmitter;
var inherits = require('inherits');

inherits(Stream, EE);
Stream.Readable = require('readable-stream/readable.js');
Stream.Writable = require('readable-stream/writable.js');
Stream.Duplex = require('readable-stream/duplex.js');
Stream.Transform = require('readable-stream/transform.js');
Stream.PassThrough = require('readable-stream/passthrough.js');

// Backwards-compat with node 0.4.x
Stream.Stream = Stream;



// old-style streams.  Note that the pipe method (the only relevant
// part of this class) is overridden in the Readable class.

function Stream() {
  EE.call(this);
}

Stream.prototype.pipe = function(dest, options) {
  var source = this;

  function ondata(chunk) {
    if (dest.writable) {
      if (false === dest.write(chunk) && source.pause) {
        source.pause();
      }
    }
  }

  source.on('data', ondata);

  function ondrain() {
    if (source.readable && source.resume) {
      source.resume();
    }
  }

  dest.on('drain', ondrain);

  // If the 'end' option is not supplied, dest.end() will be called when
  // source gets the 'end' or 'close' events.  Only dest.end() once.
  if (!dest._isStdio && (!options || options.end !== false)) {
    source.on('end', onend);
    source.on('close', onclose);
  }

  var didOnEnd = false;
  function onend() {
    if (didOnEnd) return;
    didOnEnd = true;

    dest.end();
  }


  function onclose() {
    if (didOnEnd) return;
    didOnEnd = true;

    if (typeof dest.destroy === 'function') dest.destroy();
  }

  // don't leave dangling pipes when there are errors.
  function onerror(er) {
    cleanup();
    if (EE.listenerCount(this, 'error') === 0) {
      throw er; // Unhandled stream error in pipe.
    }
  }

  source.on('error', onerror);
  dest.on('error', onerror);

  // remove all the event listeners that were added.
  function cleanup() {
    source.removeListener('data', ondata);
    dest.removeListener('drain', ondrain);

    source.removeListener('end', onend);
    source.removeListener('close', onclose);

    source.removeListener('error', onerror);
    dest.removeListener('error', onerror);

    source.removeListener('end', cleanup);
    source.removeListener('close', cleanup);

    dest.removeListener('close', cleanup);
  }

  source.on('end', cleanup);
  source.on('close', cleanup);

  dest.on('close', cleanup);

  dest.emit('pipe', source);

  // Allow for unix-like usage: A.pipe(B).pipe(C)
  return dest;
};

},{"events":6,"inherits":7,"readable-stream/duplex.js":10,"readable-stream/passthrough.js":17,"readable-stream/readable.js":18,"readable-stream/transform.js":19,"readable-stream/writable.js":20}],22:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

var Buffer = require('buffer').Buffer;

var isBufferEncoding = Buffer.isEncoding
  || function(encoding) {
       switch (encoding && encoding.toLowerCase()) {
         case 'hex': case 'utf8': case 'utf-8': case 'ascii': case 'binary': case 'base64': case 'ucs2': case 'ucs-2': case 'utf16le': case 'utf-16le': case 'raw': return true;
         default: return false;
       }
     }


function assertEncoding(encoding) {
  if (encoding && !isBufferEncoding(encoding)) {
    throw new Error('Unknown encoding: ' + encoding);
  }
}

// StringDecoder provides an interface for efficiently splitting a series of
// buffers into a series of JS strings without breaking apart multi-byte
// characters. CESU-8 is handled as part of the UTF-8 encoding.
//
// @TODO Handling all encodings inside a single object makes it very difficult
// to reason about this code, so it should be split up in the future.
// @TODO There should be a utf8-strict encoding that rejects invalid UTF-8 code
// points as used by CESU-8.
var StringDecoder = exports.StringDecoder = function(encoding) {
  this.encoding = (encoding || 'utf8').toLowerCase().replace(/[-_]/, '');
  assertEncoding(encoding);
  switch (this.encoding) {
    case 'utf8':
      // CESU-8 represents each of Surrogate Pair by 3-bytes
      this.surrogateSize = 3;
      break;
    case 'ucs2':
    case 'utf16le':
      // UTF-16 represents each of Surrogate Pair by 2-bytes
      this.surrogateSize = 2;
      this.detectIncompleteChar = utf16DetectIncompleteChar;
      break;
    case 'base64':
      // Base-64 stores 3 bytes in 4 chars, and pads the remainder.
      this.surrogateSize = 3;
      this.detectIncompleteChar = base64DetectIncompleteChar;
      break;
    default:
      this.write = passThroughWrite;
      return;
  }

  // Enough space to store all bytes of a single character. UTF-8 needs 4
  // bytes, but CESU-8 may require up to 6 (3 bytes per surrogate).
  this.charBuffer = new Buffer(6);
  // Number of bytes received for the current incomplete multi-byte character.
  this.charReceived = 0;
  // Number of bytes expected for the current incomplete multi-byte character.
  this.charLength = 0;
};


// write decodes the given buffer and returns it as JS string that is
// guaranteed to not contain any partial multi-byte characters. Any partial
// character found at the end of the buffer is buffered up, and will be
// returned when calling write again with the remaining bytes.
//
// Note: Converting a Buffer containing an orphan surrogate to a String
// currently works, but converting a String to a Buffer (via `new Buffer`, or
// Buffer#write) will replace incomplete surrogates with the unicode
// replacement character. See https://codereview.chromium.org/121173009/ .
StringDecoder.prototype.write = function(buffer) {
  var charStr = '';
  // if our last write ended with an incomplete multibyte character
  while (this.charLength) {
    // determine how many remaining bytes this buffer has to offer for this char
    var available = (buffer.length >= this.charLength - this.charReceived) ?
        this.charLength - this.charReceived :
        buffer.length;

    // add the new bytes to the char buffer
    buffer.copy(this.charBuffer, this.charReceived, 0, available);
    this.charReceived += available;

    if (this.charReceived < this.charLength) {
      // still not enough chars in this buffer? wait for more ...
      return '';
    }

    // remove bytes belonging to the current character from the buffer
    buffer = buffer.slice(available, buffer.length);

    // get the character that was split
    charStr = this.charBuffer.slice(0, this.charLength).toString(this.encoding);

    // CESU-8: lead surrogate (D800-DBFF) is also the incomplete character
    var charCode = charStr.charCodeAt(charStr.length - 1);
    if (charCode >= 0xD800 && charCode <= 0xDBFF) {
      this.charLength += this.surrogateSize;
      charStr = '';
      continue;
    }
    this.charReceived = this.charLength = 0;

    // if there are no more bytes in this buffer, just emit our char
    if (buffer.length === 0) {
      return charStr;
    }
    break;
  }

  // determine and set charLength / charReceived
  this.detectIncompleteChar(buffer);

  var end = buffer.length;
  if (this.charLength) {
    // buffer the incomplete character bytes we got
    buffer.copy(this.charBuffer, 0, buffer.length - this.charReceived, end);
    end -= this.charReceived;
  }

  charStr += buffer.toString(this.encoding, 0, end);

  var end = charStr.length - 1;
  var charCode = charStr.charCodeAt(end);
  // CESU-8: lead surrogate (D800-DBFF) is also the incomplete character
  if (charCode >= 0xD800 && charCode <= 0xDBFF) {
    var size = this.surrogateSize;
    this.charLength += size;
    this.charReceived += size;
    this.charBuffer.copy(this.charBuffer, size, 0, size);
    buffer.copy(this.charBuffer, 0, 0, size);
    return charStr.substring(0, end);
  }

  // or just emit the charStr
  return charStr;
};

// detectIncompleteChar determines if there is an incomplete UTF-8 character at
// the end of the given buffer. If so, it sets this.charLength to the byte
// length that character, and sets this.charReceived to the number of bytes
// that are available for this character.
StringDecoder.prototype.detectIncompleteChar = function(buffer) {
  // determine how many bytes we have to check at the end of this buffer
  var i = (buffer.length >= 3) ? 3 : buffer.length;

  // Figure out if one of the last i bytes of our buffer announces an
  // incomplete char.
  for (; i > 0; i--) {
    var c = buffer[buffer.length - i];

    // See http://en.wikipedia.org/wiki/UTF-8#Description

    // 110XXXXX
    if (i == 1 && c >> 5 == 0x06) {
      this.charLength = 2;
      break;
    }

    // 1110XXXX
    if (i <= 2 && c >> 4 == 0x0E) {
      this.charLength = 3;
      break;
    }

    // 11110XXX
    if (i <= 3 && c >> 3 == 0x1E) {
      this.charLength = 4;
      break;
    }
  }
  this.charReceived = i;
};

StringDecoder.prototype.end = function(buffer) {
  var res = '';
  if (buffer && buffer.length)
    res = this.write(buffer);

  if (this.charReceived) {
    var cr = this.charReceived;
    var buf = this.charBuffer;
    var enc = this.encoding;
    res += buf.slice(0, cr).toString(enc);
  }

  return res;
};

function passThroughWrite(buffer) {
  return buffer.toString(this.encoding);
}

function utf16DetectIncompleteChar(buffer) {
  this.charReceived = buffer.length % 2;
  this.charLength = this.charReceived ? 2 : 0;
}

function base64DetectIncompleteChar(buffer) {
  this.charReceived = buffer.length % 3;
  this.charLength = this.charReceived ? 3 : 0;
}

},{"buffer":2}],23:[function(require,module,exports){
module.exports = function isBuffer(arg) {
  return arg && typeof arg === 'object'
    && typeof arg.copy === 'function'
    && typeof arg.fill === 'function'
    && typeof arg.readUInt8 === 'function';
}
},{}],24:[function(require,module,exports){
(function (process,global){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

var formatRegExp = /%[sdj%]/g;
exports.format = function(f) {
  if (!isString(f)) {
    var objects = [];
    for (var i = 0; i < arguments.length; i++) {
      objects.push(inspect(arguments[i]));
    }
    return objects.join(' ');
  }

  var i = 1;
  var args = arguments;
  var len = args.length;
  var str = String(f).replace(formatRegExp, function(x) {
    if (x === '%%') return '%';
    if (i >= len) return x;
    switch (x) {
      case '%s': return String(args[i++]);
      case '%d': return Number(args[i++]);
      case '%j':
        try {
          return JSON.stringify(args[i++]);
        } catch (_) {
          return '[Circular]';
        }
      default:
        return x;
    }
  });
  for (var x = args[i]; i < len; x = args[++i]) {
    if (isNull(x) || !isObject(x)) {
      str += ' ' + x;
    } else {
      str += ' ' + inspect(x);
    }
  }
  return str;
};


// Mark that a method should not be used.
// Returns a modified function which warns once by default.
// If --no-deprecation is set, then it is a no-op.
exports.deprecate = function(fn, msg) {
  // Allow for deprecating things in the process of starting up.
  if (isUndefined(global.process)) {
    return function() {
      return exports.deprecate(fn, msg).apply(this, arguments);
    };
  }

  if (process.noDeprecation === true) {
    return fn;
  }

  var warned = false;
  function deprecated() {
    if (!warned) {
      if (process.throwDeprecation) {
        throw new Error(msg);
      } else if (process.traceDeprecation) {
        console.trace(msg);
      } else {
        console.error(msg);
      }
      warned = true;
    }
    return fn.apply(this, arguments);
  }

  return deprecated;
};


var debugs = {};
var debugEnviron;
exports.debuglog = function(set) {
  if (isUndefined(debugEnviron))
    debugEnviron = process.env.NODE_DEBUG || '';
  set = set.toUpperCase();
  if (!debugs[set]) {
    if (new RegExp('\\b' + set + '\\b', 'i').test(debugEnviron)) {
      var pid = process.pid;
      debugs[set] = function() {
        var msg = exports.format.apply(exports, arguments);
        console.error('%s %d: %s', set, pid, msg);
      };
    } else {
      debugs[set] = function() {};
    }
  }
  return debugs[set];
};


/**
 * Echos the value of a value. Trys to print the value out
 * in the best way possible given the different types.
 *
 * @param {Object} obj The object to print out.
 * @param {Object} opts Optional options object that alters the output.
 */
/* legacy: obj, showHidden, depth, colors*/
function inspect(obj, opts) {
  // default options
  var ctx = {
    seen: [],
    stylize: stylizeNoColor
  };
  // legacy...
  if (arguments.length >= 3) ctx.depth = arguments[2];
  if (arguments.length >= 4) ctx.colors = arguments[3];
  if (isBoolean(opts)) {
    // legacy...
    ctx.showHidden = opts;
  } else if (opts) {
    // got an "options" object
    exports._extend(ctx, opts);
  }
  // set default options
  if (isUndefined(ctx.showHidden)) ctx.showHidden = false;
  if (isUndefined(ctx.depth)) ctx.depth = 2;
  if (isUndefined(ctx.colors)) ctx.colors = false;
  if (isUndefined(ctx.customInspect)) ctx.customInspect = true;
  if (ctx.colors) ctx.stylize = stylizeWithColor;
  return formatValue(ctx, obj, ctx.depth);
}
exports.inspect = inspect;


// http://en.wikipedia.org/wiki/ANSI_escape_code#graphics
inspect.colors = {
  'bold' : [1, 22],
  'italic' : [3, 23],
  'underline' : [4, 24],
  'inverse' : [7, 27],
  'white' : [37, 39],
  'grey' : [90, 39],
  'black' : [30, 39],
  'blue' : [34, 39],
  'cyan' : [36, 39],
  'green' : [32, 39],
  'magenta' : [35, 39],
  'red' : [31, 39],
  'yellow' : [33, 39]
};

// Don't use 'blue' not visible on cmd.exe
inspect.styles = {
  'special': 'cyan',
  'number': 'yellow',
  'boolean': 'yellow',
  'undefined': 'grey',
  'null': 'bold',
  'string': 'green',
  'date': 'magenta',
  // "name": intentionally not styling
  'regexp': 'red'
};


function stylizeWithColor(str, styleType) {
  var style = inspect.styles[styleType];

  if (style) {
    return '\u001b[' + inspect.colors[style][0] + 'm' + str +
           '\u001b[' + inspect.colors[style][1] + 'm';
  } else {
    return str;
  }
}


function stylizeNoColor(str, styleType) {
  return str;
}


function arrayToHash(array) {
  var hash = {};

  array.forEach(function(val, idx) {
    hash[val] = true;
  });

  return hash;
}


function formatValue(ctx, value, recurseTimes) {
  // Provide a hook for user-specified inspect functions.
  // Check that value is an object with an inspect function on it
  if (ctx.customInspect &&
      value &&
      isFunction(value.inspect) &&
      // Filter out the util module, it's inspect function is special
      value.inspect !== exports.inspect &&
      // Also filter out any prototype objects using the circular check.
      !(value.constructor && value.constructor.prototype === value)) {
    var ret = value.inspect(recurseTimes, ctx);
    if (!isString(ret)) {
      ret = formatValue(ctx, ret, recurseTimes);
    }
    return ret;
  }

  // Primitive types cannot have properties
  var primitive = formatPrimitive(ctx, value);
  if (primitive) {
    return primitive;
  }

  // Look up the keys of the object.
  var keys = Object.keys(value);
  var visibleKeys = arrayToHash(keys);

  if (ctx.showHidden) {
    keys = Object.getOwnPropertyNames(value);
  }

  // IE doesn't make error fields non-enumerable
  // http://msdn.microsoft.com/en-us/library/ie/dww52sbt(v=vs.94).aspx
  if (isError(value)
      && (keys.indexOf('message') >= 0 || keys.indexOf('description') >= 0)) {
    return formatError(value);
  }

  // Some type of object without properties can be shortcutted.
  if (keys.length === 0) {
    if (isFunction(value)) {
      var name = value.name ? ': ' + value.name : '';
      return ctx.stylize('[Function' + name + ']', 'special');
    }
    if (isRegExp(value)) {
      return ctx.stylize(RegExp.prototype.toString.call(value), 'regexp');
    }
    if (isDate(value)) {
      return ctx.stylize(Date.prototype.toString.call(value), 'date');
    }
    if (isError(value)) {
      return formatError(value);
    }
  }

  var base = '', array = false, braces = ['{', '}'];

  // Make Array say that they are Array
  if (isArray(value)) {
    array = true;
    braces = ['[', ']'];
  }

  // Make functions say that they are functions
  if (isFunction(value)) {
    var n = value.name ? ': ' + value.name : '';
    base = ' [Function' + n + ']';
  }

  // Make RegExps say that they are RegExps
  if (isRegExp(value)) {
    base = ' ' + RegExp.prototype.toString.call(value);
  }

  // Make dates with properties first say the date
  if (isDate(value)) {
    base = ' ' + Date.prototype.toUTCString.call(value);
  }

  // Make error with message first say the error
  if (isError(value)) {
    base = ' ' + formatError(value);
  }

  if (keys.length === 0 && (!array || value.length == 0)) {
    return braces[0] + base + braces[1];
  }

  if (recurseTimes < 0) {
    if (isRegExp(value)) {
      return ctx.stylize(RegExp.prototype.toString.call(value), 'regexp');
    } else {
      return ctx.stylize('[Object]', 'special');
    }
  }

  ctx.seen.push(value);

  var output;
  if (array) {
    output = formatArray(ctx, value, recurseTimes, visibleKeys, keys);
  } else {
    output = keys.map(function(key) {
      return formatProperty(ctx, value, recurseTimes, visibleKeys, key, array);
    });
  }

  ctx.seen.pop();

  return reduceToSingleString(output, base, braces);
}


function formatPrimitive(ctx, value) {
  if (isUndefined(value))
    return ctx.stylize('undefined', 'undefined');
  if (isString(value)) {
    var simple = '\'' + JSON.stringify(value).replace(/^"|"$/g, '')
                                             .replace(/'/g, "\\'")
                                             .replace(/\\"/g, '"') + '\'';
    return ctx.stylize(simple, 'string');
  }
  if (isNumber(value))
    return ctx.stylize('' + value, 'number');
  if (isBoolean(value))
    return ctx.stylize('' + value, 'boolean');
  // For some reason typeof null is "object", so special case here.
  if (isNull(value))
    return ctx.stylize('null', 'null');
}


function formatError(value) {
  return '[' + Error.prototype.toString.call(value) + ']';
}


function formatArray(ctx, value, recurseTimes, visibleKeys, keys) {
  var output = [];
  for (var i = 0, l = value.length; i < l; ++i) {
    if (hasOwnProperty(value, String(i))) {
      output.push(formatProperty(ctx, value, recurseTimes, visibleKeys,
          String(i), true));
    } else {
      output.push('');
    }
  }
  keys.forEach(function(key) {
    if (!key.match(/^\d+$/)) {
      output.push(formatProperty(ctx, value, recurseTimes, visibleKeys,
          key, true));
    }
  });
  return output;
}


function formatProperty(ctx, value, recurseTimes, visibleKeys, key, array) {
  var name, str, desc;
  desc = Object.getOwnPropertyDescriptor(value, key) || { value: value[key] };
  if (desc.get) {
    if (desc.set) {
      str = ctx.stylize('[Getter/Setter]', 'special');
    } else {
      str = ctx.stylize('[Getter]', 'special');
    }
  } else {
    if (desc.set) {
      str = ctx.stylize('[Setter]', 'special');
    }
  }
  if (!hasOwnProperty(visibleKeys, key)) {
    name = '[' + key + ']';
  }
  if (!str) {
    if (ctx.seen.indexOf(desc.value) < 0) {
      if (isNull(recurseTimes)) {
        str = formatValue(ctx, desc.value, null);
      } else {
        str = formatValue(ctx, desc.value, recurseTimes - 1);
      }
      if (str.indexOf('\n') > -1) {
        if (array) {
          str = str.split('\n').map(function(line) {
            return '  ' + line;
          }).join('\n').substr(2);
        } else {
          str = '\n' + str.split('\n').map(function(line) {
            return '   ' + line;
          }).join('\n');
        }
      }
    } else {
      str = ctx.stylize('[Circular]', 'special');
    }
  }
  if (isUndefined(name)) {
    if (array && key.match(/^\d+$/)) {
      return str;
    }
    name = JSON.stringify('' + key);
    if (name.match(/^"([a-zA-Z_][a-zA-Z_0-9]*)"$/)) {
      name = name.substr(1, name.length - 2);
      name = ctx.stylize(name, 'name');
    } else {
      name = name.replace(/'/g, "\\'")
                 .replace(/\\"/g, '"')
                 .replace(/(^"|"$)/g, "'");
      name = ctx.stylize(name, 'string');
    }
  }

  return name + ': ' + str;
}


function reduceToSingleString(output, base, braces) {
  var numLinesEst = 0;
  var length = output.reduce(function(prev, cur) {
    numLinesEst++;
    if (cur.indexOf('\n') >= 0) numLinesEst++;
    return prev + cur.replace(/\u001b\[\d\d?m/g, '').length + 1;
  }, 0);

  if (length > 60) {
    return braces[0] +
           (base === '' ? '' : base + '\n ') +
           ' ' +
           output.join(',\n  ') +
           ' ' +
           braces[1];
  }

  return braces[0] + base + ' ' + output.join(', ') + ' ' + braces[1];
}


// NOTE: These type checking functions intentionally don't use `instanceof`
// because it is fragile and can be easily faked with `Object.create()`.
function isArray(ar) {
  return Array.isArray(ar);
}
exports.isArray = isArray;

function isBoolean(arg) {
  return typeof arg === 'boolean';
}
exports.isBoolean = isBoolean;

function isNull(arg) {
  return arg === null;
}
exports.isNull = isNull;

function isNullOrUndefined(arg) {
  return arg == null;
}
exports.isNullOrUndefined = isNullOrUndefined;

function isNumber(arg) {
  return typeof arg === 'number';
}
exports.isNumber = isNumber;

function isString(arg) {
  return typeof arg === 'string';
}
exports.isString = isString;

function isSymbol(arg) {
  return typeof arg === 'symbol';
}
exports.isSymbol = isSymbol;

function isUndefined(arg) {
  return arg === void 0;
}
exports.isUndefined = isUndefined;

function isRegExp(re) {
  return isObject(re) && objectToString(re) === '[object RegExp]';
}
exports.isRegExp = isRegExp;

function isObject(arg) {
  return typeof arg === 'object' && arg !== null;
}
exports.isObject = isObject;

function isDate(d) {
  return isObject(d) && objectToString(d) === '[object Date]';
}
exports.isDate = isDate;

function isError(e) {
  return isObject(e) &&
      (objectToString(e) === '[object Error]' || e instanceof Error);
}
exports.isError = isError;

function isFunction(arg) {
  return typeof arg === 'function';
}
exports.isFunction = isFunction;

function isPrimitive(arg) {
  return arg === null ||
         typeof arg === 'boolean' ||
         typeof arg === 'number' ||
         typeof arg === 'string' ||
         typeof arg === 'symbol' ||  // ES6 symbol
         typeof arg === 'undefined';
}
exports.isPrimitive = isPrimitive;

exports.isBuffer = require('./support/isBuffer');

function objectToString(o) {
  return Object.prototype.toString.call(o);
}


function pad(n) {
  return n < 10 ? '0' + n.toString(10) : n.toString(10);
}


var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep',
              'Oct', 'Nov', 'Dec'];

// 26 Feb 16:19:34
function timestamp() {
  var d = new Date();
  var time = [pad(d.getHours()),
              pad(d.getMinutes()),
              pad(d.getSeconds())].join(':');
  return [d.getDate(), months[d.getMonth()], time].join(' ');
}


// log is just a thin wrapper to console.log that prepends a timestamp
exports.log = function() {
  console.log('%s - %s', timestamp(), exports.format.apply(exports, arguments));
};


/**
 * Inherit the prototype methods from one constructor into another.
 *
 * The Function.prototype.inherits from lang.js rewritten as a standalone
 * function (not on Function.prototype). NOTE: If this file is to be loaded
 * during bootstrapping this function needs to be rewritten using some native
 * functions as prototype setup using normal JavaScript does not work as
 * expected during bootstrapping (see mirror.js in r114903).
 *
 * @param {function} ctor Constructor function which needs to inherit the
 *     prototype.
 * @param {function} superCtor Constructor function to inherit prototype from.
 */
exports.inherits = require('inherits');

exports._extend = function(origin, add) {
  // Don't do anything if add isn't an object
  if (!add || !isObject(add)) return origin;

  var keys = Object.keys(add);
  var i = keys.length;
  while (i--) {
    origin[keys[i]] = add[keys[i]];
  }
  return origin;
};

function hasOwnProperty(obj, prop) {
  return Object.prototype.hasOwnProperty.call(obj, prop);
}

}).call(this,require('_process'),typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{"./support/isBuffer":23,"_process":9,"inherits":7}],25:[function(require,module,exports){
/**
 * This script gives you the zone info key representing your device's time zone setting.
 *
 * @name jsTimezoneDetect
 * @version 1.0.5
 * @author Jon Nylander
 * @license MIT License - http://www.opensource.org/licenses/mit-license.php
 *
 * For usage and examples, visit:
 * http://pellepim.bitbucket.org/jstz/
 *
 * Copyright (c) Jon Nylander
 */

/*jslint undef: true */
/*global console, exports*/

(function(root) {
  /**
   * Namespace to hold all the code for timezone detection.
   */
  var jstz = (function () {
      'use strict';
      var HEMISPHERE_SOUTH = 's',
          
          /**
           * Gets the offset in minutes from UTC for a certain date.
           * @param {Date} date
           * @returns {Number}
           */
          get_date_offset = function (date) {
              var offset = -date.getTimezoneOffset();
              return (offset !== null ? offset : 0);
          },

          get_date = function (year, month, date) {
              var d = new Date();
              if (year !== undefined) {
                d.setFullYear(year);
              }
              d.setMonth(month);
              d.setDate(date);
              return d;
          },

          get_january_offset = function (year) {
              return get_date_offset(get_date(year, 0 ,2));
          },

          get_june_offset = function (year) {
              return get_date_offset(get_date(year, 5, 2));
          },

          /**
           * Private method.
           * Checks whether a given date is in daylight saving time.
           * If the date supplied is after august, we assume that we're checking
           * for southern hemisphere DST.
           * @param {Date} date
           * @returns {Boolean}
           */
          date_is_dst = function (date) {
              var is_southern = date.getMonth() > 7,
                  base_offset = is_southern ? get_june_offset(date.getFullYear()) : 
                                              get_january_offset(date.getFullYear()),
                  date_offset = get_date_offset(date),
                  is_west = base_offset < 0,
                  dst_offset = base_offset - date_offset;
                  
              if (!is_west && !is_southern) {
                  return dst_offset < 0;
              }

              return dst_offset !== 0;
          },

          /**
           * This function does some basic calculations to create information about
           * the user's timezone. It uses REFERENCE_YEAR as a solid year for which
           * the script has been tested rather than depend on the year set by the
           * client device.
           *
           * Returns a key that can be used to do lookups in jstz.olson.timezones.
           * eg: "720,1,2". 
           *
           * @returns {String}
           */

          lookup_key = function () {
              var january_offset = get_january_offset(),
                  june_offset = get_june_offset(),
                  diff = january_offset - june_offset;

              if (diff < 0) {
                  return january_offset + ",1";
              } else if (diff > 0) {
                  return june_offset + ",1," + HEMISPHERE_SOUTH;
              }

              return january_offset + ",0";
          },

          /**
           * Uses get_timezone_info() to formulate a key to use in the olson.timezones dictionary.
           *
           * Returns a primitive object on the format:
           * {'timezone': TimeZone, 'key' : 'the key used to find the TimeZone object'}
           *
           * @returns Object
           */
          determine = function () {
              var key = lookup_key();
              return new jstz.TimeZone(jstz.olson.timezones[key]);
          },

          /**
           * This object contains information on when daylight savings starts for
           * different timezones.
           *
           * The list is short for a reason. Often we do not have to be very specific
           * to single out the correct timezone. But when we do, this list comes in
           * handy.
           *
           * Each value is a date denoting when daylight savings starts for that timezone.
           */
          dst_start_for = function (tz_name) {

            var ru_pre_dst_change = new Date(2010, 6, 15, 1, 0, 0, 0), // In 2010 Russia had DST, this allows us to detect Russia :)
                dst_starts = {
                    'America/Denver': new Date(2011, 2, 13, 3, 0, 0, 0),
                    'America/Mazatlan': new Date(2011, 3, 3, 3, 0, 0, 0),
                    'America/Chicago': new Date(2011, 2, 13, 3, 0, 0, 0),
                    'America/Mexico_City': new Date(2011, 3, 3, 3, 0, 0, 0),
                    'America/Asuncion': new Date(2012, 9, 7, 3, 0, 0, 0),
                    'America/Santiago': new Date(2012, 9, 3, 3, 0, 0, 0),
                    'America/Campo_Grande': new Date(2012, 9, 21, 5, 0, 0, 0),
                    'America/Montevideo': new Date(2011, 9, 2, 3, 0, 0, 0),
                    'America/Sao_Paulo': new Date(2011, 9, 16, 5, 0, 0, 0),
                    'America/Los_Angeles': new Date(2011, 2, 13, 8, 0, 0, 0),
                    'America/Santa_Isabel': new Date(2011, 3, 5, 8, 0, 0, 0),
                    'America/Havana': new Date(2012, 2, 10, 2, 0, 0, 0),
                    'America/New_York': new Date(2012, 2, 10, 7, 0, 0, 0),
                    'Europe/Helsinki': new Date(2013, 2, 31, 5, 0, 0, 0),
                    'Pacific/Auckland': new Date(2011, 8, 26, 7, 0, 0, 0),
                    'America/Halifax': new Date(2011, 2, 13, 6, 0, 0, 0),
                    'America/Goose_Bay': new Date(2011, 2, 13, 2, 1, 0, 0),
                    'America/Miquelon': new Date(2011, 2, 13, 5, 0, 0, 0),
                    'America/Godthab': new Date(2011, 2, 27, 1, 0, 0, 0),
                    'Europe/Moscow': ru_pre_dst_change,
                    'Asia/Amman': new Date(2013, 2, 29, 1, 0, 0, 0),
                    'Asia/Beirut': new Date(2013, 2, 31, 2, 0, 0, 0),
                    'Asia/Damascus': new Date(2013, 3, 6, 2, 0, 0, 0),
                    'Asia/Jerusalem': new Date(2013, 2, 29, 5, 0, 0, 0),
                    'Asia/Yekaterinburg': ru_pre_dst_change,
                    'Asia/Omsk': ru_pre_dst_change,
                    'Asia/Krasnoyarsk': ru_pre_dst_change,
                    'Asia/Irkutsk': ru_pre_dst_change,
                    'Asia/Yakutsk': ru_pre_dst_change,
                    'Asia/Vladivostok': ru_pre_dst_change,
                    'Asia/Baku': new Date(2013, 2, 31, 4, 0, 0),
                    'Asia/Yerevan': new Date(2013, 2, 31, 3, 0, 0),
                    'Asia/Kamchatka': ru_pre_dst_change,
                    'Asia/Gaza': new Date(2010, 2, 27, 4, 0, 0),
                    'Africa/Cairo': new Date(2010, 4, 1, 3, 0, 0),
                    'Europe/Minsk': ru_pre_dst_change,
                    'Pacific/Apia': new Date(2010, 10, 1, 1, 0, 0, 0),
                    'Pacific/Fiji': new Date(2010, 11, 1, 0, 0, 0),
                    'Australia/Perth': new Date(2008, 10, 1, 1, 0, 0, 0)
                };

              return dst_starts[tz_name];
          };

      return {
          determine: determine,
          date_is_dst: date_is_dst,
          dst_start_for: dst_start_for 
      };
  }());

  /**
   * Simple object to perform ambiguity check and to return name of time zone.
   */
  jstz.TimeZone = function (tz_name) {
      'use strict';
        /**
         * The keys in this object are timezones that we know may be ambiguous after
         * a preliminary scan through the olson_tz object.
         *
         * The array of timezones to compare must be in the order that daylight savings
         * starts for the regions.
         */
      var AMBIGUITIES = {
              'America/Denver':       ['America/Denver', 'America/Mazatlan'],
              'America/Chicago':      ['America/Chicago', 'America/Mexico_City'],
              'America/Santiago':     ['America/Santiago', 'America/Asuncion', 'America/Campo_Grande'],
              'America/Montevideo':   ['America/Montevideo', 'America/Sao_Paulo'],
              'Asia/Beirut':          ['Asia/Amman', 'Asia/Jerusalem', 'Asia/Beirut', 'Europe/Helsinki','Asia/Damascus'],
              'Pacific/Auckland':     ['Pacific/Auckland', 'Pacific/Fiji'],
              'America/Los_Angeles':  ['America/Los_Angeles', 'America/Santa_Isabel'],
              'America/New_York':     ['America/Havana', 'America/New_York'],
              'America/Halifax':      ['America/Goose_Bay', 'America/Halifax'],
              'America/Godthab':      ['America/Miquelon', 'America/Godthab'],
              'Asia/Dubai':           ['Europe/Moscow'],
              'Asia/Dhaka':           ['Asia/Yekaterinburg'],
              'Asia/Jakarta':         ['Asia/Omsk'],
              'Asia/Shanghai':        ['Asia/Krasnoyarsk', 'Australia/Perth'],
              'Asia/Tokyo':           ['Asia/Irkutsk'],
              'Australia/Brisbane':   ['Asia/Yakutsk'],
              'Pacific/Noumea':       ['Asia/Vladivostok'],
              'Pacific/Tarawa':       ['Asia/Kamchatka', 'Pacific/Fiji'],
              'Pacific/Tongatapu':    ['Pacific/Apia'],
              'Asia/Baghdad':         ['Europe/Minsk'],
              'Asia/Baku':            ['Asia/Yerevan','Asia/Baku'],
              'Africa/Johannesburg':  ['Asia/Gaza', 'Africa/Cairo']
          },

          timezone_name = tz_name,
          
          /**
           * Checks if a timezone has possible ambiguities. I.e timezones that are similar.
           *
           * For example, if the preliminary scan determines that we're in America/Denver.
           * We double check here that we're really there and not in America/Mazatlan.
           *
           * This is done by checking known dates for when daylight savings start for different
           * timezones during 2010 and 2011.
           */
          ambiguity_check = function () {
              var ambiguity_list = AMBIGUITIES[timezone_name],
                  length = ambiguity_list.length,
                  i = 0,
                  tz = ambiguity_list[0];

              for (; i < length; i += 1) {
                  tz = ambiguity_list[i];

                  if (jstz.date_is_dst(jstz.dst_start_for(tz))) {
                      timezone_name = tz;
                      return;
                  }
              }
          },

          /**
           * Checks if it is possible that the timezone is ambiguous.
           */
          is_ambiguous = function () {
              return typeof (AMBIGUITIES[timezone_name]) !== 'undefined';
          };

      if (is_ambiguous()) {
          ambiguity_check();
      }

      return {
          name: function () {
              return timezone_name;
          }
      };
  };

  jstz.olson = {};

  /*
   * The keys in this dictionary are comma separated as such:
   *
   * First the offset compared to UTC time in minutes.
   *
   * Then a flag which is 0 if the timezone does not take daylight savings into account and 1 if it
   * does.
   *
   * Thirdly an optional 's' signifies that the timezone is in the southern hemisphere,
   * only interesting for timezones with DST.
   *
   * The mapped arrays is used for constructing the jstz.TimeZone object from within
   * jstz.determine_timezone();
   */
  jstz.olson.timezones = {
      '-720,0'   : 'Pacific/Majuro',
      '-660,0'   : 'Pacific/Pago_Pago',
      '-600,1'   : 'America/Adak',
      '-600,0'   : 'Pacific/Honolulu',
      '-570,0'   : 'Pacific/Marquesas',
      '-540,0'   : 'Pacific/Gambier',
      '-540,1'   : 'America/Anchorage',
      '-480,1'   : 'America/Los_Angeles',
      '-480,0'   : 'Pacific/Pitcairn',
      '-420,0'   : 'America/Phoenix',
      '-420,1'   : 'America/Denver',
      '-360,0'   : 'America/Guatemala',
      '-360,1'   : 'America/Chicago',
      '-360,1,s' : 'Pacific/Easter',
      '-300,0'   : 'America/Bogota',
      '-300,1'   : 'America/New_York',
      '-270,0'   : 'America/Caracas',
      '-240,1'   : 'America/Halifax',
      '-240,0'   : 'America/Santo_Domingo',
      '-240,1,s' : 'America/Santiago',
      '-210,1'   : 'America/St_Johns',
      '-180,1'   : 'America/Godthab',
      '-180,0'   : 'America/Argentina/Buenos_Aires',
      '-180,1,s' : 'America/Montevideo',
      '-120,0'   : 'America/Noronha',
      '-120,1'   : 'America/Noronha',
      '-60,1'    : 'Atlantic/Azores',
      '-60,0'    : 'Atlantic/Cape_Verde',
      '0,0'      : 'UTC',
      '0,1'      : 'Europe/London',
      '60,1'     : 'Europe/Berlin',
      '60,0'     : 'Africa/Lagos',
      '60,1,s'   : 'Africa/Windhoek',
      '120,1'    : 'Asia/Beirut',
      '120,0'    : 'Africa/Johannesburg',
      '180,0'    : 'Asia/Baghdad',
      '180,1'    : 'Europe/Moscow',
      '210,1'    : 'Asia/Tehran',
      '240,0'    : 'Asia/Dubai',
      '240,1'    : 'Asia/Baku',
      '270,0'    : 'Asia/Kabul',
      '300,1'    : 'Asia/Yekaterinburg',
      '300,0'    : 'Asia/Karachi',
      '330,0'    : 'Asia/Kolkata',
      '345,0'    : 'Asia/Kathmandu',
      '360,0'    : 'Asia/Dhaka',
      '360,1'    : 'Asia/Omsk',
      '390,0'    : 'Asia/Rangoon',
      '420,1'    : 'Asia/Krasnoyarsk',
      '420,0'    : 'Asia/Jakarta',
      '480,0'    : 'Asia/Shanghai',
      '480,1'    : 'Asia/Irkutsk',
      '525,0'    : 'Australia/Eucla',
      '525,1,s'  : 'Australia/Eucla',
      '540,1'    : 'Asia/Yakutsk',
      '540,0'    : 'Asia/Tokyo',
      '570,0'    : 'Australia/Darwin',
      '570,1,s'  : 'Australia/Adelaide',
      '600,0'    : 'Australia/Brisbane',
      '600,1'    : 'Asia/Vladivostok',
      '600,1,s'  : 'Australia/Sydney',
      '630,1,s'  : 'Australia/Lord_Howe',
      '660,1'    : 'Asia/Kamchatka',
      '660,0'    : 'Pacific/Noumea',
      '690,0'    : 'Pacific/Norfolk',
      '720,1,s'  : 'Pacific/Auckland',
      '720,0'    : 'Pacific/Tarawa',
      '765,1,s'  : 'Pacific/Chatham',
      '780,0'    : 'Pacific/Tongatapu',
      '780,1,s'  : 'Pacific/Apia',
      '840,0'    : 'Pacific/Kiritimati'
  };

  if (typeof exports !== 'undefined') {
    exports.jstz = jstz;
  } else {
    root.jstz = jstz;
  }
})(this);


},{}],26:[function(require,module,exports){
// Mingo.js 0.4.0
// Copyright (c) 2015 Francis Asante <kofrasa@gmail.com>
// MIT

(function (root, undefined) {

  "use strict";

  // global on the server, window in the browser
  var Mingo = {}, previousMingo;
  var _;

  // backup previous Mingo
  if (root != null) {
    previousMingo = root.Mingo;
  }

  Mingo.noConflict = function () {
    root.Mingo = previousMingo;
    return Mingo;
  };

  var nativeScriptEnabled = Boolean(((typeof android !== 'undefined' && android && android.widget && android.widget.Button)
    || (typeof UIButton !== 'undefined' && UIButton)));

  var nodeEnabled = ('undefined' !== typeof exports && 'undefined' !== typeof require && !nativeScriptEnabled);


  // Export the Mingo object for Node.js
  if (nodeEnabled || nativeScriptEnabled) {
    if (typeof module !== 'undefined' && module.exports) {
      exports = module.exports = Mingo;
    } else {
      exports = Mingo;
    }
    _ = require("underscore"); // get a reference to underscore
  } else {
    root.Mingo = Mingo;
    _ = root._; // get a reference to underscore
  }

  // quick reference for
  var primitives = [
    _.isString, _.isBoolean, _.isNumber, _.isDate, _.isNull, _.isRegExp
  ];

  function normalize(expr) {
    // normalized primitives
    for (var i = 0; i < primitives.length; i++) {
      if (primitives[i](expr)) {
        if (_.isRegExp(expr)) {
          return {"$regex": expr};
        } else {
          return {"$eq": expr};
        }
      }
    }
    // normalize object expression
    if (_.isObject(expr)) {
      var keys = _.keys(expr);
      var notQuery = _.intersection(Ops.queryOperators, keys).length === 0;

      // no valid query operator found, so we do simple comparison
      if (notQuery) {
        return {"$eq": expr};
      }

      // ensure valid regex
      if (_.contains(keys, "$regex")) {
        var regex = expr['$regex'];
        var options = expr['$options'] || "";
        var modifiers = "";
        if (_.isString(regex)) {
          modifiers += (regex.ignoreCase || options.indexOf("i") >= 0) ? "i" : "";
          modifiers += (regex.multiline || options.indexOf("m") >= 0) ? "m" : "";
          modifiers += (regex.global || options.indexOf("g") >= 0) ? "g" : "";
          regex = new RegExp(regex, modifiers);
        }
        expr['$regex'] = regex;
        delete expr['$options'];
      }
    }

    return expr;
  }

  // Settings used by Mingo internally
  var settings = {
    key: "_id"
  };

  /**
   * Setup default settings for Mingo
   * @param options
   */
  Mingo.setup = function (options) {
    _.extend(settings, options || {});
  };


  /**
   * Query object to test collection elements with
   * @param criteria the pass criteria for the query
   * @param projection optional projection specifiers
   * @constructor
   */
  Mingo.Query = function (criteria, projection) {
    if (!(this instanceof Mingo.Query))
      return new Mingo.Query(criteria, projection);

    this._criteria = criteria;
    this._projection = projection;
    this._compiled = [];
    this._compile();
  };

  Mingo.Query.prototype = {

    _compile: function () {

      if (_.isEmpty(this._criteria)) return;

      if (_.isArray(this._criteria) || _.isFunction(this._criteria) || !_.isObject(this._criteria)) {
        throw new Error("Invalid type for criteria");
      }

      for (var field in this._criteria) {
        if (this._criteria.hasOwnProperty(field)) {
          var expr = this._criteria[field];
          if (_.contains(['$and', '$or', '$nor', '$where'], field)) {
            this._processOperator(field, field, expr);
          } else {
            // normalize expression
            expr = normalize(expr);
            for (var op in expr) {
              if (expr.hasOwnProperty(op)) {
                this._processOperator(field, op, expr[op]);
              }
            }
          }
        }
      }
    },

    _processOperator: function (field, operator, value) {
      var compiledSelector;
      if (_.contains(Ops.simpleOperators, operator)) {
        compiledSelector = {
          test: function (obj) {
            var actualValue = resolve(obj, field);
            // value of operator must already be fully resolved.
            return simpleOperators[operator](actualValue, value);
          }
        };
      } else if (_.contains(Ops.compoundOperators, operator)) {
        compiledSelector = compoundOperators[operator](field, value);
      } else {
        throw new Error("Invalid query operator '" + operator + "' detected");
      }
      this._compiled.push(compiledSelector);
    },

    /**
     * Checks if the object passes the query criteria. Returns true if so, false otherwise.
     * @param obj
     * @returns {boolean}
     */
    test: function (obj) {
      for (var i = 0; i < this._compiled.length; i++) {
        if (!this._compiled[i].test(obj)) {
          return false;
        }
      }
      return true;
    },

    /**
     * Performs a query on a collection and returns a cursor object.
     * @param collection
     * @param projection
     * @returns {Mingo.Cursor}
     */
    find: function (collection, projection) {
      return new Mingo.Cursor(collection, this, projection);
    },

    /**
     * Remove matched documents from the collection returning the remainder
     * @param collection
     * @returns {Array}
     */
    remove: function (collection) {
      var arr = [];
      for (var i = 0; i < collection.length; i++) {
        if (!this.test(collection[i])) {
          arr.push(collection[i]);
        }
      }
      return arr;
    }
  };

  if (nodeEnabled) {

    var Transform = require('stream').Transform;
    var util = require('util');

    Mingo.Query.prototype.stream = function (options) {
      return new Mingo.Stream(this, options);
    };

    /**
     * Create a Transform class
     * @param query
     * @param options
     * @returns {Mingo.Stream}
     * @constructor
     */
    Mingo.Stream = function (query, options) {

      if (!(this instanceof Mingo.Stream))
        return new Mingo.Stream(query, options);

      options = options || {};
      _.extend(options, {objectMode: true});
      Transform.call(this, options);
      // query for this stream
      this._query = query;
    };
    // extend Transform
    util.inherits(Mingo.Stream, Transform);

    Mingo.Stream.prototype._transform = function (chunk, encoding, done) {
      if (_.isObject(chunk) && this._query.test(chunk)) {
        if (_.isEmpty(this._query._projection)) {
          this.push(chunk);
        } else {
          var cursor = new Mingo.Cursor([chunk], this._query);
          if (cursor.hasNext()) {
            this.push(cursor.next());
          }
        }
      }
      done();
    };
  }

  /**
   * Cursor to iterate and perform filtering on matched objects
   * @param collection
   * @param query
   * @param projection
   * @constructor
   */
  Mingo.Cursor = function (collection, query, projection) {

    if (!(this instanceof Mingo.Cursor))
      return new Mingo.Cursor(collection, query, projection);

    this._query = query;
    this._collection = collection;
    this._projection = projection || query._projection;
    this._operators = {};
    this._result = false;
    this._position = 0;
  };

  Mingo.Cursor.prototype = {

    _fetch: function () {
      var self = this;

      if (this._result !== false) {
        return this._result;
      }

      // inject projection operator
      if (_.isObject(this._projection)) {
        _.extend(this._operators, {"$project": this._projection});
      }

      if (!_.isArray(this._collection) && !_.isObject(this._collection)) {
        throw new Error("Input collection is not of valid type. Must be an Array.");
      }

      // filter collection
      this._result = _.filter(this._collection, this._query.test, this._query);
      var pipeline = [];

      _.each(['$sort', '$skip', '$limit', '$project'], function (op) {
        if (_.has(self._operators, op)) {
          pipeline.push(_.pick(self._operators, op));
        }
      });

      if (pipeline.length > 0) {
        var aggregator = new Mingo.Aggregator(pipeline);
        this._result = aggregator.run(this._result, this._query);
      }
      return this._result;
    },

    /**
     * Fetch and return all matched results
     * @returns {Array}
     */
    all: function () {
      return this._fetch();
    },

    /**
     * Fetch and return the first matching result
     * @returns {Object}
     */
    first: function () {
      return this.count() > 0 ? this._fetch()[0] : null;
    },

    /**
     * Fetch and return the last matching object from the result
     * @returns {Object}
     */
    last: function () {
      return this.count() > 0 ? this._fetch()[this.count() - 1] : null;
    },

    /**
     * Counts the number of matched objects found
     * @returns {Number}
     */
    count: function () {
      return this._fetch().length;
    },

    /**
     * Returns a cursor that begins returning results only after passing or skipping a number of documents.
     * @param {Number} n the number of results to skip.
     * @return {Mingo.Cursor} Returns the cursor, so you can chain this call.
     */
    skip: function (n) {
      _.extend(this._operators, {"$skip": n});
      return this;
    },

    /**
     * Constrains the size of a cursor's result set.
     * @param {Number} n the number of results to limit to.
     * @return {Mingo.Cursor} Returns the cursor, so you can chain this call.
     */
    limit: function (n) {
      _.extend(this._operators, {"$limit": n});
      return this;
    },

    /**
     * Returns results ordered according to a sort specification.
     * @param {Object} modifier an object of key and values specifying the sort order. 1 for ascending and -1 for descending
     * @return {Mingo.Cursor} Returns the cursor, so you can chain this call.
     */
    sort: function (modifier) {
      _.extend(this._operators, {"$sort": modifier});
      return this;
    },

    /**
     * Returns the next document in a cursor.
     * @returns {Object | Boolean}
     */
    next: function () {
      if (this.hasNext()) {
        return this._fetch()[this._position++];
      }
      return null;
    },

    /**
     * Returns true if the cursor has documents and can be iterated.
     * @returns {boolean}
     */
    hasNext: function () {
      return this.count() > this._position;
    },

    /**
     * Specifies the exclusive upper bound for a specific field
     * @param expr
     * @returns {Number}
     */
    max: function (expr) {
      return groupOperators.$max(this._fetch(), expr);
    },

    /**
     * Specifies the inclusive lower bound for a specific field
     * @param expr
     * @returns {Number}
     */
    min: function (expr) {
      return groupOperators.$min(this._fetch(), expr);
    },

    /**
     * Applies a function to each document in a cursor and collects the return values in an array.
     * @param callback
     * @returns {Array}
     */
    map: function (callback) {
      return _.map(this._fetch(), callback);
    },

    /**
     * Applies a JavaScript function for every document in a cursor.
     * @param callback
     */
    forEach: function (callback) {
      _.each(this._fetch(), callback);
    }

  };

  /**
   * Aggregator for defining filter using mongoDB aggregation pipeline syntax
   * @param operators an Array of pipeline operators
   * @constructor
   */
  Mingo.Aggregator = function (operators) {
    if (!(this instanceof Mingo.Aggregator))
      return new Mingo.Aggregator(operators);

    this._operators = operators;
  };

  Mingo.Aggregator.prototype = {

    /**
     * Apply the pipeline operations over the collection by order of the sequence added
     * @param collection an array of objects to process
     * @param query the `Mingo.Query` object to use as context
     * @returns {Array}
     */
    run: function (collection, query) {
      if (!_.isEmpty(this._operators)) {
        // run aggregation pipeline
        for (var i = 0; i < this._operators.length; i++) {
          var operator = this._operators[i];
          for (var key in operator) {
            if (operator.hasOwnProperty(key)) {
              if (query instanceof Mingo.Query) {
                collection = pipelineOperators[key].call(query, collection, operator[key]);
              } else {
                collection = pipelineOperators[key](collection, operator[key]);
              }
            }
          }
        }
      }
      return collection;
    }
  };

  /**
   * Retrieve the value of a given key on an object
   * @param obj
   * @param field
   * @returns {*}
   * @private
   */
  function getValue(obj, field) {
    return _.result(obj, field);
  }

  /**
   * Resolve the value of the field (dot separated) on the given object
   * @param obj
   * @param field
   * @returns {*}
   */
  function resolve(obj, field) {
    if (!field) {
      return undefined;
    }
    var names = field.split(".");
    var value = obj;
    var isText;

    for (var i = 0; i < names.length; i++) {
      isText = names[i].match(/^\d+$/) === null;

      if (isText && _.isArray(value)) {
        var res = [];
        _.each(value, function (item) {
          if (_.isObject(item)) {
            res.push(resolve(item, names[i]));
          }
        });
        value = res;
      } else {
        value = getValue(value, names[i]);
      }

      if (value === undefined) {
        break;
      }
    }

    return value;
  }

  /**
   * Performs a query on a collection and returns a cursor object.
   * @param collection
   * @param criteria
   * @param projection
   * @returns {Mingo.Cursor}
   */
  Mingo.find = function (collection, criteria, projection) {
    return (new Mingo.Query(criteria)).find(collection, projection);
  };

  /**
   * Returns a new array without objects which match the criteria
   * @param collection
   * @param criteria
   * @returns {Array}
   */
  Mingo.remove = function (collection, criteria) {
    return (new Mingo.Query(criteria)).remove(collection);
  };

  /**
   * Return the result collection after running the aggregation pipeline for the given collection
   * @param collection
   * @param pipeline
   * @returns {Array}
   */
  Mingo.aggregate = function (collection, pipeline) {
    if (!_.isArray(pipeline)) {
      throw new Error("Aggregation pipeline must be an array")
    }
    return (new Mingo.Aggregator(pipeline)).run(collection);
  };

  /**
   * Mixin for Backbone.Collection objects
   */
  Mingo.CollectionMixin = {
    /**
     * Runs a query and returns a cursor to the result
     * @param criteria
     * @param projection
     * @returns {Mingo.Cursor}
     */
    query: function (criteria, projection) {
      return Mingo.find(this.toJSON(), criteria, projection);
    },

    /**
     * Runs the given aggregation operators on this collection
     * @params pipeline
     * @returns {Array}
     */
    aggregate: function (pipeline) {
      var args = [this.toJSON(), pipeline];
      return Mingo.aggregate.apply(null, args);
    }
  };

  var pipelineOperators = {

    /**
     * Groups documents together for the purpose of calculating aggregate values based on a collection of documents.
     *
     * @param collection
     * @param expr
     * @returns {Array}
     */
    $group: function (collection, expr) {
      // lookup key for grouping
      var idKey = expr[settings.key];
      var indexes = [];
      // group collection by key
      var groups = _.groupBy(collection, function (obj) {
        var key = computeValue(obj, idKey, idKey);
        indexes.push(key);
        return key;
      });

      // group indexes
      indexes = _.uniq(indexes);

      // remove the group key
      expr = _.omit(expr, settings.key);

      var result = [];
      _.each(indexes, function (index) {
        var obj = {};
        obj[settings.key] = index;
        // compute remaining keys in expression
        for (var key in expr) {
          if (expr.hasOwnProperty(key)) {
            obj[key] = accumulate(groups[index], key, expr[key]);
          }
        }
        result.push(obj);
      });

      return result;
    },

    /**
     * Filters the document stream, and only allows matching documents to pass into the next pipeline stage.
     * $match uses standard MongoDB queries.
     *
     * @param collection
     * @param expr
     * @returns {Array|*}
     */
    $match: function (collection, expr) {
      return (new Mingo.Query(expr)).find(collection).all();
    },

    /**
     * Reshapes a document stream.
     * $project can rename, add, or remove fields as well as create computed values and sub-documents.
     *
     * @param collection
     * @param expr
     * @returns {Array}
     */
    $project: function (collection, expr) {

      if (_.isEmpty(expr)) {
        return collection;
      }

      // result collection
      var projected = [];
      var objKeys = _.keys(expr);

      if (_.contains(objKeys, settings.key)) {
        var id = expr[settings.key];
        if (id === 0 || id === false) {
          objKeys = _.without(objKeys, settings.key);
        }
      } else {
        // if not specified the add the ID field
        objKeys.push(settings.key);
      }

      for (var i = 0; i < collection.length; i++) {
        var obj = collection[i];
        var cloneObj = {};
        var foundSlice = false;
        var dropKeys = [];

        _.each(objKeys, function (key) {

          var subExpr = expr[key];
          var newValue;

          // tiny optimization here to skip over id
          if (key === settings.key && _.isEmpty(subExpr)) {
            newValue = obj[key];
          } else if (_.isString(subExpr)) {
            newValue = computeValue(obj, subExpr, key);
          } else if (subExpr === 1 || subExpr === true) {
            newValue = _.result(obj, key);
          } else if (_.isObject(subExpr)) {
            var operator = _.keys(subExpr);
            operator = operator.length > 1 ? false : operator[0];
            if (operator !== false && _.contains(Ops.projectionOperators, operator)) {
              // apply the projection operator on the operator expression for the key
              var temp = projectionOperators[operator](obj, subExpr[operator], key);
              if (!_.isUndefined(temp)) {
                newValue = temp;
              }
              if (operator == '$slice') {
                foundSlice = true;
              }
            } else {
              // compute the value for the sub expression for the key
              newValue = computeValue(obj, subExpr, key);
            }
          } else {
            dropKeys.push(key);
          }

          if (newValue !== undefined) {
            cloneObj[key] = _.isObject(newValue) ? _.clone(newValue) : newValue;
          }

        });
        // if projection included $slice operator
        // include keys that were not explicitly excluded
        if (foundSlice) {
          cloneObj = _.defaults(cloneObj, _.omit(obj, dropKeys));
        }
        projected.push(cloneObj);
      }

      return projected;
    },

    /**
     * Restricts the number of documents in an aggregation pipeline.
     *
     * @param collection
     * @param value
     * @returns {Object|*}
     */
    $limit: function (collection, value) {
      return _.first(collection, value);
    },

    /**
     * Skips over a specified number of documents from the pipeline and returns the rest.
     *
     * @param collection
     * @param value
     * @returns {*}
     */
    $skip: function (collection, value) {
      return _.rest(collection, value);
    },

    /**
     * Takes an array of documents and returns them as a stream of documents.
     *
     * @param collection
     * @param expr
     * @returns {Array}
     */
    $unwind: function (collection, expr) {
      var result = [];
      var field = expr.substr(1);
      for (var i = 0; i < collection.length; i++) {
        var obj = collection[i];
        // must throw an error if value is not an array
        var value = getValue(obj, field);
        if (_.isArray(value)) {
          _.each(value, function (item) {
            var tmp = _.clone(obj);
            tmp[field] = item;
            result.push(tmp);
          });
        } else {
          throw new Error("Target field '" + field + "' is not of type Array.");
        }
      }
      return result;
    },

    /**
     * Takes all input documents and returns them in a stream of sorted documents.
     *
     * @param collection
     * @param sortKeys
     * @returns {*}
     */
    $sort: function (collection, sortKeys) {
      if (!_.isEmpty(sortKeys) && _.isObject(sortKeys)) {
        var modifiers = _.keys(sortKeys);
        modifiers.reverse().forEach(function (key) {
          var indexes = [];
          var grouped = _.groupBy(collection, function (obj) {
            var value = resolve(obj, key);
            indexes.push(value);
            return value;
          });
          indexes = _.sortBy(_.uniq(indexes), function (item) {
            return item;
          });
          if (sortKeys[key] === -1) {
            indexes.reverse();
          }
          collection = [];
          _.each(indexes, function (item) {
            Array.prototype.push.apply(collection, grouped[item]);
          });
        });
      }
      return collection;
    }
  };

  var compoundOperators = {

    /**
     * Joins query clauses with a logical AND returns all documents that match the conditions of both clauses.
     *
     * @param selector
     * @param value
     * @returns {{test: Function}}
     */
    $and: function (selector, value) {
      if (!_.isArray(value)) {
        throw new Error("Invalid expression for $and criteria");
      }
      var queries = [];
      _.each(value, function (expr) {
        queries.push(new Mingo.Query(expr));
      });

      return {
        test: function (obj) {
          for (var i = 0; i < queries.length; i++) {
            if (!queries[i].test(obj)) {
              return false;
            }
          }
          return true;
        }
      };
    },

    /**
     * Joins query clauses with a logical OR returns all documents that match the conditions of either clause.
     *
     * @param selector
     * @param value
     * @returns {{test: Function}}
     */
    $or: function (selector, value) {
      if (!_.isArray(value)) {
        throw new Error("Invalid expression for $or criteria");
      }
      var queries = [];
      _.each(value, function (expr) {
        queries.push(new Mingo.Query(expr));
      });

      return {
        test: function (obj) {
          for (var i = 0; i < queries.length; i++) {
            if (queries[i].test(obj)) {
              return true;
            }
          }
          return false;
        }
      };
    },

    /**
     * Joins query clauses with a logical NOR returns all documents that fail to match both clauses.
     *
     * @param selector
     * @param value
     * @returns {{test: Function}}
     */
    $nor: function (selector, value) {
      if (!_.isArray(value)) {
        throw new Error("Invalid expression for $nor criteria");
      }
      var query = this.$or("$or", value);
      return {
        test: function (obj) {
          return !query.test(obj);
        }
      };
    },

    /**
     * Inverts the effect of a query expression and returns documents that do not match the query expression.
     *
     * @param selector
     * @param value
     * @returns {{test: Function}}
     */
    $not: function (selector, value) {
      var criteria = {};
      criteria[selector] = normalize(value);
      var query = new Mingo.Query(criteria);
      return {
        test: function (obj) {
          return !query.test(obj);
        }
      };
    },

    /**
     * Matches documents that satisfy a JavaScript expression.
     *
     * @param selector
     * @param value
     * @returns {{test: test}}
     */
    $where: function (selector, value) {
      if (!_.isFunction(value)) {
        value = new Function("return " + value + ";");
      }
      return {
        test: function (obj) {
          return value.call(obj) === true;
        }
      };
    }

  };

  var simpleOperators = {

    /**
     * Checks that two values are equal. Pseudo operator introduced for convenience and consistency
     *
     * @param a
     * @param b
     * @returns {*}
     */
    $eq: function (a, b) {
      a = _.isArray(a) ? a : [a];
      a = _.find(a, function (val) {
        return _.isEqual(val, b);
      });
      return a !== undefined;
    },

    /**
     * Matches all values that are not equal to the value specified in the query.
     *
     * @param a
     * @param b
     * @returns {boolean}
     */
    $ne: function (a, b) {
      return !this.$eq(a, b);
    },

    /**
     * Matches any of the values that exist in an array specified in the query.
     *
     * @param a
     * @param b
     * @returns {*}
     */
    $in: function (a, b) {
      a = _.isArray(a) ? a : [a];
      return _.intersection(a, b).length > 0;
    },

    /**
     * Matches values that do not exist in an array specified to the query.
     *
     * @param a
     * @param b
     * @returns {*|boolean}
     */
    $nin: function (a, b) {
      return _.isUndefined(a) || !this.$in(a, b);
    },

    /**
     * Matches values that are less than the value specified in the query.
     *
     * @param a
     * @param b
     * @returns {boolean}
     */
    $lt: function (a, b) {
      a = _.isArray(a) ? a : [a];
      a = _.find(a, function (val) {
        return val < b
      });
      return a !== undefined;
    },

    /**
     * Matches values that are less than or equal to the value specified in the query.
     *
     * @param a
     * @param b
     * @returns {boolean}
     */
    $lte: function (a, b) {
      a = _.isArray(a) ? a : [a];
      a = _.find(a, function (val) {
        return val <= b
      });
      return a !== undefined;
    },

    /**
     * Matches values that are greater than the value specified in the query.
     *
     * @param a
     * @param b
     * @returns {boolean}
     */
    $gt: function (a, b) {
      a = _.isArray(a) ? a : [a];
      a = _.find(a, function (val) {
        return val > b
      });
      return a !== undefined;
    },

    /**
     * Matches values that are greater than or equal to the value specified in the query.
     *
     * @param a
     * @param b
     * @returns {boolean}
     */
    $gte: function (a, b) {
      a = _.isArray(a) ? a : [a];
      a = _.find(a, function (val) {
        return val >= b
      });
      return a !== undefined;
    },

    /**
     * Performs a modulo operation on the value of a field and selects documents with a specified result.
     *
     * @param a
     * @param b
     * @returns {*|boolean|boolean}
     */
    $mod: function (a, b) {
      a = _.isArray(a) ? a : [a];
      a = _.find(a, function (val) {
        return _.isNumber(val) && _.isArray(b) && b.length === 2 && (val % b[0]) === b[1];
      });
      return a !== undefined;
    },

    /**
     * Selects documents where values match a specified regular expression.
     *
     * @param a
     * @param b
     * @returns {*|boolean}
     */
    $regex: function (a, b) {
      a = _.isArray(a) ? a : [a];
      a = _.find(a, function (val) {
        return _.isString(val) && _.isRegExp(b) && (!!val.match(b));
      });
      return a !== undefined;
    },

    /**
     * Matches documents that have the specified field.
     *
     * @param a
     * @param b
     * @returns {boolean|*|boolean}
     */
    $exists: function (a, b) {
      return (b === false && _.isUndefined(a)) || (b === true && !_.isUndefined(a));
    },

    /**
     * Matches arrays that contain all elements specified in the query.
     *
     * @param a
     * @param b
     * @returns boolean
     */
    $all: function (a, b) {
      var self = this;
      var matched = false;
      if (_.isArray(a) && _.isArray(b)) {
        for (var i = 0; i < b.length; i++) {
          if (_.isObject(b[i]) && _.contains(_.keys(b[i]), "$elemMatch")) {
            matched = matched || self.$elemMatch(a, b[i].$elemMatch);
          } else {
            // order of arguments matter. underscore maintains order after intersection
            return _.intersection(b, a).length === b.length;
          }
        }
      }
      return matched;
    },

    /**
     * Selects documents if the array field is a specified size.
     *
     * @param a
     * @param b
     * @returns {*|boolean}
     */
    $size: function (a, b) {
      return _.isArray(a) && _.isNumber(b) && (a.length === b);
    },

    /**
     * Selects documents if element in the array field matches all the specified $elemMatch condition.
     *
     * @param a
     * @param b
     */
    $elemMatch: function (a, b) {
      if (_.isArray(a) && !_.isEmpty(a)) {
        var query = new Mingo.Query(b);
        for (var i = 0; i < a.length; i++) {
          if (query.test(a[i])) {
            return true;
          }
        }
      }
      return false;
    },

    /**
     * Selects documents if a field is of the specified type.
     *
     * @param a
     * @param b
     * @returns {boolean}
     */
    $type: function (a, b) {
      switch (b) {
        case 1:
          return _.isNumeric(a) && (a + "").indexOf(".") !== -1;
        case 2:
        case 5:
          return _.isString(a);
        case 3:
          return _.isObject(a);
        case 4:
          return _.isArray(a);
        case 8:
          return _.isBoolean(a);
        case 9:
          return _.isDate(a);
        case 10:
          return _.isNull(a);
        case 11:
          return _.isRegExp(a);
        case 16:
          return _.isNumeric(a) && a <= 2147483647 && (a + "").indexOf(".") === -1;
        case 18:
          return _.isNumeric(a) && a > 2147483647 && a <= 9223372036854775807 && (a + "").indexOf(".") === -1;
        default:
          return false;
      }
    }

  };

  var projectionOperators = {

    /**
     * Projects the first element in an array that matches the query condition.
     *
     * @param obj
     * @param field
     * @param expr
     */
    $: function (obj, expr, field) {
      throw new Error("$ not implemented");
    },

    /**
     * Projects only the first element from an array that matches the specified $elemMatch condition.
     *
     * @param obj
     * @param field
     * @param expr
     * @returns {*}
     */
    $elemMatch: function (obj, expr, field) {
      var array = resolve(obj, field);
      var query = new Mingo.Query(expr);

      if (_.isUndefined(array) || !_.isArray(array)) {
        return undefined;
      }

      for (var i = 0; i < array.length; i++) {
        if (query.test(array[i])) {
          return [array[i]];
        }
      }

      return undefined;
    },

    /**
     * Limits the number of elements projected from an array. Supports skip and limit slices.
     *
     * @param obj
     * @param field
     * @param expr
     */
    $slice: function (obj, expr, field) {
      var array = resolve(obj, field);

      if (!_.isArray(array)) {
        return array;
      }
      if (!_.isArray(expr)) {
        if (!_.isNumber(expr)) {
          throw new Error("Invalid type for $slice operator");
      }
        expr = expr < 0 ? [expr] : [0, expr];
      } else {
        // MongoDB $slice works a bit differently from Array.slice
        // Uses single argument for 'limit' and array argument [skip, limit]
        var skip = (expr[0] < 0) ? array.length + expr[0] : expr;
        var limit = skip + expr[1];
        expr = [skip, limit];
      }

      return Array.prototype.slice.apply(array, expr);
    }
  };

  var groupOperators = {

    /**
     * Returns an array of all the unique values for the selected field among for each document in that group.
     *
     * @param collection
     * @param expr
     * @returns {*}
     */
    $addToSet: function (collection, expr) {
      var result = _.map(collection, function (obj) {
        return computeValue(obj, expr);
      });
      return _.uniq(result);
    },

    /**
     * Returns the sum of all the values in a group.
     *
     * @param collection
     * @param expr
     * @returns {*}
     */
    $sum: function (collection, expr) {
      if (_.isNumber(expr)) {
        // take a short cut if expr is number literal
        return collection.length * expr;
      }
      return _.reduce(collection, function (acc, obj) {
        // pass empty field to avoid naming conflicts with fields on documents
        return acc + computeValue(obj, expr);
      }, 0);
    },

    /**
     * Returns the highest value in a group.
     *
     * @param collection
     * @param expr
     * @returns {*}
     */
    $max: function (collection, expr) {
      var obj = _.max(collection, function (obj) {
        return computeValue(obj, expr);
      });
      return computeValue(obj, expr);
    },

    /**
     * Returns the lowest value in a group.
     *
     * @param collection
     * @param expr
     * @returns {*}
     */
    $min: function (collection, expr) {
      var obj = _.min(collection, function (obj) {
        return computeValue(obj, expr);
      });
      return computeValue(obj, expr);
    },

    /**
     * Returns an average of all the values in a group.
     *
     * @param collection
     * @param expr
     * @returns {number}
     */
    $avg: function (collection, expr) {
      return this.$sum(collection, expr) / (collection.length || 1);
    },

    /**
     * Returns an array of all values for the selected field among for each document in that group.
     *
     * @param collection
     * @param expr
     * @returns {Array|*}
     */
    $push: function (collection, expr) {
      return _.map(collection, function (obj) {
        return computeValue(obj, expr);
      });
    },

    /**
     * Returns the first value in a group.
     *
     * @param collection
     * @param expr
     * @returns {*}
     */
    $first: function (collection, expr) {
      return (collection.length > 0) ? computeValue(collection[0], expr) : undefined;
    },

    /**
     * Returns the last value in a group.
     *
     * @param collection
     * @param expr
     * @returns {*}
     */
    $last: function (collection, expr) {
      return (collection.length > 0) ? computeValue(collection[collection.length - 1], expr) : undefined;
    }
  };


  /////////// Common Aggregation Operators ///////////

  var arithmeticOperators = {

    /**
     * Computes the sum of an array of numbers.
     *
     * @param obj
     * @param expr
     * @returns {Object}
     */
    $add: function (obj, expr) {
      var args = computeValue(obj, expr);
      return _.reduce(args, function (memo, num) {
        return memo + num;
      }, 0);
    },

    /**
     * Takes an array that contains two numbers or two dates and subtracts the second value from the first.
     *
     * @param obj
     * @param expr
     * @returns {number}
     */
    $subtract: function (obj, expr) {
      var args = computeValue(obj, expr);
      return args[0] - args[1];
    },

    /**
     * Takes two numbers and divides the first number by the second.
     *
     * @param obj
     * @param expr
     * @returns {number}
     */
    $divide: function (obj, expr) {
      var args = computeValue(obj, expr);
      return args[0] / args[1];
    },

    /**
     * Computes the product of an array of numbers.
     *
     * @param obj
     * @param expr
     * @returns {Object}
     */
    $multiply: function (obj, expr) {
      var args = computeValue(obj, expr);
      return _.reduce(args, function (memo, num) {
        return memo * num;
      }, 1);
    },

    /**
     * Takes two numbers and calculates the modulo of the first number divided by the second.
     *
     * @param obj
     * @param expr
     * @returns {number}
     */
    $mod: function (obj, expr) {
      var args = computeValue(obj, expr);
      return args[0] % args[1];
    }
  };

  var stringOperators = {

    /**
     * Concatenates two strings.
     *
     * @param obj
     * @param expr
     * @returns {string|*}
     */
    $concat: function (obj, expr) {
      var args = computeValue(obj, expr);
      // does not allow concatenation with nulls
      if (_.contains(args, null) || _.contains(args, undefined)) {
        return null;
      }
      return args.join("");
    },

    /**
     * Compares two strings and returns an integer that reflects the comparison.
     *
     * @param obj
     * @param expr
     * @returns {number}
     */
    $strcasecmp: function (obj, expr) {
      var args = computeValue(obj, expr);
      args[0] = _.isEmpty(args[0]) ? "" : args[0].toUpperCase();
      args[1] = _.isEmpty(args[1]) ? "" : args[1].toUpperCase();
      if (args[0] > args[1]) {
        return 1;
      }
      return (args[0] < args[1]) ? -1 : 0;
    },

    /**
     * Returns a substring of a string, starting at a specified index position and including the specified number of characters.
     * The index is zero-based.
     *
     * @param obj
     * @param expr
     * @returns {string}
     */
    $substr: function (obj, expr) {
      var args = computeValue(obj, expr);
      if (_.isString(args[0])) {
        if (args[1] < 0) {
          return "";
        } else if (args[2] < 0) {
          return args[0].substr(args[1]);
        } else {
          return args[0].substr(args[1], args[2]);
        }
      }
      return "";
    },

    /**
     * Converts a string to lowercase.
     *
     * @param obj
     * @param expr
     * @returns {string}
     */
    $toLower: function (obj, expr) {
      var value = computeValue(obj, expr);
      return _.isEmpty(value) ? "" : value.toLowerCase();
    },

    /**
     * Converts a string to uppercase.
     *
     * @param obj
     * @param expr
     * @returns {string}
     */
    $toUpper: function (obj, expr) {
      var value = computeValue(obj, expr);
      return _.isEmpty(value) ? "" : value.toUpperCase();
    }
  };

  var dateOperators = {
    /**
     * Returns the day of the year for a date as a number between 1 and 366 (leap year).
     * @param obj
     * @param expr
     */
    $dayOfYear: function (obj, expr) {
      var d = computeValue(obj, expr);
      if (_.isDate(value)) {
        var start = new Date(d.getFullYear(), 0, 0);
        var diff = d - start;
        var oneDay = 1000 * 60 * 60 * 24;
        return Math.round(diff / oneDay);
      }
      return undefined;
    },

    /**
     * Returns the day of the month for a date as a number between 1 and 31.
     * @param obj
     * @param expr
     */
    $dayOfMonth: function (obj, expr) {
      var d = computeValue(obj, expr);
      return _.isDate(d) ? d.getDate() : undefined;
    },

    /**
     * Returns the day of the week for a date as a number between 1 (Sunday) and 7 (Saturday).
     * @param obj
     * @param expr
     */
    $dayOfWeek: function (obj, expr) {
      var d = computeValue(obj, expr);
      return _.isDate(d) ? d.getDay() + 1 : undefined;
    },

    /**
     * Returns the year for a date as a number (e.g. 2014).
     * @param obj
     * @param expr
     */
    $year: function (obj, expr) {
      var d = computeValue(obj, expr);
      return _.isDate(d) ? d.getFullYear() + 1 : undefined;
    },

    /**
     * Returns the month for a date as a number between 1 (January) and 12 (December).
     * @param obj
     * @param expr
     */
    $month: function (obj, expr) {
      var d = computeValue(obj, expr);
      return _.isDate(d) ? d.getMonth() + 1 : undefined;
    },

    /**
     * Returns the week number for a date as a number between 0
     * (the partial week that precedes the first Sunday of the year) and 53 (leap year).
     * @param obj
     * @param expr
     */
    $week: function (obj, expr) {
      var d = computeValue(obj, expr);
      // TODO
      throw new Error("Not Implemented");
    },

    /**
     * Returns the hour for a date as a number between 0 and 23.
     * @param obj
     * @param expr
     */
    $hour: function (obj, expr) {
      var d = computeValue(obj, expr);
      return _.isDate(d) ? d.getHours() : undefined;
    },

    /**
     * Returns the minute for a date as a number between 0 and 59.
     * @param obj
     * @param expr
     */
    $minute: function (obj, expr) {
      var d = computeValue(obj, expr);
      return _.isDate(d) ? d.getMinutes() : undefined;
    },

    /**
     * Returns the seconds for a date as a number between 0 and 60 (leap seconds).
     * @param obj
     * @param expr
     */
    $second: function (obj, expr) {
      var d = computeValue(obj, expr);
      return _.isDate(d) ? d.getSeconds() : undefined;
    },

    /**
     * Returns the milliseconds of a date as a number between 0 and 999.
     * @param obj
     * @param expr
     */
    $millisecond: function (obj, expr) {
      var d = computeValue(obj, expr);
      return _.isDate(d) ? d.getMilliseconds() : undefined;
    },

    /**
     * Returns the date as a formatted string.
     * @param obj
     * @param expr
     */
    $dateToString: function (obj, expr) {
      var fmt = expr['format'];
      var date = computeValue(obj, expr['date']);
      // TODO: use python-style date formatting
      /*
       %Y	Year (4 digits, zero padded)	0000-9999
       %m	Month (2 digits, zero padded)	01-12
       %d	Day of Month (2 digits, zero padded)	01-31
       %H	Hour (2 digits, zero padded, 24-hour clock)	00-23
       %M	Minute (2 digits, zero padded)	00-59
       %S	Second (2 digits, zero padded)	00-60
       %L	Millisecond (3 digits, zero padded)	000-999
       %j	Day of year (3 digits, zero padded)	001-366
       %w	Day of week (1-Sunday, 7-Saturday)	1-7
       %U	Week of year (2 digits, zero padded)	00-53
       %%	Percent Character as a Literal	%
       */
      throw new Error("Not Implemented");
    }
  };

  var setOperators = {
    /**
     * Returns true if two sets have the same elements.
     * @param obj
     * @param expr
     */
    $setEquals: function (obj, expr) {
      var args = computeValue(obj, expr);
      var first = _.uniq(args[0]);
      var second = _.uniq(args[1]);
      if (first.length !== second.length) {
        return false;
      }
      return _.difference(first, second).length == 0;
    },

    /**
     * Returns the common elements of the input sets.
     * @param obj
     * @param expr
     */
    $setIntersection: function (obj, expr) {
      var args = computeValue(obj, expr);
      return _.intersection(args[0], args[1]);
    },

    /**
     * Returns elements of a set that do not appear in a second set.
     * @param obj
     * @param expr
     */
    $setDifference: function (obj, expr) {
      var args = computeValue(obj, expr);
      return _.difference(args[0], args[1]);
    },

    /**
     * Returns a set that holds all elements of the input sets.
     * @param obj
     * @param expr
     */
    $setUnion: function (obj, expr) {
      var args = computeValue(obj, expr);
      return _.union(args[0], args[1]);
    },

    /**
     * Returns true if all elements of a set appear in a second set.
     * @param obj
     * @param expr
     */
    $setIsSubset: function (obj, expr) {
      var args = computeValue(obj, expr);
      return _.intersection(args[0], args[1]).length === args[0].length;
    },

    /**
     * Returns true if any elements of a set evaluate to true, and false otherwise.
     * @param obj
     * @param expr
     */
    $anyElementTrue: function (obj, expr) {
      // mongodb nests the array expression in another
      var args = computeValue(obj, expr)[0];
      for (var i = 0; i < args.length; i++) {
        if (!!args[i])
          return true;
      }
      return false;
    },

    /**
     * Returns true if all elements of a set evaluate to true, and false otherwise.
     * @param obj
     * @param expr
     */
    $allElementsTrue: function (obj, expr) {
      // mongodb nests the array expression in another
      var args = computeValue(obj, expr)[0];
      for (var i = 0; i < args.length; i++) {
        if (!args[i])
          return false;
      }
      return true;
    }
  };

  var conditionalOperators = {

    /**
     * A ternary operator that evaluates one expression,
     * and depending on the result returns the value of one following expressions.
     *
     * @param obj
     * @param expr
     */
    $cond: function (obj, expr) {
      var ifExpr, thenExpr, elseExpr;
      if (_.isArray(expr)) {
        if (expr.length != 3) {
          throw new Error("Invalid arguments for $cond operator");
        }
        ifExpr = expr[0];
        thenExpr = expr[1];
        elseExpr = expr[2];
      } else if (_.isObject(expr)) {
        ifExpr = expr['if'];
        thenExpr = expr['then'];
        elseExpr = expr['else'];
      }
      var condition = computeValue(obj, ifExpr);
      return condition ? computeValue(obj, thenExpr) : computeValue(obj, elseExpr);
    },

    /**
     * Evaluates an expression and returns the first expression if it evaluates to a non-null value.
     * Otherwise, $ifNull returns the second expression's value.
     *
     * @param obj
     * @param expr
     * @returns {*}
     */
    $ifNull: function (obj, expr) {
      if (!_.isArray(expr) || expr.length != 2) {
        throw new Error("Invalid arguments for $ifNull operator");
      }
      var args = computeValue(obj, expr);
      return (args[0] === null || args[0] === undefined) ? args[1] : args[0];
    }
  };

  var comparisonOperators = {
    /**
     * Compares two values and returns the result of the comparison as an integer.
     *
     * @param obj
     * @param expr
     * @returns {number}
     */
    $cmp: function (obj, expr) {
      var args = computeValue(obj, expr);
      if (args[0] > args[1]) {
        return 1;
      }
      return (args[0] < args[1]) ? -1 : 0;
    }
  };

  // combine aggregate operators
  var aggregateOperators = _.extend(
      {},
      arithmeticOperators,
      comparisonOperators,
      conditionalOperators,
      dateOperators,
      setOperators,
      stringOperators
    );

  // mixin comparison operators
  _.each(["$eq", "$ne", "$gt", "$gte", "$lt", "$lte"], function (op) {
    aggregateOperators[op] = function (obj, expr) {
      var args = computeValue(obj, expr);
      return simpleOperators[op](args[0], args[1]);
    };
  });

  var Ops = {
    simpleOperators: _.keys(simpleOperators),
    compoundOperators: _.keys(compoundOperators),
    aggregateOperators: _.keys(aggregateOperators),
    groupOperators: _.keys(groupOperators),
    pipelineOperators: _.keys(pipelineOperators),
    projectionOperators: _.keys(projectionOperators)
  };
  Ops.queryOperators = _.union(Ops.simpleOperators, Ops.compoundOperators);

  /**
   * Returns the result of evaluating a $group operation over a collection
   *
   * @param collection
   * @param field the name of the aggregate operator or field
   * @param expr the expression of the aggregate operator for the field
   * @returns {*}
   */
  function accumulate(collection, field, expr) {
    if (_.contains(Ops.groupOperators, field)) {
      return groupOperators[field](collection, expr);
    }

    if (_.isObject(expr)) {
      var result = {};
      for (var key in expr) {
        if (expr.hasOwnProperty(key)) {
          result[key] = accumulate(collection, key, expr[key]);
          // must run ONLY one group operator per expression
          // if so, return result of the computed value
          if (_.contains(Ops.groupOperators, key)) {
            result = result[key];
            // if there are more keys in expression this is bad
            if (_.keys(expr).length > 1) {
              throw new Error("Invalid $group expression '" + JSON.stringify(expr) + "'");
            }
            break;
          }
        }
      }
      return result;
    }

    return undefined;
  }

  /**
   * Computes the actual value of the expression using the given object as context
   *
   * @param obj the current object from the collection
   * @param expr the expression for the given field
   * @param field the field name (may also be an aggregate operator)
   * @returns {*}
   */
  function computeValue(obj, expr, field) {

    // if the field of the object is a valid operator
    if (_.contains(Ops.aggregateOperators, field)) {
      return aggregateOperators[field](obj, expr);
    }

    // if expr is a variable for an object field
    // field not used in this case
    if (_.isString(expr) && expr.length > 0 && expr[0] === "$") {
      return resolve(obj, expr.slice(1));
    }

    var result;

    if (_.isArray(expr)) {
      result = [];
      for (var i = 0; i < expr.length; i++) {
        result.push(computeValue(obj, expr[i], null));
      }
    } else if (_.isObject(expr)) {
      result = {};
      for (var key in expr) {
        if (expr.hasOwnProperty(key)) {
          result[key] = computeValue(obj, expr[key], key);

          // must run ONLY one aggregate operator per expression
          // if so, return result of the computed value
          if (_.contains(Ops.aggregateOperators, key)) {
            result = result[key];
            // if there are more keys in expression this is bad
            if (_.keys(expr).length > 1) {
              throw new Error("Invalid aggregation expression '" + JSON.stringify(expr) + "'");
            }
            break;
          }
        }
      }
    } else {
      // check and return value if already in a resolved state
      for (var i = 0; i < primitives.length; i++) {
        if (primitives[i](expr)) {
          return expr;
        }
      }
    }

    return result;
  }

}(this));
},{"stream":21,"underscore":41,"util":24}],27:[function(require,module,exports){

/**
 * Module dependencies.
 */

var ops = require('./ops');
var eql = require('mongo-eql');
var dot = require('dot-component');
var type = require('component-type');
var object = require('object-component');
var debug = require('debug')('mongo-query');

/**
 * Module exports.
 */

module.exports = exports = filter;
exports.ops = ops;

/**
 * Filters an `obj` by the given `query` for subdocuments.
 *
 * @return {Object|Boolean} false if no match, or matched subdocs
 * @api public
 */

function filter(obj, query){
  obj = obj || {};
  var ret = {};

  for (var key in query) {
    if (!query.hasOwnProperty(key)) continue;

    // search value
    var val = query[key];

    // split the key into prefix and suffix
    var keys = key.split('.');
    var target = obj;
    var prefix, search;
    var matches = [];

    walk_keys:
    for (var i = 0; i < keys.length; i++) {
      target = target[keys[i]];

      switch (type(target)) {
        case 'array':
          // if it's an array subdocument search we stop here
          prefix = keys.slice(0, i + 1).join('.');
          search = keys.slice(i + 1).join('.');

          debug('searching array "%s"', prefix);

          // we special case operators that don't walk the array
          if (val.$size && !search.length) {
            return compare(val, target);
          }

          // walk subdocs
          var subset = ret[prefix] || target;

          for (var ii = 0; ii < subset.length; ii++) {
            if (search.length) {
              var q = {};
              q[search] = val;
              if ('object' == type(subset[ii])) {
                debug('attempting subdoc search with query %j', q);
                if (filter(subset[ii], q)) {
                  // we ignore the ret value of filter
                  if (!ret[prefix] || !~ret[prefix].indexOf(subset[ii])) {
                    matches.push(subset[ii]);
                  }
                }
              }
            } else {
              debug('performing simple array item search');
              if (compare(val, subset[ii])) {
                if (!ret[prefix] || !~ret[prefix].indexOf(subset[ii])) {
                  matches.push(subset[ii]);
                }
              }
            }
          }

          if (matches.length) {
            ret[prefix] = ret[prefix] || [];
            ret[prefix].push.apply(ret[prefix], matches);
          }

          // we don't continue the key search
          break walk_keys;

        case 'undefined':
          // if we can't find the key
          return false;

        case 'object':
          if (null != keys[i + 1]) {
            continue;
          } else if (!compare(val, target)) {
            return false;
          }
          break;

        default:
          if (!compare(val, target)) return false;
      }
    }
  }

  return ret;
}

/**
 * Compares the given matcher with the document value.
 *
 * @param {Mixed} matcher
 * @param {Mixed} value
 * @api private
 */

function compare(matcher, val){
  if ('object' != type(matcher)) {
    return eql(matcher, val);
  }

  var keys = object.keys(matcher);
  if ('$' == keys[0][0]) {
    for (var i = 0; i < keys.length; i++) {
      // special case for sub-object matching
      if ('$elemMatch' == keys[i]) {
        return false !== filter(val, matcher.$elemMatch);
      } else {
        if (!ops[keys[i]](matcher[keys[i]], val)) return false;
      }
    }
    return true;
  } else {
    return eql(matcher, val);
  }
}

},{"./ops":38,"component-type":30,"debug":31,"dot-component":34,"mongo-eql":36,"object-component":37}],28:[function(require,module,exports){

/**
 * Module dependencies.
 */

var mods = require('./mods');
var filter = require('./filter');
var dot = require('dot-component');
var type = require('component-type');
var object = require('object-component');
var debug = require('debug')('mongo-query');

/**
 * Module exports.
 */

module.exports = exports = query;

/**
 * Export filter helper.
 */

exports.filter = filter;

/**
 * Export modifiers.
 */

exports.mods = mods;

/**
 * Execute a query.
 *
 * Options:
 *  - `strict` only modify if query matches
 *
 * @param {Object} object to alter
 * @param {Object} query to filter modifications by
 * @param {Object} update object
 * @param {Object} options
 */

function query(obj, query, update, opts){
  obj = obj || {};
  opts = opts || {};
  query = query || {};
  update = update || {};

  // strict mode
  var strict = !!opts.strict;

  var match;
  var log = [];

  if (object.length(query)) {
    match = filter(obj, query);
  }

  if (!strict || false !== match) {
    var keys = object.keys(update);
    var transactions = [];

    for (var i = 0, l = keys.length; i < l; i++) {
      if (mods[keys[i]]) {
        debug('found modifier "%s"', keys[i]);
        for (var key in update[keys[i]]) {
          var pos = key.indexOf('.$.');

          if (~pos) {
            var prefix = key.substr(0, pos);
            var suffix = key.substr(pos + 3);

            if (match[prefix]) {
              debug('executing "%s" %s on first match within "%s"', key, keys[i], prefix);
              var fn = mods[keys[i]](match[prefix][0], suffix, update[keys[i]][key]);
              if (fn) {
                // produce a key name replacing $ with the actual index
                // TODO: this is unnecessarily expensive
                var index = dot.get(obj, prefix).indexOf(match[prefix][0]);
                fn.key = prefix + '.' + index + '.' + suffix;
                fn.op = keys[i];
                transactions.push(fn);
              }
            } else {
              debug('ignoring "%s" %s - no matches within "%s"', key, keys[i], prefix);
            }
          } else {
            var fn = mods[keys[i]](obj, key, update[keys[i]][key]);
            if (fn) {
              fn.key = key;
              fn.op = keys[i];
              transactions.push(fn);
            }
          }
        }
      } else {
        debug('skipping unknown modifier "%s"', keys[i]);
      }
    }

    if (transactions.length) {
      // if we got here error free we process all transactions
      for (var i = 0; i < transactions.length; i++) {
        var fn = transactions[i];
        var val = fn();
        log.push({ op: fn.op, key: fn.key, value: val });
      }
    }
  } else {
    debug('no matches for query %j', query);
  }

  return log;
}

},{"./filter":27,"./mods":29,"component-type":30,"debug":31,"dot-component":34,"object-component":37}],29:[function(require,module,exports){

/**
 * Module dependencies.
 */

var eql = require('mongo-eql');
var dot = require('dot-component');
var type = require('component-type');
var keys = require('object-component').keys;
var debug = require('debug')('mongo-query');

/**
 * Performs a `$set`.
 *
 * @param {Object} object to modify
 * @param {String} path to alter
 * @param {String} value to set
 * @return {Function} transaction (unless noop)
 */

exports.$set = function $set(obj, path, val){
  var key = path.split('.').pop();
  obj = dot.parent(obj, path, true);

  switch (type(obj)) {
    case 'object':
      if (!eql(obj[key], val)) {
        return function(){
          obj[key] = val;
          return val;
        };
      }
      break;

    case 'array':
      if (numeric(key)) {
        if (!eql(obj[key], val)) {
          return function(){
            obj[key] = val;
            return val;
          };
        }
      } else {
        throw new Error('can\'t append to array using string field name [' + key + ']');
      }
      break;

    default:
      throw new Error('$set only supports object not ' + type(obj));
  }
};

/**
 * Performs an `$unset`.
 *
 * @param {Object} object to modify
 * @param {String} path to alter
 * @param {String} value to set
 * @return {Function} transaction (unless noop)
 */

exports.$unset = function $unset(obj, path){
  var key = path.split('.').pop();
  obj = dot.parent(obj, path);

  switch (type(obj)) {
    case 'array':
    case 'object':
      if (obj.hasOwnProperty(key)) {
        return function(){
          // reminder: `delete arr[1]` === `delete arr['1']` [!]
          delete obj[key];
        };
      } else {
        // we fail silently
        debug('ignoring unset of inexisting key');
      }
  }
};

/**
 * Performs a `$rename`.
 *
 * @param {Object} object to modify
 * @param {String} path to alter
 * @param {String} value to set
 * @return {Function} transaction (unless noop)
 */

exports.$rename = function $rename(obj, path, newKey){
  // target = source
  if (path == newKey) {
    throw new Error('$rename source must differ from target');
  }

  // target is parent of source
  if (0 === path.indexOf(newKey + '.')) {
    throw new Error('$rename target may not be a parent of source');
  }

  var p = dot.parent(obj, path);
  var t = type(p);

  if ('object' == t) {
    var key = path.split('.').pop();

    if (p.hasOwnProperty(key)) {
      return function(){
        var val = p[key];
        delete p[key];

        // target does initialize the path
        var newp = dot.parent(obj, newKey, true);

        // and also fails silently upon type mismatch
        if ('object' == type(newp)) {
          newp[newKey.split('.').pop()] = val;
        } else {
          debug('invalid $rename target path type');
        }

        // returns the name of the new key
        return newKey;
      };
    } else {
      debug('ignoring rename from inexisting source');
    }
  } else if ('undefined' != t) {
    throw new Error('$rename source field invalid');
  }
};

/**
 * Performs an `$inc`.
 *
 * @param {Object} object to modify
 * @param {String} path to alter
 * @param {String} value to set
 * @return {Function} transaction (unless noop)
 */

exports.$inc = function $inc(obj, path, inc){
  if ('number' != type(inc)) {
    throw new Error('Modifier $inc allowed for numbers only');
  }

  obj = dot.parent(obj, path, true);
  var key = path.split('.').pop();

  switch (type(obj)) {
    case 'array':
    case 'object':
      if (obj.hasOwnProperty(key)) {
        if ('number' != type(obj[key])) {
          throw new Error('Cannot apply $inc modifier to non-number');
        }

        return function(){
          obj[key] += inc;
          return inc;
        };
      } else if('object' == type(obj) || numeric(key)){
        return function(){
          obj[key] = inc;
          return inc;
        };
      } else {
        throw new Error('can\'t append to array using string field name [' + key + ']');
      }
      break;

    default:
      throw new Error('Cannot apply $inc modifier to non-number');
  }
};

/**
 * Performs an `$pop`.
 *
 * @param {Object} object to modify
 * @param {String} path to alter
 * @param {String} value to set
 * @return {Function} transaction (unless noop)
 */

exports.$pop = function $pop(obj, path, val){
  obj = dot.parent(obj, path);
  var key = path.split('.').pop();

  // we make sure the array is not just the parent of the main key
  switch (type(obj)) {
    case 'array':
    case 'object':
      if (obj.hasOwnProperty(key)) {
        switch (type(obj[key])) {
          case 'array':
            if (obj[key].length) {
              return function(){
                if (-1 == val) {
                  return obj[key].shift();
                } else {
                  // mongodb allows any value to pop
                  return obj[key].pop();
                }
              };
            }
            break;

          case 'undefined':
            debug('ignoring pop to inexisting key');
            break;

          default:
            throw new Error('Cannot apply $pop modifier to non-array');
        }
      } else {
        debug('ignoring pop to inexisting key');
      }
      break;

    case 'undefined':
      debug('ignoring pop to inexisting key');
      break;
  }
};

/**
 * Performs a `$push`.
 *
 * @param {Object} object to modify
 * @param {String} path to alter
 * @param {Object} value to push
 * @return {Function} transaction (unless noop)
 */

exports.$push = function $push(obj, path, val){
  obj = dot.parent(obj, path, true);
  var key = path.split('.').pop();

  switch (type(obj)) {
    case 'object':
      if (obj.hasOwnProperty(key)) {
        if ('array' == type(obj[key])) {
          return function(){
            obj[key].push(val);
            return val;
          };
        } else {
          throw new Error('Cannot apply $push/$pushAll modifier to non-array');
        }
      } else {
        return function(){
          obj[key] = [val];
          return val;
        };
      }
      break;

    case 'array':
      if (obj.hasOwnProperty(key)) {
        if ('array' == type(obj[key])) {
          return function(){
            obj[key].push(val);
            return val;
          };
        } else {
          throw new Error('Cannot apply $push/$pushAll modifier to non-array');
        }
      } else if (numeric(key)) {
        return function(){
          obj[key] = [val];
          return val;
        };
      } else {
        throw new Error('can\'t append to array using string field name [' + key + ']');
      }
      break;
  }
};

/**
 * Performs a `$pushAll`.
 *
 * @param {Object} object to modify
 * @param {String} path to alter
 * @param {Array} values to push
 * @return {Function} transaction (unless noop)
 */

exports.$pushAll = function $pushAll(obj, path, val){
  if ('array' != type(val)) {
    throw new Error('Modifier $pushAll/pullAll allowed for arrays only');
  }

  obj = dot.parent(obj, path, true);
  var key = path.split('.').pop();

  switch (type(obj)) {
    case 'object':
      if (obj.hasOwnProperty(key)) {
        if ('array' == type(obj[key])) {
          return function(){
            obj[key].push.apply(obj[key], val);
            return val;
          };
        } else {
          throw new Error('Cannot apply $push/$pushAll modifier to non-array');
        }
      } else {
        return function(){
          obj[key] = val;
          return val;
        };
      }
      break;

    case 'array':
      if (obj.hasOwnProperty(key)) {
        if ('array' == type(obj[key])) {
          return function(){
            obj[key].push.apply(obj[key], val);
            return val;
          };
        } else {
          throw new Error('Cannot apply $push/$pushAll modifier to non-array');
        }
      } else if (numeric(key)) {
        return function(){
          obj[key] = val;
          return val;
        };
      } else {
        throw new Error('can\'t append to array using string field name [' + key + ']');
      }
      break;
  }
};

/**
 * Performs a `$pull`.
 */

exports.$pull = function $pull(obj, path, val){
  obj = dot.parent(obj, path, true);
  var key = path.split('.').pop();
  var t = type(obj);

  switch (t) {
    case 'object':
      if (obj.hasOwnProperty(key)) {
        if ('array' == type(obj[key])) {
          var pulled = [];
          var splice = pull(obj[key], [val], pulled);
          if (pulled.length) {
            return function(){
              splice();
              return pulled;
            };
          }
        } else {
          throw new Error('Cannot apply $pull/$pullAll modifier to non-array');
        }
      }
      break;

    case 'array':
      if (obj.hasOwnProperty(key)) {
        if ('array' == type(obj[key])) {
          var pulled = [];
          var splice = pull(obj[key], [val], pulled);
          if (pulled.length) {
            return function(){
              splice();
              return pulled;
            };
          }
        } else {
          throw new Error('Cannot apply $pull/$pullAll modifier to non-array');
        }
      } else {
        debug('ignoring pull to non array');
      }
      break;

    default:
      if ('undefined' != t) {
        throw new Error('LEFT_SUBFIELD only supports Object: hello not: ' + t);
      }
  }
};

/**
 * Performs a `$pullAll`.
 */

exports.$pullAll = function $pullAll(obj, path, val){
  if ('array' != type(val)) {
    throw new Error('Modifier $pushAll/pullAll allowed for arrays only');
  }

  obj = dot.parent(obj, path, true);
  var key = path.split('.').pop();
  var t = type(obj);

  switch (t) {
    case 'object':
      if (obj.hasOwnProperty(key)) {
        if ('array' == type(obj[key])) {
          var pulled = [];
          var splice = pull(obj[key], val, pulled);
          if (pulled.length) {
            return function(){
              splice();
              return pulled;
            };
          }
        } else {
          throw new Error('Cannot apply $pull/$pullAll modifier to non-array');
        }
      }
      break;

    case 'array':
      if (obj.hasOwnProperty(key)) {
        if ('array' == type(obj[key])) {
          var pulled = [];
          var splice = pull(obj[key], val, pulled);
          if (pulled.length) {
            return function(){
              splice();
              return pulled;
            };
          }
        } else {
          throw new Error('Cannot apply $pull/$pullAll modifier to non-array');
        }
      } else {
        debug('ignoring pull to non array');
      }
      break;

    default:
      if ('undefined' != t) {
        throw new Error('LEFT_SUBFIELD only supports Object: hello not: ' + t);
      }
  }
};

/**
 * Performs a `$addToSet`.
 *
 * @param {Object} object to modify
 * @param {String} path to alter
 * @param {Object} value to push
 * @param {Boolean} internal, true if recursing
 * @return {Function} transaction (unless noop)
 */

exports.$addToSet = function $addToSet(obj, path, val, recursing){
  if (!recursing && 'array' == type(val.$each)) {
    var fns = [];
    for (var i = 0, l = val.$each.length; i < l; i++) {
      var fn = $addToSet(obj, path, val.$each[i], true);
      if (fn) fns.push(fn);
    }
    if (fns.length) {
      return function(){
        var values = [];
        for (var i = 0; i < fns.length; i++) values.push(fns[i]());
        return values;
      };
    } else {
      return;
    }
  }

  obj = dot.parent(obj, path, true);
  var key = path.split('.').pop();

  switch (type(obj)) {
    case 'object':
      if (obj.hasOwnProperty(key)) {
        if ('array' == type(obj[key])) {
          if (!has(obj[key], val)) {
            return function(){
              obj[key].push(val);
              return val;
            };
          }
        } else {
          throw new Error('Cannot apply $addToSet modifier to non-array');
        }
      } else {
        return function(){
          obj[key] = [val];
          return val;
        };
      }
      break;

    case 'array':
      if (obj.hasOwnProperty(key)) {
        if ('array' == type(obj[key])) {
          if (!has(obj[key], val)) {
            return function(){
              obj[key].push(val);
              return val;
            };
          }
        } else {
          throw new Error('Cannot apply $addToSet modifier to non-array');
        }
      } else if (numeric(key)) {
        return function(){
          obj[key] = [val];
          return val;
        };
      } else {
        throw new Error('can\'t append to array using string field name [' + key + ']');
      }
      break;
  }
};

/**
 * Helper for determining if an array has the given value.
 *
 * @param {Array} array
 * @param {Object} value to check
 * @return {Boolean}
 */

function has(array, val){
  for (var i = 0, l = array.length; i < l; i++) {
    if (eql(val, array[i])) return true;
  }
  return false;
}

/**
 * Array#filter function generator for `$pull`/`$pullAll` operations.
 *
 * @param {Array} array of values to match
 * @param {Array} array to populate with results
 * @return {Function} that splices the array
 */

function pull(arr, vals, pulled){
  var indexes = [];

  for (var a = 0; a < arr.length; a++) {
    var val = arr[a];

    for (var i = 0; i < vals.length; i++) {
      var matcher = vals[i];
      if ('object' == type(matcher)) {
        // we only are only interested in obj <-> obj comparisons
        if ('object' == type(val)) {
          var match = false;

          if (keys(matcher).length) {
            for (var i in matcher) {
              if (matcher.hasOwnProperty(i)) {
                // we need at least one matching key to pull
                if (eql(matcher[i], val[i])) {
                  match = true;
                } else {
                  // if a single key doesn't match we move on
                  match = false;
                  break;
                }
              }
            }
          } else if (!keys(val).length) {
            // pull `{}` matches [{}]
            match = true;
          }

          if (match) {
            indexes.push(a);
            pulled.push(val);
            continue;
          }
        } else {
          debug('ignoring pull match against object');
        }
      } else {
        if (eql(matcher, val)) {
          indexes.push(a);
          pulled.push(val);
          continue;
        }
      }
    }
  }

  return function(){
    for (var i = 0; i < indexes.length; i++) {
      var index = indexes[i];
      arr.splice(index - i, 1);
    }
  };
}

/**
 * Helper to determine if a value is numeric.
 *
 * @param {String|Number} value
 * @return {Boolean} true if numeric
 * @api private
 */

function numeric(val){
  return 'number' == type(val) || Number(val) == val;
}

},{"component-type":30,"debug":31,"dot-component":34,"mongo-eql":36,"object-component":37}],30:[function(require,module,exports){
/**
 * toString ref.
 */

var toString = Object.prototype.toString;

/**
 * Return the type of `val`.
 *
 * @param {Mixed} val
 * @return {String}
 * @api public
 */

module.exports = function(val){
  switch (toString.call(val)) {
    case '[object Date]': return 'date';
    case '[object RegExp]': return 'regexp';
    case '[object Arguments]': return 'arguments';
    case '[object Array]': return 'array';
    case '[object Error]': return 'error';
  }

  if (val === null) return 'null';
  if (val === undefined) return 'undefined';
  if (val !== val) return 'nan';
  if (val && val.nodeType === 1) return 'element';

  val = val.valueOf
    ? val.valueOf()
    : Object.prototype.valueOf.apply(val)

  return typeof val;
};

},{}],31:[function(require,module,exports){

/**
 * This is the web browser implementation of `debug()`.
 *
 * Expose `debug()` as the module.
 */

exports = module.exports = require('./debug');
exports.log = log;
exports.formatArgs = formatArgs;
exports.save = save;
exports.load = load;
exports.useColors = useColors;

/**
 * Use chrome.storage.local if we are in an app
 */

var storage;

if (typeof chrome !== 'undefined' && typeof chrome.storage !== 'undefined')
  storage = chrome.storage.local;
else
  storage = localstorage();

/**
 * Colors.
 */

exports.colors = [
  'lightseagreen',
  'forestgreen',
  'goldenrod',
  'dodgerblue',
  'darkorchid',
  'crimson'
];

/**
 * Currently only WebKit-based Web Inspectors, Firefox >= v31,
 * and the Firebug extension (any Firefox version) are known
 * to support "%c" CSS customizations.
 *
 * TODO: add a `localStorage` variable to explicitly enable/disable colors
 */

function useColors() {
  // is webkit? http://stackoverflow.com/a/16459606/376773
  return ('WebkitAppearance' in document.documentElement.style) ||
    // is firebug? http://stackoverflow.com/a/398120/376773
    (window.console && (console.firebug || (console.exception && console.table))) ||
    // is firefox >= v31?
    // https://developer.mozilla.org/en-US/docs/Tools/Web_Console#Styling_messages
    (navigator.userAgent.toLowerCase().match(/firefox\/(\d+)/) && parseInt(RegExp.$1, 10) >= 31);
}

/**
 * Map %j to `JSON.stringify()`, since no Web Inspectors do that by default.
 */

exports.formatters.j = function(v) {
  return JSON.stringify(v);
};


/**
 * Colorize log arguments if enabled.
 *
 * @api public
 */

function formatArgs() {
  var args = arguments;
  var useColors = this.useColors;

  args[0] = (useColors ? '%c' : '')
    + this.namespace
    + (useColors ? ' %c' : ' ')
    + args[0]
    + (useColors ? '%c ' : ' ')
    + '+' + exports.humanize(this.diff);

  if (!useColors) return args;

  var c = 'color: ' + this.color;
  args = [args[0], c, 'color: inherit'].concat(Array.prototype.slice.call(args, 1));

  // the final "%c" is somewhat tricky, because there could be other
  // arguments passed either before or after the %c, so we need to
  // figure out the correct index to insert the CSS into
  var index = 0;
  var lastC = 0;
  args[0].replace(/%[a-z%]/g, function(match) {
    if ('%%' === match) return;
    index++;
    if ('%c' === match) {
      // we only are interested in the *last* %c
      // (the user may have provided their own)
      lastC = index;
    }
  });

  args.splice(lastC, 0, c);
  return args;
}

/**
 * Invokes `console.log()` when available.
 * No-op when `console.log` is not a "function".
 *
 * @api public
 */

function log() {
  // this hackery is required for IE8/9, where
  // the `console.log` function doesn't have 'apply'
  return 'object' === typeof console
    && console.log
    && Function.prototype.apply.call(console.log, console, arguments);
}

/**
 * Save `namespaces`.
 *
 * @param {String} namespaces
 * @api private
 */

function save(namespaces) {
  try {
    if (null == namespaces) {
      storage.removeItem('debug');
    } else {
      storage.debug = namespaces;
    }
  } catch(e) {}
}

/**
 * Load `namespaces`.
 *
 * @return {String} returns the previously persisted debug modes
 * @api private
 */

function load() {
  var r;
  try {
    r = storage.debug;
  } catch(e) {}
  return r;
}

/**
 * Enable namespaces listed in `localStorage.debug` initially.
 */

exports.enable(load());

/**
 * Localstorage attempts to return the localstorage.
 *
 * This is necessary because safari throws
 * when a user disables cookies/localstorage
 * and you attempt to access it.
 *
 * @return {LocalStorage}
 * @api private
 */

function localstorage(){
  try {
    return window.localStorage;
  } catch (e) {}
}

},{"./debug":32}],32:[function(require,module,exports){

/**
 * This is the common logic for both the Node.js and web browser
 * implementations of `debug()`.
 *
 * Expose `debug()` as the module.
 */

exports = module.exports = debug;
exports.coerce = coerce;
exports.disable = disable;
exports.enable = enable;
exports.enabled = enabled;
exports.humanize = require('ms');

/**
 * The currently active debug mode names, and names to skip.
 */

exports.names = [];
exports.skips = [];

/**
 * Map of special "%n" handling functions, for the debug "format" argument.
 *
 * Valid key names are a single, lowercased letter, i.e. "n".
 */

exports.formatters = {};

/**
 * Previously assigned color.
 */

var prevColor = 0;

/**
 * Previous log timestamp.
 */

var prevTime;

/**
 * Select a color.
 *
 * @return {Number}
 * @api private
 */

function selectColor() {
  return exports.colors[prevColor++ % exports.colors.length];
}

/**
 * Create a debugger with the given `namespace`.
 *
 * @param {String} namespace
 * @return {Function}
 * @api public
 */

function debug(namespace) {

  // define the `disabled` version
  function disabled() {
  }
  disabled.enabled = false;

  // define the `enabled` version
  function enabled() {

    var self = enabled;

    // set `diff` timestamp
    var curr = +new Date();
    var ms = curr - (prevTime || curr);
    self.diff = ms;
    self.prev = prevTime;
    self.curr = curr;
    prevTime = curr;

    // add the `color` if not set
    if (null == self.useColors) self.useColors = exports.useColors();
    if (null == self.color && self.useColors) self.color = selectColor();

    var args = Array.prototype.slice.call(arguments);

    args[0] = exports.coerce(args[0]);

    if ('string' !== typeof args[0]) {
      // anything else let's inspect with %o
      args = ['%o'].concat(args);
    }

    // apply any `formatters` transformations
    var index = 0;
    args[0] = args[0].replace(/%([a-z%])/g, function(match, format) {
      // if we encounter an escaped % then don't increase the array index
      if (match === '%%') return match;
      index++;
      var formatter = exports.formatters[format];
      if ('function' === typeof formatter) {
        var val = args[index];
        match = formatter.call(self, val);

        // now we need to remove `args[index]` since it's inlined in the `format`
        args.splice(index, 1);
        index--;
      }
      return match;
    });

    if ('function' === typeof exports.formatArgs) {
      args = exports.formatArgs.apply(self, args);
    }
    var logFn = enabled.log || exports.log || console.log.bind(console);
    logFn.apply(self, args);
  }
  enabled.enabled = true;

  var fn = exports.enabled(namespace) ? enabled : disabled;

  fn.namespace = namespace;

  return fn;
}

/**
 * Enables a debug mode by namespaces. This can include modes
 * separated by a colon and wildcards.
 *
 * @param {String} namespaces
 * @api public
 */

function enable(namespaces) {
  exports.save(namespaces);

  var split = (namespaces || '').split(/[\s,]+/);
  var len = split.length;

  for (var i = 0; i < len; i++) {
    if (!split[i]) continue; // ignore empty strings
    namespaces = split[i].replace(/\*/g, '.*?');
    if (namespaces[0] === '-') {
      exports.skips.push(new RegExp('^' + namespaces.substr(1) + '$'));
    } else {
      exports.names.push(new RegExp('^' + namespaces + '$'));
    }
  }
}

/**
 * Disable debug output.
 *
 * @api public
 */

function disable() {
  exports.enable('');
}

/**
 * Returns true if the given mode name is enabled, false otherwise.
 *
 * @param {String} name
 * @return {Boolean}
 * @api public
 */

function enabled(name) {
  var i, len;
  for (i = 0, len = exports.skips.length; i < len; i++) {
    if (exports.skips[i].test(name)) {
      return false;
    }
  }
  for (i = 0, len = exports.names.length; i < len; i++) {
    if (exports.names[i].test(name)) {
      return true;
    }
  }
  return false;
}

/**
 * Coerce `val`.
 *
 * @param {Mixed} val
 * @return {Mixed}
 * @api private
 */

function coerce(val) {
  if (val instanceof Error) return val.stack || val.message;
  return val;
}

},{"ms":33}],33:[function(require,module,exports){
/**
 * Helpers.
 */

var s = 1000;
var m = s * 60;
var h = m * 60;
var d = h * 24;
var y = d * 365.25;

/**
 * Parse or format the given `val`.
 *
 * Options:
 *
 *  - `long` verbose formatting [false]
 *
 * @param {String|Number} val
 * @param {Object} options
 * @return {String|Number}
 * @api public
 */

module.exports = function(val, options){
  options = options || {};
  if ('string' == typeof val) return parse(val);
  return options.long
    ? long(val)
    : short(val);
};

/**
 * Parse the given `str` and return milliseconds.
 *
 * @param {String} str
 * @return {Number}
 * @api private
 */

function parse(str) {
  var match = /^((?:\d+)?\.?\d+) *(milliseconds?|msecs?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|years?|yrs?|y)?$/i.exec(str);
  if (!match) return;
  var n = parseFloat(match[1]);
  var type = (match[2] || 'ms').toLowerCase();
  switch (type) {
    case 'years':
    case 'year':
    case 'yrs':
    case 'yr':
    case 'y':
      return n * y;
    case 'days':
    case 'day':
    case 'd':
      return n * d;
    case 'hours':
    case 'hour':
    case 'hrs':
    case 'hr':
    case 'h':
      return n * h;
    case 'minutes':
    case 'minute':
    case 'mins':
    case 'min':
    case 'm':
      return n * m;
    case 'seconds':
    case 'second':
    case 'secs':
    case 'sec':
    case 's':
      return n * s;
    case 'milliseconds':
    case 'millisecond':
    case 'msecs':
    case 'msec':
    case 'ms':
      return n;
  }
}

/**
 * Short format for `ms`.
 *
 * @param {Number} ms
 * @return {String}
 * @api private
 */

function short(ms) {
  if (ms >= d) return Math.round(ms / d) + 'd';
  if (ms >= h) return Math.round(ms / h) + 'h';
  if (ms >= m) return Math.round(ms / m) + 'm';
  if (ms >= s) return Math.round(ms / s) + 's';
  return ms + 'ms';
}

/**
 * Long format for `ms`.
 *
 * @param {Number} ms
 * @return {String}
 * @api private
 */

function long(ms) {
  return plural(ms, d, 'day')
    || plural(ms, h, 'hour')
    || plural(ms, m, 'minute')
    || plural(ms, s, 'second')
    || ms + ' ms';
}

/**
 * Pluralization helper.
 */

function plural(ms, n, name) {
  if (ms < n) return;
  if (ms < n * 1.5) return Math.floor(ms / n) + ' ' + name;
  return Math.ceil(ms / n) + ' ' + name + 's';
}

},{}],34:[function(require,module,exports){

/**
 * Module dependencies.
 */

var type = require('type-component');

/**
 * Gets a certain `path` from the `obj`.
 *
 * @param {Object} target
 * @param {String} key
 * @return {Object} found object, or `undefined
 * @api public
 */

exports.get = function(obj, path){
  if (~path.indexOf('.')) {
    var par = parent(obj, path);
    var mainKey = path.split('.').pop();
    var t = type(par);
    if ('object' == t || 'array' == t) return par[mainKey];
  } else {
    return obj[path];
  }
};

/**
 * Sets the given `path` to `val` in `obj`.
 *
 * @param {Object} target
 * @Param {String} key
 * @param {Object} value
 * @api public
 */

exports.set = function(obj, path, val){
  if (~path.indexOf('.')) {
    var par = parent(obj, path, true);
    var mainKey = path.split('.').pop();
    if (par && 'object' == type(par)) par[mainKey] = val;
  } else {
    obj[path] = val;
  }
};

/**
 * Gets the parent object for a given key (dot notation aware).
 *
 * - If a parent object doesn't exist, it's initialized.
 * - Array index lookup is supported
 *
 * @param {Object} target object
 * @param {String} key
 * @param {Boolean} true if it should initialize the path
 * @api public
 */

exports.parent = parent;

function parent(obj, key, init){
  if (~key.indexOf('.')) {
    var pieces = key.split('.');
    var ret = obj;

    for (var i = 0; i < pieces.length - 1; i++) {
      // if the key is a number string and parent is an array
      if (Number(pieces[i]) == pieces[i] && 'array' == type(ret)) {
        ret = ret[pieces[i]];
      } else if ('object' == type(ret)) {
        if (init && !ret.hasOwnProperty(pieces[i])) {
          ret[pieces[i]] = {};
        }
        if (ret) ret = ret[pieces[i]];
      }
    }

    return ret;
  } else {
    return obj;
  }
}

},{"type-component":35}],35:[function(require,module,exports){

/**
 * toString ref.
 */

var toString = Object.prototype.toString;

/**
 * Return the type of `val`.
 *
 * @param {Mixed} val
 * @return {String}
 * @api public
 */

module.exports = function(val){
  switch (toString.call(val)) {
    case '[object Function]': return 'function';
    case '[object Date]': return 'date';
    case '[object RegExp]': return 'regexp';
    case '[object Arguments]': return 'arguments';
    case '[object Array]': return 'array';
  }

  if (val === null) return 'null';
  if (val === undefined) return 'undefined';
  if (val === Object(val)) return 'object';

  return typeof val;
};

},{}],36:[function(require,module,exports){

/**
 * Module dependencies.
 */

var type = require('component-type');

/**
 * Module exports.
 */

module.exports = eql;

/**
 * MongoDB style value comparisons.
 *
 * @param {Object} matcher
 * @param {Object} value
 * @return {Boolean} true if they match
 */

function eql(matcher, val){
  switch (type(matcher)) {
    case 'null':
    case 'undefined':
      // we treat null as undefined
      return null == val;

    case 'regexp':
      return matcher.test(val);

    case 'array':
      if ('array' == type(val) && matcher.length == val.length) {
        for (var i = 0; i < matcher.length; i++) {
          if (!eql(val[i], matcher[i])) return false;
        }
        return true;
      } else {
        return false;
      }
      break;

    case 'object':
      // object can match keys in any order
      var keys = {};

      // we match all values of `matcher` in `val`
      for (var i in matcher) {
        if (matcher.hasOwnProperty(i)) {
          if (!val.hasOwnProperty(i) || !eql(matcher[i], val[i])) {
            return false;
          }
        }
        keys[i] = true;
      }

      // we make sure `val` doesn't have extra keys
      for (var i in val) {
        if (val.hasOwnProperty(i) && !keys.hasOwnProperty(i)) {
          return false;
        }
      }

      return true;

    default:
      return matcher === val;
  }
}

},{"component-type":30}],37:[function(require,module,exports){

/**
 * HOP ref.
 */

var has = Object.prototype.hasOwnProperty;

/**
 * Return own keys in `obj`.
 *
 * @param {Object} obj
 * @return {Array}
 * @api public
 */

exports.keys = Object.keys || function(obj){
  var keys = [];
  for (var key in obj) {
    if (has.call(obj, key)) {
      keys.push(key);
    }
  }
  return keys;
};

/**
 * Return own values in `obj`.
 *
 * @param {Object} obj
 * @return {Array}
 * @api public
 */

exports.values = function(obj){
  var vals = [];
  for (var key in obj) {
    if (has.call(obj, key)) {
      vals.push(obj[key]);
    }
  }
  return vals;
};

/**
 * Merge `b` into `a`.
 *
 * @param {Object} a
 * @param {Object} b
 * @return {Object} a
 * @api public
 */

exports.merge = function(a, b){
  for (var key in b) {
    if (has.call(b, key)) {
      a[key] = b[key];
    }
  }
  return a;
};

/**
 * Return length of `obj`.
 *
 * @param {Object} obj
 * @return {Number}
 * @api public
 */

exports.length = function(obj){
  return exports.keys(obj).length;
};

/**
 * Check if `obj` is empty.
 *
 * @param {Object} obj
 * @return {Boolean}
 * @api public
 */

exports.isEmpty = function(obj){
  return 0 == exports.length(obj);
};
},{}],38:[function(require,module,exports){

/**
 * Module dependencies.
 */

var eql = require('mongo-eql');
var type = require('component-type');

/**
 * $ne: not equal.
 */

exports.$ne = function $ne(matcher, val){
  return !eql(matcher, val);
};

/**
 * $gt: greater than.
 */

exports.$gt = function $gt(matcher, val){
  return type(matcher) === 'number' && val > matcher;
};

/**
 * $gte: greater than equal.
 */

exports.$gte = function $gte(matcher, val){
  return type(matcher) === 'number' && val >= matcher;
};

/**
 * $lt: less than.
 */

exports.$lt = function $lt(matcher, val){
  return type(matcher) === 'number' && val < matcher;
};

/**
 * $lte: less than equal.
 */

exports.$lte = function $lte(matcher, val){
  return type(matcher) === 'number' && val <= matcher;
};

/**
 * $regex: supply a regular expression as a string.
 */

exports.$regex = function $regex(matcher, val){
  // TODO: add $options support
  if ('regexp' != type('matcher')) matcher = new RegExp(matcher);
  return matcher.test(val);
};

/**
 * $exists: key exists.
 */

exports.$exists = function $exists(matcher, val){
  if (matcher) {
    return undefined !== val;
  } else {
    return undefined === val;
  }
};

/**
 * $in: value in array.
 */

exports.$in = function $in(matcher, val){
  if ('array' != type(matcher)) return false;
  for (var i = 0; i < matcher.length; i++) {
    if (eql(matcher[i], val)) return true;
  }
  return false;
};

/**
 * $nin: value not in array.
 */

exports.$nin = function $nin(matcher, val){
  return !exports.$in(matcher, val);
};

/**
 * @size: array length
 */

exports.$size = function(matcher, val){
  return Array.isArray(val) && matcher == val.length;
};

},{"component-type":30,"mongo-eql":36}],39:[function(require,module,exports){
/*!
  * Reqwest! A general purpose XHR connection manager
  * license MIT (c) Dustin Diaz 2014
  * https://github.com/ded/reqwest
  */

!function (name, context, definition) {
  if (typeof module != 'undefined' && module.exports) module.exports = definition()
  else if (typeof define == 'function' && define.amd) define(definition)
  else context[name] = definition()
}('reqwest', this, function () {

  var win = window
    , doc = document
    , httpsRe = /^http/
    , protocolRe = /(^\w+):\/\//
    , twoHundo = /^(20\d|1223)$/ //http://stackoverflow.com/questions/10046972/msie-returns-status-code-of-1223-for-ajax-request
    , byTag = 'getElementsByTagName'
    , readyState = 'readyState'
    , contentType = 'Content-Type'
    , requestedWith = 'X-Requested-With'
    , head = doc[byTag]('head')[0]
    , uniqid = 0
    , callbackPrefix = 'reqwest_' + (+new Date())
    , lastValue // data stored by the most recent JSONP callback
    , xmlHttpRequest = 'XMLHttpRequest'
    , xDomainRequest = 'XDomainRequest'
    , noop = function () {}

    , isArray = typeof Array.isArray == 'function'
        ? Array.isArray
        : function (a) {
            return a instanceof Array
          }

    , defaultHeaders = {
          'contentType': 'application/x-www-form-urlencoded'
        , 'requestedWith': xmlHttpRequest
        , 'accept': {
              '*':  'text/javascript, text/html, application/xml, text/xml, */*'
            , 'xml':  'application/xml, text/xml'
            , 'html': 'text/html'
            , 'text': 'text/plain'
            , 'json': 'application/json, text/javascript'
            , 'js':   'application/javascript, text/javascript'
          }
      }

    , xhr = function(o) {
        // is it x-domain
        if (o['crossOrigin'] === true) {
          var xhr = win[xmlHttpRequest] ? new XMLHttpRequest() : null
          if (xhr && 'withCredentials' in xhr) {
            return xhr
          } else if (win[xDomainRequest]) {
            return new XDomainRequest()
          } else {
            throw new Error('Browser does not support cross-origin requests')
          }
        } else if (win[xmlHttpRequest]) {
          return new XMLHttpRequest()
        } else {
          return new ActiveXObject('Microsoft.XMLHTTP')
        }
      }
    , globalSetupOptions = {
        dataFilter: function (data) {
          return data
        }
      }

  function succeed(r) {
    var protocol = protocolRe.exec(r.url);
    protocol = (protocol && protocol[1]) || window.location.protocol;
    return httpsRe.test(protocol) ? twoHundo.test(r.request.status) : !!r.request.response;
  }

  function handleReadyState(r, success, error) {
    return function () {
      // use _aborted to mitigate against IE err c00c023f
      // (can't read props on aborted request objects)
      if (r._aborted) return error(r.request)
      if (r._timedOut) return error(r.request, 'Request is aborted: timeout')
      if (r.request && r.request[readyState] == 4) {
        r.request.onreadystatechange = noop
        if (succeed(r)) success(r.request)
        else
          error(r.request)
      }
    }
  }

  function setHeaders(http, o) {
    var headers = o['headers'] || {}
      , h

    headers['Accept'] = headers['Accept']
      || defaultHeaders['accept'][o['type']]
      || defaultHeaders['accept']['*']

    var isAFormData = typeof FormData === 'function' && (o['data'] instanceof FormData);
    // breaks cross-origin requests with legacy browsers
    if (!o['crossOrigin'] && !headers[requestedWith]) headers[requestedWith] = defaultHeaders['requestedWith']
    if (!headers[contentType] && !isAFormData) headers[contentType] = o['contentType'] || defaultHeaders['contentType']
    for (h in headers)
      headers.hasOwnProperty(h) && 'setRequestHeader' in http && http.setRequestHeader(h, headers[h])
  }

  function setCredentials(http, o) {
    if (typeof o['withCredentials'] !== 'undefined' && typeof http.withCredentials !== 'undefined') {
      http.withCredentials = !!o['withCredentials']
    }
  }

  function generalCallback(data) {
    lastValue = data
  }

  function urlappend (url, s) {
    return url + (/\?/.test(url) ? '&' : '?') + s
  }

  function handleJsonp(o, fn, err, url) {
    var reqId = uniqid++
      , cbkey = o['jsonpCallback'] || 'callback' // the 'callback' key
      , cbval = o['jsonpCallbackName'] || reqwest.getcallbackPrefix(reqId)
      , cbreg = new RegExp('((^|\\?|&)' + cbkey + ')=([^&]+)')
      , match = url.match(cbreg)
      , script = doc.createElement('script')
      , loaded = 0
      , isIE10 = navigator.userAgent.indexOf('MSIE 10.0') !== -1

    if (match) {
      if (match[3] === '?') {
        url = url.replace(cbreg, '$1=' + cbval) // wildcard callback func name
      } else {
        cbval = match[3] // provided callback func name
      }
    } else {
      url = urlappend(url, cbkey + '=' + cbval) // no callback details, add 'em
    }

    win[cbval] = generalCallback

    script.type = 'text/javascript'
    script.src = url
    script.async = true
    if (typeof script.onreadystatechange !== 'undefined' && !isIE10) {
      // need this for IE due to out-of-order onreadystatechange(), binding script
      // execution to an event listener gives us control over when the script
      // is executed. See http://jaubourg.net/2010/07/loading-script-as-onclick-handler-of.html
      script.htmlFor = script.id = '_reqwest_' + reqId
    }

    script.onload = script.onreadystatechange = function () {
      if ((script[readyState] && script[readyState] !== 'complete' && script[readyState] !== 'loaded') || loaded) {
        return false
      }
      script.onload = script.onreadystatechange = null
      script.onclick && script.onclick()
      // Call the user callback with the last value stored and clean up values and scripts.
      fn(lastValue)
      lastValue = undefined
      head.removeChild(script)
      loaded = 1
    }

    // Add the script to the DOM head
    head.appendChild(script)

    // Enable JSONP timeout
    return {
      abort: function () {
        script.onload = script.onreadystatechange = null
        err({}, 'Request is aborted: timeout', {})
        lastValue = undefined
        head.removeChild(script)
        loaded = 1
      }
    }
  }

  function getRequest(fn, err) {
    var o = this.o
      , method = (o['method'] || 'GET').toUpperCase()
      , url = typeof o === 'string' ? o : o['url']
      // convert non-string objects to query-string form unless o['processData'] is false
      , data = (o['processData'] !== false && o['data'] && typeof o['data'] !== 'string')
        ? reqwest.toQueryString(o['data'])
        : (o['data'] || null)
      , http
      , sendWait = false

    // if we're working on a GET request and we have data then we should append
    // query string to end of URL and not post data
    if ((o['type'] == 'jsonp' || method == 'GET') && data) {
      url = urlappend(url, data)
      data = null
    }

    if (o['type'] == 'jsonp') return handleJsonp(o, fn, err, url)

    // get the xhr from the factory if passed
    // if the factory returns null, fall-back to ours
    http = (o.xhr && o.xhr(o)) || xhr(o)

    http.open(method, url, o['async'] === false ? false : true)
    setHeaders(http, o)
    setCredentials(http, o)
    if (win[xDomainRequest] && http instanceof win[xDomainRequest]) {
        http.onload = fn
        http.onerror = err
        // NOTE: see
        // http://social.msdn.microsoft.com/Forums/en-US/iewebdevelopment/thread/30ef3add-767c-4436-b8a9-f1ca19b4812e
        http.onprogress = function() {}
        sendWait = true
    } else {
      http.onreadystatechange = handleReadyState(this, fn, err)
    }
    o['before'] && o['before'](http)
    if (sendWait) {
      setTimeout(function () {
        http.send(data)
      }, 200)
    } else {
      http.send(data)
    }
    return http
  }

  function Reqwest(o, fn) {
    this.o = o
    this.fn = fn

    init.apply(this, arguments)
  }

  function setType(header) {
    // json, javascript, text/plain, text/html, xml
    if (header.match('json')) return 'json'
    if (header.match('javascript')) return 'js'
    if (header.match('text')) return 'html'
    if (header.match('xml')) return 'xml'
  }

  function init(o, fn) {

    this.url = typeof o == 'string' ? o : o['url']
    this.timeout = null

    // whether request has been fulfilled for purpose
    // of tracking the Promises
    this._fulfilled = false
    // success handlers
    this._successHandler = function(){}
    this._fulfillmentHandlers = []
    // error handlers
    this._errorHandlers = []
    // complete (both success and fail) handlers
    this._completeHandlers = []
    this._erred = false
    this._responseArgs = {}

    var self = this

    fn = fn || function () {}

    if (o['timeout']) {
      this.timeout = setTimeout(function () {
        timedOut()
      }, o['timeout'])
    }

    if (o['success']) {
      this._successHandler = function () {
        o['success'].apply(o, arguments)
      }
    }

    if (o['error']) {
      this._errorHandlers.push(function () {
        o['error'].apply(o, arguments)
      })
    }

    if (o['complete']) {
      this._completeHandlers.push(function () {
        o['complete'].apply(o, arguments)
      })
    }

    function complete (resp) {
      o['timeout'] && clearTimeout(self.timeout)
      self.timeout = null
      while (self._completeHandlers.length > 0) {
        self._completeHandlers.shift()(resp)
      }
    }

    function success (resp) {
      var type = o['type'] || resp && setType(resp.getResponseHeader('Content-Type')) // resp can be undefined in IE
      resp = (type !== 'jsonp') ? self.request : resp
      // use global data filter on response text
      var filteredResponse = globalSetupOptions.dataFilter(resp.responseText, type)
        , r = filteredResponse
      try {
        resp.responseText = r
      } catch (e) {
        // can't assign this in IE<=8, just ignore
      }
      if (r) {
        switch (type) {
        case 'json':
          try {
            resp = win.JSON ? win.JSON.parse(r) : eval('(' + r + ')')
          } catch (err) {
            return error(resp, 'Could not parse JSON in response', err)
          }
          break
        case 'js':
          resp = eval(r)
          break
        case 'html':
          resp = r
          break
        case 'xml':
          resp = resp.responseXML
              && resp.responseXML.parseError // IE trololo
              && resp.responseXML.parseError.errorCode
              && resp.responseXML.parseError.reason
            ? null
            : resp.responseXML
          break
        }
      }

      self._responseArgs.resp = resp
      self._fulfilled = true
      fn(resp)
      self._successHandler(resp)
      while (self._fulfillmentHandlers.length > 0) {
        resp = self._fulfillmentHandlers.shift()(resp)
      }

      complete(resp)
    }

    function timedOut() {
      self._timedOut = true
      self.request.abort()      
    }

    function error(resp, msg, t) {
      resp = self.request
      self._responseArgs.resp = resp
      self._responseArgs.msg = msg
      self._responseArgs.t = t
      self._erred = true
      while (self._errorHandlers.length > 0) {
        self._errorHandlers.shift()(resp, msg, t)
      }
      complete(resp)
    }

    this.request = getRequest.call(this, success, error)
  }

  Reqwest.prototype = {
    abort: function () {
      this._aborted = true
      this.request.abort()
    }

  , retry: function () {
      init.call(this, this.o, this.fn)
    }

    /**
     * Small deviation from the Promises A CommonJs specification
     * http://wiki.commonjs.org/wiki/Promises/A
     */

    /**
     * `then` will execute upon successful requests
     */
  , then: function (success, fail) {
      success = success || function () {}
      fail = fail || function () {}
      if (this._fulfilled) {
        this._responseArgs.resp = success(this._responseArgs.resp)
      } else if (this._erred) {
        fail(this._responseArgs.resp, this._responseArgs.msg, this._responseArgs.t)
      } else {
        this._fulfillmentHandlers.push(success)
        this._errorHandlers.push(fail)
      }
      return this
    }

    /**
     * `always` will execute whether the request succeeds or fails
     */
  , always: function (fn) {
      if (this._fulfilled || this._erred) {
        fn(this._responseArgs.resp)
      } else {
        this._completeHandlers.push(fn)
      }
      return this
    }

    /**
     * `fail` will execute when the request fails
     */
  , fail: function (fn) {
      if (this._erred) {
        fn(this._responseArgs.resp, this._responseArgs.msg, this._responseArgs.t)
      } else {
        this._errorHandlers.push(fn)
      }
      return this
    }
  , 'catch': function (fn) {
      return this.fail(fn)
    }
  }

  function reqwest(o, fn) {
    return new Reqwest(o, fn)
  }

  // normalize newline variants according to spec -> CRLF
  function normalize(s) {
    return s ? s.replace(/\r?\n/g, '\r\n') : ''
  }

  function serial(el, cb) {
    var n = el.name
      , t = el.tagName.toLowerCase()
      , optCb = function (o) {
          // IE gives value="" even where there is no value attribute
          // 'specified' ref: http://www.w3.org/TR/DOM-Level-3-Core/core.html#ID-862529273
          if (o && !o['disabled'])
            cb(n, normalize(o['attributes']['value'] && o['attributes']['value']['specified'] ? o['value'] : o['text']))
        }
      , ch, ra, val, i

    // don't serialize elements that are disabled or without a name
    if (el.disabled || !n) return

    switch (t) {
    case 'input':
      if (!/reset|button|image|file/i.test(el.type)) {
        ch = /checkbox/i.test(el.type)
        ra = /radio/i.test(el.type)
        val = el.value
        // WebKit gives us "" instead of "on" if a checkbox has no value, so correct it here
        ;(!(ch || ra) || el.checked) && cb(n, normalize(ch && val === '' ? 'on' : val))
      }
      break
    case 'textarea':
      cb(n, normalize(el.value))
      break
    case 'select':
      if (el.type.toLowerCase() === 'select-one') {
        optCb(el.selectedIndex >= 0 ? el.options[el.selectedIndex] : null)
      } else {
        for (i = 0; el.length && i < el.length; i++) {
          el.options[i].selected && optCb(el.options[i])
        }
      }
      break
    }
  }

  // collect up all form elements found from the passed argument elements all
  // the way down to child elements; pass a '<form>' or form fields.
  // called with 'this'=callback to use for serial() on each element
  function eachFormElement() {
    var cb = this
      , e, i
      , serializeSubtags = function (e, tags) {
          var i, j, fa
          for (i = 0; i < tags.length; i++) {
            fa = e[byTag](tags[i])
            for (j = 0; j < fa.length; j++) serial(fa[j], cb)
          }
        }

    for (i = 0; i < arguments.length; i++) {
      e = arguments[i]
      if (/input|select|textarea/i.test(e.tagName)) serial(e, cb)
      serializeSubtags(e, [ 'input', 'select', 'textarea' ])
    }
  }

  // standard query string style serialization
  function serializeQueryString() {
    return reqwest.toQueryString(reqwest.serializeArray.apply(null, arguments))
  }

  // { 'name': 'value', ... } style serialization
  function serializeHash() {
    var hash = {}
    eachFormElement.apply(function (name, value) {
      if (name in hash) {
        hash[name] && !isArray(hash[name]) && (hash[name] = [hash[name]])
        hash[name].push(value)
      } else hash[name] = value
    }, arguments)
    return hash
  }

  // [ { name: 'name', value: 'value' }, ... ] style serialization
  reqwest.serializeArray = function () {
    var arr = []
    eachFormElement.apply(function (name, value) {
      arr.push({name: name, value: value})
    }, arguments)
    return arr
  }

  reqwest.serialize = function () {
    if (arguments.length === 0) return ''
    var opt, fn
      , args = Array.prototype.slice.call(arguments, 0)

    opt = args.pop()
    opt && opt.nodeType && args.push(opt) && (opt = null)
    opt && (opt = opt.type)

    if (opt == 'map') fn = serializeHash
    else if (opt == 'array') fn = reqwest.serializeArray
    else fn = serializeQueryString

    return fn.apply(null, args)
  }

  reqwest.toQueryString = function (o, trad) {
    var prefix, i
      , traditional = trad || false
      , s = []
      , enc = encodeURIComponent
      , add = function (key, value) {
          // If value is a function, invoke it and return its value
          value = ('function' === typeof value) ? value() : (value == null ? '' : value)
          s[s.length] = enc(key) + '=' + enc(value)
        }
    // If an array was passed in, assume that it is an array of form elements.
    if (isArray(o)) {
      for (i = 0; o && i < o.length; i++) add(o[i]['name'], o[i]['value'])
    } else {
      // If traditional, encode the "old" way (the way 1.3.2 or older
      // did it), otherwise encode params recursively.
      for (prefix in o) {
        if (o.hasOwnProperty(prefix)) buildParams(prefix, o[prefix], traditional, add)
      }
    }

    // spaces should be + according to spec
    return s.join('&').replace(/%20/g, '+')
  }

  function buildParams(prefix, obj, traditional, add) {
    var name, i, v
      , rbracket = /\[\]$/

    if (isArray(obj)) {
      // Serialize array item.
      for (i = 0; obj && i < obj.length; i++) {
        v = obj[i]
        if (traditional || rbracket.test(prefix)) {
          // Treat each array item as a scalar.
          add(prefix, v)
        } else {
          buildParams(prefix + '[' + (typeof v === 'object' ? i : '') + ']', v, traditional, add)
        }
      }
    } else if (obj && obj.toString() === '[object Object]') {
      // Serialize object item.
      for (name in obj) {
        buildParams(prefix + '[' + name + ']', obj[name], traditional, add)
      }

    } else {
      // Serialize scalar item.
      add(prefix, obj)
    }
  }

  reqwest.getcallbackPrefix = function () {
    return callbackPrefix
  }

  // jQuery and Zepto compatibility, differences can be remapped here so you can call
  // .ajax.compat(options, callback)
  reqwest.compat = function (o, fn) {
    if (o) {
      o['type'] && (o['method'] = o['type']) && delete o['type']
      o['dataType'] && (o['type'] = o['dataType'])
      o['jsonpCallback'] && (o['jsonpCallbackName'] = o['jsonpCallback']) && delete o['jsonpCallback']
      o['jsonp'] && (o['jsonpCallback'] = o['jsonp'])
    }
    return new Reqwest(o, fn)
  }

  reqwest.ajaxSetup = function (options) {
    options = options || {}
    for (var k in options) {
      globalSetupOptions[k] = options[k]
    }
  }

  return reqwest
});

},{}],40:[function(require,module,exports){
(function (process){
/*!
 * @overview RSVP - a tiny implementation of Promises/A+.
 * @copyright Copyright (c) 2014 Yehuda Katz, Tom Dale, Stefan Penner and contributors
 * @license   Licensed under MIT license
 *            See https://raw.githubusercontent.com/tildeio/rsvp.js/master/LICENSE
 * @version   3.0.18
 */

(function() {
    "use strict";
    function lib$rsvp$utils$$objectOrFunction(x) {
      return typeof x === 'function' || (typeof x === 'object' && x !== null);
    }

    function lib$rsvp$utils$$isFunction(x) {
      return typeof x === 'function';
    }

    function lib$rsvp$utils$$isMaybeThenable(x) {
      return typeof x === 'object' && x !== null;
    }

    var lib$rsvp$utils$$_isArray;
    if (!Array.isArray) {
      lib$rsvp$utils$$_isArray = function (x) {
        return Object.prototype.toString.call(x) === '[object Array]';
      };
    } else {
      lib$rsvp$utils$$_isArray = Array.isArray;
    }

    var lib$rsvp$utils$$isArray = lib$rsvp$utils$$_isArray;

    var lib$rsvp$utils$$now = Date.now || function() { return new Date().getTime(); };

    function lib$rsvp$utils$$F() { }

    var lib$rsvp$utils$$o_create = (Object.create || function (o) {
      if (arguments.length > 1) {
        throw new Error('Second argument not supported');
      }
      if (typeof o !== 'object') {
        throw new TypeError('Argument must be an object');
      }
      lib$rsvp$utils$$F.prototype = o;
      return new lib$rsvp$utils$$F();
    });
    function lib$rsvp$events$$indexOf(callbacks, callback) {
      for (var i=0, l=callbacks.length; i<l; i++) {
        if (callbacks[i] === callback) { return i; }
      }

      return -1;
    }

    function lib$rsvp$events$$callbacksFor(object) {
      var callbacks = object._promiseCallbacks;

      if (!callbacks) {
        callbacks = object._promiseCallbacks = {};
      }

      return callbacks;
    }

    var lib$rsvp$events$$default = {

      /**
        `RSVP.EventTarget.mixin` extends an object with EventTarget methods. For
        Example:

        ```javascript
        var object = {};

        RSVP.EventTarget.mixin(object);

        object.on('finished', function(event) {
          // handle event
        });

        object.trigger('finished', { detail: value });
        ```

        `EventTarget.mixin` also works with prototypes:

        ```javascript
        var Person = function() {};
        RSVP.EventTarget.mixin(Person.prototype);

        var yehuda = new Person();
        var tom = new Person();

        yehuda.on('poke', function(event) {
          console.log('Yehuda says OW');
        });

        tom.on('poke', function(event) {
          console.log('Tom says OW');
        });

        yehuda.trigger('poke');
        tom.trigger('poke');
        ```

        @method mixin
        @for RSVP.EventTarget
        @private
        @param {Object} object object to extend with EventTarget methods
      */
      'mixin': function(object) {
        object['on']      = this['on'];
        object['off']     = this['off'];
        object['trigger'] = this['trigger'];
        object._promiseCallbacks = undefined;
        return object;
      },

      /**
        Registers a callback to be executed when `eventName` is triggered

        ```javascript
        object.on('event', function(eventInfo){
          // handle the event
        });

        object.trigger('event');
        ```

        @method on
        @for RSVP.EventTarget
        @private
        @param {String} eventName name of the event to listen for
        @param {Function} callback function to be called when the event is triggered.
      */
      'on': function(eventName, callback) {
        var allCallbacks = lib$rsvp$events$$callbacksFor(this), callbacks;

        callbacks = allCallbacks[eventName];

        if (!callbacks) {
          callbacks = allCallbacks[eventName] = [];
        }

        if (lib$rsvp$events$$indexOf(callbacks, callback) === -1) {
          callbacks.push(callback);
        }
      },

      /**
        You can use `off` to stop firing a particular callback for an event:

        ```javascript
        function doStuff() { // do stuff! }
        object.on('stuff', doStuff);

        object.trigger('stuff'); // doStuff will be called

        // Unregister ONLY the doStuff callback
        object.off('stuff', doStuff);
        object.trigger('stuff'); // doStuff will NOT be called
        ```

        If you don't pass a `callback` argument to `off`, ALL callbacks for the
        event will not be executed when the event fires. For example:

        ```javascript
        var callback1 = function(){};
        var callback2 = function(){};

        object.on('stuff', callback1);
        object.on('stuff', callback2);

        object.trigger('stuff'); // callback1 and callback2 will be executed.

        object.off('stuff');
        object.trigger('stuff'); // callback1 and callback2 will not be executed!
        ```

        @method off
        @for RSVP.EventTarget
        @private
        @param {String} eventName event to stop listening to
        @param {Function} callback optional argument. If given, only the function
        given will be removed from the event's callback queue. If no `callback`
        argument is given, all callbacks will be removed from the event's callback
        queue.
      */
      'off': function(eventName, callback) {
        var allCallbacks = lib$rsvp$events$$callbacksFor(this), callbacks, index;

        if (!callback) {
          allCallbacks[eventName] = [];
          return;
        }

        callbacks = allCallbacks[eventName];

        index = lib$rsvp$events$$indexOf(callbacks, callback);

        if (index !== -1) { callbacks.splice(index, 1); }
      },

      /**
        Use `trigger` to fire custom events. For example:

        ```javascript
        object.on('foo', function(){
          console.log('foo event happened!');
        });
        object.trigger('foo');
        // 'foo event happened!' logged to the console
        ```

        You can also pass a value as a second argument to `trigger` that will be
        passed as an argument to all event listeners for the event:

        ```javascript
        object.on('foo', function(value){
          console.log(value.name);
        });

        object.trigger('foo', { name: 'bar' });
        // 'bar' logged to the console
        ```

        @method trigger
        @for RSVP.EventTarget
        @private
        @param {String} eventName name of the event to be triggered
        @param {Any} options optional value to be passed to any event handlers for
        the given `eventName`
      */
      'trigger': function(eventName, options) {
        var allCallbacks = lib$rsvp$events$$callbacksFor(this), callbacks, callback;

        if (callbacks = allCallbacks[eventName]) {
          // Don't cache the callbacks.length since it may grow
          for (var i=0; i<callbacks.length; i++) {
            callback = callbacks[i];

            callback(options);
          }
        }
      }
    };

    var lib$rsvp$config$$config = {
      instrument: false
    };

    lib$rsvp$events$$default['mixin'](lib$rsvp$config$$config);

    function lib$rsvp$config$$configure(name, value) {
      if (name === 'onerror') {
        // handle for legacy users that expect the actual
        // error to be passed to their function added via
        // `RSVP.configure('onerror', someFunctionHere);`
        lib$rsvp$config$$config['on']('error', value);
        return;
      }

      if (arguments.length === 2) {
        lib$rsvp$config$$config[name] = value;
      } else {
        return lib$rsvp$config$$config[name];
      }
    }

    var lib$rsvp$instrument$$queue = [];

    function lib$rsvp$instrument$$scheduleFlush() {
      setTimeout(function() {
        var entry;
        for (var i = 0; i < lib$rsvp$instrument$$queue.length; i++) {
          entry = lib$rsvp$instrument$$queue[i];

          var payload = entry.payload;

          payload.guid = payload.key + payload.id;
          payload.childGuid = payload.key + payload.childId;
          if (payload.error) {
            payload.stack = payload.error.stack;
          }

          lib$rsvp$config$$config['trigger'](entry.name, entry.payload);
        }
        lib$rsvp$instrument$$queue.length = 0;
      }, 50);
    }

    function lib$rsvp$instrument$$instrument(eventName, promise, child) {
      if (1 === lib$rsvp$instrument$$queue.push({
          name: eventName,
          payload: {
            key: promise._guidKey,
            id:  promise._id,
            eventName: eventName,
            detail: promise._result,
            childId: child && child._id,
            label: promise._label,
            timeStamp: lib$rsvp$utils$$now(),
            error: lib$rsvp$config$$config["instrument-with-stack"] ? new Error(promise._label) : null
          }})) {
            lib$rsvp$instrument$$scheduleFlush();
          }
      }
    var lib$rsvp$instrument$$default = lib$rsvp$instrument$$instrument;

    function  lib$rsvp$$internal$$withOwnPromise() {
      return new TypeError('A promises callback cannot return that same promise.');
    }

    function lib$rsvp$$internal$$noop() {}

    var lib$rsvp$$internal$$PENDING   = void 0;
    var lib$rsvp$$internal$$FULFILLED = 1;
    var lib$rsvp$$internal$$REJECTED  = 2;

    var lib$rsvp$$internal$$GET_THEN_ERROR = new lib$rsvp$$internal$$ErrorObject();

    function lib$rsvp$$internal$$getThen(promise) {
      try {
        return promise.then;
      } catch(error) {
        lib$rsvp$$internal$$GET_THEN_ERROR.error = error;
        return lib$rsvp$$internal$$GET_THEN_ERROR;
      }
    }

    function lib$rsvp$$internal$$tryThen(then, value, fulfillmentHandler, rejectionHandler) {
      try {
        then.call(value, fulfillmentHandler, rejectionHandler);
      } catch(e) {
        return e;
      }
    }

    function lib$rsvp$$internal$$handleForeignThenable(promise, thenable, then) {
      lib$rsvp$config$$config.async(function(promise) {
        var sealed = false;
        var error = lib$rsvp$$internal$$tryThen(then, thenable, function(value) {
          if (sealed) { return; }
          sealed = true;
          if (thenable !== value) {
            lib$rsvp$$internal$$resolve(promise, value);
          } else {
            lib$rsvp$$internal$$fulfill(promise, value);
          }
        }, function(reason) {
          if (sealed) { return; }
          sealed = true;

          lib$rsvp$$internal$$reject(promise, reason);
        }, 'Settle: ' + (promise._label || ' unknown promise'));

        if (!sealed && error) {
          sealed = true;
          lib$rsvp$$internal$$reject(promise, error);
        }
      }, promise);
    }

    function lib$rsvp$$internal$$handleOwnThenable(promise, thenable) {
      if (thenable._state === lib$rsvp$$internal$$FULFILLED) {
        lib$rsvp$$internal$$fulfill(promise, thenable._result);
      } else if (thenable._state === lib$rsvp$$internal$$REJECTED) {
        thenable._onError = null;
        lib$rsvp$$internal$$reject(promise, thenable._result);
      } else {
        lib$rsvp$$internal$$subscribe(thenable, undefined, function(value) {
          if (thenable !== value) {
            lib$rsvp$$internal$$resolve(promise, value);
          } else {
            lib$rsvp$$internal$$fulfill(promise, value);
          }
        }, function(reason) {
          lib$rsvp$$internal$$reject(promise, reason);
        });
      }
    }

    function lib$rsvp$$internal$$handleMaybeThenable(promise, maybeThenable) {
      if (maybeThenable.constructor === promise.constructor) {
        lib$rsvp$$internal$$handleOwnThenable(promise, maybeThenable);
      } else {
        var then = lib$rsvp$$internal$$getThen(maybeThenable);

        if (then === lib$rsvp$$internal$$GET_THEN_ERROR) {
          lib$rsvp$$internal$$reject(promise, lib$rsvp$$internal$$GET_THEN_ERROR.error);
        } else if (then === undefined) {
          lib$rsvp$$internal$$fulfill(promise, maybeThenable);
        } else if (lib$rsvp$utils$$isFunction(then)) {
          lib$rsvp$$internal$$handleForeignThenable(promise, maybeThenable, then);
        } else {
          lib$rsvp$$internal$$fulfill(promise, maybeThenable);
        }
      }
    }

    function lib$rsvp$$internal$$resolve(promise, value) {
      if (promise === value) {
        lib$rsvp$$internal$$fulfill(promise, value);
      } else if (lib$rsvp$utils$$objectOrFunction(value)) {
        lib$rsvp$$internal$$handleMaybeThenable(promise, value);
      } else {
        lib$rsvp$$internal$$fulfill(promise, value);
      }
    }

    function lib$rsvp$$internal$$publishRejection(promise) {
      if (promise._onError) {
        promise._onError(promise._result);
      }

      lib$rsvp$$internal$$publish(promise);
    }

    function lib$rsvp$$internal$$fulfill(promise, value) {
      if (promise._state !== lib$rsvp$$internal$$PENDING) { return; }

      promise._result = value;
      promise._state = lib$rsvp$$internal$$FULFILLED;

      if (promise._subscribers.length === 0) {
        if (lib$rsvp$config$$config.instrument) {
          lib$rsvp$instrument$$default('fulfilled', promise);
        }
      } else {
        lib$rsvp$config$$config.async(lib$rsvp$$internal$$publish, promise);
      }
    }

    function lib$rsvp$$internal$$reject(promise, reason) {
      if (promise._state !== lib$rsvp$$internal$$PENDING) { return; }
      promise._state = lib$rsvp$$internal$$REJECTED;
      promise._result = reason;
      lib$rsvp$config$$config.async(lib$rsvp$$internal$$publishRejection, promise);
    }

    function lib$rsvp$$internal$$subscribe(parent, child, onFulfillment, onRejection) {
      var subscribers = parent._subscribers;
      var length = subscribers.length;

      parent._onError = null;

      subscribers[length] = child;
      subscribers[length + lib$rsvp$$internal$$FULFILLED] = onFulfillment;
      subscribers[length + lib$rsvp$$internal$$REJECTED]  = onRejection;

      if (length === 0 && parent._state) {
        lib$rsvp$config$$config.async(lib$rsvp$$internal$$publish, parent);
      }
    }

    function lib$rsvp$$internal$$publish(promise) {
      var subscribers = promise._subscribers;
      var settled = promise._state;

      if (lib$rsvp$config$$config.instrument) {
        lib$rsvp$instrument$$default(settled === lib$rsvp$$internal$$FULFILLED ? 'fulfilled' : 'rejected', promise);
      }

      if (subscribers.length === 0) { return; }

      var child, callback, detail = promise._result;

      for (var i = 0; i < subscribers.length; i += 3) {
        child = subscribers[i];
        callback = subscribers[i + settled];

        if (child) {
          lib$rsvp$$internal$$invokeCallback(settled, child, callback, detail);
        } else {
          callback(detail);
        }
      }

      promise._subscribers.length = 0;
    }

    function lib$rsvp$$internal$$ErrorObject() {
      this.error = null;
    }

    var lib$rsvp$$internal$$TRY_CATCH_ERROR = new lib$rsvp$$internal$$ErrorObject();

    function lib$rsvp$$internal$$tryCatch(callback, detail) {
      try {
        return callback(detail);
      } catch(e) {
        lib$rsvp$$internal$$TRY_CATCH_ERROR.error = e;
        return lib$rsvp$$internal$$TRY_CATCH_ERROR;
      }
    }

    function lib$rsvp$$internal$$invokeCallback(settled, promise, callback, detail) {
      var hasCallback = lib$rsvp$utils$$isFunction(callback),
          value, error, succeeded, failed;

      if (hasCallback) {
        value = lib$rsvp$$internal$$tryCatch(callback, detail);

        if (value === lib$rsvp$$internal$$TRY_CATCH_ERROR) {
          failed = true;
          error = value.error;
          value = null;
        } else {
          succeeded = true;
        }

        if (promise === value) {
          lib$rsvp$$internal$$reject(promise, lib$rsvp$$internal$$withOwnPromise());
          return;
        }

      } else {
        value = detail;
        succeeded = true;
      }

      if (promise._state !== lib$rsvp$$internal$$PENDING) {
        // noop
      } else if (hasCallback && succeeded) {
        lib$rsvp$$internal$$resolve(promise, value);
      } else if (failed) {
        lib$rsvp$$internal$$reject(promise, error);
      } else if (settled === lib$rsvp$$internal$$FULFILLED) {
        lib$rsvp$$internal$$fulfill(promise, value);
      } else if (settled === lib$rsvp$$internal$$REJECTED) {
        lib$rsvp$$internal$$reject(promise, value);
      }
    }

    function lib$rsvp$$internal$$initializePromise(promise, resolver) {
      var resolved = false;
      try {
        resolver(function resolvePromise(value){
          if (resolved) { return; }
          resolved = true;
          lib$rsvp$$internal$$resolve(promise, value);
        }, function rejectPromise(reason) {
          if (resolved) { return; }
          resolved = true;
          lib$rsvp$$internal$$reject(promise, reason);
        });
      } catch(e) {
        lib$rsvp$$internal$$reject(promise, e);
      }
    }

    function lib$rsvp$enumerator$$makeSettledResult(state, position, value) {
      if (state === lib$rsvp$$internal$$FULFILLED) {
        return {
          state: 'fulfilled',
          value: value
        };
      } else {
        return {
          state: 'rejected',
          reason: value
        };
      }
    }

    function lib$rsvp$enumerator$$Enumerator(Constructor, input, abortOnReject, label) {
      this._instanceConstructor = Constructor;
      this.promise = new Constructor(lib$rsvp$$internal$$noop, label);
      this._abortOnReject = abortOnReject;

      if (this._validateInput(input)) {
        this._input     = input;
        this.length     = input.length;
        this._remaining = input.length;

        this._init();

        if (this.length === 0) {
          lib$rsvp$$internal$$fulfill(this.promise, this._result);
        } else {
          this.length = this.length || 0;
          this._enumerate();
          if (this._remaining === 0) {
            lib$rsvp$$internal$$fulfill(this.promise, this._result);
          }
        }
      } else {
        lib$rsvp$$internal$$reject(this.promise, this._validationError());
      }
    }

    var lib$rsvp$enumerator$$default = lib$rsvp$enumerator$$Enumerator;

    lib$rsvp$enumerator$$Enumerator.prototype._validateInput = function(input) {
      return lib$rsvp$utils$$isArray(input);
    };

    lib$rsvp$enumerator$$Enumerator.prototype._validationError = function() {
      return new Error('Array Methods must be provided an Array');
    };

    lib$rsvp$enumerator$$Enumerator.prototype._init = function() {
      this._result = new Array(this.length);
    };

    lib$rsvp$enumerator$$Enumerator.prototype._enumerate = function() {
      var length  = this.length;
      var promise = this.promise;
      var input   = this._input;

      for (var i = 0; promise._state === lib$rsvp$$internal$$PENDING && i < length; i++) {
        this._eachEntry(input[i], i);
      }
    };

    lib$rsvp$enumerator$$Enumerator.prototype._eachEntry = function(entry, i) {
      var c = this._instanceConstructor;
      if (lib$rsvp$utils$$isMaybeThenable(entry)) {
        if (entry.constructor === c && entry._state !== lib$rsvp$$internal$$PENDING) {
          entry._onError = null;
          this._settledAt(entry._state, i, entry._result);
        } else {
          this._willSettleAt(c.resolve(entry), i);
        }
      } else {
        this._remaining--;
        this._result[i] = this._makeResult(lib$rsvp$$internal$$FULFILLED, i, entry);
      }
    };

    lib$rsvp$enumerator$$Enumerator.prototype._settledAt = function(state, i, value) {
      var promise = this.promise;

      if (promise._state === lib$rsvp$$internal$$PENDING) {
        this._remaining--;

        if (this._abortOnReject && state === lib$rsvp$$internal$$REJECTED) {
          lib$rsvp$$internal$$reject(promise, value);
        } else {
          this._result[i] = this._makeResult(state, i, value);
        }
      }

      if (this._remaining === 0) {
        lib$rsvp$$internal$$fulfill(promise, this._result);
      }
    };

    lib$rsvp$enumerator$$Enumerator.prototype._makeResult = function(state, i, value) {
      return value;
    };

    lib$rsvp$enumerator$$Enumerator.prototype._willSettleAt = function(promise, i) {
      var enumerator = this;

      lib$rsvp$$internal$$subscribe(promise, undefined, function(value) {
        enumerator._settledAt(lib$rsvp$$internal$$FULFILLED, i, value);
      }, function(reason) {
        enumerator._settledAt(lib$rsvp$$internal$$REJECTED, i, reason);
      });
    };
    function lib$rsvp$promise$all$$all(entries, label) {
      return new lib$rsvp$enumerator$$default(this, entries, true /* abort on reject */, label).promise;
    }
    var lib$rsvp$promise$all$$default = lib$rsvp$promise$all$$all;
    function lib$rsvp$promise$race$$race(entries, label) {
      /*jshint validthis:true */
      var Constructor = this;

      var promise = new Constructor(lib$rsvp$$internal$$noop, label);

      if (!lib$rsvp$utils$$isArray(entries)) {
        lib$rsvp$$internal$$reject(promise, new TypeError('You must pass an array to race.'));
        return promise;
      }

      var length = entries.length;

      function onFulfillment(value) {
        lib$rsvp$$internal$$resolve(promise, value);
      }

      function onRejection(reason) {
        lib$rsvp$$internal$$reject(promise, reason);
      }

      for (var i = 0; promise._state === lib$rsvp$$internal$$PENDING && i < length; i++) {
        lib$rsvp$$internal$$subscribe(Constructor.resolve(entries[i]), undefined, onFulfillment, onRejection);
      }

      return promise;
    }
    var lib$rsvp$promise$race$$default = lib$rsvp$promise$race$$race;
    function lib$rsvp$promise$resolve$$resolve(object, label) {
      /*jshint validthis:true */
      var Constructor = this;

      if (object && typeof object === 'object' && object.constructor === Constructor) {
        return object;
      }

      var promise = new Constructor(lib$rsvp$$internal$$noop, label);
      lib$rsvp$$internal$$resolve(promise, object);
      return promise;
    }
    var lib$rsvp$promise$resolve$$default = lib$rsvp$promise$resolve$$resolve;
    function lib$rsvp$promise$reject$$reject(reason, label) {
      /*jshint validthis:true */
      var Constructor = this;
      var promise = new Constructor(lib$rsvp$$internal$$noop, label);
      lib$rsvp$$internal$$reject(promise, reason);
      return promise;
    }
    var lib$rsvp$promise$reject$$default = lib$rsvp$promise$reject$$reject;

    var lib$rsvp$promise$$guidKey = 'rsvp_' + lib$rsvp$utils$$now() + '-';
    var lib$rsvp$promise$$counter = 0;

    function lib$rsvp$promise$$needsResolver() {
      throw new TypeError('You must pass a resolver function as the first argument to the promise constructor');
    }

    function lib$rsvp$promise$$needsNew() {
      throw new TypeError("Failed to construct 'Promise': Please use the 'new' operator, this object constructor cannot be called as a function.");
    }

    /**
      Promise objects represent the eventual result of an asynchronous operation. The
      primary way of interacting with a promise is through its `then` method, which
      registers callbacks to receive either a promise’s eventual value or the reason
      why the promise cannot be fulfilled.

      Terminology
      -----------

      - `promise` is an object or function with a `then` method whose behavior conforms to this specification.
      - `thenable` is an object or function that defines a `then` method.
      - `value` is any legal JavaScript value (including undefined, a thenable, or a promise).
      - `exception` is a value that is thrown using the throw statement.
      - `reason` is a value that indicates why a promise was rejected.
      - `settled` the final resting state of a promise, fulfilled or rejected.

      A promise can be in one of three states: pending, fulfilled, or rejected.

      Promises that are fulfilled have a fulfillment value and are in the fulfilled
      state.  Promises that are rejected have a rejection reason and are in the
      rejected state.  A fulfillment value is never a thenable.

      Promises can also be said to *resolve* a value.  If this value is also a
      promise, then the original promise's settled state will match the value's
      settled state.  So a promise that *resolves* a promise that rejects will
      itself reject, and a promise that *resolves* a promise that fulfills will
      itself fulfill.


      Basic Usage:
      ------------

      ```js
      var promise = new Promise(function(resolve, reject) {
        // on success
        resolve(value);

        // on failure
        reject(reason);
      });

      promise.then(function(value) {
        // on fulfillment
      }, function(reason) {
        // on rejection
      });
      ```

      Advanced Usage:
      ---------------

      Promises shine when abstracting away asynchronous interactions such as
      `XMLHttpRequest`s.

      ```js
      function getJSON(url) {
        return new Promise(function(resolve, reject){
          var xhr = new XMLHttpRequest();

          xhr.open('GET', url);
          xhr.onreadystatechange = handler;
          xhr.responseType = 'json';
          xhr.setRequestHeader('Accept', 'application/json');
          xhr.send();

          function handler() {
            if (this.readyState === this.DONE) {
              if (this.status === 200) {
                resolve(this.response);
              } else {
                reject(new Error('getJSON: `' + url + '` failed with status: [' + this.status + ']'));
              }
            }
          };
        });
      }

      getJSON('/posts.json').then(function(json) {
        // on fulfillment
      }, function(reason) {
        // on rejection
      });
      ```

      Unlike callbacks, promises are great composable primitives.

      ```js
      Promise.all([
        getJSON('/posts'),
        getJSON('/comments')
      ]).then(function(values){
        values[0] // => postsJSON
        values[1] // => commentsJSON

        return values;
      });
      ```

      @class RSVP.Promise
      @param {function} resolver
      @param {String} label optional string for labeling the promise.
      Useful for tooling.
      @constructor
    */
    function lib$rsvp$promise$$Promise(resolver, label) {
      this._id = lib$rsvp$promise$$counter++;
      this._label = label;
      this._state = undefined;
      this._result = undefined;
      this._subscribers = [];

      if (lib$rsvp$config$$config.instrument) {
        lib$rsvp$instrument$$default('created', this);
      }

      if (lib$rsvp$$internal$$noop !== resolver) {
        if (!lib$rsvp$utils$$isFunction(resolver)) {
          lib$rsvp$promise$$needsResolver();
        }

        if (!(this instanceof lib$rsvp$promise$$Promise)) {
          lib$rsvp$promise$$needsNew();
        }

        lib$rsvp$$internal$$initializePromise(this, resolver);
      }
    }

    var lib$rsvp$promise$$default = lib$rsvp$promise$$Promise;

    // deprecated
    lib$rsvp$promise$$Promise.cast = lib$rsvp$promise$resolve$$default;
    lib$rsvp$promise$$Promise.all = lib$rsvp$promise$all$$default;
    lib$rsvp$promise$$Promise.race = lib$rsvp$promise$race$$default;
    lib$rsvp$promise$$Promise.resolve = lib$rsvp$promise$resolve$$default;
    lib$rsvp$promise$$Promise.reject = lib$rsvp$promise$reject$$default;

    lib$rsvp$promise$$Promise.prototype = {
      constructor: lib$rsvp$promise$$Promise,

      _guidKey: lib$rsvp$promise$$guidKey,

      _onError: function (reason) {
        lib$rsvp$config$$config.async(function(promise) {
          setTimeout(function() {
            if (promise._onError) {
              lib$rsvp$config$$config['trigger']('error', reason);
            }
          }, 0);
        }, this);
      },

    /**
      The primary way of interacting with a promise is through its `then` method,
      which registers callbacks to receive either a promise's eventual value or the
      reason why the promise cannot be fulfilled.

      ```js
      findUser().then(function(user){
        // user is available
      }, function(reason){
        // user is unavailable, and you are given the reason why
      });
      ```

      Chaining
      --------

      The return value of `then` is itself a promise.  This second, 'downstream'
      promise is resolved with the return value of the first promise's fulfillment
      or rejection handler, or rejected if the handler throws an exception.

      ```js
      findUser().then(function (user) {
        return user.name;
      }, function (reason) {
        return 'default name';
      }).then(function (userName) {
        // If `findUser` fulfilled, `userName` will be the user's name, otherwise it
        // will be `'default name'`
      });

      findUser().then(function (user) {
        throw new Error('Found user, but still unhappy');
      }, function (reason) {
        throw new Error('`findUser` rejected and we're unhappy');
      }).then(function (value) {
        // never reached
      }, function (reason) {
        // if `findUser` fulfilled, `reason` will be 'Found user, but still unhappy'.
        // If `findUser` rejected, `reason` will be '`findUser` rejected and we're unhappy'.
      });
      ```
      If the downstream promise does not specify a rejection handler, rejection reasons will be propagated further downstream.

      ```js
      findUser().then(function (user) {
        throw new PedagogicalException('Upstream error');
      }).then(function (value) {
        // never reached
      }).then(function (value) {
        // never reached
      }, function (reason) {
        // The `PedgagocialException` is propagated all the way down to here
      });
      ```

      Assimilation
      ------------

      Sometimes the value you want to propagate to a downstream promise can only be
      retrieved asynchronously. This can be achieved by returning a promise in the
      fulfillment or rejection handler. The downstream promise will then be pending
      until the returned promise is settled. This is called *assimilation*.

      ```js
      findUser().then(function (user) {
        return findCommentsByAuthor(user);
      }).then(function (comments) {
        // The user's comments are now available
      });
      ```

      If the assimliated promise rejects, then the downstream promise will also reject.

      ```js
      findUser().then(function (user) {
        return findCommentsByAuthor(user);
      }).then(function (comments) {
        // If `findCommentsByAuthor` fulfills, we'll have the value here
      }, function (reason) {
        // If `findCommentsByAuthor` rejects, we'll have the reason here
      });
      ```

      Simple Example
      --------------

      Synchronous Example

      ```javascript
      var result;

      try {
        result = findResult();
        // success
      } catch(reason) {
        // failure
      }
      ```

      Errback Example

      ```js
      findResult(function(result, err){
        if (err) {
          // failure
        } else {
          // success
        }
      });
      ```

      Promise Example;

      ```javascript
      findResult().then(function(result){
        // success
      }, function(reason){
        // failure
      });
      ```

      Advanced Example
      --------------

      Synchronous Example

      ```javascript
      var author, books;

      try {
        author = findAuthor();
        books  = findBooksByAuthor(author);
        // success
      } catch(reason) {
        // failure
      }
      ```

      Errback Example

      ```js

      function foundBooks(books) {

      }

      function failure(reason) {

      }

      findAuthor(function(author, err){
        if (err) {
          failure(err);
          // failure
        } else {
          try {
            findBoooksByAuthor(author, function(books, err) {
              if (err) {
                failure(err);
              } else {
                try {
                  foundBooks(books);
                } catch(reason) {
                  failure(reason);
                }
              }
            });
          } catch(error) {
            failure(err);
          }
          // success
        }
      });
      ```

      Promise Example;

      ```javascript
      findAuthor().
        then(findBooksByAuthor).
        then(function(books){
          // found books
      }).catch(function(reason){
        // something went wrong
      });
      ```

      @method then
      @param {Function} onFulfilled
      @param {Function} onRejected
      @param {String} label optional string for labeling the promise.
      Useful for tooling.
      @return {Promise}
    */
      then: function(onFulfillment, onRejection, label) {
        var parent = this;
        var state = parent._state;

        if (state === lib$rsvp$$internal$$FULFILLED && !onFulfillment || state === lib$rsvp$$internal$$REJECTED && !onRejection) {
          if (lib$rsvp$config$$config.instrument) {
            lib$rsvp$instrument$$default('chained', this, this);
          }
          return this;
        }

        parent._onError = null;

        var child = new this.constructor(lib$rsvp$$internal$$noop, label);
        var result = parent._result;

        if (lib$rsvp$config$$config.instrument) {
          lib$rsvp$instrument$$default('chained', parent, child);
        }

        if (state) {
          var callback = arguments[state - 1];
          lib$rsvp$config$$config.async(function(){
            lib$rsvp$$internal$$invokeCallback(state, child, callback, result);
          });
        } else {
          lib$rsvp$$internal$$subscribe(parent, child, onFulfillment, onRejection);
        }

        return child;
      },

    /**
      `catch` is simply sugar for `then(undefined, onRejection)` which makes it the same
      as the catch block of a try/catch statement.

      ```js
      function findAuthor(){
        throw new Error('couldn't find that author');
      }

      // synchronous
      try {
        findAuthor();
      } catch(reason) {
        // something went wrong
      }

      // async with promises
      findAuthor().catch(function(reason){
        // something went wrong
      });
      ```

      @method catch
      @param {Function} onRejection
      @param {String} label optional string for labeling the promise.
      Useful for tooling.
      @return {Promise}
    */
      'catch': function(onRejection, label) {
        return this.then(null, onRejection, label);
      },

    /**
      `finally` will be invoked regardless of the promise's fate just as native
      try/catch/finally behaves

      Synchronous example:

      ```js
      findAuthor() {
        if (Math.random() > 0.5) {
          throw new Error();
        }
        return new Author();
      }

      try {
        return findAuthor(); // succeed or fail
      } catch(error) {
        return findOtherAuther();
      } finally {
        // always runs
        // doesn't affect the return value
      }
      ```

      Asynchronous example:

      ```js
      findAuthor().catch(function(reason){
        return findOtherAuther();
      }).finally(function(){
        // author was either found, or not
      });
      ```

      @method finally
      @param {Function} callback
      @param {String} label optional string for labeling the promise.
      Useful for tooling.
      @return {Promise}
    */
      'finally': function(callback, label) {
        var constructor = this.constructor;

        return this.then(function(value) {
          return constructor.resolve(callback()).then(function(){
            return value;
          });
        }, function(reason) {
          return constructor.resolve(callback()).then(function(){
            throw reason;
          });
        }, label);
      }
    };

    function lib$rsvp$all$settled$$AllSettled(Constructor, entries, label) {
      this._superConstructor(Constructor, entries, false /* don't abort on reject */, label);
    }

    lib$rsvp$all$settled$$AllSettled.prototype = lib$rsvp$utils$$o_create(lib$rsvp$enumerator$$default.prototype);
    lib$rsvp$all$settled$$AllSettled.prototype._superConstructor = lib$rsvp$enumerator$$default;
    lib$rsvp$all$settled$$AllSettled.prototype._makeResult = lib$rsvp$enumerator$$makeSettledResult;
    lib$rsvp$all$settled$$AllSettled.prototype._validationError = function() {
      return new Error('allSettled must be called with an array');
    };

    function lib$rsvp$all$settled$$allSettled(entries, label) {
      return new lib$rsvp$all$settled$$AllSettled(lib$rsvp$promise$$default, entries, label).promise;
    }
    var lib$rsvp$all$settled$$default = lib$rsvp$all$settled$$allSettled;
    function lib$rsvp$all$$all(array, label) {
      return lib$rsvp$promise$$default.all(array, label);
    }
    var lib$rsvp$all$$default = lib$rsvp$all$$all;
    var lib$rsvp$asap$$len = 0;
    var lib$rsvp$asap$$toString = {}.toString;
    var lib$rsvp$asap$$vertxNext;
    function lib$rsvp$asap$$asap(callback, arg) {
      lib$rsvp$asap$$queue[lib$rsvp$asap$$len] = callback;
      lib$rsvp$asap$$queue[lib$rsvp$asap$$len + 1] = arg;
      lib$rsvp$asap$$len += 2;
      if (lib$rsvp$asap$$len === 2) {
        // If len is 1, that means that we need to schedule an async flush.
        // If additional callbacks are queued before the queue is flushed, they
        // will be processed by this flush that we are scheduling.
        lib$rsvp$asap$$scheduleFlush();
      }
    }

    var lib$rsvp$asap$$default = lib$rsvp$asap$$asap;

    var lib$rsvp$asap$$browserWindow = (typeof window !== 'undefined') ? window : undefined;
    var lib$rsvp$asap$$browserGlobal = lib$rsvp$asap$$browserWindow || {};
    var lib$rsvp$asap$$BrowserMutationObserver = lib$rsvp$asap$$browserGlobal.MutationObserver || lib$rsvp$asap$$browserGlobal.WebKitMutationObserver;
    var lib$rsvp$asap$$isNode = typeof process !== 'undefined' && {}.toString.call(process) === '[object process]';

    // test for web worker but not in IE10
    var lib$rsvp$asap$$isWorker = typeof Uint8ClampedArray !== 'undefined' &&
      typeof importScripts !== 'undefined' &&
      typeof MessageChannel !== 'undefined';

    // node
    function lib$rsvp$asap$$useNextTick() {
      var nextTick = process.nextTick;
      // node version 0.10.x displays a deprecation warning when nextTick is used recursively
      // setImmediate should be used instead instead
      var version = process.versions.node.match(/^(?:(\d+)\.)?(?:(\d+)\.)?(\*|\d+)$/);
      if (Array.isArray(version) && version[1] === '0' && version[2] === '10') {
        nextTick = setImmediate;
      }
      return function() {
        nextTick(lib$rsvp$asap$$flush);
      };
    }

    // vertx
    function lib$rsvp$asap$$useVertxTimer() {
      return function() {
        lib$rsvp$asap$$vertxNext(lib$rsvp$asap$$flush);
      };
    }

    function lib$rsvp$asap$$useMutationObserver() {
      var iterations = 0;
      var observer = new lib$rsvp$asap$$BrowserMutationObserver(lib$rsvp$asap$$flush);
      var node = document.createTextNode('');
      observer.observe(node, { characterData: true });

      return function() {
        node.data = (iterations = ++iterations % 2);
      };
    }

    // web worker
    function lib$rsvp$asap$$useMessageChannel() {
      var channel = new MessageChannel();
      channel.port1.onmessage = lib$rsvp$asap$$flush;
      return function () {
        channel.port2.postMessage(0);
      };
    }

    function lib$rsvp$asap$$useSetTimeout() {
      return function() {
        setTimeout(lib$rsvp$asap$$flush, 1);
      };
    }

    var lib$rsvp$asap$$queue = new Array(1000);
    function lib$rsvp$asap$$flush() {
      for (var i = 0; i < lib$rsvp$asap$$len; i+=2) {
        var callback = lib$rsvp$asap$$queue[i];
        var arg = lib$rsvp$asap$$queue[i+1];

        callback(arg);

        lib$rsvp$asap$$queue[i] = undefined;
        lib$rsvp$asap$$queue[i+1] = undefined;
      }

      lib$rsvp$asap$$len = 0;
    }

    function lib$rsvp$asap$$attemptVertex() {
      try {
        var r = require;
        var vertx = r('vertx');
        lib$rsvp$asap$$vertxNext = vertx.runOnLoop || vertx.runOnContext;
        return lib$rsvp$asap$$useVertxTimer();
      } catch(e) {
        return lib$rsvp$asap$$useSetTimeout();
      }
    }

    var lib$rsvp$asap$$scheduleFlush;
    // Decide what async method to use to triggering processing of queued callbacks:
    if (lib$rsvp$asap$$isNode) {
      lib$rsvp$asap$$scheduleFlush = lib$rsvp$asap$$useNextTick();
    } else if (lib$rsvp$asap$$BrowserMutationObserver) {
      lib$rsvp$asap$$scheduleFlush = lib$rsvp$asap$$useMutationObserver();
    } else if (lib$rsvp$asap$$isWorker) {
      lib$rsvp$asap$$scheduleFlush = lib$rsvp$asap$$useMessageChannel();
    } else if (lib$rsvp$asap$$browserWindow === undefined && typeof require === 'function') {
      lib$rsvp$asap$$scheduleFlush = lib$rsvp$asap$$attemptVertex();
    } else {
      lib$rsvp$asap$$scheduleFlush = lib$rsvp$asap$$useSetTimeout();
    }
    function lib$rsvp$defer$$defer(label) {
      var deferred = { };

      deferred['promise'] = new lib$rsvp$promise$$default(function(resolve, reject) {
        deferred['resolve'] = resolve;
        deferred['reject'] = reject;
      }, label);

      return deferred;
    }
    var lib$rsvp$defer$$default = lib$rsvp$defer$$defer;
    function lib$rsvp$filter$$filter(promises, filterFn, label) {
      return lib$rsvp$promise$$default.all(promises, label).then(function(values) {
        if (!lib$rsvp$utils$$isFunction(filterFn)) {
          throw new TypeError("You must pass a function as filter's second argument.");
        }

        var length = values.length;
        var filtered = new Array(length);

        for (var i = 0; i < length; i++) {
          filtered[i] = filterFn(values[i]);
        }

        return lib$rsvp$promise$$default.all(filtered, label).then(function(filtered) {
          var results = new Array(length);
          var newLength = 0;

          for (var i = 0; i < length; i++) {
            if (filtered[i]) {
              results[newLength] = values[i];
              newLength++;
            }
          }

          results.length = newLength;

          return results;
        });
      });
    }
    var lib$rsvp$filter$$default = lib$rsvp$filter$$filter;

    function lib$rsvp$promise$hash$$PromiseHash(Constructor, object, label) {
      this._superConstructor(Constructor, object, true, label);
    }

    var lib$rsvp$promise$hash$$default = lib$rsvp$promise$hash$$PromiseHash;

    lib$rsvp$promise$hash$$PromiseHash.prototype = lib$rsvp$utils$$o_create(lib$rsvp$enumerator$$default.prototype);
    lib$rsvp$promise$hash$$PromiseHash.prototype._superConstructor = lib$rsvp$enumerator$$default;
    lib$rsvp$promise$hash$$PromiseHash.prototype._init = function() {
      this._result = {};
    };

    lib$rsvp$promise$hash$$PromiseHash.prototype._validateInput = function(input) {
      return input && typeof input === 'object';
    };

    lib$rsvp$promise$hash$$PromiseHash.prototype._validationError = function() {
      return new Error('Promise.hash must be called with an object');
    };

    lib$rsvp$promise$hash$$PromiseHash.prototype._enumerate = function() {
      var promise = this.promise;
      var input   = this._input;
      var results = [];

      for (var key in input) {
        if (promise._state === lib$rsvp$$internal$$PENDING && Object.prototype.hasOwnProperty.call(input, key)) {
          results.push({
            position: key,
            entry: input[key]
          });
        }
      }

      var length = results.length;
      this._remaining = length;
      var result;

      for (var i = 0; promise._state === lib$rsvp$$internal$$PENDING && i < length; i++) {
        result = results[i];
        this._eachEntry(result.entry, result.position);
      }
    };

    function lib$rsvp$hash$settled$$HashSettled(Constructor, object, label) {
      this._superConstructor(Constructor, object, false, label);
    }

    lib$rsvp$hash$settled$$HashSettled.prototype = lib$rsvp$utils$$o_create(lib$rsvp$promise$hash$$default.prototype);
    lib$rsvp$hash$settled$$HashSettled.prototype._superConstructor = lib$rsvp$enumerator$$default;
    lib$rsvp$hash$settled$$HashSettled.prototype._makeResult = lib$rsvp$enumerator$$makeSettledResult;

    lib$rsvp$hash$settled$$HashSettled.prototype._validationError = function() {
      return new Error('hashSettled must be called with an object');
    };

    function lib$rsvp$hash$settled$$hashSettled(object, label) {
      return new lib$rsvp$hash$settled$$HashSettled(lib$rsvp$promise$$default, object, label).promise;
    }
    var lib$rsvp$hash$settled$$default = lib$rsvp$hash$settled$$hashSettled;
    function lib$rsvp$hash$$hash(object, label) {
      return new lib$rsvp$promise$hash$$default(lib$rsvp$promise$$default, object, label).promise;
    }
    var lib$rsvp$hash$$default = lib$rsvp$hash$$hash;
    function lib$rsvp$map$$map(promises, mapFn, label) {
      return lib$rsvp$promise$$default.all(promises, label).then(function(values) {
        if (!lib$rsvp$utils$$isFunction(mapFn)) {
          throw new TypeError("You must pass a function as map's second argument.");
        }

        var length = values.length;
        var results = new Array(length);

        for (var i = 0; i < length; i++) {
          results[i] = mapFn(values[i]);
        }

        return lib$rsvp$promise$$default.all(results, label);
      });
    }
    var lib$rsvp$map$$default = lib$rsvp$map$$map;

    function lib$rsvp$node$$Result() {
      this.value = undefined;
    }

    var lib$rsvp$node$$ERROR = new lib$rsvp$node$$Result();
    var lib$rsvp$node$$GET_THEN_ERROR = new lib$rsvp$node$$Result();

    function lib$rsvp$node$$getThen(obj) {
      try {
       return obj.then;
      } catch(error) {
        lib$rsvp$node$$ERROR.value= error;
        return lib$rsvp$node$$ERROR;
      }
    }


    function lib$rsvp$node$$tryApply(f, s, a) {
      try {
        f.apply(s, a);
      } catch(error) {
        lib$rsvp$node$$ERROR.value = error;
        return lib$rsvp$node$$ERROR;
      }
    }

    function lib$rsvp$node$$makeObject(_, argumentNames) {
      var obj = {};
      var name;
      var i;
      var length = _.length;
      var args = new Array(length);

      for (var x = 0; x < length; x++) {
        args[x] = _[x];
      }

      for (i = 0; i < argumentNames.length; i++) {
        name = argumentNames[i];
        obj[name] = args[i + 1];
      }

      return obj;
    }

    function lib$rsvp$node$$arrayResult(_) {
      var length = _.length;
      var args = new Array(length - 1);

      for (var i = 1; i < length; i++) {
        args[i - 1] = _[i];
      }

      return args;
    }

    function lib$rsvp$node$$wrapThenable(then, promise) {
      return {
        then: function(onFulFillment, onRejection) {
          return then.call(promise, onFulFillment, onRejection);
        }
      };
    }

    function lib$rsvp$node$$denodeify(nodeFunc, options) {
      var fn = function() {
        var self = this;
        var l = arguments.length;
        var args = new Array(l + 1);
        var arg;
        var promiseInput = false;

        for (var i = 0; i < l; ++i) {
          arg = arguments[i];

          if (!promiseInput) {
            // TODO: clean this up
            promiseInput = lib$rsvp$node$$needsPromiseInput(arg);
            if (promiseInput === lib$rsvp$node$$GET_THEN_ERROR) {
              var p = new lib$rsvp$promise$$default(lib$rsvp$$internal$$noop);
              lib$rsvp$$internal$$reject(p, lib$rsvp$node$$GET_THEN_ERROR.value);
              return p;
            } else if (promiseInput && promiseInput !== true) {
              arg = lib$rsvp$node$$wrapThenable(promiseInput, arg);
            }
          }
          args[i] = arg;
        }

        var promise = new lib$rsvp$promise$$default(lib$rsvp$$internal$$noop);

        args[l] = function(err, val) {
          if (err)
            lib$rsvp$$internal$$reject(promise, err);
          else if (options === undefined)
            lib$rsvp$$internal$$resolve(promise, val);
          else if (options === true)
            lib$rsvp$$internal$$resolve(promise, lib$rsvp$node$$arrayResult(arguments));
          else if (lib$rsvp$utils$$isArray(options))
            lib$rsvp$$internal$$resolve(promise, lib$rsvp$node$$makeObject(arguments, options));
          else
            lib$rsvp$$internal$$resolve(promise, val);
        };

        if (promiseInput) {
          return lib$rsvp$node$$handlePromiseInput(promise, args, nodeFunc, self);
        } else {
          return lib$rsvp$node$$handleValueInput(promise, args, nodeFunc, self);
        }
      };

      fn.__proto__ = nodeFunc;

      return fn;
    }

    var lib$rsvp$node$$default = lib$rsvp$node$$denodeify;

    function lib$rsvp$node$$handleValueInput(promise, args, nodeFunc, self) {
      var result = lib$rsvp$node$$tryApply(nodeFunc, self, args);
      if (result === lib$rsvp$node$$ERROR) {
        lib$rsvp$$internal$$reject(promise, result.value);
      }
      return promise;
    }

    function lib$rsvp$node$$handlePromiseInput(promise, args, nodeFunc, self){
      return lib$rsvp$promise$$default.all(args).then(function(args){
        var result = lib$rsvp$node$$tryApply(nodeFunc, self, args);
        if (result === lib$rsvp$node$$ERROR) {
          lib$rsvp$$internal$$reject(promise, result.value);
        }
        return promise;
      });
    }

    function lib$rsvp$node$$needsPromiseInput(arg) {
      if (arg && typeof arg === 'object') {
        if (arg.constructor === lib$rsvp$promise$$default) {
          return true;
        } else {
          return lib$rsvp$node$$getThen(arg);
        }
      } else {
        return false;
      }
    }
    function lib$rsvp$race$$race(array, label) {
      return lib$rsvp$promise$$default.race(array, label);
    }
    var lib$rsvp$race$$default = lib$rsvp$race$$race;
    function lib$rsvp$reject$$reject(reason, label) {
      return lib$rsvp$promise$$default.reject(reason, label);
    }
    var lib$rsvp$reject$$default = lib$rsvp$reject$$reject;
    function lib$rsvp$resolve$$resolve(value, label) {
      return lib$rsvp$promise$$default.resolve(value, label);
    }
    var lib$rsvp$resolve$$default = lib$rsvp$resolve$$resolve;
    function lib$rsvp$rethrow$$rethrow(reason) {
      setTimeout(function() {
        throw reason;
      });
      throw reason;
    }
    var lib$rsvp$rethrow$$default = lib$rsvp$rethrow$$rethrow;

    // default async is asap;
    lib$rsvp$config$$config.async = lib$rsvp$asap$$default;
    var lib$rsvp$$cast = lib$rsvp$resolve$$default;
    function lib$rsvp$$async(callback, arg) {
      lib$rsvp$config$$config.async(callback, arg);
    }

    function lib$rsvp$$on() {
      lib$rsvp$config$$config['on'].apply(lib$rsvp$config$$config, arguments);
    }

    function lib$rsvp$$off() {
      lib$rsvp$config$$config['off'].apply(lib$rsvp$config$$config, arguments);
    }

    // Set up instrumentation through `window.__PROMISE_INTRUMENTATION__`
    if (typeof window !== 'undefined' && typeof window['__PROMISE_INSTRUMENTATION__'] === 'object') {
      var lib$rsvp$$callbacks = window['__PROMISE_INSTRUMENTATION__'];
      lib$rsvp$config$$configure('instrument', true);
      for (var lib$rsvp$$eventName in lib$rsvp$$callbacks) {
        if (lib$rsvp$$callbacks.hasOwnProperty(lib$rsvp$$eventName)) {
          lib$rsvp$$on(lib$rsvp$$eventName, lib$rsvp$$callbacks[lib$rsvp$$eventName]);
        }
      }
    }

    var lib$rsvp$umd$$RSVP = {
      'race': lib$rsvp$race$$default,
      'Promise': lib$rsvp$promise$$default,
      'allSettled': lib$rsvp$all$settled$$default,
      'hash': lib$rsvp$hash$$default,
      'hashSettled': lib$rsvp$hash$settled$$default,
      'denodeify': lib$rsvp$node$$default,
      'on': lib$rsvp$$on,
      'off': lib$rsvp$$off,
      'map': lib$rsvp$map$$default,
      'filter': lib$rsvp$filter$$default,
      'resolve': lib$rsvp$resolve$$default,
      'reject': lib$rsvp$reject$$default,
      'all': lib$rsvp$all$$default,
      'rethrow': lib$rsvp$rethrow$$default,
      'defer': lib$rsvp$defer$$default,
      'EventTarget': lib$rsvp$events$$default,
      'configure': lib$rsvp$config$$configure,
      'async': lib$rsvp$$async
    };

    /* global define:true module:true window: true */
    if (typeof define === 'function' && define['amd']) {
      define(function() { return lib$rsvp$umd$$RSVP; });
    } else if (typeof module !== 'undefined' && module['exports']) {
      module['exports'] = lib$rsvp$umd$$RSVP;
    } else if (typeof this !== 'undefined') {
      this['RSVP'] = lib$rsvp$umd$$RSVP;
    }
}).call(this);


}).call(this,require('_process'))

},{"_process":9}],41:[function(require,module,exports){
//     Underscore.js 1.8.2
//     http://underscorejs.org
//     (c) 2009-2015 Jeremy Ashkenas, DocumentCloud and Investigative Reporters & Editors
//     Underscore may be freely distributed under the MIT license.

(function() {

  // Baseline setup
  // --------------

  // Establish the root object, `window` in the browser, or `exports` on the server.
  var root = this;

  // Save the previous value of the `_` variable.
  var previousUnderscore = root._;

  // Save bytes in the minified (but not gzipped) version:
  var ArrayProto = Array.prototype, ObjProto = Object.prototype, FuncProto = Function.prototype;

  // Create quick reference variables for speed access to core prototypes.
  var
    push             = ArrayProto.push,
    slice            = ArrayProto.slice,
    toString         = ObjProto.toString,
    hasOwnProperty   = ObjProto.hasOwnProperty;

  // All **ECMAScript 5** native function implementations that we hope to use
  // are declared here.
  var
    nativeIsArray      = Array.isArray,
    nativeKeys         = Object.keys,
    nativeBind         = FuncProto.bind,
    nativeCreate       = Object.create;

  // Naked function reference for surrogate-prototype-swapping.
  var Ctor = function(){};

  // Create a safe reference to the Underscore object for use below.
  var _ = function(obj) {
    if (obj instanceof _) return obj;
    if (!(this instanceof _)) return new _(obj);
    this._wrapped = obj;
  };

  // Export the Underscore object for **Node.js**, with
  // backwards-compatibility for the old `require()` API. If we're in
  // the browser, add `_` as a global object.
  if (typeof exports !== 'undefined') {
    if (typeof module !== 'undefined' && module.exports) {
      exports = module.exports = _;
    }
    exports._ = _;
  } else {
    root._ = _;
  }

  // Current version.
  _.VERSION = '1.8.2';

  // Internal function that returns an efficient (for current engines) version
  // of the passed-in callback, to be repeatedly applied in other Underscore
  // functions.
  var optimizeCb = function(func, context, argCount) {
    if (context === void 0) return func;
    switch (argCount == null ? 3 : argCount) {
      case 1: return function(value) {
        return func.call(context, value);
      };
      case 2: return function(value, other) {
        return func.call(context, value, other);
      };
      case 3: return function(value, index, collection) {
        return func.call(context, value, index, collection);
      };
      case 4: return function(accumulator, value, index, collection) {
        return func.call(context, accumulator, value, index, collection);
      };
    }
    return function() {
      return func.apply(context, arguments);
    };
  };

  // A mostly-internal function to generate callbacks that can be applied
  // to each element in a collection, returning the desired result — either
  // identity, an arbitrary callback, a property matcher, or a property accessor.
  var cb = function(value, context, argCount) {
    if (value == null) return _.identity;
    if (_.isFunction(value)) return optimizeCb(value, context, argCount);
    if (_.isObject(value)) return _.matcher(value);
    return _.property(value);
  };
  _.iteratee = function(value, context) {
    return cb(value, context, Infinity);
  };

  // An internal function for creating assigner functions.
  var createAssigner = function(keysFunc, undefinedOnly) {
    return function(obj) {
      var length = arguments.length;
      if (length < 2 || obj == null) return obj;
      for (var index = 1; index < length; index++) {
        var source = arguments[index],
            keys = keysFunc(source),
            l = keys.length;
        for (var i = 0; i < l; i++) {
          var key = keys[i];
          if (!undefinedOnly || obj[key] === void 0) obj[key] = source[key];
        }
      }
      return obj;
    };
  };

  // An internal function for creating a new object that inherits from another.
  var baseCreate = function(prototype) {
    if (!_.isObject(prototype)) return {};
    if (nativeCreate) return nativeCreate(prototype);
    Ctor.prototype = prototype;
    var result = new Ctor;
    Ctor.prototype = null;
    return result;
  };

  // Helper for collection methods to determine whether a collection
  // should be iterated as an array or as an object
  // Related: http://people.mozilla.org/~jorendorff/es6-draft.html#sec-tolength
  var MAX_ARRAY_INDEX = Math.pow(2, 53) - 1;
  var isArrayLike = function(collection) {
    var length = collection && collection.length;
    return typeof length == 'number' && length >= 0 && length <= MAX_ARRAY_INDEX;
  };

  // Collection Functions
  // --------------------

  // The cornerstone, an `each` implementation, aka `forEach`.
  // Handles raw objects in addition to array-likes. Treats all
  // sparse array-likes as if they were dense.
  _.each = _.forEach = function(obj, iteratee, context) {
    iteratee = optimizeCb(iteratee, context);
    var i, length;
    if (isArrayLike(obj)) {
      for (i = 0, length = obj.length; i < length; i++) {
        iteratee(obj[i], i, obj);
      }
    } else {
      var keys = _.keys(obj);
      for (i = 0, length = keys.length; i < length; i++) {
        iteratee(obj[keys[i]], keys[i], obj);
      }
    }
    return obj;
  };

  // Return the results of applying the iteratee to each element.
  _.map = _.collect = function(obj, iteratee, context) {
    iteratee = cb(iteratee, context);
    var keys = !isArrayLike(obj) && _.keys(obj),
        length = (keys || obj).length,
        results = Array(length);
    for (var index = 0; index < length; index++) {
      var currentKey = keys ? keys[index] : index;
      results[index] = iteratee(obj[currentKey], currentKey, obj);
    }
    return results;
  };

  // Create a reducing function iterating left or right.
  function createReduce(dir) {
    // Optimized iterator function as using arguments.length
    // in the main function will deoptimize the, see #1991.
    function iterator(obj, iteratee, memo, keys, index, length) {
      for (; index >= 0 && index < length; index += dir) {
        var currentKey = keys ? keys[index] : index;
        memo = iteratee(memo, obj[currentKey], currentKey, obj);
      }
      return memo;
    }

    return function(obj, iteratee, memo, context) {
      iteratee = optimizeCb(iteratee, context, 4);
      var keys = !isArrayLike(obj) && _.keys(obj),
          length = (keys || obj).length,
          index = dir > 0 ? 0 : length - 1;
      // Determine the initial value if none is provided.
      if (arguments.length < 3) {
        memo = obj[keys ? keys[index] : index];
        index += dir;
      }
      return iterator(obj, iteratee, memo, keys, index, length);
    };
  }

  // **Reduce** builds up a single result from a list of values, aka `inject`,
  // or `foldl`.
  _.reduce = _.foldl = _.inject = createReduce(1);

  // The right-associative version of reduce, also known as `foldr`.
  _.reduceRight = _.foldr = createReduce(-1);

  // Return the first value which passes a truth test. Aliased as `detect`.
  _.find = _.detect = function(obj, predicate, context) {
    var key;
    if (isArrayLike(obj)) {
      key = _.findIndex(obj, predicate, context);
    } else {
      key = _.findKey(obj, predicate, context);
    }
    if (key !== void 0 && key !== -1) return obj[key];
  };

  // Return all the elements that pass a truth test.
  // Aliased as `select`.
  _.filter = _.select = function(obj, predicate, context) {
    var results = [];
    predicate = cb(predicate, context);
    _.each(obj, function(value, index, list) {
      if (predicate(value, index, list)) results.push(value);
    });
    return results;
  };

  // Return all the elements for which a truth test fails.
  _.reject = function(obj, predicate, context) {
    return _.filter(obj, _.negate(cb(predicate)), context);
  };

  // Determine whether all of the elements match a truth test.
  // Aliased as `all`.
  _.every = _.all = function(obj, predicate, context) {
    predicate = cb(predicate, context);
    var keys = !isArrayLike(obj) && _.keys(obj),
        length = (keys || obj).length;
    for (var index = 0; index < length; index++) {
      var currentKey = keys ? keys[index] : index;
      if (!predicate(obj[currentKey], currentKey, obj)) return false;
    }
    return true;
  };

  // Determine if at least one element in the object matches a truth test.
  // Aliased as `any`.
  _.some = _.any = function(obj, predicate, context) {
    predicate = cb(predicate, context);
    var keys = !isArrayLike(obj) && _.keys(obj),
        length = (keys || obj).length;
    for (var index = 0; index < length; index++) {
      var currentKey = keys ? keys[index] : index;
      if (predicate(obj[currentKey], currentKey, obj)) return true;
    }
    return false;
  };

  // Determine if the array or object contains a given value (using `===`).
  // Aliased as `includes` and `include`.
  _.contains = _.includes = _.include = function(obj, target, fromIndex) {
    if (!isArrayLike(obj)) obj = _.values(obj);
    return _.indexOf(obj, target, typeof fromIndex == 'number' && fromIndex) >= 0;
  };

  // Invoke a method (with arguments) on every item in a collection.
  _.invoke = function(obj, method) {
    var args = slice.call(arguments, 2);
    var isFunc = _.isFunction(method);
    return _.map(obj, function(value) {
      var func = isFunc ? method : value[method];
      return func == null ? func : func.apply(value, args);
    });
  };

  // Convenience version of a common use case of `map`: fetching a property.
  _.pluck = function(obj, key) {
    return _.map(obj, _.property(key));
  };

  // Convenience version of a common use case of `filter`: selecting only objects
  // containing specific `key:value` pairs.
  _.where = function(obj, attrs) {
    return _.filter(obj, _.matcher(attrs));
  };

  // Convenience version of a common use case of `find`: getting the first object
  // containing specific `key:value` pairs.
  _.findWhere = function(obj, attrs) {
    return _.find(obj, _.matcher(attrs));
  };

  // Return the maximum element (or element-based computation).
  _.max = function(obj, iteratee, context) {
    var result = -Infinity, lastComputed = -Infinity,
        value, computed;
    if (iteratee == null && obj != null) {
      obj = isArrayLike(obj) ? obj : _.values(obj);
      for (var i = 0, length = obj.length; i < length; i++) {
        value = obj[i];
        if (value > result) {
          result = value;
        }
      }
    } else {
      iteratee = cb(iteratee, context);
      _.each(obj, function(value, index, list) {
        computed = iteratee(value, index, list);
        if (computed > lastComputed || computed === -Infinity && result === -Infinity) {
          result = value;
          lastComputed = computed;
        }
      });
    }
    return result;
  };

  // Return the minimum element (or element-based computation).
  _.min = function(obj, iteratee, context) {
    var result = Infinity, lastComputed = Infinity,
        value, computed;
    if (iteratee == null && obj != null) {
      obj = isArrayLike(obj) ? obj : _.values(obj);
      for (var i = 0, length = obj.length; i < length; i++) {
        value = obj[i];
        if (value < result) {
          result = value;
        }
      }
    } else {
      iteratee = cb(iteratee, context);
      _.each(obj, function(value, index, list) {
        computed = iteratee(value, index, list);
        if (computed < lastComputed || computed === Infinity && result === Infinity) {
          result = value;
          lastComputed = computed;
        }
      });
    }
    return result;
  };

  // Shuffle a collection, using the modern version of the
  // [Fisher-Yates shuffle](http://en.wikipedia.org/wiki/Fisher–Yates_shuffle).
  _.shuffle = function(obj) {
    var set = isArrayLike(obj) ? obj : _.values(obj);
    var length = set.length;
    var shuffled = Array(length);
    for (var index = 0, rand; index < length; index++) {
      rand = _.random(0, index);
      if (rand !== index) shuffled[index] = shuffled[rand];
      shuffled[rand] = set[index];
    }
    return shuffled;
  };

  // Sample **n** random values from a collection.
  // If **n** is not specified, returns a single random element.
  // The internal `guard` argument allows it to work with `map`.
  _.sample = function(obj, n, guard) {
    if (n == null || guard) {
      if (!isArrayLike(obj)) obj = _.values(obj);
      return obj[_.random(obj.length - 1)];
    }
    return _.shuffle(obj).slice(0, Math.max(0, n));
  };

  // Sort the object's values by a criterion produced by an iteratee.
  _.sortBy = function(obj, iteratee, context) {
    iteratee = cb(iteratee, context);
    return _.pluck(_.map(obj, function(value, index, list) {
      return {
        value: value,
        index: index,
        criteria: iteratee(value, index, list)
      };
    }).sort(function(left, right) {
      var a = left.criteria;
      var b = right.criteria;
      if (a !== b) {
        if (a > b || a === void 0) return 1;
        if (a < b || b === void 0) return -1;
      }
      return left.index - right.index;
    }), 'value');
  };

  // An internal function used for aggregate "group by" operations.
  var group = function(behavior) {
    return function(obj, iteratee, context) {
      var result = {};
      iteratee = cb(iteratee, context);
      _.each(obj, function(value, index) {
        var key = iteratee(value, index, obj);
        behavior(result, value, key);
      });
      return result;
    };
  };

  // Groups the object's values by a criterion. Pass either a string attribute
  // to group by, or a function that returns the criterion.
  _.groupBy = group(function(result, value, key) {
    if (_.has(result, key)) result[key].push(value); else result[key] = [value];
  });

  // Indexes the object's values by a criterion, similar to `groupBy`, but for
  // when you know that your index values will be unique.
  _.indexBy = group(function(result, value, key) {
    result[key] = value;
  });

  // Counts instances of an object that group by a certain criterion. Pass
  // either a string attribute to count by, or a function that returns the
  // criterion.
  _.countBy = group(function(result, value, key) {
    if (_.has(result, key)) result[key]++; else result[key] = 1;
  });

  // Safely create a real, live array from anything iterable.
  _.toArray = function(obj) {
    if (!obj) return [];
    if (_.isArray(obj)) return slice.call(obj);
    if (isArrayLike(obj)) return _.map(obj, _.identity);
    return _.values(obj);
  };

  // Return the number of elements in an object.
  _.size = function(obj) {
    if (obj == null) return 0;
    return isArrayLike(obj) ? obj.length : _.keys(obj).length;
  };

  // Split a collection into two arrays: one whose elements all satisfy the given
  // predicate, and one whose elements all do not satisfy the predicate.
  _.partition = function(obj, predicate, context) {
    predicate = cb(predicate, context);
    var pass = [], fail = [];
    _.each(obj, function(value, key, obj) {
      (predicate(value, key, obj) ? pass : fail).push(value);
    });
    return [pass, fail];
  };

  // Array Functions
  // ---------------

  // Get the first element of an array. Passing **n** will return the first N
  // values in the array. Aliased as `head` and `take`. The **guard** check
  // allows it to work with `_.map`.
  _.first = _.head = _.take = function(array, n, guard) {
    if (array == null) return void 0;
    if (n == null || guard) return array[0];
    return _.initial(array, array.length - n);
  };

  // Returns everything but the last entry of the array. Especially useful on
  // the arguments object. Passing **n** will return all the values in
  // the array, excluding the last N.
  _.initial = function(array, n, guard) {
    return slice.call(array, 0, Math.max(0, array.length - (n == null || guard ? 1 : n)));
  };

  // Get the last element of an array. Passing **n** will return the last N
  // values in the array.
  _.last = function(array, n, guard) {
    if (array == null) return void 0;
    if (n == null || guard) return array[array.length - 1];
    return _.rest(array, Math.max(0, array.length - n));
  };

  // Returns everything but the first entry of the array. Aliased as `tail` and `drop`.
  // Especially useful on the arguments object. Passing an **n** will return
  // the rest N values in the array.
  _.rest = _.tail = _.drop = function(array, n, guard) {
    return slice.call(array, n == null || guard ? 1 : n);
  };

  // Trim out all falsy values from an array.
  _.compact = function(array) {
    return _.filter(array, _.identity);
  };

  // Internal implementation of a recursive `flatten` function.
  var flatten = function(input, shallow, strict, startIndex) {
    var output = [], idx = 0;
    for (var i = startIndex || 0, length = input && input.length; i < length; i++) {
      var value = input[i];
      if (isArrayLike(value) && (_.isArray(value) || _.isArguments(value))) {
        //flatten current level of array or arguments object
        if (!shallow) value = flatten(value, shallow, strict);
        var j = 0, len = value.length;
        output.length += len;
        while (j < len) {
          output[idx++] = value[j++];
        }
      } else if (!strict) {
        output[idx++] = value;
      }
    }
    return output;
  };

  // Flatten out an array, either recursively (by default), or just one level.
  _.flatten = function(array, shallow) {
    return flatten(array, shallow, false);
  };

  // Return a version of the array that does not contain the specified value(s).
  _.without = function(array) {
    return _.difference(array, slice.call(arguments, 1));
  };

  // Produce a duplicate-free version of the array. If the array has already
  // been sorted, you have the option of using a faster algorithm.
  // Aliased as `unique`.
  _.uniq = _.unique = function(array, isSorted, iteratee, context) {
    if (array == null) return [];
    if (!_.isBoolean(isSorted)) {
      context = iteratee;
      iteratee = isSorted;
      isSorted = false;
    }
    if (iteratee != null) iteratee = cb(iteratee, context);
    var result = [];
    var seen = [];
    for (var i = 0, length = array.length; i < length; i++) {
      var value = array[i],
          computed = iteratee ? iteratee(value, i, array) : value;
      if (isSorted) {
        if (!i || seen !== computed) result.push(value);
        seen = computed;
      } else if (iteratee) {
        if (!_.contains(seen, computed)) {
          seen.push(computed);
          result.push(value);
        }
      } else if (!_.contains(result, value)) {
        result.push(value);
      }
    }
    return result;
  };

  // Produce an array that contains the union: each distinct element from all of
  // the passed-in arrays.
  _.union = function() {
    return _.uniq(flatten(arguments, true, true));
  };

  // Produce an array that contains every item shared between all the
  // passed-in arrays.
  _.intersection = function(array) {
    if (array == null) return [];
    var result = [];
    var argsLength = arguments.length;
    for (var i = 0, length = array.length; i < length; i++) {
      var item = array[i];
      if (_.contains(result, item)) continue;
      for (var j = 1; j < argsLength; j++) {
        if (!_.contains(arguments[j], item)) break;
      }
      if (j === argsLength) result.push(item);
    }
    return result;
  };

  // Take the difference between one array and a number of other arrays.
  // Only the elements present in just the first array will remain.
  _.difference = function(array) {
    var rest = flatten(arguments, true, true, 1);
    return _.filter(array, function(value){
      return !_.contains(rest, value);
    });
  };

  // Zip together multiple lists into a single array -- elements that share
  // an index go together.
  _.zip = function() {
    return _.unzip(arguments);
  };

  // Complement of _.zip. Unzip accepts an array of arrays and groups
  // each array's elements on shared indices
  _.unzip = function(array) {
    var length = array && _.max(array, 'length').length || 0;
    var result = Array(length);

    for (var index = 0; index < length; index++) {
      result[index] = _.pluck(array, index);
    }
    return result;
  };

  // Converts lists into objects. Pass either a single array of `[key, value]`
  // pairs, or two parallel arrays of the same length -- one of keys, and one of
  // the corresponding values.
  _.object = function(list, values) {
    var result = {};
    for (var i = 0, length = list && list.length; i < length; i++) {
      if (values) {
        result[list[i]] = values[i];
      } else {
        result[list[i][0]] = list[i][1];
      }
    }
    return result;
  };

  // Return the position of the first occurrence of an item in an array,
  // or -1 if the item is not included in the array.
  // If the array is large and already in sort order, pass `true`
  // for **isSorted** to use binary search.
  _.indexOf = function(array, item, isSorted) {
    var i = 0, length = array && array.length;
    if (typeof isSorted == 'number') {
      i = isSorted < 0 ? Math.max(0, length + isSorted) : isSorted;
    } else if (isSorted && length) {
      i = _.sortedIndex(array, item);
      return array[i] === item ? i : -1;
    }
    if (item !== item) {
      return _.findIndex(slice.call(array, i), _.isNaN);
    }
    for (; i < length; i++) if (array[i] === item) return i;
    return -1;
  };

  _.lastIndexOf = function(array, item, from) {
    var idx = array ? array.length : 0;
    if (typeof from == 'number') {
      idx = from < 0 ? idx + from + 1 : Math.min(idx, from + 1);
    }
    if (item !== item) {
      return _.findLastIndex(slice.call(array, 0, idx), _.isNaN);
    }
    while (--idx >= 0) if (array[idx] === item) return idx;
    return -1;
  };

  // Generator function to create the findIndex and findLastIndex functions
  function createIndexFinder(dir) {
    return function(array, predicate, context) {
      predicate = cb(predicate, context);
      var length = array != null && array.length;
      var index = dir > 0 ? 0 : length - 1;
      for (; index >= 0 && index < length; index += dir) {
        if (predicate(array[index], index, array)) return index;
      }
      return -1;
    };
  }

  // Returns the first index on an array-like that passes a predicate test
  _.findIndex = createIndexFinder(1);

  _.findLastIndex = createIndexFinder(-1);

  // Use a comparator function to figure out the smallest index at which
  // an object should be inserted so as to maintain order. Uses binary search.
  _.sortedIndex = function(array, obj, iteratee, context) {
    iteratee = cb(iteratee, context, 1);
    var value = iteratee(obj);
    var low = 0, high = array.length;
    while (low < high) {
      var mid = Math.floor((low + high) / 2);
      if (iteratee(array[mid]) < value) low = mid + 1; else high = mid;
    }
    return low;
  };

  // Generate an integer Array containing an arithmetic progression. A port of
  // the native Python `range()` function. See
  // [the Python documentation](http://docs.python.org/library/functions.html#range).
  _.range = function(start, stop, step) {
    if (arguments.length <= 1) {
      stop = start || 0;
      start = 0;
    }
    step = step || 1;

    var length = Math.max(Math.ceil((stop - start) / step), 0);
    var range = Array(length);

    for (var idx = 0; idx < length; idx++, start += step) {
      range[idx] = start;
    }

    return range;
  };

  // Function (ahem) Functions
  // ------------------

  // Determines whether to execute a function as a constructor
  // or a normal function with the provided arguments
  var executeBound = function(sourceFunc, boundFunc, context, callingContext, args) {
    if (!(callingContext instanceof boundFunc)) return sourceFunc.apply(context, args);
    var self = baseCreate(sourceFunc.prototype);
    var result = sourceFunc.apply(self, args);
    if (_.isObject(result)) return result;
    return self;
  };

  // Create a function bound to a given object (assigning `this`, and arguments,
  // optionally). Delegates to **ECMAScript 5**'s native `Function.bind` if
  // available.
  _.bind = function(func, context) {
    if (nativeBind && func.bind === nativeBind) return nativeBind.apply(func, slice.call(arguments, 1));
    if (!_.isFunction(func)) throw new TypeError('Bind must be called on a function');
    var args = slice.call(arguments, 2);
    var bound = function() {
      return executeBound(func, bound, context, this, args.concat(slice.call(arguments)));
    };
    return bound;
  };

  // Partially apply a function by creating a version that has had some of its
  // arguments pre-filled, without changing its dynamic `this` context. _ acts
  // as a placeholder, allowing any combination of arguments to be pre-filled.
  _.partial = function(func) {
    var boundArgs = slice.call(arguments, 1);
    var bound = function() {
      var position = 0, length = boundArgs.length;
      var args = Array(length);
      for (var i = 0; i < length; i++) {
        args[i] = boundArgs[i] === _ ? arguments[position++] : boundArgs[i];
      }
      while (position < arguments.length) args.push(arguments[position++]);
      return executeBound(func, bound, this, this, args);
    };
    return bound;
  };

  // Bind a number of an object's methods to that object. Remaining arguments
  // are the method names to be bound. Useful for ensuring that all callbacks
  // defined on an object belong to it.
  _.bindAll = function(obj) {
    var i, length = arguments.length, key;
    if (length <= 1) throw new Error('bindAll must be passed function names');
    for (i = 1; i < length; i++) {
      key = arguments[i];
      obj[key] = _.bind(obj[key], obj);
    }
    return obj;
  };

  // Memoize an expensive function by storing its results.
  _.memoize = function(func, hasher) {
    var memoize = function(key) {
      var cache = memoize.cache;
      var address = '' + (hasher ? hasher.apply(this, arguments) : key);
      if (!_.has(cache, address)) cache[address] = func.apply(this, arguments);
      return cache[address];
    };
    memoize.cache = {};
    return memoize;
  };

  // Delays a function for the given number of milliseconds, and then calls
  // it with the arguments supplied.
  _.delay = function(func, wait) {
    var args = slice.call(arguments, 2);
    return setTimeout(function(){
      return func.apply(null, args);
    }, wait);
  };

  // Defers a function, scheduling it to run after the current call stack has
  // cleared.
  _.defer = _.partial(_.delay, _, 1);

  // Returns a function, that, when invoked, will only be triggered at most once
  // during a given window of time. Normally, the throttled function will run
  // as much as it can, without ever going more than once per `wait` duration;
  // but if you'd like to disable the execution on the leading edge, pass
  // `{leading: false}`. To disable execution on the trailing edge, ditto.
  _.throttle = function(func, wait, options) {
    var context, args, result;
    var timeout = null;
    var previous = 0;
    if (!options) options = {};
    var later = function() {
      previous = options.leading === false ? 0 : _.now();
      timeout = null;
      result = func.apply(context, args);
      if (!timeout) context = args = null;
    };
    return function() {
      var now = _.now();
      if (!previous && options.leading === false) previous = now;
      var remaining = wait - (now - previous);
      context = this;
      args = arguments;
      if (remaining <= 0 || remaining > wait) {
        if (timeout) {
          clearTimeout(timeout);
          timeout = null;
        }
        previous = now;
        result = func.apply(context, args);
        if (!timeout) context = args = null;
      } else if (!timeout && options.trailing !== false) {
        timeout = setTimeout(later, remaining);
      }
      return result;
    };
  };

  // Returns a function, that, as long as it continues to be invoked, will not
  // be triggered. The function will be called after it stops being called for
  // N milliseconds. If `immediate` is passed, trigger the function on the
  // leading edge, instead of the trailing.
  _.debounce = function(func, wait, immediate) {
    var timeout, args, context, timestamp, result;

    var later = function() {
      var last = _.now() - timestamp;

      if (last < wait && last >= 0) {
        timeout = setTimeout(later, wait - last);
      } else {
        timeout = null;
        if (!immediate) {
          result = func.apply(context, args);
          if (!timeout) context = args = null;
        }
      }
    };

    return function() {
      context = this;
      args = arguments;
      timestamp = _.now();
      var callNow = immediate && !timeout;
      if (!timeout) timeout = setTimeout(later, wait);
      if (callNow) {
        result = func.apply(context, args);
        context = args = null;
      }

      return result;
    };
  };

  // Returns the first function passed as an argument to the second,
  // allowing you to adjust arguments, run code before and after, and
  // conditionally execute the original function.
  _.wrap = function(func, wrapper) {
    return _.partial(wrapper, func);
  };

  // Returns a negated version of the passed-in predicate.
  _.negate = function(predicate) {
    return function() {
      return !predicate.apply(this, arguments);
    };
  };

  // Returns a function that is the composition of a list of functions, each
  // consuming the return value of the function that follows.
  _.compose = function() {
    var args = arguments;
    var start = args.length - 1;
    return function() {
      var i = start;
      var result = args[start].apply(this, arguments);
      while (i--) result = args[i].call(this, result);
      return result;
    };
  };

  // Returns a function that will only be executed on and after the Nth call.
  _.after = function(times, func) {
    return function() {
      if (--times < 1) {
        return func.apply(this, arguments);
      }
    };
  };

  // Returns a function that will only be executed up to (but not including) the Nth call.
  _.before = function(times, func) {
    var memo;
    return function() {
      if (--times > 0) {
        memo = func.apply(this, arguments);
      }
      if (times <= 1) func = null;
      return memo;
    };
  };

  // Returns a function that will be executed at most one time, no matter how
  // often you call it. Useful for lazy initialization.
  _.once = _.partial(_.before, 2);

  // Object Functions
  // ----------------

  // Keys in IE < 9 that won't be iterated by `for key in ...` and thus missed.
  var hasEnumBug = !{toString: null}.propertyIsEnumerable('toString');
  var nonEnumerableProps = ['valueOf', 'isPrototypeOf', 'toString',
                      'propertyIsEnumerable', 'hasOwnProperty', 'toLocaleString'];

  function collectNonEnumProps(obj, keys) {
    var nonEnumIdx = nonEnumerableProps.length;
    var constructor = obj.constructor;
    var proto = (_.isFunction(constructor) && constructor.prototype) || ObjProto;

    // Constructor is a special case.
    var prop = 'constructor';
    if (_.has(obj, prop) && !_.contains(keys, prop)) keys.push(prop);

    while (nonEnumIdx--) {
      prop = nonEnumerableProps[nonEnumIdx];
      if (prop in obj && obj[prop] !== proto[prop] && !_.contains(keys, prop)) {
        keys.push(prop);
      }
    }
  }

  // Retrieve the names of an object's own properties.
  // Delegates to **ECMAScript 5**'s native `Object.keys`
  _.keys = function(obj) {
    if (!_.isObject(obj)) return [];
    if (nativeKeys) return nativeKeys(obj);
    var keys = [];
    for (var key in obj) if (_.has(obj, key)) keys.push(key);
    // Ahem, IE < 9.
    if (hasEnumBug) collectNonEnumProps(obj, keys);
    return keys;
  };

  // Retrieve all the property names of an object.
  _.allKeys = function(obj) {
    if (!_.isObject(obj)) return [];
    var keys = [];
    for (var key in obj) keys.push(key);
    // Ahem, IE < 9.
    if (hasEnumBug) collectNonEnumProps(obj, keys);
    return keys;
  };

  // Retrieve the values of an object's properties.
  _.values = function(obj) {
    var keys = _.keys(obj);
    var length = keys.length;
    var values = Array(length);
    for (var i = 0; i < length; i++) {
      values[i] = obj[keys[i]];
    }
    return values;
  };

  // Returns the results of applying the iteratee to each element of the object
  // In contrast to _.map it returns an object
  _.mapObject = function(obj, iteratee, context) {
    iteratee = cb(iteratee, context);
    var keys =  _.keys(obj),
          length = keys.length,
          results = {},
          currentKey;
      for (var index = 0; index < length; index++) {
        currentKey = keys[index];
        results[currentKey] = iteratee(obj[currentKey], currentKey, obj);
      }
      return results;
  };

  // Convert an object into a list of `[key, value]` pairs.
  _.pairs = function(obj) {
    var keys = _.keys(obj);
    var length = keys.length;
    var pairs = Array(length);
    for (var i = 0; i < length; i++) {
      pairs[i] = [keys[i], obj[keys[i]]];
    }
    return pairs;
  };

  // Invert the keys and values of an object. The values must be serializable.
  _.invert = function(obj) {
    var result = {};
    var keys = _.keys(obj);
    for (var i = 0, length = keys.length; i < length; i++) {
      result[obj[keys[i]]] = keys[i];
    }
    return result;
  };

  // Return a sorted list of the function names available on the object.
  // Aliased as `methods`
  _.functions = _.methods = function(obj) {
    var names = [];
    for (var key in obj) {
      if (_.isFunction(obj[key])) names.push(key);
    }
    return names.sort();
  };

  // Extend a given object with all the properties in passed-in object(s).
  _.extend = createAssigner(_.allKeys);

  // Assigns a given object with all the own properties in the passed-in object(s)
  // (https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Object/assign)
  _.extendOwn = _.assign = createAssigner(_.keys);

  // Returns the first key on an object that passes a predicate test
  _.findKey = function(obj, predicate, context) {
    predicate = cb(predicate, context);
    var keys = _.keys(obj), key;
    for (var i = 0, length = keys.length; i < length; i++) {
      key = keys[i];
      if (predicate(obj[key], key, obj)) return key;
    }
  };

  // Return a copy of the object only containing the whitelisted properties.
  _.pick = function(object, oiteratee, context) {
    var result = {}, obj = object, iteratee, keys;
    if (obj == null) return result;
    if (_.isFunction(oiteratee)) {
      keys = _.allKeys(obj);
      iteratee = optimizeCb(oiteratee, context);
    } else {
      keys = flatten(arguments, false, false, 1);
      iteratee = function(value, key, obj) { return key in obj; };
      obj = Object(obj);
    }
    for (var i = 0, length = keys.length; i < length; i++) {
      var key = keys[i];
      var value = obj[key];
      if (iteratee(value, key, obj)) result[key] = value;
    }
    return result;
  };

   // Return a copy of the object without the blacklisted properties.
  _.omit = function(obj, iteratee, context) {
    if (_.isFunction(iteratee)) {
      iteratee = _.negate(iteratee);
    } else {
      var keys = _.map(flatten(arguments, false, false, 1), String);
      iteratee = function(value, key) {
        return !_.contains(keys, key);
      };
    }
    return _.pick(obj, iteratee, context);
  };

  // Fill in a given object with default properties.
  _.defaults = createAssigner(_.allKeys, true);

  // Create a (shallow-cloned) duplicate of an object.
  _.clone = function(obj) {
    if (!_.isObject(obj)) return obj;
    return _.isArray(obj) ? obj.slice() : _.extend({}, obj);
  };

  // Invokes interceptor with the obj, and then returns obj.
  // The primary purpose of this method is to "tap into" a method chain, in
  // order to perform operations on intermediate results within the chain.
  _.tap = function(obj, interceptor) {
    interceptor(obj);
    return obj;
  };

  // Returns whether an object has a given set of `key:value` pairs.
  _.isMatch = function(object, attrs) {
    var keys = _.keys(attrs), length = keys.length;
    if (object == null) return !length;
    var obj = Object(object);
    for (var i = 0; i < length; i++) {
      var key = keys[i];
      if (attrs[key] !== obj[key] || !(key in obj)) return false;
    }
    return true;
  };


  // Internal recursive comparison function for `isEqual`.
  var eq = function(a, b, aStack, bStack) {
    // Identical objects are equal. `0 === -0`, but they aren't identical.
    // See the [Harmony `egal` proposal](http://wiki.ecmascript.org/doku.php?id=harmony:egal).
    if (a === b) return a !== 0 || 1 / a === 1 / b;
    // A strict comparison is necessary because `null == undefined`.
    if (a == null || b == null) return a === b;
    // Unwrap any wrapped objects.
    if (a instanceof _) a = a._wrapped;
    if (b instanceof _) b = b._wrapped;
    // Compare `[[Class]]` names.
    var className = toString.call(a);
    if (className !== toString.call(b)) return false;
    switch (className) {
      // Strings, numbers, regular expressions, dates, and booleans are compared by value.
      case '[object RegExp]':
      // RegExps are coerced to strings for comparison (Note: '' + /a/i === '/a/i')
      case '[object String]':
        // Primitives and their corresponding object wrappers are equivalent; thus, `"5"` is
        // equivalent to `new String("5")`.
        return '' + a === '' + b;
      case '[object Number]':
        // `NaN`s are equivalent, but non-reflexive.
        // Object(NaN) is equivalent to NaN
        if (+a !== +a) return +b !== +b;
        // An `egal` comparison is performed for other numeric values.
        return +a === 0 ? 1 / +a === 1 / b : +a === +b;
      case '[object Date]':
      case '[object Boolean]':
        // Coerce dates and booleans to numeric primitive values. Dates are compared by their
        // millisecond representations. Note that invalid dates with millisecond representations
        // of `NaN` are not equivalent.
        return +a === +b;
    }

    var areArrays = className === '[object Array]';
    if (!areArrays) {
      if (typeof a != 'object' || typeof b != 'object') return false;

      // Objects with different constructors are not equivalent, but `Object`s or `Array`s
      // from different frames are.
      var aCtor = a.constructor, bCtor = b.constructor;
      if (aCtor !== bCtor && !(_.isFunction(aCtor) && aCtor instanceof aCtor &&
                               _.isFunction(bCtor) && bCtor instanceof bCtor)
                          && ('constructor' in a && 'constructor' in b)) {
        return false;
      }
    }
    // Assume equality for cyclic structures. The algorithm for detecting cyclic
    // structures is adapted from ES 5.1 section 15.12.3, abstract operation `JO`.
    
    // Initializing stack of traversed objects.
    // It's done here since we only need them for objects and arrays comparison.
    aStack = aStack || [];
    bStack = bStack || [];
    var length = aStack.length;
    while (length--) {
      // Linear search. Performance is inversely proportional to the number of
      // unique nested structures.
      if (aStack[length] === a) return bStack[length] === b;
    }

    // Add the first object to the stack of traversed objects.
    aStack.push(a);
    bStack.push(b);

    // Recursively compare objects and arrays.
    if (areArrays) {
      // Compare array lengths to determine if a deep comparison is necessary.
      length = a.length;
      if (length !== b.length) return false;
      // Deep compare the contents, ignoring non-numeric properties.
      while (length--) {
        if (!eq(a[length], b[length], aStack, bStack)) return false;
      }
    } else {
      // Deep compare objects.
      var keys = _.keys(a), key;
      length = keys.length;
      // Ensure that both objects contain the same number of properties before comparing deep equality.
      if (_.keys(b).length !== length) return false;
      while (length--) {
        // Deep compare each member
        key = keys[length];
        if (!(_.has(b, key) && eq(a[key], b[key], aStack, bStack))) return false;
      }
    }
    // Remove the first object from the stack of traversed objects.
    aStack.pop();
    bStack.pop();
    return true;
  };

  // Perform a deep comparison to check if two objects are equal.
  _.isEqual = function(a, b) {
    return eq(a, b);
  };

  // Is a given array, string, or object empty?
  // An "empty" object has no enumerable own-properties.
  _.isEmpty = function(obj) {
    if (obj == null) return true;
    if (isArrayLike(obj) && (_.isArray(obj) || _.isString(obj) || _.isArguments(obj))) return obj.length === 0;
    return _.keys(obj).length === 0;
  };

  // Is a given value a DOM element?
  _.isElement = function(obj) {
    return !!(obj && obj.nodeType === 1);
  };

  // Is a given value an array?
  // Delegates to ECMA5's native Array.isArray
  _.isArray = nativeIsArray || function(obj) {
    return toString.call(obj) === '[object Array]';
  };

  // Is a given variable an object?
  _.isObject = function(obj) {
    var type = typeof obj;
    return type === 'function' || type === 'object' && !!obj;
  };

  // Add some isType methods: isArguments, isFunction, isString, isNumber, isDate, isRegExp, isError.
  _.each(['Arguments', 'Function', 'String', 'Number', 'Date', 'RegExp', 'Error'], function(name) {
    _['is' + name] = function(obj) {
      return toString.call(obj) === '[object ' + name + ']';
    };
  });

  // Define a fallback version of the method in browsers (ahem, IE < 9), where
  // there isn't any inspectable "Arguments" type.
  if (!_.isArguments(arguments)) {
    _.isArguments = function(obj) {
      return _.has(obj, 'callee');
    };
  }

  // Optimize `isFunction` if appropriate. Work around some typeof bugs in old v8,
  // IE 11 (#1621), and in Safari 8 (#1929).
  if (typeof /./ != 'function' && typeof Int8Array != 'object') {
    _.isFunction = function(obj) {
      return typeof obj == 'function' || false;
    };
  }

  // Is a given object a finite number?
  _.isFinite = function(obj) {
    return isFinite(obj) && !isNaN(parseFloat(obj));
  };

  // Is the given value `NaN`? (NaN is the only number which does not equal itself).
  _.isNaN = function(obj) {
    return _.isNumber(obj) && obj !== +obj;
  };

  // Is a given value a boolean?
  _.isBoolean = function(obj) {
    return obj === true || obj === false || toString.call(obj) === '[object Boolean]';
  };

  // Is a given value equal to null?
  _.isNull = function(obj) {
    return obj === null;
  };

  // Is a given variable undefined?
  _.isUndefined = function(obj) {
    return obj === void 0;
  };

  // Shortcut function for checking if an object has a given property directly
  // on itself (in other words, not on a prototype).
  _.has = function(obj, key) {
    return obj != null && hasOwnProperty.call(obj, key);
  };

  // Utility Functions
  // -----------------

  // Run Underscore.js in *noConflict* mode, returning the `_` variable to its
  // previous owner. Returns a reference to the Underscore object.
  _.noConflict = function() {
    root._ = previousUnderscore;
    return this;
  };

  // Keep the identity function around for default iteratees.
  _.identity = function(value) {
    return value;
  };

  // Predicate-generating functions. Often useful outside of Underscore.
  _.constant = function(value) {
    return function() {
      return value;
    };
  };

  _.noop = function(){};

  _.property = function(key) {
    return function(obj) {
      return obj == null ? void 0 : obj[key];
    };
  };

  // Generates a function for a given object that returns a given property.
  _.propertyOf = function(obj) {
    return obj == null ? function(){} : function(key) {
      return obj[key];
    };
  };

  // Returns a predicate for checking whether an object has a given set of 
  // `key:value` pairs.
  _.matcher = _.matches = function(attrs) {
    attrs = _.extendOwn({}, attrs);
    return function(obj) {
      return _.isMatch(obj, attrs);
    };
  };

  // Run a function **n** times.
  _.times = function(n, iteratee, context) {
    var accum = Array(Math.max(0, n));
    iteratee = optimizeCb(iteratee, context, 1);
    for (var i = 0; i < n; i++) accum[i] = iteratee(i);
    return accum;
  };

  // Return a random integer between min and max (inclusive).
  _.random = function(min, max) {
    if (max == null) {
      max = min;
      min = 0;
    }
    return min + Math.floor(Math.random() * (max - min + 1));
  };

  // A (possibly faster) way to get the current timestamp as an integer.
  _.now = Date.now || function() {
    return new Date().getTime();
  };

   // List of HTML entities for escaping.
  var escapeMap = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#x27;',
    '`': '&#x60;'
  };
  var unescapeMap = _.invert(escapeMap);

  // Functions for escaping and unescaping strings to/from HTML interpolation.
  var createEscaper = function(map) {
    var escaper = function(match) {
      return map[match];
    };
    // Regexes for identifying a key that needs to be escaped
    var source = '(?:' + _.keys(map).join('|') + ')';
    var testRegexp = RegExp(source);
    var replaceRegexp = RegExp(source, 'g');
    return function(string) {
      string = string == null ? '' : '' + string;
      return testRegexp.test(string) ? string.replace(replaceRegexp, escaper) : string;
    };
  };
  _.escape = createEscaper(escapeMap);
  _.unescape = createEscaper(unescapeMap);

  // If the value of the named `property` is a function then invoke it with the
  // `object` as context; otherwise, return it.
  _.result = function(object, property, fallback) {
    var value = object == null ? void 0 : object[property];
    if (value === void 0) {
      value = fallback;
    }
    return _.isFunction(value) ? value.call(object) : value;
  };

  // Generate a unique integer id (unique within the entire client session).
  // Useful for temporary DOM ids.
  var idCounter = 0;
  _.uniqueId = function(prefix) {
    var id = ++idCounter + '';
    return prefix ? prefix + id : id;
  };

  // By default, Underscore uses ERB-style template delimiters, change the
  // following template settings to use alternative delimiters.
  _.templateSettings = {
    evaluate    : /<%([\s\S]+?)%>/g,
    interpolate : /<%=([\s\S]+?)%>/g,
    escape      : /<%-([\s\S]+?)%>/g
  };

  // When customizing `templateSettings`, if you don't want to define an
  // interpolation, evaluation or escaping regex, we need one that is
  // guaranteed not to match.
  var noMatch = /(.)^/;

  // Certain characters need to be escaped so that they can be put into a
  // string literal.
  var escapes = {
    "'":      "'",
    '\\':     '\\',
    '\r':     'r',
    '\n':     'n',
    '\u2028': 'u2028',
    '\u2029': 'u2029'
  };

  var escaper = /\\|'|\r|\n|\u2028|\u2029/g;

  var escapeChar = function(match) {
    return '\\' + escapes[match];
  };

  // JavaScript micro-templating, similar to John Resig's implementation.
  // Underscore templating handles arbitrary delimiters, preserves whitespace,
  // and correctly escapes quotes within interpolated code.
  // NB: `oldSettings` only exists for backwards compatibility.
  _.template = function(text, settings, oldSettings) {
    if (!settings && oldSettings) settings = oldSettings;
    settings = _.defaults({}, settings, _.templateSettings);

    // Combine delimiters into one regular expression via alternation.
    var matcher = RegExp([
      (settings.escape || noMatch).source,
      (settings.interpolate || noMatch).source,
      (settings.evaluate || noMatch).source
    ].join('|') + '|$', 'g');

    // Compile the template source, escaping string literals appropriately.
    var index = 0;
    var source = "__p+='";
    text.replace(matcher, function(match, escape, interpolate, evaluate, offset) {
      source += text.slice(index, offset).replace(escaper, escapeChar);
      index = offset + match.length;

      if (escape) {
        source += "'+\n((__t=(" + escape + "))==null?'':_.escape(__t))+\n'";
      } else if (interpolate) {
        source += "'+\n((__t=(" + interpolate + "))==null?'':__t)+\n'";
      } else if (evaluate) {
        source += "';\n" + evaluate + "\n__p+='";
      }

      // Adobe VMs need the match returned to produce the correct offest.
      return match;
    });
    source += "';\n";

    // If a variable is not specified, place data values in local scope.
    if (!settings.variable) source = 'with(obj||{}){\n' + source + '}\n';

    source = "var __t,__p='',__j=Array.prototype.join," +
      "print=function(){__p+=__j.call(arguments,'');};\n" +
      source + 'return __p;\n';

    try {
      var render = new Function(settings.variable || 'obj', '_', source);
    } catch (e) {
      e.source = source;
      throw e;
    }

    var template = function(data) {
      return render.call(this, data, _);
    };

    // Provide the compiled source as a convenience for precompilation.
    var argument = settings.variable || 'obj';
    template.source = 'function(' + argument + '){\n' + source + '}';

    return template;
  };

  // Add a "chain" function. Start chaining a wrapped Underscore object.
  _.chain = function(obj) {
    var instance = _(obj);
    instance._chain = true;
    return instance;
  };

  // OOP
  // ---------------
  // If Underscore is called as a function, it returns a wrapped object that
  // can be used OO-style. This wrapper holds altered versions of all the
  // underscore functions. Wrapped objects may be chained.

  // Helper function to continue chaining intermediate results.
  var result = function(instance, obj) {
    return instance._chain ? _(obj).chain() : obj;
  };

  // Add your own custom functions to the Underscore object.
  _.mixin = function(obj) {
    _.each(_.functions(obj), function(name) {
      var func = _[name] = obj[name];
      _.prototype[name] = function() {
        var args = [this._wrapped];
        push.apply(args, arguments);
        return result(this, func.apply(_, args));
      };
    });
  };

  // Add all of the Underscore functions to the wrapper object.
  _.mixin(_);

  // Add all mutator Array functions to the wrapper.
  _.each(['pop', 'push', 'reverse', 'shift', 'sort', 'splice', 'unshift'], function(name) {
    var method = ArrayProto[name];
    _.prototype[name] = function() {
      var obj = this._wrapped;
      method.apply(obj, arguments);
      if ((name === 'shift' || name === 'splice') && obj.length === 0) delete obj[0];
      return result(this, obj);
    };
  });

  // Add all accessor Array functions to the wrapper.
  _.each(['concat', 'join', 'slice'], function(name) {
    var method = ArrayProto[name];
    _.prototype[name] = function() {
      return result(this, method.apply(this._wrapped, arguments));
    };
  });

  // Extracts the result from a wrapped and chained object.
  _.prototype.value = function() {
    return this._wrapped;
  };

  // Provide unwrapping proxy for some methods used in engine operations
  // such as arithmetic and JSON stringification.
  _.prototype.valueOf = _.prototype.toJSON = _.prototype.value;
  
  _.prototype.toString = function() {
    return '' + this._wrapped;
  };

  // AMD registration happens at the end for compatibility with AMD loaders
  // that may not enforce next-turn semantics on modules. Even though general
  // practice for AMD registration is to be anonymous, underscore registers
  // as a named module because, like jQuery, it is a base library that is
  // popular enough to be bundled in a third party lib, but not be part of
  // an AMD load request. Those cases could generate an error when an
  // anonymous define() is called outside of a loader request.
  if (typeof define === 'function' && define.amd) {
    define('underscore', [], function() {
      return _;
    });
  }
}.call(this));

},{}],42:[function(require,module,exports){
(function (global){

var rng;

if (global.crypto && crypto.getRandomValues) {
  // WHATWG crypto-based RNG - http://wiki.whatwg.org/wiki/Crypto
  // Moderately fast, high quality
  var _rnds8 = new Uint8Array(16);
  rng = function whatwgRNG() {
    crypto.getRandomValues(_rnds8);
    return _rnds8;
  };
}

if (!rng) {
  // Math.random()-based (RNG)
  //
  // If all else fails, use Math.random().  It's fast, but is of unspecified
  // quality.
  var  _rnds = new Array(16);
  rng = function() {
    for (var i = 0, r; i < 16; i++) {
      if ((i & 0x03) === 0) r = Math.random() * 0x100000000;
      _rnds[i] = r >>> ((i & 0x03) << 3) & 0xff;
    }

    return _rnds;
  };
}

module.exports = rng;


}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{}],43:[function(require,module,exports){
//     uuid.js
//
//     Copyright (c) 2010-2012 Robert Kieffer
//     MIT License - http://opensource.org/licenses/mit-license.php

// Unique ID creation requires a high quality random # generator.  We feature
// detect to determine the best RNG source, normalizing to a function that
// returns 128-bits of randomness, since that's what's usually required
var _rng = require('./rng');

// Maps for number <-> hex string conversion
var _byteToHex = [];
var _hexToByte = {};
for (var i = 0; i < 256; i++) {
  _byteToHex[i] = (i + 0x100).toString(16).substr(1);
  _hexToByte[_byteToHex[i]] = i;
}

// **`parse()` - Parse a UUID into it's component bytes**
function parse(s, buf, offset) {
  var i = (buf && offset) || 0, ii = 0;

  buf = buf || [];
  s.toLowerCase().replace(/[0-9a-f]{2}/g, function(oct) {
    if (ii < 16) { // Don't overflow!
      buf[i + ii++] = _hexToByte[oct];
    }
  });

  // Zero out remaining bytes if string was short
  while (ii < 16) {
    buf[i + ii++] = 0;
  }

  return buf;
}

// **`unparse()` - Convert UUID byte array (ala parse()) into a string**
function unparse(buf, offset) {
  var i = offset || 0, bth = _byteToHex;
  return  bth[buf[i++]] + bth[buf[i++]] +
          bth[buf[i++]] + bth[buf[i++]] + '-' +
          bth[buf[i++]] + bth[buf[i++]] + '-' +
          bth[buf[i++]] + bth[buf[i++]] + '-' +
          bth[buf[i++]] + bth[buf[i++]] + '-' +
          bth[buf[i++]] + bth[buf[i++]] +
          bth[buf[i++]] + bth[buf[i++]] +
          bth[buf[i++]] + bth[buf[i++]];
}

// **`v1()` - Generate time-based UUID**
//
// Inspired by https://github.com/LiosK/UUID.js
// and http://docs.python.org/library/uuid.html

// random #'s we need to init node and clockseq
var _seedBytes = _rng();

// Per 4.5, create and 48-bit node id, (47 random bits + multicast bit = 1)
var _nodeId = [
  _seedBytes[0] | 0x01,
  _seedBytes[1], _seedBytes[2], _seedBytes[3], _seedBytes[4], _seedBytes[5]
];

// Per 4.2.2, randomize (14 bit) clockseq
var _clockseq = (_seedBytes[6] << 8 | _seedBytes[7]) & 0x3fff;

// Previous uuid creation time
var _lastMSecs = 0, _lastNSecs = 0;

// See https://github.com/broofa/node-uuid for API details
function v1(options, buf, offset) {
  var i = buf && offset || 0;
  var b = buf || [];

  options = options || {};

  var clockseq = options.clockseq !== undefined ? options.clockseq : _clockseq;

  // UUID timestamps are 100 nano-second units since the Gregorian epoch,
  // (1582-10-15 00:00).  JSNumbers aren't precise enough for this, so
  // time is handled internally as 'msecs' (integer milliseconds) and 'nsecs'
  // (100-nanoseconds offset from msecs) since unix epoch, 1970-01-01 00:00.
  var msecs = options.msecs !== undefined ? options.msecs : new Date().getTime();

  // Per 4.2.1.2, use count of uuid's generated during the current clock
  // cycle to simulate higher resolution clock
  var nsecs = options.nsecs !== undefined ? options.nsecs : _lastNSecs + 1;

  // Time since last uuid creation (in msecs)
  var dt = (msecs - _lastMSecs) + (nsecs - _lastNSecs)/10000;

  // Per 4.2.1.2, Bump clockseq on clock regression
  if (dt < 0 && options.clockseq === undefined) {
    clockseq = clockseq + 1 & 0x3fff;
  }

  // Reset nsecs if clock regresses (new clockseq) or we've moved onto a new
  // time interval
  if ((dt < 0 || msecs > _lastMSecs) && options.nsecs === undefined) {
    nsecs = 0;
  }

  // Per 4.2.1.2 Throw error if too many uuids are requested
  if (nsecs >= 10000) {
    throw new Error('uuid.v1(): Can\'t create more than 10M uuids/sec');
  }

  _lastMSecs = msecs;
  _lastNSecs = nsecs;
  _clockseq = clockseq;

  // Per 4.1.4 - Convert from unix epoch to Gregorian epoch
  msecs += 12219292800000;

  // `time_low`
  var tl = ((msecs & 0xfffffff) * 10000 + nsecs) % 0x100000000;
  b[i++] = tl >>> 24 & 0xff;
  b[i++] = tl >>> 16 & 0xff;
  b[i++] = tl >>> 8 & 0xff;
  b[i++] = tl & 0xff;

  // `time_mid`
  var tmh = (msecs / 0x100000000 * 10000) & 0xfffffff;
  b[i++] = tmh >>> 8 & 0xff;
  b[i++] = tmh & 0xff;

  // `time_high_and_version`
  b[i++] = tmh >>> 24 & 0xf | 0x10; // include version
  b[i++] = tmh >>> 16 & 0xff;

  // `clock_seq_hi_and_reserved` (Per 4.2.2 - include variant)
  b[i++] = clockseq >>> 8 | 0x80;

  // `clock_seq_low`
  b[i++] = clockseq & 0xff;

  // `node`
  var node = options.node || _nodeId;
  for (var n = 0; n < 6; n++) {
    b[i + n] = node[n];
  }

  return buf ? buf : unparse(b);
}

// **`v4()` - Generate random UUID**

// See https://github.com/broofa/node-uuid for API details
function v4(options, buf, offset) {
  // Deprecated - 'format' argument, as supported in v1.2
  var i = buf && offset || 0;

  if (typeof(options) == 'string') {
    buf = options == 'binary' ? new Array(16) : null;
    options = null;
  }
  options = options || {};

  var rnds = options.random || (options.rng || _rng)();

  // Per 4.4, set bits for version and `clock_seq_hi_and_reserved`
  rnds[6] = (rnds[6] & 0x0f) | 0x40;
  rnds[8] = (rnds[8] & 0x3f) | 0x80;

  // Copy bytes to buffer, if provided
  if (buf) {
    for (var ii = 0; ii < 16; ii++) {
      buf[i + ii] = rnds[ii];
    }
  }

  return buf || unparse(rnds);
}

// Export public API
var uuid = v4;
uuid.v1 = v1;
uuid.v4 = v4;
uuid.parse = parse;
uuid.unparse = unparse;

module.exports = uuid;

},{"./rng":42}],44:[function(require,module,exports){
'use strict';
var Constants = {};
Constants.DefaultTakeItemsCount = 50;
Constants.ExpandExpressionName = 'Expand';
Constants.ReturnAsFieldName = 'ReturnAs';
Constants.FieldsExpressionName = 'Fields';
Constants.SingleFieldExpressionName = 'SingleField';
Constants.SortExpressionName = 'Sort';
Constants.FilterExpressionName = 'Filter';
Constants.SkipExpressionName = 'Skip';
Constants.TakeExpressionName = 'Take';
Constants.ParentRelationFieldName = 'ParentRelationField';
Constants.IdFieldNameClient = 'Id';
Constants.TargetTypeNameFieldName = 'TargetTypeName';

module.exports = Constants;
},{}],45:[function(require,module,exports){
'use strict';
var Constants = require('./Constants');

/**
 * A class that is used to get all required information in order to process a set of relations.
 * @param parent - An ExecutionNode instance used to supply the tree like data structure.
 * @param relationNode - The relation node used to created the ExecutionNode instance (ExecutionNode instance should contain one or many relations
 * if they can be combined for batch execution).
 * @constructor
 */
var ExecutionNode = function (parent, relationNode) {
    var parentPath = '';
    if (parent) {
        parentPath = parent.path;
    }
    this.parent = parentPath;
    this.relations = [relationNode.path];
    this.name = relationNode.path;
    this.targetTypeName = relationNode.targetTypeName;
    this.canAddOtherRelations = !relationNode.filterExpression && !relationNode.sortExpression && !relationNode.take && !relationNode.skip;
    this.children = [];
    var path = '';
    if (parentPath) {
        path += parentPath + '.';
    }
    path += relationNode.targetTypeName;
    this.path = path;
};

/**
 * Inserts a RelationNode to an ExecutionNode.
 * @param relation - A Relation instance.
 */
ExecutionNode.prototype.insertRelationNode = function (relation) {
    this.relations.push(relation.path);
};

/**
 * Inserts a child node (which relations) depends from parent node result.
 * @param child - ExecutionNode instance representing child node.
 */
ExecutionNode.prototype.insertChildrenNode = function (child) {
    this.children.push(child.name);
};

/**
 * Helper method that checks if some relations could be combined (for example have same TargetType).
 * @param relation
 * @returns {boolean}
 */
ExecutionNode.prototype.canCombineWithRelation = function (relation) {
    //TODO: think some more ?!
    if (!this.canAddOtherRelations) {
        return false;
    }

    return this.targetTypeName === relation.targetTypeName && !relation.filterExpression && !relation.sortExpression && !relation.take && !relation.skip;
};

/** ExecutionTree
 * Class that allows the creation of an execution tree from a relationTree. Used to process all queries (master and child) in a correct order.
 * @param relationTree - An instance of relation tree.
 * @constructor
 */
var ExecutionTree = function (relationTree) {
    this._relationTree = relationTree;
    this._map = {};
};

/**
 * Adds execution node to the ExecutionTree.
 * @param executionNode
 */
ExecutionTree.prototype.addExecutionNode = function (executionNode) {
    this._map[executionNode.name] = executionNode;
};

/**
 * Finds the ExecutionNode which contains the requested relation.
 * @param relation - A Relation instance.
 * @returns {*}
 */
ExecutionTree.prototype.getExecutionNodeOfRelation = function (relation) {
    for (var execNode in this._map) {
        if (this._map.hasOwnProperty(execNode)) {
            if (this._map[execNode].relations.indexOf(relation) > -1) {
                return this._map[execNode];
            }
        }
    }
    return null;
};

/**
 * Finds a RelationNode within the RelationTree.
 * @param relation - String that represents the relation within the RelationTree (for example: Activities.Likes.Role).
 * @returns {*}
 */
ExecutionTree.prototype.getRelationNode = function (relation) {
    if (relation) {
        return this._relationTree[relation] || null;
    } else {
        return null;
    }
};

ExecutionTree.prototype.getRootRelationNode = function () {
    return this._relationTree[this._relationTree.$root] || null;
};
/**
 * Builds the ExecutionTree from a RelationTree.
 */
ExecutionTree.prototype.build = function () {
    //build beginning from the root
    var relationRoot = this.getRelationNode(this._relationTree.$root);
    //Setup the root of the execution tree.
    var rootExecutionNode = new ExecutionNode(null, relationRoot);//no parent node
    this.addExecutionNode(rootExecutionNode);
    this.buildInternal(relationRoot);
};

/**
 * Traverse the relation tree and build the execution tree.
 * @param relationRoot - The root node of the RelationTree.
 */
ExecutionTree.prototype.buildInternal = function (relationRoot) {
    relationRoot.children.forEach(function (child) {
        var childRelationNode = this.getRelationNode(child);
        this.insertRelationNodeInExecutionTree(childRelationNode);
        this.buildInternal(childRelationNode);
    }, this);
};

/**
 * Inserts a relation node within the execution tree (based on its dependencies).
 * @param relation - The relation that will be inserted.
 */
ExecutionTree.prototype.insertRelationNodeInExecutionTree = function (relation) {
    var rootExecutionNode = this.getExecutionNodeOfRelation(relation.parent);
    var childToCombine = this.tryGetChildNodeToCombine(rootExecutionNode, relation);
    if (childToCombine) {//if there is a child that we combine the relation
        childToCombine.insertRelationNode(relation);
    } else {
        var newExecutionNode = new ExecutionNode(rootExecutionNode, relation);//create a separate execution node that will host the relation
        rootExecutionNode.insertChildrenNode(newExecutionNode);
        this.addExecutionNode(newExecutionNode);
    }
};

/**
 * Tries to find an ExecutionNode which could be combined with a relation.
 * @param rootExecutionNode - The root node of the ExecutionTree.
 * @param relation - Relation that will be added to the ExecutionTree.
 * @returns {*}
 */
ExecutionTree.prototype.tryGetChildNodeToCombine = function (rootExecutionNode, relation) {
    if (rootExecutionNode.canCombineWithRelation(relation)) {
        return rootExecutionNode;
    }
    var children = rootExecutionNode.children;
    for (var i = 0; i < children.length; i++) {
        var child = this._map[children[i]];
        var childToCombine = this.tryGetChildNodeToCombine(child, relation);
        if (childToCombine) {
            return childToCombine;
        }
    }
    return null;
};

/**
 * Gets the filter expression from all relations inside an ExecutionNode.
 * @param executionNode - The ExecutionNode instance.
 * @returns {{}}
 */
ExecutionTree.prototype.getFilterFromExecutionNode = function (executionNode, includeArrays) {
    var filter = {};
    var subRelationsFilter = [];
    for (var i = 0; i < executionNode.relations.length; i++) {
        var innerFilter = this.getFilterFromSingleRelation(this._relationTree[executionNode.relations[i]], includeArrays);
        if (innerFilter) {
            subRelationsFilter.push(innerFilter);
        }
    }

    if (subRelationsFilter.length > 1) {
        filter.$or = subRelationsFilter;
    } else if (subRelationsFilter.length > 0) {
        filter = subRelationsFilter[0];
    } else {
        filter = null;
    }
    return filter;
};

/**
 * Gets filter expression from a single relation. Traverse the relation tree in order to get the "Id"s from the result of parent relation
 * along with user defined filters.
 * @param relation - A Relation instance.
 * @returns {*}
 */
ExecutionTree.prototype.getFilterFromSingleRelation = function (relation, includeArrays) {
    var userDefinedFilter = relation.filterExpression;
    var parentRelationFilter = {};
    var parentRelationIds = this.getRelationFieldValues(relation, includeArrays);
    var parentRelationFieldName = (relation.isInvertedRelation ? relation.relationField : Constants.IdFieldNameClient);

    if (parentRelationIds.length > 0) {
        parentRelationFilter[parentRelationFieldName] = {'$in': parentRelationIds};
    } else {
        return null;
    }

    if (userDefinedFilter !== undefined) {
        var filters = [];
        filters.push(parentRelationFilter);
        filters.push(userDefinedFilter);
        return {'$and': filters};
    } else {
        return parentRelationFilter;
    }
};

/**
 * Get relation field values of parent relation in order to construct a proper filter (to create a relation).
 * @param relation - A relation instance which will get the filter.
 * @param includeArrays - Whether to include array valus of the parent items when calculating the items that will be expanded on the current level.
 * @returns {Array} - An array of relation field values.
 */
ExecutionTree.prototype.getRelationFieldValues = function (relation, includeArrays) {
    var parentRelationIds = [];
    var parentRelation = this._relationTree[relation.parent];
    // parentRelationResult actually is an Activity or Array of Activities
    var parentRelationResult = Array.isArray(parentRelation.result) ? parentRelation.result : [parentRelation.result];
    if (relation.isInvertedRelation) {
        for (var p = 0; p < parentRelationResult.length; p++) {
            parentRelationIds.push(parentRelationResult[p][relation.parentRelationField]);
        }
    } else {
        // all comments are related to expand of type content type Activities expand: {"Likes": true}
        if (parentRelation && parentRelation.result) {
            relation.parentRelationIds = relation.parentRelationIds || {};
            for (var i = 0; i < parentRelationResult.length; i++) {
                // itemFromParentRelation is single Activity
                var itemFromParentRelation = parentRelationResult[i];

                // parentRelationFieldValue is Activity.Likes
                var parentRelationFieldValue = itemFromParentRelation[relation.relationField];
                if (Array.isArray(parentRelationFieldValue)) {
                    relation.hasArrayValues = true;
                    if (includeArrays) {
                        for (var j = 0; j < parentRelationFieldValue.length; j++) {
                            // itemToExpandId is current value in Activity.Likes array or just a single "Id"
                            var itemToExpandId = parentRelationFieldValue[j];
                            if(itemToExpandId !== undefined && itemToExpandId !== null) {
                                parentRelationIds.push(itemToExpandId);
                                // we set any value just to create a map of Ids
                                relation.parentRelationIds[itemToExpandId] = 1;
                            }
                        }
                    }
                } else {
                    if(parentRelationFieldValue !== undefined && parentRelationFieldValue !== null) {
                        parentRelationIds.push(parentRelationFieldValue);
                        relation.parentRelationIds[parentRelationFieldValue] = 1;
                    }
                }
            }
        }
    }

    return parentRelationIds;
};

module.exports = ExecutionTree;

},{"./Constants":44}],46:[function(require,module,exports){
'use strict';
var async = require('async');
var RelationTreeBuilder = require('./RelationTreeBuilder');
var ExecutionTree = require('./ExecutionTree');
var Constants = require('./Constants');

function Processor(options) {
    this._executionNodeFunction = options.executionNodeFunction;
    this._metadataProviderFunction = options.metadataProviderFunction;
}

Processor.prototype.getExecutionTreeRoot = function (executionTree) {
    var executionTreeRoot = null;
    for (var exNode in executionTree) {
        if (executionTree.hasOwnProperty(exNode)) {
            if (executionTree[exNode].parent === '') {
                executionTreeRoot = executionTree[exNode];
                break;
            }
        }
    }
    return executionTreeRoot;
};

Processor.prototype.createExecuteNodeExecutor = function (relationsTree, executionTree, executionNode, expandContext) {
    var self = this;
    var relationsTreeMap = relationsTree.map;
    return function (done) {
        var relationNode = executionTree.getRelationNode(executionNode.relations[0]);//get the relation node for the only relation of the execution node.
        var parentRelationNode = executionTree.getRelationNode(relationNode.parent);
        var includeArrays = !(parentRelationNode.parent && parentRelationNode.hasArrayValues); //only expand array fields if the parent relation is not an array. This means that if we have expanded a Likes (multiple to Users), we won't expand any array relations that are nested in it such as the UserComments (multiple relation to Comments).
        var filter = executionTree.getFilterFromExecutionNode(executionNode, includeArrays);

        var errorMessage = relationsTree.validateSingleRelation(relationNode);
        if(errorMessage) {
            return done(new Error(errorMessage));
        }

        // if we have such options executionNode should have only one relation.
        var node = {};
        node.select = relationNode.fieldsExpression;
        node.sort = relationNode.sortExpression;
        node.skip = relationNode.skip;
        node.take = relationNode.take;
        node.filter = filter;
        node.targetTypeName = relationNode.targetTypeName;

        self._executionNodeFunction.call(null, node, expandContext, function onProcessExecutionNode(err, result) {
            if (err) {
                return done(err);
            }

            for (var i = 0; i < executionNode.relations.length; i++) {
                var childRelation = relationsTreeMap[executionNode.relations[i]];
                childRelation.result = self.extractResultForRelation(relationsTreeMap[executionNode.relations[i]], result);
            }
            executionNode.result = childRelation.result;
            var arr = [];
            for (var j = 0; j < executionNode.children.length; j++) {
                var executionTreeMap = executionTree._map;
                arr.push(self.createExecuteNodeExecutor(relationsTree, executionTree, executionTreeMap[executionNode.children[j]], expandContext));
            }
            async.parallel(arr, done);
        });
    };
};

Processor.prototype.getSingleResult = function (relationsTree, relation, singleObject) {
    if (!singleObject) {
        return null;
    }

    var childRelation;
    var childItem;

    // if relation has singleFieldName option we just replace the parent id with a single value
    if (relation.singleFieldName) {
        if (relation.children && relation.children.length > 0) {
            childRelation = relationsTree[relation.children[0]];
            childItem = this.getObjectByIdFromArray(childRelation.result, singleObject[relation.singleFieldName]);
            return this.getSingleResult(relationsTree, childRelation, childItem);
        }
        return singleObject[relation.singleFieldName];
    }

    var result = {};
    var passedProperties = {};

    if (relation.children && relation.children.length > 0) {
        for (var j = 0; j < relation.children.length; j++) {
            childRelation = relationsTree[relation.children[j]];
            var childRelationField = childRelation.relationField;
            var userDefinedRelName = childRelation.userDefinedName;
            if (!childRelation.isInvertedRelation) {
                passedProperties[childRelationField] = 1;
            }

            var innerRelationResult = childRelation.result;

            if (childRelation.isInvertedRelation) {
                for (var k = 0; k < innerRelationResult.length; k++) {
                    this.addSingleResultToParentArray(relationsTree, childRelation, innerRelationResult[k], result, userDefinedRelName);
                }
            } else {
                result[userDefinedRelName] = childRelation.isArray() ? [] : null;
                
                if (singleObject[childRelationField]) {
                    if (Array.isArray(singleObject[childRelationField])) {
                        if (childRelation.sortExpression) {
                            // if there is a sorting we replace items using order of the query result
                            for (var p = 0; p < innerRelationResult.length; p++) {
                                if (singleObject[childRelationField].indexOf(innerRelationResult[p].Id) > -1) {
                                    childItem = innerRelationResult[p];
                                    this.addSingleResultToParentArray(relationsTree, childRelation, childItem, result, userDefinedRelName);
                                }
                            }
                        } else {
                            // we just replace items getting them by id which we have
                            for (var i = 0; i < singleObject[childRelationField].length; i++) {
                                childItem = this.getObjectByIdFromArray(innerRelationResult, singleObject[childRelationField][i]);
                                this.addSingleResultToParentArray(relationsTree, childRelation, childItem, result, userDefinedRelName);
                            }
                        }
                    } else {
                        childItem = this.getObjectByIdFromArray(innerRelationResult, singleObject[childRelationField]);
                        result[userDefinedRelName] = this.getSingleResult(relationsTree, childRelation, childItem);
                    }
                }
            }
        }
    }

    // add all other fields to the result (except the relation fields which we have already replaced).
    for (var prop in singleObject) {
        var propertyShouldBeAddedToResult = singleObject.hasOwnProperty(prop) && !passedProperties[prop] &&
            this.fieldExistInFieldsExpression(prop, relation.originalFieldsExpression);
        if (propertyShouldBeAddedToResult) {
            result[prop] = singleObject[prop];
        }
    }

    return result;
};

Processor.prototype.addSingleResultToParentArray = function (relationsTree, childRelation, childItem, result, userDefinedRelName) {
    var singleResult = this.getSingleResult(relationsTree, childRelation, childItem);
    result[userDefinedRelName] = result[userDefinedRelName] || [];
    if (singleResult) {
        result[userDefinedRelName].push(singleResult);
    }
};

/**
 * Checks if a field will be returned via given fields expression.
 * @param field - The name of the field.
 * @param fieldsExpression - The Fields expression which is checked.
 * @returns {*}
 */
Processor.prototype.fieldExistInFieldsExpression = function (field, fieldsExpression) {
    if (fieldsExpression === undefined || Object.keys(fieldsExpression).length === 0) {
        return true;
    }

    if (field === Constants.IdFieldNameClient) {
        if (fieldsExpression[field] === undefined) {
            return true;
        }
        return fieldsExpression[field];
    }

    var isExclusive = RelationTreeBuilder.getIsFieldsExpressionExclusive(fieldsExpression);

    if (isExclusive === undefined) {
        return true;
    }

    if (isExclusive) {
        return !fieldsExpression.hasOwnProperty(field);
    } else {
        return fieldsExpression.hasOwnProperty(field);
    }
};

/**
 * Extracts the result for a single relation (in cases when ExecutionNode contains more than one relations).
 * @param relation - The relation object.
 * @param queryResult - Result of the combined query.
 * @returns {Array}
 */
Processor.prototype.extractResultForRelation = function (relation, queryResult) {
    var result = [];
    for (var i = 0; i < queryResult.length; i++) {
        if (relation.parentRelationIds) {
            if (relation.parentRelationIds.hasOwnProperty(queryResult[i].Id)) {
                result.push(queryResult[i]);
            }
        }
        if (relation.isInvertedRelation) {
            result.push(queryResult[i]);
        }
    }
    return result;
};

/**
 * Gets an object with a given Id from Array.
 * @param array
 * @param id
 * @returns {*}
 */
Processor.prototype.getObjectByIdFromArray = function (array, id) {
    if (array) {
        for (var i = 0; i < array.length; i++) {
            if (array[i].Id === id) {
                return array[i];
            }
        }
    }
    return null;
};

Processor.prototype.prepare = function (expandExpression, mainTypeName, isArray, fieldsExpression, maxTakeValue, prepareContext, done) {
    var rtb = new RelationTreeBuilder(expandExpression, mainTypeName, isArray, fieldsExpression, maxTakeValue, this._metadataProviderFunction, prepareContext);
    rtb.build(function (err, map) {
        var mainQueryFieldsExpression;
        if (map) {
            mainQueryFieldsExpression = map[map.$root].fieldsExpression;
            var prepareResult = {
                relationsTree: rtb,
                mainQueryFieldsExpression: mainQueryFieldsExpression
            }
        }
        done(err, prepareResult);
    });
};

Processor.prototype.expand = function (relationsTree, mainQueryResult, expandContext, done) {
    var relationsTreeMap = relationsTree.map;
    var self = this;
    var executionTree = new ExecutionTree(relationsTreeMap);
    executionTree.build();
    relationsTreeMap[relationsTreeMap.$root].result = mainQueryResult;
    var executionTreeMap = executionTree._map;

    var executionTreeRoot = this.getExecutionTreeRoot(executionTreeMap);

    var maxQueriesCount = 20; //TODO: make it configurable
    if (Object.keys(executionTreeMap).length > maxQueriesCount) {
        done(new Error('Expand expression results in more than ' + maxQueriesCount + ' inner queries!'));
    }

    if (executionTreeRoot) {
        var execFuncs = [];
        for (var i = 0; i < executionTreeRoot.children.length; i++) {
            execFuncs.push(this.createExecuteNodeExecutor(relationsTree, executionTree, executionTreeMap[executionTreeRoot.children[i]], expandContext));
        }
        // execFuncs are functions created for every single execution note
        // we execute them in async, since the result of the parent relation is used to get correct filter.
        async.series(execFuncs, function onProcessExecutionTree(err) {
            if (err) {
                done(err);
            } else {
                var output;
                var rootRelation = relationsTreeMap[relationsTreeMap.$root];
                if (Array.isArray(mainQueryResult)) {
                    output = [];
                    for (var i = 0; i < mainQueryResult.length; i++) {
                        var singleResult = self.getSingleResult(relationsTreeMap, rootRelation, mainQueryResult[i]);
                        if (singleResult) {
                            output.push(singleResult);
                        }
                    }
                } else {
                    output = self.getSingleResult(relationsTreeMap, rootRelation, mainQueryResult);
                }
                done(null, output);
            }
        });
    }
};

Processor.Constants = Constants;

module.exports = Processor;

},{"./Constants":44,"./ExecutionTree":45,"./RelationTreeBuilder":48,"async":49}],47:[function(require,module,exports){
'use strict';
var Constants = require('./Constants');
var _ = require('underscore');

function RelationNode(options) {
    this.parent = options.parent;
    this.relationField = options.relationField;
    this.path = options.path || options.parent + '.' + options.relationField;
    this.fieldsExpression = options.fieldsExpression || {};
    var isManuallyValidated = options.hasOwnProperty('validated') ? options.validated : !!options.targetTypeName;
    this.validated = isManuallyValidated;
    this.targetTypeName = options.targetTypeName;
    this.children = [];
    this.isInvertedRelation = options.isInvertedRelation;
    this.isArrayRoot = options.isArrayRoot; //used for validation of cases where various expand features are disabled for a GetAll scenario.
    this.hasArrayValues = false;//set when we have executed the query. Used in validation scenarios where we do not have metadata about whether the relation is an array or not.

    var expandExpression = options.expandExpression || {};

    this.parentRelationField = expandExpression[Constants.ParentRelationFieldName] || Constants.IdFieldNameClient;
    var relationField = this.isInvertedRelation ? this.path : this.relationField; //inverted relations appear with the full path - ContentType.Field - in the result when expanding.
    this.userDefinedName = expandExpression[Constants.ReturnAsFieldName] || relationField;
    _.extend(this.fieldsExpression, expandExpression[Constants.FieldsExpressionName]);
    this.originalFieldsExpression = {};
    _.extend(this.originalFieldsExpression, this.fieldsExpression);
    this.singleFieldName = expandExpression[Constants.SingleFieldExpressionName];
    this.filterExpression = expandExpression[Constants.FilterExpressionName];
    this.sortExpression = expandExpression[Constants.SortExpressionName];
    this.skip = expandExpression[Constants.SkipExpressionName];
    this.take = this._getTakeLimit(expandExpression[Constants.TakeExpressionName], options.maxTakeValue);
}


/**
 * Gets the take limit depending on the application and the take value that the user has provided.
 * @param clientTakeValue
 * @param maxTakeValue
 * @returns {number}
 */
RelationNode.prototype._getTakeLimit = function (clientTakeValue, maxTakeValue) {
    maxTakeValue = maxTakeValue || Constants.DefaultTakeItemsCount;
    if (clientTakeValue) {
        if (clientTakeValue > maxTakeValue) {
            throw new Error('The maximum allowed take value when expanding relations is ' + maxTakeValue + '!');
        }
        return clientTakeValue;
    } else {
        return maxTakeValue;
    }
};

/**
 * Anyone using the bs-expand-processor module can set whether the relation is a multiple relation in the prepare phase.
 * This will allow for certain restrictions to be enforced directly on the prepare phase instead of the execution phase.
 */
RelationNode.prototype.setIsArrayFromMetadata = function () {
    this.isArrayFromMetadata = true;
};

RelationNode.prototype.isArray = function () {
    // We can find out if a relation is an array in the following cases:
    // From metadata in the API Server.
    // All inverted relations are array.
    // Once values have been received we can find out. This is used for scenarios where we do not have metadata about the relation (offline storage in SDK).
    return this.isArrayFromMetadata || this.isInvertedRelation || this.hasArrayValues ;
};

module.exports = RelationNode;

},{"./Constants":44,"underscore":50}],48:[function(require,module,exports){
'use strict';
var RelationNode = require('./RelationNode');
var _ = require('underscore');
var Constants = require('./Constants');

//var relationFieldPropertyName = Constants.RelationExpressionName;

var possibleExpandOptions = [
    Constants.ExpandExpressionName,
    Constants.ReturnAsFieldName,
    Constants.FieldsExpressionName,
    Constants.SingleFieldExpressionName,
    Constants.SortExpressionName,
    Constants.FilterExpressionName,
    Constants.SkipExpressionName,
    Constants.TakeExpressionName,
    Constants.ParentRelationFieldName,
    Constants.TargetTypeNameFieldName
];


/**
 * A class used to parse Expand expression and build a corresponding relation tree.
 * In a process of creating the relation tree are performed several checks in order to force some limitations -
 * 50 items both for master and child queries and entire amount of all queries limited to 20.
 * Checks if the relation field given by the customer is valid (for example: user gives "Like" while the relation field is "Likes").
 * Checks for possible expand options.
 * @constructor
 */
var RelationTreeBuilder = function (expandExpression, mainTypeName, isArray, fieldsExpression, maxTakeValue, metadataProviderFunction, context) {
    this.maxTakeValue = maxTakeValue;
    this._metadataProviderFunction = metadataProviderFunction;
    this.context = context;
    this.expandExpression = this.processExpandExpression(expandExpression);
    // mark the main query in order to avoid some duplication issues.
    this.map = {};
    this.map[mainTypeName] = new RelationNode({
        targetTypeName: mainTypeName,
        isArrayRoot: isArray,
        fieldsExpression: fieldsExpression,
        validated: true,
        path: mainTypeName,
        maxTakeValue: maxTakeValue
    });
    this.map[mainTypeName].originalFieldsExpression = {};
    _.extend(this.map[mainTypeName].originalFieldsExpression, fieldsExpression);
    this.map.$root = mainTypeName;
};

/**
 * Creates fully qualified expand expression from shorthand usages:
 * {"Likes": true} -> {"Likes": {"ReturnAs": "Likes"}}
 * {"Likes": "LikesExpanded"} -> {"Likes": {"ReturnAs": "LikesExpanded"}}
 * @param expandExpression
 * @returns {*}
 */
RelationTreeBuilder.prototype.processExpandExpression = function (expandExpression) {
    for (var property in expandExpression) {
        if (expandExpression.hasOwnProperty(property)) {
            if (typeof expandExpression[property] === 'boolean') {
                expandExpression[property] = {};
                expandExpression[property][Constants.ReturnAsFieldName] = property;
            }
            if (typeof expandExpression[property] === 'string') {
                var relationField = expandExpression[property];
                expandExpression[property] = {};
                expandExpression[property][Constants.ReturnAsFieldName] = relationField;
            }
        }
    }
    return expandExpression;
};

/**
 * Builds the relation tree.
 * @param done
 */
RelationTreeBuilder.prototype.build = function (done) {
    try {
        this.buildMapInternal(this.expandExpression, this.map.$root);
    } catch (e) {
        return done(e);
    }
    var self = this;
    require('async').series([
        this.configureRelationTree.bind(this),
        this.validateRelationTree.bind(this)
    ], function (err) {
        done(err, self.map);
    });
};

/**
 *
 * @param relationName - A path to the external relation collection (Comments.ActivityId)
 * @param expandExpression - The expand expression that contains all information about the relation
 * @param rootName - Name of the parent relation.
 * @returns {RelationNode}
 */
RelationTreeBuilder.prototype.createInvertedRelation = function (relationName, expandExpression, rootName) {
    var options = {};
    var relationNameParts = relationName.split('.');
    options.parent = rootName;
    options.relationField = relationNameParts[1];
    options.isInvertedRelation = true;
    options.targetTypeName = relationNameParts[0];
    options.expandExpression = expandExpression;
    options.path = relationName;
    options.maxTakeValue = this.maxTakeValue;
    options.validated = false;

    return new RelationNode(options);
};

/**
 * An internal method which parses the expand expression and produces a basic relation tree (only names and parent relations).
 * @param expandExpression - The expand expression which will be processed.
 * @param rootName - The name of the root relation (master query) usually the name of the requested content type (Activities).
 */
RelationTreeBuilder.prototype.buildMapInternal = function (expandExpression, rootName) {
    for (var relationName in expandExpression) {
        if (expandExpression.hasOwnProperty(relationName)) {
            var currentExpression = expandExpression[relationName];

            for (var option in currentExpression) {
                if (currentExpression.hasOwnProperty(option) && possibleExpandOptions.indexOf(option) === -1) {
                    throw new Error('\"' + option + '\"' + ' is not a valid option for Expand expression');
                }
            }

            if (relationName.indexOf('.') > -1) {
                var invertedRelation = this.createInvertedRelation(relationName, currentExpression, rootName);
                this.map[invertedRelation.path] = invertedRelation;
                this.map[invertedRelation.parent].children.push(invertedRelation.path);
                // adds a field expression in the original fields expression in order to get the result for that field
                RelationTreeBuilder.addFieldToFieldsExpression(this.map[invertedRelation.parent].originalFieldsExpression, invertedRelation.userDefinedName);

                if (expandExpression[relationName][Constants.ExpandExpressionName]) {
                    var processedExpandExpression = this.processExpandExpression(expandExpression[relationName][Constants.ExpandExpressionName]);
                    this.buildMapInternal(processedExpandExpression, invertedRelation.path);
                }
            } else {
                var options = {};
                options.relationField = relationName;
                options.parent = rootName;
                options.expandExpression = currentExpression;
                options.maxTakeValue = this.maxTakeValue;
                options.targetTypeName = currentExpression[Constants.TargetTypeNameFieldName];
                var relationNode = new RelationNode(options);
                var parentNode = this.map[options.parent];
                parentNode.children.push(relationNode.path);
                this.map[relationNode.path] = relationNode;

                if (currentExpression.hasOwnProperty(Constants.ExpandExpressionName)) {
                    if (typeof(currentExpression[Constants.ExpandExpressionName]) === 'object') {
                        this.buildMapInternal(this.processExpandExpression(currentExpression.Expand), relationNode.path);
                    } else {
                        throw new Error(relationNode.path + '.Expand must be a valid expand expression!');
                    }
                }
            }
        }
    }
};

/**
 * Adds additional metadata which is necessary to execute a query.
 * Name of the content type of the child relation get via relation field.
 * @param done
 */
RelationTreeBuilder.prototype.configureRelationTree = function (done) {
    if (this._metadataProviderFunction) {
        var relationNames = [];
        var self = this;

        for (var rel in this.map) {
            if (this.map.hasOwnProperty(rel)) {
                if (this.map[rel].parent !== null) {
                    relationNames.push(this.map[rel].relationField);
                }
            }
        }

        this._metadataProviderFunction(relationNames, this.map, this.context, function (err, result) {
            done(err);
        });
    } else {
        return done();
    }
};

/**
 * Performs several checks like:
 * Validity of the relation field.
 * To not use filter or sorting expression within a "GetByFilter" scenario.
 * Does not allow to nest (expand multiple relation field) after a multiple relation.
 * Does not allow to use both "Fields" and "SingleField" options.
 * @param done
 * @returns {*}
 */
RelationTreeBuilder.prototype.validateRelationTree = function (done) {
    var errorMessage = '';
    var EOL = '\r\n';
    for (var relationPath in this.map) {
        if (relationPath !== '$root' && this.map.hasOwnProperty(relationPath)) {
            var relation = this.map[relationPath];
            errorMessage += this.validateSingleRelation(relation);
            this.configureFieldsExpressionsForRelation(relation);
        }
    }
    if (errorMessage !== '') {
        var finalErrorMessage = errorMessage.substr(0, errorMessage.lastIndexOf(EOL));
        var error = new Error(finalErrorMessage);
        return done(error);
    } else {
        done();
    }
};

/**
 * Add relation fields to parent relation fields expression if needed (otherwise relation cannot be established).
 * @param relation - A relation which will be configured.
 */
RelationTreeBuilder.prototype.configureFieldsExpressionsForRelation = function (relation) {
    if (relation.parent) {
        var parentRelationFieldsExpression = this.map[relation.parent].fieldsExpression;
        if (relation.isInvertedRelation) {
            RelationTreeBuilder.addFieldToFieldsExpression(parentRelationFieldsExpression, relation.parentRelationField);
        } else {
            RelationTreeBuilder.addFieldToFieldsExpression(parentRelationFieldsExpression, relation.relationField);
        }
    }
    if (relation.isInvertedRelation) {
        RelationTreeBuilder.addFieldToFieldsExpression(relation.fieldsExpression, relation.relationField);
    } else {
        RelationTreeBuilder.addFieldToFieldsExpression(relation.fieldsExpression, Constants.IdFieldNameClient);
    }
    RelationTreeBuilder.adjustParentRelationFieldsExpression(this.map[relation.parent], relation);
};

/**
 * Validates a single relation for all build-in limitations.
 * @param relation - A relation which will be validated.
 * @returns {string} - Returns an error message with all errors or empty string if there is no errors.
 */
RelationTreeBuilder.prototype.validateSingleRelation = function (relation) {
    var errorMessage = '';
    var EOL = '\r\n';
    var isGetByFilterQuery = this.map[this.map.$root].isArrayRoot;

    if (relation.path === relation.parent) {
        errorMessage += relation.path + ' has same parent which will cause an infinite loop.' + EOL;
        return errorMessage;
    }

    if (relation.isArray()) {
        var multipleQueriesCount = this.getParentMultipleRelationsCount(relation);
        if (multipleQueriesCount > 0) {
            errorMessage += 'Expand expression has multiple relation \"' + relation.path + '\" inside a multiple relation.';
            errorMessage += EOL;
        }

        if (this.map[relation.parent] === this.map[this.map.$root] &&
            isGetByFilterQuery &&
            (relation.filterExpression || relation.sortExpression)) {
            errorMessage += 'Filter and Sort expressions are not allowed with GetByFilter scenario.';
            errorMessage += EOL;
        }

        if (isGetByFilterQuery && relation.isInvertedRelation) {
            errorMessage += 'Expanding an external content type is not allowed with GetByFilter scenario.';
            errorMessage += EOL;
        }
    }
    if (!relation.validated) {
        if (relation.isInvertedRelation) {
            errorMessage += 'Content type \"' + relation.targetTypeName + '\"';
        } else {
            var parentRelation = relation.parent;
            errorMessage += 'Content type \"' + this.map[parentRelation].targetTypeName + '\"';
        }
        errorMessage += ' does not contain \"' + relation.relationField + '\"' + ' relation field.';
        errorMessage += EOL;
    }
    if (relation.fieldsExpression && Object.keys(relation.fieldsExpression).length && relation.singleFieldName) {
        errorMessage += relation.path + ' ';
        errorMessage += 'expand expression contains both \"Fields\" and \"SingleField\" expressions.';
        errorMessage += EOL;
    }
    if (relation.singleFieldName) {
        if (relation.children) {
            if (relation.children.length > 1) {
                errorMessage += relation.path + ' has multiple expand expressions with a single field option.' + EOL;
            }
            if (relation.children.length === 1 && this.map[relation.children[0]].relationField !== relation.singleFieldName) {
                errorMessage += 'Expand expression ' + relation.path;
                errorMessage += ' single field \"' + relation.singleFieldName + '\"';
                errorMessage += ' does not match child relation field \"' + this.map[relation.children[0]].relationField + '\".';
                errorMessage += EOL;
            }
        }
    }

    return errorMessage;
};

/**
 * Gets the count of parent multiple relations.
 * @param relation - Starting relation.
 * @returns {number} - count of all parent multiple relations
 */
RelationTreeBuilder.prototype.getParentMultipleRelationsCount = function (relation) {
    var result = 0;
    var relationForLoop = relation;
    while (relationForLoop.parent) {
        var parentRelation = this.map[relationForLoop.parent];
        if (parentRelation.isArray() && parentRelation.parent) {
            result += 1;
        }
        relationForLoop = parentRelation;
    }
    return result;
};


/**
 * Adjusts fields expression of the parent relation based on paging setting of a relation (skip, take).
 * In that case we put a "$slice" option within the parent relation fields expression.
 * @param parentRelation
 * @param relation
 */
RelationTreeBuilder.adjustParentRelationFieldsExpression = function (parentRelation, relation) {
    //TODO: make it dynamic in execution node

    if (!relation.isInvertedRelation && relation.take && typeof relation.take === 'number') {
        // when relation has filter or sorting skip and take should not be transferred to the parent relation as $slice.
        var shouldTransferPagingToParentRelation = relation.isArray() && !relation.filterExpression && !relation.sortExpression && parentRelation;
        if (shouldTransferPagingToParentRelation) {
            if (parentRelation.fieldsExpression === undefined) {
                parentRelation.fieldsExpression = {};
            }

            if (relation.skip && typeof relation.skip === 'number') {
                parentRelation.fieldsExpression[relation.relationField] = {
                    '$slice': [relation.skip, relation.take]
                };
            } else {
                parentRelation.fieldsExpression[relation.relationField] = {
                    '$slice': relation.take
                };
            }
            relation.take = null;
            relation.skip = null;
            relation.movedSkipTakeAsSlice = true;
        }
    }
};

/**
 * Adds field to parent relation fields expression. For example if the relation field is excluded from the master request.
 * @param fieldsExpression - Fields expression of the parent relation.
 * @param relationField - Name of the field which should be returned.
 */
RelationTreeBuilder.addFieldToFieldsExpression = function (fieldsExpression, relationField) {
    if (fieldsExpression === undefined || Object.keys(fieldsExpression).length === 0) {
        return;
    }
    var isExclusive = RelationTreeBuilder.getIsFieldsExpressionExclusive(fieldsExpression);

    if (isExclusive === undefined) {
        return;
    }

    if (isExclusive) {
        delete fieldsExpression[relationField];
    } else {
        fieldsExpression[relationField] = 1;
    }
};

/**
 * Gets if the fields expression is exclusive ("FieldName" : 0)
 * @param fieldsExpression - Fields expression to check.
 * @returns {*}
 */
RelationTreeBuilder.getIsFieldsExpressionExclusive = function (fieldsExpression) {
    var isExclusive;
    for (var fieldName in fieldsExpression) {
        if (fieldName !== Constants.IdFieldNameClient && fieldsExpression.hasOwnProperty(fieldName)) {
            if (isExclusive === undefined) {
                if (fieldsExpression[fieldName] === 0) {
                    isExclusive = true;
                    break;
                } else {
                    if (typeof fieldsExpression[fieldName] === 'object') {
                        continue;
                    } else {
                        // fieldsExpression[fieldName] === 1
                        isExclusive = false;
                        break;
                    }
                }
            }
        }
    }
    return isExclusive;
};

module.exports = RelationTreeBuilder;

},{"./Constants":44,"./RelationNode":47,"async":49,"underscore":50}],49:[function(require,module,exports){
(function (process){
/*!
 * async
 * https://github.com/caolan/async
 *
 * Copyright 2010-2014 Caolan McMahon
 * Released under the MIT license
 */
/*jshint onevar: false, indent:4 */
/*global setImmediate: false, setTimeout: false, console: false */
(function () {

    var async = {};

    // global on the server, window in the browser
    var root, previous_async;

    root = this;
    if (root != null) {
      previous_async = root.async;
    }

    async.noConflict = function () {
        root.async = previous_async;
        return async;
    };

    function only_once(fn) {
        var called = false;
        return function() {
            if (called) throw new Error("Callback was already called.");
            called = true;
            fn.apply(root, arguments);
        }
    }

    //// cross-browser compatiblity functions ////

    var _toString = Object.prototype.toString;

    var _isArray = Array.isArray || function (obj) {
        return _toString.call(obj) === '[object Array]';
    };

    var _each = function (arr, iterator) {
        if (arr.forEach) {
            return arr.forEach(iterator);
        }
        for (var i = 0; i < arr.length; i += 1) {
            iterator(arr[i], i, arr);
        }
    };

    var _map = function (arr, iterator) {
        if (arr.map) {
            return arr.map(iterator);
        }
        var results = [];
        _each(arr, function (x, i, a) {
            results.push(iterator(x, i, a));
        });
        return results;
    };

    var _reduce = function (arr, iterator, memo) {
        if (arr.reduce) {
            return arr.reduce(iterator, memo);
        }
        _each(arr, function (x, i, a) {
            memo = iterator(memo, x, i, a);
        });
        return memo;
    };

    var _keys = function (obj) {
        if (Object.keys) {
            return Object.keys(obj);
        }
        var keys = [];
        for (var k in obj) {
            if (obj.hasOwnProperty(k)) {
                keys.push(k);
            }
        }
        return keys;
    };

    //// exported async module functions ////

    //// nextTick implementation with browser-compatible fallback ////
    if (typeof process === 'undefined' || !(process.nextTick)) {
        if (typeof setImmediate === 'function') {
            async.nextTick = function (fn) {
                // not a direct alias for IE10 compatibility
                setImmediate(fn);
            };
            async.setImmediate = async.nextTick;
        }
        else {
            async.nextTick = function (fn) {
                setTimeout(fn, 0);
            };
            async.setImmediate = async.nextTick;
        }
    }
    else {
        async.nextTick = process.nextTick;
        if (typeof setImmediate !== 'undefined') {
            async.setImmediate = function (fn) {
              // not a direct alias for IE10 compatibility
              setImmediate(fn);
            };
        }
        else {
            async.setImmediate = async.nextTick;
        }
    }

    async.each = function (arr, iterator, callback) {
        callback = callback || function () {};
        if (!arr.length) {
            return callback();
        }
        var completed = 0;
        _each(arr, function (x) {
            iterator(x, only_once(done) );
        });
        function done(err) {
          if (err) {
              callback(err);
              callback = function () {};
          }
          else {
              completed += 1;
              if (completed >= arr.length) {
                  callback();
              }
          }
        }
    };
    async.forEach = async.each;

    async.eachSeries = function (arr, iterator, callback) {
        callback = callback || function () {};
        if (!arr.length) {
            return callback();
        }
        var completed = 0;
        var iterate = function () {
            iterator(arr[completed], function (err) {
                if (err) {
                    callback(err);
                    callback = function () {};
                }
                else {
                    completed += 1;
                    if (completed >= arr.length) {
                        callback();
                    }
                    else {
                        iterate();
                    }
                }
            });
        };
        iterate();
    };
    async.forEachSeries = async.eachSeries;

    async.eachLimit = function (arr, limit, iterator, callback) {
        var fn = _eachLimit(limit);
        fn.apply(null, [arr, iterator, callback]);
    };
    async.forEachLimit = async.eachLimit;

    var _eachLimit = function (limit) {

        return function (arr, iterator, callback) {
            callback = callback || function () {};
            if (!arr.length || limit <= 0) {
                return callback();
            }
            var completed = 0;
            var started = 0;
            var running = 0;

            (function replenish () {
                if (completed >= arr.length) {
                    return callback();
                }

                while (running < limit && started < arr.length) {
                    started += 1;
                    running += 1;
                    iterator(arr[started - 1], function (err) {
                        if (err) {
                            callback(err);
                            callback = function () {};
                        }
                        else {
                            completed += 1;
                            running -= 1;
                            if (completed >= arr.length) {
                                callback();
                            }
                            else {
                                replenish();
                            }
                        }
                    });
                }
            })();
        };
    };


    var doParallel = function (fn) {
        return function () {
            var args = Array.prototype.slice.call(arguments);
            return fn.apply(null, [async.each].concat(args));
        };
    };
    var doParallelLimit = function(limit, fn) {
        return function () {
            var args = Array.prototype.slice.call(arguments);
            return fn.apply(null, [_eachLimit(limit)].concat(args));
        };
    };
    var doSeries = function (fn) {
        return function () {
            var args = Array.prototype.slice.call(arguments);
            return fn.apply(null, [async.eachSeries].concat(args));
        };
    };


    var _asyncMap = function (eachfn, arr, iterator, callback) {
        arr = _map(arr, function (x, i) {
            return {index: i, value: x};
        });
        if (!callback) {
            eachfn(arr, function (x, callback) {
                iterator(x.value, function (err) {
                    callback(err);
                });
            });
        } else {
            var results = [];
            eachfn(arr, function (x, callback) {
                iterator(x.value, function (err, v) {
                    results[x.index] = v;
                    callback(err);
                });
            }, function (err) {
                callback(err, results);
            });
        }
    };
    async.map = doParallel(_asyncMap);
    async.mapSeries = doSeries(_asyncMap);
    async.mapLimit = function (arr, limit, iterator, callback) {
        return _mapLimit(limit)(arr, iterator, callback);
    };

    var _mapLimit = function(limit) {
        return doParallelLimit(limit, _asyncMap);
    };

    // reduce only has a series version, as doing reduce in parallel won't
    // work in many situations.
    async.reduce = function (arr, memo, iterator, callback) {
        async.eachSeries(arr, function (x, callback) {
            iterator(memo, x, function (err, v) {
                memo = v;
                callback(err);
            });
        }, function (err) {
            callback(err, memo);
        });
    };
    // inject alias
    async.inject = async.reduce;
    // foldl alias
    async.foldl = async.reduce;

    async.reduceRight = function (arr, memo, iterator, callback) {
        var reversed = _map(arr, function (x) {
            return x;
        }).reverse();
        async.reduce(reversed, memo, iterator, callback);
    };
    // foldr alias
    async.foldr = async.reduceRight;

    var _filter = function (eachfn, arr, iterator, callback) {
        var results = [];
        arr = _map(arr, function (x, i) {
            return {index: i, value: x};
        });
        eachfn(arr, function (x, callback) {
            iterator(x.value, function (v) {
                if (v) {
                    results.push(x);
                }
                callback();
            });
        }, function (err) {
            callback(_map(results.sort(function (a, b) {
                return a.index - b.index;
            }), function (x) {
                return x.value;
            }));
        });
    };
    async.filter = doParallel(_filter);
    async.filterSeries = doSeries(_filter);
    // select alias
    async.select = async.filter;
    async.selectSeries = async.filterSeries;

    var _reject = function (eachfn, arr, iterator, callback) {
        var results = [];
        arr = _map(arr, function (x, i) {
            return {index: i, value: x};
        });
        eachfn(arr, function (x, callback) {
            iterator(x.value, function (v) {
                if (!v) {
                    results.push(x);
                }
                callback();
            });
        }, function (err) {
            callback(_map(results.sort(function (a, b) {
                return a.index - b.index;
            }), function (x) {
                return x.value;
            }));
        });
    };
    async.reject = doParallel(_reject);
    async.rejectSeries = doSeries(_reject);

    var _detect = function (eachfn, arr, iterator, main_callback) {
        eachfn(arr, function (x, callback) {
            iterator(x, function (result) {
                if (result) {
                    main_callback(x);
                    main_callback = function () {};
                }
                else {
                    callback();
                }
            });
        }, function (err) {
            main_callback();
        });
    };
    async.detect = doParallel(_detect);
    async.detectSeries = doSeries(_detect);

    async.some = function (arr, iterator, main_callback) {
        async.each(arr, function (x, callback) {
            iterator(x, function (v) {
                if (v) {
                    main_callback(true);
                    main_callback = function () {};
                }
                callback();
            });
        }, function (err) {
            main_callback(false);
        });
    };
    // any alias
    async.any = async.some;

    async.every = function (arr, iterator, main_callback) {
        async.each(arr, function (x, callback) {
            iterator(x, function (v) {
                if (!v) {
                    main_callback(false);
                    main_callback = function () {};
                }
                callback();
            });
        }, function (err) {
            main_callback(true);
        });
    };
    // all alias
    async.all = async.every;

    async.sortBy = function (arr, iterator, callback) {
        async.map(arr, function (x, callback) {
            iterator(x, function (err, criteria) {
                if (err) {
                    callback(err);
                }
                else {
                    callback(null, {value: x, criteria: criteria});
                }
            });
        }, function (err, results) {
            if (err) {
                return callback(err);
            }
            else {
                var fn = function (left, right) {
                    var a = left.criteria, b = right.criteria;
                    return a < b ? -1 : a > b ? 1 : 0;
                };
                callback(null, _map(results.sort(fn), function (x) {
                    return x.value;
                }));
            }
        });
    };

    async.auto = function (tasks, callback) {
        callback = callback || function () {};
        var keys = _keys(tasks);
        var remainingTasks = keys.length
        if (!remainingTasks) {
            return callback();
        }

        var results = {};

        var listeners = [];
        var addListener = function (fn) {
            listeners.unshift(fn);
        };
        var removeListener = function (fn) {
            for (var i = 0; i < listeners.length; i += 1) {
                if (listeners[i] === fn) {
                    listeners.splice(i, 1);
                    return;
                }
            }
        };
        var taskComplete = function () {
            remainingTasks--
            _each(listeners.slice(0), function (fn) {
                fn();
            });
        };

        addListener(function () {
            if (!remainingTasks) {
                var theCallback = callback;
                // prevent final callback from calling itself if it errors
                callback = function () {};

                theCallback(null, results);
            }
        });

        _each(keys, function (k) {
            var task = _isArray(tasks[k]) ? tasks[k]: [tasks[k]];
            var taskCallback = function (err) {
                var args = Array.prototype.slice.call(arguments, 1);
                if (args.length <= 1) {
                    args = args[0];
                }
                if (err) {
                    var safeResults = {};
                    _each(_keys(results), function(rkey) {
                        safeResults[rkey] = results[rkey];
                    });
                    safeResults[k] = args;
                    callback(err, safeResults);
                    // stop subsequent errors hitting callback multiple times
                    callback = function () {};
                }
                else {
                    results[k] = args;
                    async.setImmediate(taskComplete);
                }
            };
            var requires = task.slice(0, Math.abs(task.length - 1)) || [];
            var ready = function () {
                return _reduce(requires, function (a, x) {
                    return (a && results.hasOwnProperty(x));
                }, true) && !results.hasOwnProperty(k);
            };
            if (ready()) {
                task[task.length - 1](taskCallback, results);
            }
            else {
                var listener = function () {
                    if (ready()) {
                        removeListener(listener);
                        task[task.length - 1](taskCallback, results);
                    }
                };
                addListener(listener);
            }
        });
    };

    async.retry = function(times, task, callback) {
        var DEFAULT_TIMES = 5;
        var attempts = [];
        // Use defaults if times not passed
        if (typeof times === 'function') {
            callback = task;
            task = times;
            times = DEFAULT_TIMES;
        }
        // Make sure times is a number
        times = parseInt(times, 10) || DEFAULT_TIMES;
        var wrappedTask = function(wrappedCallback, wrappedResults) {
            var retryAttempt = function(task, finalAttempt) {
                return function(seriesCallback) {
                    task(function(err, result){
                        seriesCallback(!err || finalAttempt, {err: err, result: result});
                    }, wrappedResults);
                };
            };
            while (times) {
                attempts.push(retryAttempt(task, !(times-=1)));
            }
            async.series(attempts, function(done, data){
                data = data[data.length - 1];
                (wrappedCallback || callback)(data.err, data.result);
            });
        }
        // If a callback is passed, run this as a controll flow
        return callback ? wrappedTask() : wrappedTask
    };

    async.waterfall = function (tasks, callback) {
        callback = callback || function () {};
        if (!_isArray(tasks)) {
          var err = new Error('First argument to waterfall must be an array of functions');
          return callback(err);
        }
        if (!tasks.length) {
            return callback();
        }
        var wrapIterator = function (iterator) {
            return function (err) {
                if (err) {
                    callback.apply(null, arguments);
                    callback = function () {};
                }
                else {
                    var args = Array.prototype.slice.call(arguments, 1);
                    var next = iterator.next();
                    if (next) {
                        args.push(wrapIterator(next));
                    }
                    else {
                        args.push(callback);
                    }
                    async.setImmediate(function () {
                        iterator.apply(null, args);
                    });
                }
            };
        };
        wrapIterator(async.iterator(tasks))();
    };

    var _parallel = function(eachfn, tasks, callback) {
        callback = callback || function () {};
        if (_isArray(tasks)) {
            eachfn.map(tasks, function (fn, callback) {
                if (fn) {
                    fn(function (err) {
                        var args = Array.prototype.slice.call(arguments, 1);
                        if (args.length <= 1) {
                            args = args[0];
                        }
                        callback.call(null, err, args);
                    });
                }
            }, callback);
        }
        else {
            var results = {};
            eachfn.each(_keys(tasks), function (k, callback) {
                tasks[k](function (err) {
                    var args = Array.prototype.slice.call(arguments, 1);
                    if (args.length <= 1) {
                        args = args[0];
                    }
                    results[k] = args;
                    callback(err);
                });
            }, function (err) {
                callback(err, results);
            });
        }
    };

    async.parallel = function (tasks, callback) {
        _parallel({ map: async.map, each: async.each }, tasks, callback);
    };

    async.parallelLimit = function(tasks, limit, callback) {
        _parallel({ map: _mapLimit(limit), each: _eachLimit(limit) }, tasks, callback);
    };

    async.series = function (tasks, callback) {
        callback = callback || function () {};
        if (_isArray(tasks)) {
            async.mapSeries(tasks, function (fn, callback) {
                if (fn) {
                    fn(function (err) {
                        var args = Array.prototype.slice.call(arguments, 1);
                        if (args.length <= 1) {
                            args = args[0];
                        }
                        callback.call(null, err, args);
                    });
                }
            }, callback);
        }
        else {
            var results = {};
            async.eachSeries(_keys(tasks), function (k, callback) {
                tasks[k](function (err) {
                    var args = Array.prototype.slice.call(arguments, 1);
                    if (args.length <= 1) {
                        args = args[0];
                    }
                    results[k] = args;
                    callback(err);
                });
            }, function (err) {
                callback(err, results);
            });
        }
    };

    async.iterator = function (tasks) {
        var makeCallback = function (index) {
            var fn = function () {
                if (tasks.length) {
                    tasks[index].apply(null, arguments);
                }
                return fn.next();
            };
            fn.next = function () {
                return (index < tasks.length - 1) ? makeCallback(index + 1): null;
            };
            return fn;
        };
        return makeCallback(0);
    };

    async.apply = function (fn) {
        var args = Array.prototype.slice.call(arguments, 1);
        return function () {
            return fn.apply(
                null, args.concat(Array.prototype.slice.call(arguments))
            );
        };
    };

    var _concat = function (eachfn, arr, fn, callback) {
        var r = [];
        eachfn(arr, function (x, cb) {
            fn(x, function (err, y) {
                r = r.concat(y || []);
                cb(err);
            });
        }, function (err) {
            callback(err, r);
        });
    };
    async.concat = doParallel(_concat);
    async.concatSeries = doSeries(_concat);

    async.whilst = function (test, iterator, callback) {
        if (test()) {
            iterator(function (err) {
                if (err) {
                    return callback(err);
                }
                async.whilst(test, iterator, callback);
            });
        }
        else {
            callback();
        }
    };

    async.doWhilst = function (iterator, test, callback) {
        iterator(function (err) {
            if (err) {
                return callback(err);
            }
            var args = Array.prototype.slice.call(arguments, 1);
            if (test.apply(null, args)) {
                async.doWhilst(iterator, test, callback);
            }
            else {
                callback();
            }
        });
    };

    async.until = function (test, iterator, callback) {
        if (!test()) {
            iterator(function (err) {
                if (err) {
                    return callback(err);
                }
                async.until(test, iterator, callback);
            });
        }
        else {
            callback();
        }
    };

    async.doUntil = function (iterator, test, callback) {
        iterator(function (err) {
            if (err) {
                return callback(err);
            }
            var args = Array.prototype.slice.call(arguments, 1);
            if (!test.apply(null, args)) {
                async.doUntil(iterator, test, callback);
            }
            else {
                callback();
            }
        });
    };

    async.queue = function (worker, concurrency) {
        if (concurrency === undefined) {
            concurrency = 1;
        }
        function _insert(q, data, pos, callback) {
          if (!q.started){
            q.started = true;
          }
          if (!_isArray(data)) {
              data = [data];
          }
          if(data.length == 0) {
             // call drain immediately if there are no tasks
             return async.setImmediate(function() {
                 if (q.drain) {
                     q.drain();
                 }
             });
          }
          _each(data, function(task) {
              var item = {
                  data: task,
                  callback: typeof callback === 'function' ? callback : null
              };

              if (pos) {
                q.tasks.unshift(item);
              } else {
                q.tasks.push(item);
              }

              if (q.saturated && q.tasks.length === q.concurrency) {
                  q.saturated();
              }
              async.setImmediate(q.process);
          });
        }

        var workers = 0;
        var q = {
            tasks: [],
            concurrency: concurrency,
            saturated: null,
            empty: null,
            drain: null,
            started: false,
            paused: false,
            push: function (data, callback) {
              _insert(q, data, false, callback);
            },
            kill: function () {
              q.drain = null;
              q.tasks = [];
            },
            unshift: function (data, callback) {
              _insert(q, data, true, callback);
            },
            process: function () {
                if (!q.paused && workers < q.concurrency && q.tasks.length) {
                    var task = q.tasks.shift();
                    if (q.empty && q.tasks.length === 0) {
                        q.empty();
                    }
                    workers += 1;
                    var next = function () {
                        workers -= 1;
                        if (task.callback) {
                            task.callback.apply(task, arguments);
                        }
                        if (q.drain && q.tasks.length + workers === 0) {
                            q.drain();
                        }
                        q.process();
                    };
                    var cb = only_once(next);
                    worker(task.data, cb);
                }
            },
            length: function () {
                return q.tasks.length;
            },
            running: function () {
                return workers;
            },
            idle: function() {
                return q.tasks.length + workers === 0;
            },
            pause: function () {
                if (q.paused === true) { return; }
                q.paused = true;
                q.process();
            },
            resume: function () {
                if (q.paused === false) { return; }
                q.paused = false;
                q.process();
            }
        };
        return q;
    };
    
    async.priorityQueue = function (worker, concurrency) {
        
        function _compareTasks(a, b){
          return a.priority - b.priority;
        };
        
        function _binarySearch(sequence, item, compare) {
          var beg = -1,
              end = sequence.length - 1;
          while (beg < end) {
            var mid = beg + ((end - beg + 1) >>> 1);
            if (compare(item, sequence[mid]) >= 0) {
              beg = mid;
            } else {
              end = mid - 1;
            }
          }
          return beg;
        }
        
        function _insert(q, data, priority, callback) {
          if (!q.started){
            q.started = true;
          }
          if (!_isArray(data)) {
              data = [data];
          }
          if(data.length == 0) {
             // call drain immediately if there are no tasks
             return async.setImmediate(function() {
                 if (q.drain) {
                     q.drain();
                 }
             });
          }
          _each(data, function(task) {
              var item = {
                  data: task,
                  priority: priority,
                  callback: typeof callback === 'function' ? callback : null
              };
              
              q.tasks.splice(_binarySearch(q.tasks, item, _compareTasks) + 1, 0, item);

              if (q.saturated && q.tasks.length === q.concurrency) {
                  q.saturated();
              }
              async.setImmediate(q.process);
          });
        }
        
        // Start with a normal queue
        var q = async.queue(worker, concurrency);
        
        // Override push to accept second parameter representing priority
        q.push = function (data, priority, callback) {
          _insert(q, data, priority, callback);
        };
        
        // Remove unshift function
        delete q.unshift;

        return q;
    };

    async.cargo = function (worker, payload) {
        var working     = false,
            tasks       = [];

        var cargo = {
            tasks: tasks,
            payload: payload,
            saturated: null,
            empty: null,
            drain: null,
            drained: true,
            push: function (data, callback) {
                if (!_isArray(data)) {
                    data = [data];
                }
                _each(data, function(task) {
                    tasks.push({
                        data: task,
                        callback: typeof callback === 'function' ? callback : null
                    });
                    cargo.drained = false;
                    if (cargo.saturated && tasks.length === payload) {
                        cargo.saturated();
                    }
                });
                async.setImmediate(cargo.process);
            },
            process: function process() {
                if (working) return;
                if (tasks.length === 0) {
                    if(cargo.drain && !cargo.drained) cargo.drain();
                    cargo.drained = true;
                    return;
                }

                var ts = typeof payload === 'number'
                            ? tasks.splice(0, payload)
                            : tasks.splice(0, tasks.length);

                var ds = _map(ts, function (task) {
                    return task.data;
                });

                if(cargo.empty) cargo.empty();
                working = true;
                worker(ds, function () {
                    working = false;

                    var args = arguments;
                    _each(ts, function (data) {
                        if (data.callback) {
                            data.callback.apply(null, args);
                        }
                    });

                    process();
                });
            },
            length: function () {
                return tasks.length;
            },
            running: function () {
                return working;
            }
        };
        return cargo;
    };

    var _console_fn = function (name) {
        return function (fn) {
            var args = Array.prototype.slice.call(arguments, 1);
            fn.apply(null, args.concat([function (err) {
                var args = Array.prototype.slice.call(arguments, 1);
                if (typeof console !== 'undefined') {
                    if (err) {
                        if (console.error) {
                            console.error(err);
                        }
                    }
                    else if (console[name]) {
                        _each(args, function (x) {
                            console[name](x);
                        });
                    }
                }
            }]));
        };
    };
    async.log = _console_fn('log');
    async.dir = _console_fn('dir');
    /*async.info = _console_fn('info');
    async.warn = _console_fn('warn');
    async.error = _console_fn('error');*/

    async.memoize = function (fn, hasher) {
        var memo = {};
        var queues = {};
        hasher = hasher || function (x) {
            return x;
        };
        var memoized = function () {
            var args = Array.prototype.slice.call(arguments);
            var callback = args.pop();
            var key = hasher.apply(null, args);
            if (key in memo) {
                async.nextTick(function () {
                    callback.apply(null, memo[key]);
                });
            }
            else if (key in queues) {
                queues[key].push(callback);
            }
            else {
                queues[key] = [callback];
                fn.apply(null, args.concat([function () {
                    memo[key] = arguments;
                    var q = queues[key];
                    delete queues[key];
                    for (var i = 0, l = q.length; i < l; i++) {
                      q[i].apply(null, arguments);
                    }
                }]));
            }
        };
        memoized.memo = memo;
        memoized.unmemoized = fn;
        return memoized;
    };

    async.unmemoize = function (fn) {
      return function () {
        return (fn.unmemoized || fn).apply(null, arguments);
      };
    };

    async.times = function (count, iterator, callback) {
        var counter = [];
        for (var i = 0; i < count; i++) {
            counter.push(i);
        }
        return async.map(counter, iterator, callback);
    };

    async.timesSeries = function (count, iterator, callback) {
        var counter = [];
        for (var i = 0; i < count; i++) {
            counter.push(i);
        }
        return async.mapSeries(counter, iterator, callback);
    };

    async.seq = function (/* functions... */) {
        var fns = arguments;
        return function () {
            var that = this;
            var args = Array.prototype.slice.call(arguments);
            var callback = args.pop();
            async.reduce(fns, args, function (newargs, fn, cb) {
                fn.apply(that, newargs.concat([function () {
                    var err = arguments[0];
                    var nextargs = Array.prototype.slice.call(arguments, 1);
                    cb(err, nextargs);
                }]))
            },
            function (err, results) {
                callback.apply(that, [err].concat(results));
            });
        };
    };

    async.compose = function (/* functions... */) {
      return async.seq.apply(null, Array.prototype.reverse.call(arguments));
    };

    var _applyEach = function (eachfn, fns /*args...*/) {
        var go = function () {
            var that = this;
            var args = Array.prototype.slice.call(arguments);
            var callback = args.pop();
            return eachfn(fns, function (fn, cb) {
                fn.apply(that, args.concat([cb]));
            },
            callback);
        };
        if (arguments.length > 2) {
            var args = Array.prototype.slice.call(arguments, 2);
            return go.apply(this, args);
        }
        else {
            return go;
        }
    };
    async.applyEach = doParallel(_applyEach);
    async.applyEachSeries = doSeries(_applyEach);

    async.forever = function (fn, callback) {
        function next(err) {
            if (err) {
                if (callback) {
                    return callback(err);
                }
                throw err;
            }
            fn(next);
        }
        next();
    };

    // Node.js
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = async;
    }
    // AMD / RequireJS
    else if (typeof define !== 'undefined' && define.amd) {
        define([], function () {
            return async;
        });
    }
    // included directly via <script> tag
    else {
        root.async = async;
    }

}());

}).call(this,require('_process'))

},{"_process":9}],50:[function(require,module,exports){
//     Underscore.js 1.8.2
//     http://underscorejs.org
//     (c) 2009-2015 Jeremy Ashkenas, DocumentCloud and Investigative Reporters & Editors
//     Underscore may be freely distributed under the MIT license.

(function() {

  // Baseline setup
  // --------------

  // Establish the root object, `window` in the browser, or `exports` on the server.
  var root = this;

  // Save the previous value of the `_` variable.
  var previousUnderscore = root._;

  // Save bytes in the minified (but not gzipped) version:
  var ArrayProto = Array.prototype, ObjProto = Object.prototype, FuncProto = Function.prototype;

  // Create quick reference variables for speed access to core prototypes.
  var
    push             = ArrayProto.push,
    slice            = ArrayProto.slice,
    toString         = ObjProto.toString,
    hasOwnProperty   = ObjProto.hasOwnProperty;

  // All **ECMAScript 5** native function implementations that we hope to use
  // are declared here.
  var
    nativeIsArray      = Array.isArray,
    nativeKeys         = Object.keys,
    nativeBind         = FuncProto.bind,
    nativeCreate       = Object.create;

  // Naked function reference for surrogate-prototype-swapping.
  var Ctor = function(){};

  // Create a safe reference to the Underscore object for use below.
  var _ = function(obj) {
    if (obj instanceof _) return obj;
    if (!(this instanceof _)) return new _(obj);
    this._wrapped = obj;
  };

  // Export the Underscore object for **Node.js**, with
  // backwards-compatibility for the old `require()` API. If we're in
  // the browser, add `_` as a global object.
  if (typeof exports !== 'undefined') {
    if (typeof module !== 'undefined' && module.exports) {
      exports = module.exports = _;
    }
    exports._ = _;
  } else {
    root._ = _;
  }

  // Current version.
  _.VERSION = '1.8.2';

  // Internal function that returns an efficient (for current engines) version
  // of the passed-in callback, to be repeatedly applied in other Underscore
  // functions.
  var optimizeCb = function(func, context, argCount) {
    if (context === void 0) return func;
    switch (argCount == null ? 3 : argCount) {
      case 1: return function(value) {
        return func.call(context, value);
      };
      case 2: return function(value, other) {
        return func.call(context, value, other);
      };
      case 3: return function(value, index, collection) {
        return func.call(context, value, index, collection);
      };
      case 4: return function(accumulator, value, index, collection) {
        return func.call(context, accumulator, value, index, collection);
      };
    }
    return function() {
      return func.apply(context, arguments);
    };
  };

  // A mostly-internal function to generate callbacks that can be applied
  // to each element in a collection, returning the desired result — either
  // identity, an arbitrary callback, a property matcher, or a property accessor.
  var cb = function(value, context, argCount) {
    if (value == null) return _.identity;
    if (_.isFunction(value)) return optimizeCb(value, context, argCount);
    if (_.isObject(value)) return _.matcher(value);
    return _.property(value);
  };
  _.iteratee = function(value, context) {
    return cb(value, context, Infinity);
  };

  // An internal function for creating assigner functions.
  var createAssigner = function(keysFunc, undefinedOnly) {
    return function(obj) {
      var length = arguments.length;
      if (length < 2 || obj == null) return obj;
      for (var index = 1; index < length; index++) {
        var source = arguments[index],
            keys = keysFunc(source),
            l = keys.length;
        for (var i = 0; i < l; i++) {
          var key = keys[i];
          if (!undefinedOnly || obj[key] === void 0) obj[key] = source[key];
        }
      }
      return obj;
    };
  };

  // An internal function for creating a new object that inherits from another.
  var baseCreate = function(prototype) {
    if (!_.isObject(prototype)) return {};
    if (nativeCreate) return nativeCreate(prototype);
    Ctor.prototype = prototype;
    var result = new Ctor;
    Ctor.prototype = null;
    return result;
  };

  // Helper for collection methods to determine whether a collection
  // should be iterated as an array or as an object
  // Related: http://people.mozilla.org/~jorendorff/es6-draft.html#sec-tolength
  var MAX_ARRAY_INDEX = Math.pow(2, 53) - 1;
  var isArrayLike = function(collection) {
    var length = collection && collection.length;
    return typeof length == 'number' && length >= 0 && length <= MAX_ARRAY_INDEX;
  };

  // Collection Functions
  // --------------------

  // The cornerstone, an `each` implementation, aka `forEach`.
  // Handles raw objects in addition to array-likes. Treats all
  // sparse array-likes as if they were dense.
  _.each = _.forEach = function(obj, iteratee, context) {
    iteratee = optimizeCb(iteratee, context);
    var i, length;
    if (isArrayLike(obj)) {
      for (i = 0, length = obj.length; i < length; i++) {
        iteratee(obj[i], i, obj);
      }
    } else {
      var keys = _.keys(obj);
      for (i = 0, length = keys.length; i < length; i++) {
        iteratee(obj[keys[i]], keys[i], obj);
      }
    }
    return obj;
  };

  // Return the results of applying the iteratee to each element.
  _.map = _.collect = function(obj, iteratee, context) {
    iteratee = cb(iteratee, context);
    var keys = !isArrayLike(obj) && _.keys(obj),
        length = (keys || obj).length,
        results = Array(length);
    for (var index = 0; index < length; index++) {
      var currentKey = keys ? keys[index] : index;
      results[index] = iteratee(obj[currentKey], currentKey, obj);
    }
    return results;
  };

  // Create a reducing function iterating left or right.
  function createReduce(dir) {
    // Optimized iterator function as using arguments.length
    // in the main function will deoptimize the, see #1991.
    function iterator(obj, iteratee, memo, keys, index, length) {
      for (; index >= 0 && index < length; index += dir) {
        var currentKey = keys ? keys[index] : index;
        memo = iteratee(memo, obj[currentKey], currentKey, obj);
      }
      return memo;
    }

    return function(obj, iteratee, memo, context) {
      iteratee = optimizeCb(iteratee, context, 4);
      var keys = !isArrayLike(obj) && _.keys(obj),
          length = (keys || obj).length,
          index = dir > 0 ? 0 : length - 1;
      // Determine the initial value if none is provided.
      if (arguments.length < 3) {
        memo = obj[keys ? keys[index] : index];
        index += dir;
      }
      return iterator(obj, iteratee, memo, keys, index, length);
    };
  }

  // **Reduce** builds up a single result from a list of values, aka `inject`,
  // or `foldl`.
  _.reduce = _.foldl = _.inject = createReduce(1);

  // The right-associative version of reduce, also known as `foldr`.
  _.reduceRight = _.foldr = createReduce(-1);

  // Return the first value which passes a truth test. Aliased as `detect`.
  _.find = _.detect = function(obj, predicate, context) {
    var key;
    if (isArrayLike(obj)) {
      key = _.findIndex(obj, predicate, context);
    } else {
      key = _.findKey(obj, predicate, context);
    }
    if (key !== void 0 && key !== -1) return obj[key];
  };

  // Return all the elements that pass a truth test.
  // Aliased as `select`.
  _.filter = _.select = function(obj, predicate, context) {
    var results = [];
    predicate = cb(predicate, context);
    _.each(obj, function(value, index, list) {
      if (predicate(value, index, list)) results.push(value);
    });
    return results;
  };

  // Return all the elements for which a truth test fails.
  _.reject = function(obj, predicate, context) {
    return _.filter(obj, _.negate(cb(predicate)), context);
  };

  // Determine whether all of the elements match a truth test.
  // Aliased as `all`.
  _.every = _.all = function(obj, predicate, context) {
    predicate = cb(predicate, context);
    var keys = !isArrayLike(obj) && _.keys(obj),
        length = (keys || obj).length;
    for (var index = 0; index < length; index++) {
      var currentKey = keys ? keys[index] : index;
      if (!predicate(obj[currentKey], currentKey, obj)) return false;
    }
    return true;
  };

  // Determine if at least one element in the object matches a truth test.
  // Aliased as `any`.
  _.some = _.any = function(obj, predicate, context) {
    predicate = cb(predicate, context);
    var keys = !isArrayLike(obj) && _.keys(obj),
        length = (keys || obj).length;
    for (var index = 0; index < length; index++) {
      var currentKey = keys ? keys[index] : index;
      if (predicate(obj[currentKey], currentKey, obj)) return true;
    }
    return false;
  };

  // Determine if the array or object contains a given value (using `===`).
  // Aliased as `includes` and `include`.
  _.contains = _.includes = _.include = function(obj, target, fromIndex) {
    if (!isArrayLike(obj)) obj = _.values(obj);
    return _.indexOf(obj, target, typeof fromIndex == 'number' && fromIndex) >= 0;
  };

  // Invoke a method (with arguments) on every item in a collection.
  _.invoke = function(obj, method) {
    var args = slice.call(arguments, 2);
    var isFunc = _.isFunction(method);
    return _.map(obj, function(value) {
      var func = isFunc ? method : value[method];
      return func == null ? func : func.apply(value, args);
    });
  };

  // Convenience version of a common use case of `map`: fetching a property.
  _.pluck = function(obj, key) {
    return _.map(obj, _.property(key));
  };

  // Convenience version of a common use case of `filter`: selecting only objects
  // containing specific `key:value` pairs.
  _.where = function(obj, attrs) {
    return _.filter(obj, _.matcher(attrs));
  };

  // Convenience version of a common use case of `find`: getting the first object
  // containing specific `key:value` pairs.
  _.findWhere = function(obj, attrs) {
    return _.find(obj, _.matcher(attrs));
  };

  // Return the maximum element (or element-based computation).
  _.max = function(obj, iteratee, context) {
    var result = -Infinity, lastComputed = -Infinity,
        value, computed;
    if (iteratee == null && obj != null) {
      obj = isArrayLike(obj) ? obj : _.values(obj);
      for (var i = 0, length = obj.length; i < length; i++) {
        value = obj[i];
        if (value > result) {
          result = value;
        }
      }
    } else {
      iteratee = cb(iteratee, context);
      _.each(obj, function(value, index, list) {
        computed = iteratee(value, index, list);
        if (computed > lastComputed || computed === -Infinity && result === -Infinity) {
          result = value;
          lastComputed = computed;
        }
      });
    }
    return result;
  };

  // Return the minimum element (or element-based computation).
  _.min = function(obj, iteratee, context) {
    var result = Infinity, lastComputed = Infinity,
        value, computed;
    if (iteratee == null && obj != null) {
      obj = isArrayLike(obj) ? obj : _.values(obj);
      for (var i = 0, length = obj.length; i < length; i++) {
        value = obj[i];
        if (value < result) {
          result = value;
        }
      }
    } else {
      iteratee = cb(iteratee, context);
      _.each(obj, function(value, index, list) {
        computed = iteratee(value, index, list);
        if (computed < lastComputed || computed === Infinity && result === Infinity) {
          result = value;
          lastComputed = computed;
        }
      });
    }
    return result;
  };

  // Shuffle a collection, using the modern version of the
  // [Fisher-Yates shuffle](http://en.wikipedia.org/wiki/Fisher–Yates_shuffle).
  _.shuffle = function(obj) {
    var set = isArrayLike(obj) ? obj : _.values(obj);
    var length = set.length;
    var shuffled = Array(length);
    for (var index = 0, rand; index < length; index++) {
      rand = _.random(0, index);
      if (rand !== index) shuffled[index] = shuffled[rand];
      shuffled[rand] = set[index];
    }
    return shuffled;
  };

  // Sample **n** random values from a collection.
  // If **n** is not specified, returns a single random element.
  // The internal `guard` argument allows it to work with `map`.
  _.sample = function(obj, n, guard) {
    if (n == null || guard) {
      if (!isArrayLike(obj)) obj = _.values(obj);
      return obj[_.random(obj.length - 1)];
    }
    return _.shuffle(obj).slice(0, Math.max(0, n));
  };

  // Sort the object's values by a criterion produced by an iteratee.
  _.sortBy = function(obj, iteratee, context) {
    iteratee = cb(iteratee, context);
    return _.pluck(_.map(obj, function(value, index, list) {
      return {
        value: value,
        index: index,
        criteria: iteratee(value, index, list)
      };
    }).sort(function(left, right) {
      var a = left.criteria;
      var b = right.criteria;
      if (a !== b) {
        if (a > b || a === void 0) return 1;
        if (a < b || b === void 0) return -1;
      }
      return left.index - right.index;
    }), 'value');
  };

  // An internal function used for aggregate "group by" operations.
  var group = function(behavior) {
    return function(obj, iteratee, context) {
      var result = {};
      iteratee = cb(iteratee, context);
      _.each(obj, function(value, index) {
        var key = iteratee(value, index, obj);
        behavior(result, value, key);
      });
      return result;
    };
  };

  // Groups the object's values by a criterion. Pass either a string attribute
  // to group by, or a function that returns the criterion.
  _.groupBy = group(function(result, value, key) {
    if (_.has(result, key)) result[key].push(value); else result[key] = [value];
  });

  // Indexes the object's values by a criterion, similar to `groupBy`, but for
  // when you know that your index values will be unique.
  _.indexBy = group(function(result, value, key) {
    result[key] = value;
  });

  // Counts instances of an object that group by a certain criterion. Pass
  // either a string attribute to count by, or a function that returns the
  // criterion.
  _.countBy = group(function(result, value, key) {
    if (_.has(result, key)) result[key]++; else result[key] = 1;
  });

  // Safely create a real, live array from anything iterable.
  _.toArray = function(obj) {
    if (!obj) return [];
    if (_.isArray(obj)) return slice.call(obj);
    if (isArrayLike(obj)) return _.map(obj, _.identity);
    return _.values(obj);
  };

  // Return the number of elements in an object.
  _.size = function(obj) {
    if (obj == null) return 0;
    return isArrayLike(obj) ? obj.length : _.keys(obj).length;
  };

  // Split a collection into two arrays: one whose elements all satisfy the given
  // predicate, and one whose elements all do not satisfy the predicate.
  _.partition = function(obj, predicate, context) {
    predicate = cb(predicate, context);
    var pass = [], fail = [];
    _.each(obj, function(value, key, obj) {
      (predicate(value, key, obj) ? pass : fail).push(value);
    });
    return [pass, fail];
  };

  // Array Functions
  // ---------------

  // Get the first element of an array. Passing **n** will return the first N
  // values in the array. Aliased as `head` and `take`. The **guard** check
  // allows it to work with `_.map`.
  _.first = _.head = _.take = function(array, n, guard) {
    if (array == null) return void 0;
    if (n == null || guard) return array[0];
    return _.initial(array, array.length - n);
  };

  // Returns everything but the last entry of the array. Especially useful on
  // the arguments object. Passing **n** will return all the values in
  // the array, excluding the last N.
  _.initial = function(array, n, guard) {
    return slice.call(array, 0, Math.max(0, array.length - (n == null || guard ? 1 : n)));
  };

  // Get the last element of an array. Passing **n** will return the last N
  // values in the array.
  _.last = function(array, n, guard) {
    if (array == null) return void 0;
    if (n == null || guard) return array[array.length - 1];
    return _.rest(array, Math.max(0, array.length - n));
  };

  // Returns everything but the first entry of the array. Aliased as `tail` and `drop`.
  // Especially useful on the arguments object. Passing an **n** will return
  // the rest N values in the array.
  _.rest = _.tail = _.drop = function(array, n, guard) {
    return slice.call(array, n == null || guard ? 1 : n);
  };

  // Trim out all falsy values from an array.
  _.compact = function(array) {
    return _.filter(array, _.identity);
  };

  // Internal implementation of a recursive `flatten` function.
  var flatten = function(input, shallow, strict, startIndex) {
    var output = [], idx = 0;
    for (var i = startIndex || 0, length = input && input.length; i < length; i++) {
      var value = input[i];
      if (isArrayLike(value) && (_.isArray(value) || _.isArguments(value))) {
        //flatten current level of array or arguments object
        if (!shallow) value = flatten(value, shallow, strict);
        var j = 0, len = value.length;
        output.length += len;
        while (j < len) {
          output[idx++] = value[j++];
        }
      } else if (!strict) {
        output[idx++] = value;
      }
    }
    return output;
  };

  // Flatten out an array, either recursively (by default), or just one level.
  _.flatten = function(array, shallow) {
    return flatten(array, shallow, false);
  };

  // Return a version of the array that does not contain the specified value(s).
  _.without = function(array) {
    return _.difference(array, slice.call(arguments, 1));
  };

  // Produce a duplicate-free version of the array. If the array has already
  // been sorted, you have the option of using a faster algorithm.
  // Aliased as `unique`.
  _.uniq = _.unique = function(array, isSorted, iteratee, context) {
    if (array == null) return [];
    if (!_.isBoolean(isSorted)) {
      context = iteratee;
      iteratee = isSorted;
      isSorted = false;
    }
    if (iteratee != null) iteratee = cb(iteratee, context);
    var result = [];
    var seen = [];
    for (var i = 0, length = array.length; i < length; i++) {
      var value = array[i],
          computed = iteratee ? iteratee(value, i, array) : value;
      if (isSorted) {
        if (!i || seen !== computed) result.push(value);
        seen = computed;
      } else if (iteratee) {
        if (!_.contains(seen, computed)) {
          seen.push(computed);
          result.push(value);
        }
      } else if (!_.contains(result, value)) {
        result.push(value);
      }
    }
    return result;
  };

  // Produce an array that contains the union: each distinct element from all of
  // the passed-in arrays.
  _.union = function() {
    return _.uniq(flatten(arguments, true, true));
  };

  // Produce an array that contains every item shared between all the
  // passed-in arrays.
  _.intersection = function(array) {
    if (array == null) return [];
    var result = [];
    var argsLength = arguments.length;
    for (var i = 0, length = array.length; i < length; i++) {
      var item = array[i];
      if (_.contains(result, item)) continue;
      for (var j = 1; j < argsLength; j++) {
        if (!_.contains(arguments[j], item)) break;
      }
      if (j === argsLength) result.push(item);
    }
    return result;
  };

  // Take the difference between one array and a number of other arrays.
  // Only the elements present in just the first array will remain.
  _.difference = function(array) {
    var rest = flatten(arguments, true, true, 1);
    return _.filter(array, function(value){
      return !_.contains(rest, value);
    });
  };

  // Zip together multiple lists into a single array -- elements that share
  // an index go together.
  _.zip = function() {
    return _.unzip(arguments);
  };

  // Complement of _.zip. Unzip accepts an array of arrays and groups
  // each array's elements on shared indices
  _.unzip = function(array) {
    var length = array && _.max(array, 'length').length || 0;
    var result = Array(length);

    for (var index = 0; index < length; index++) {
      result[index] = _.pluck(array, index);
    }
    return result;
  };

  // Converts lists into objects. Pass either a single array of `[key, value]`
  // pairs, or two parallel arrays of the same length -- one of keys, and one of
  // the corresponding values.
  _.object = function(list, values) {
    var result = {};
    for (var i = 0, length = list && list.length; i < length; i++) {
      if (values) {
        result[list[i]] = values[i];
      } else {
        result[list[i][0]] = list[i][1];
      }
    }
    return result;
  };

  // Return the position of the first occurrence of an item in an array,
  // or -1 if the item is not included in the array.
  // If the array is large and already in sort order, pass `true`
  // for **isSorted** to use binary search.
  _.indexOf = function(array, item, isSorted) {
    var i = 0, length = array && array.length;
    if (typeof isSorted == 'number') {
      i = isSorted < 0 ? Math.max(0, length + isSorted) : isSorted;
    } else if (isSorted && length) {
      i = _.sortedIndex(array, item);
      return array[i] === item ? i : -1;
    }
    if (item !== item) {
      return _.findIndex(slice.call(array, i), _.isNaN);
    }
    for (; i < length; i++) if (array[i] === item) return i;
    return -1;
  };

  _.lastIndexOf = function(array, item, from) {
    var idx = array ? array.length : 0;
    if (typeof from == 'number') {
      idx = from < 0 ? idx + from + 1 : Math.min(idx, from + 1);
    }
    if (item !== item) {
      return _.findLastIndex(slice.call(array, 0, idx), _.isNaN);
    }
    while (--idx >= 0) if (array[idx] === item) return idx;
    return -1;
  };

  // Generator function to create the findIndex and findLastIndex functions
  function createIndexFinder(dir) {
    return function(array, predicate, context) {
      predicate = cb(predicate, context);
      var length = array != null && array.length;
      var index = dir > 0 ? 0 : length - 1;
      for (; index >= 0 && index < length; index += dir) {
        if (predicate(array[index], index, array)) return index;
      }
      return -1;
    };
  }

  // Returns the first index on an array-like that passes a predicate test
  _.findIndex = createIndexFinder(1);

  _.findLastIndex = createIndexFinder(-1);

  // Use a comparator function to figure out the smallest index at which
  // an object should be inserted so as to maintain order. Uses binary search.
  _.sortedIndex = function(array, obj, iteratee, context) {
    iteratee = cb(iteratee, context, 1);
    var value = iteratee(obj);
    var low = 0, high = array.length;
    while (low < high) {
      var mid = Math.floor((low + high) / 2);
      if (iteratee(array[mid]) < value) low = mid + 1; else high = mid;
    }
    return low;
  };

  // Generate an integer Array containing an arithmetic progression. A port of
  // the native Python `range()` function. See
  // [the Python documentation](http://docs.python.org/library/functions.html#range).
  _.range = function(start, stop, step) {
    if (arguments.length <= 1) {
      stop = start || 0;
      start = 0;
    }
    step = step || 1;

    var length = Math.max(Math.ceil((stop - start) / step), 0);
    var range = Array(length);

    for (var idx = 0; idx < length; idx++, start += step) {
      range[idx] = start;
    }

    return range;
  };

  // Function (ahem) Functions
  // ------------------

  // Determines whether to execute a function as a constructor
  // or a normal function with the provided arguments
  var executeBound = function(sourceFunc, boundFunc, context, callingContext, args) {
    if (!(callingContext instanceof boundFunc)) return sourceFunc.apply(context, args);
    var self = baseCreate(sourceFunc.prototype);
    var result = sourceFunc.apply(self, args);
    if (_.isObject(result)) return result;
    return self;
  };

  // Create a function bound to a given object (assigning `this`, and arguments,
  // optionally). Delegates to **ECMAScript 5**'s native `Function.bind` if
  // available.
  _.bind = function(func, context) {
    if (nativeBind && func.bind === nativeBind) return nativeBind.apply(func, slice.call(arguments, 1));
    if (!_.isFunction(func)) throw new TypeError('Bind must be called on a function');
    var args = slice.call(arguments, 2);
    var bound = function() {
      return executeBound(func, bound, context, this, args.concat(slice.call(arguments)));
    };
    return bound;
  };

  // Partially apply a function by creating a version that has had some of its
  // arguments pre-filled, without changing its dynamic `this` context. _ acts
  // as a placeholder, allowing any combination of arguments to be pre-filled.
  _.partial = function(func) {
    var boundArgs = slice.call(arguments, 1);
    var bound = function() {
      var position = 0, length = boundArgs.length;
      var args = Array(length);
      for (var i = 0; i < length; i++) {
        args[i] = boundArgs[i] === _ ? arguments[position++] : boundArgs[i];
      }
      while (position < arguments.length) args.push(arguments[position++]);
      return executeBound(func, bound, this, this, args);
    };
    return bound;
  };

  // Bind a number of an object's methods to that object. Remaining arguments
  // are the method names to be bound. Useful for ensuring that all callbacks
  // defined on an object belong to it.
  _.bindAll = function(obj) {
    var i, length = arguments.length, key;
    if (length <= 1) throw new Error('bindAll must be passed function names');
    for (i = 1; i < length; i++) {
      key = arguments[i];
      obj[key] = _.bind(obj[key], obj);
    }
    return obj;
  };

  // Memoize an expensive function by storing its results.
  _.memoize = function(func, hasher) {
    var memoize = function(key) {
      var cache = memoize.cache;
      var address = '' + (hasher ? hasher.apply(this, arguments) : key);
      if (!_.has(cache, address)) cache[address] = func.apply(this, arguments);
      return cache[address];
    };
    memoize.cache = {};
    return memoize;
  };

  // Delays a function for the given number of milliseconds, and then calls
  // it with the arguments supplied.
  _.delay = function(func, wait) {
    var args = slice.call(arguments, 2);
    return setTimeout(function(){
      return func.apply(null, args);
    }, wait);
  };

  // Defers a function, scheduling it to run after the current call stack has
  // cleared.
  _.defer = _.partial(_.delay, _, 1);

  // Returns a function, that, when invoked, will only be triggered at most once
  // during a given window of time. Normally, the throttled function will run
  // as much as it can, without ever going more than once per `wait` duration;
  // but if you'd like to disable the execution on the leading edge, pass
  // `{leading: false}`. To disable execution on the trailing edge, ditto.
  _.throttle = function(func, wait, options) {
    var context, args, result;
    var timeout = null;
    var previous = 0;
    if (!options) options = {};
    var later = function() {
      previous = options.leading === false ? 0 : _.now();
      timeout = null;
      result = func.apply(context, args);
      if (!timeout) context = args = null;
    };
    return function() {
      var now = _.now();
      if (!previous && options.leading === false) previous = now;
      var remaining = wait - (now - previous);
      context = this;
      args = arguments;
      if (remaining <= 0 || remaining > wait) {
        if (timeout) {
          clearTimeout(timeout);
          timeout = null;
        }
        previous = now;
        result = func.apply(context, args);
        if (!timeout) context = args = null;
      } else if (!timeout && options.trailing !== false) {
        timeout = setTimeout(later, remaining);
      }
      return result;
    };
  };

  // Returns a function, that, as long as it continues to be invoked, will not
  // be triggered. The function will be called after it stops being called for
  // N milliseconds. If `immediate` is passed, trigger the function on the
  // leading edge, instead of the trailing.
  _.debounce = function(func, wait, immediate) {
    var timeout, args, context, timestamp, result;

    var later = function() {
      var last = _.now() - timestamp;

      if (last < wait && last >= 0) {
        timeout = setTimeout(later, wait - last);
      } else {
        timeout = null;
        if (!immediate) {
          result = func.apply(context, args);
          if (!timeout) context = args = null;
        }
      }
    };

    return function() {
      context = this;
      args = arguments;
      timestamp = _.now();
      var callNow = immediate && !timeout;
      if (!timeout) timeout = setTimeout(later, wait);
      if (callNow) {
        result = func.apply(context, args);
        context = args = null;
      }

      return result;
    };
  };

  // Returns the first function passed as an argument to the second,
  // allowing you to adjust arguments, run code before and after, and
  // conditionally execute the original function.
  _.wrap = function(func, wrapper) {
    return _.partial(wrapper, func);
  };

  // Returns a negated version of the passed-in predicate.
  _.negate = function(predicate) {
    return function() {
      return !predicate.apply(this, arguments);
    };
  };

  // Returns a function that is the composition of a list of functions, each
  // consuming the return value of the function that follows.
  _.compose = function() {
    var args = arguments;
    var start = args.length - 1;
    return function() {
      var i = start;
      var result = args[start].apply(this, arguments);
      while (i--) result = args[i].call(this, result);
      return result;
    };
  };

  // Returns a function that will only be executed on and after the Nth call.
  _.after = function(times, func) {
    return function() {
      if (--times < 1) {
        return func.apply(this, arguments);
      }
    };
  };

  // Returns a function that will only be executed up to (but not including) the Nth call.
  _.before = function(times, func) {
    var memo;
    return function() {
      if (--times > 0) {
        memo = func.apply(this, arguments);
      }
      if (times <= 1) func = null;
      return memo;
    };
  };

  // Returns a function that will be executed at most one time, no matter how
  // often you call it. Useful for lazy initialization.
  _.once = _.partial(_.before, 2);

  // Object Functions
  // ----------------

  // Keys in IE < 9 that won't be iterated by `for key in ...` and thus missed.
  var hasEnumBug = !{toString: null}.propertyIsEnumerable('toString');
  var nonEnumerableProps = ['valueOf', 'isPrototypeOf', 'toString',
                      'propertyIsEnumerable', 'hasOwnProperty', 'toLocaleString'];

  function collectNonEnumProps(obj, keys) {
    var nonEnumIdx = nonEnumerableProps.length;
    var constructor = obj.constructor;
    var proto = (_.isFunction(constructor) && constructor.prototype) || ObjProto;

    // Constructor is a special case.
    var prop = 'constructor';
    if (_.has(obj, prop) && !_.contains(keys, prop)) keys.push(prop);

    while (nonEnumIdx--) {
      prop = nonEnumerableProps[nonEnumIdx];
      if (prop in obj && obj[prop] !== proto[prop] && !_.contains(keys, prop)) {
        keys.push(prop);
      }
    }
  }

  // Retrieve the names of an object's own properties.
  // Delegates to **ECMAScript 5**'s native `Object.keys`
  _.keys = function(obj) {
    if (!_.isObject(obj)) return [];
    if (nativeKeys) return nativeKeys(obj);
    var keys = [];
    for (var key in obj) if (_.has(obj, key)) keys.push(key);
    // Ahem, IE < 9.
    if (hasEnumBug) collectNonEnumProps(obj, keys);
    return keys;
  };

  // Retrieve all the property names of an object.
  _.allKeys = function(obj) {
    if (!_.isObject(obj)) return [];
    var keys = [];
    for (var key in obj) keys.push(key);
    // Ahem, IE < 9.
    if (hasEnumBug) collectNonEnumProps(obj, keys);
    return keys;
  };

  // Retrieve the values of an object's properties.
  _.values = function(obj) {
    var keys = _.keys(obj);
    var length = keys.length;
    var values = Array(length);
    for (var i = 0; i < length; i++) {
      values[i] = obj[keys[i]];
    }
    return values;
  };

  // Returns the results of applying the iteratee to each element of the object
  // In contrast to _.map it returns an object
  _.mapObject = function(obj, iteratee, context) {
    iteratee = cb(iteratee, context);
    var keys =  _.keys(obj),
          length = keys.length,
          results = {},
          currentKey;
      for (var index = 0; index < length; index++) {
        currentKey = keys[index];
        results[currentKey] = iteratee(obj[currentKey], currentKey, obj);
      }
      return results;
  };

  // Convert an object into a list of `[key, value]` pairs.
  _.pairs = function(obj) {
    var keys = _.keys(obj);
    var length = keys.length;
    var pairs = Array(length);
    for (var i = 0; i < length; i++) {
      pairs[i] = [keys[i], obj[keys[i]]];
    }
    return pairs;
  };

  // Invert the keys and values of an object. The values must be serializable.
  _.invert = function(obj) {
    var result = {};
    var keys = _.keys(obj);
    for (var i = 0, length = keys.length; i < length; i++) {
      result[obj[keys[i]]] = keys[i];
    }
    return result;
  };

  // Return a sorted list of the function names available on the object.
  // Aliased as `methods`
  _.functions = _.methods = function(obj) {
    var names = [];
    for (var key in obj) {
      if (_.isFunction(obj[key])) names.push(key);
    }
    return names.sort();
  };

  // Extend a given object with all the properties in passed-in object(s).
  _.extend = createAssigner(_.allKeys);

  // Assigns a given object with all the own properties in the passed-in object(s)
  // (https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Object/assign)
  _.extendOwn = _.assign = createAssigner(_.keys);

  // Returns the first key on an object that passes a predicate test
  _.findKey = function(obj, predicate, context) {
    predicate = cb(predicate, context);
    var keys = _.keys(obj), key;
    for (var i = 0, length = keys.length; i < length; i++) {
      key = keys[i];
      if (predicate(obj[key], key, obj)) return key;
    }
  };

  // Return a copy of the object only containing the whitelisted properties.
  _.pick = function(object, oiteratee, context) {
    var result = {}, obj = object, iteratee, keys;
    if (obj == null) return result;
    if (_.isFunction(oiteratee)) {
      keys = _.allKeys(obj);
      iteratee = optimizeCb(oiteratee, context);
    } else {
      keys = flatten(arguments, false, false, 1);
      iteratee = function(value, key, obj) { return key in obj; };
      obj = Object(obj);
    }
    for (var i = 0, length = keys.length; i < length; i++) {
      var key = keys[i];
      var value = obj[key];
      if (iteratee(value, key, obj)) result[key] = value;
    }
    return result;
  };

   // Return a copy of the object without the blacklisted properties.
  _.omit = function(obj, iteratee, context) {
    if (_.isFunction(iteratee)) {
      iteratee = _.negate(iteratee);
    } else {
      var keys = _.map(flatten(arguments, false, false, 1), String);
      iteratee = function(value, key) {
        return !_.contains(keys, key);
      };
    }
    return _.pick(obj, iteratee, context);
  };

  // Fill in a given object with default properties.
  _.defaults = createAssigner(_.allKeys, true);

  // Create a (shallow-cloned) duplicate of an object.
  _.clone = function(obj) {
    if (!_.isObject(obj)) return obj;
    return _.isArray(obj) ? obj.slice() : _.extend({}, obj);
  };

  // Invokes interceptor with the obj, and then returns obj.
  // The primary purpose of this method is to "tap into" a method chain, in
  // order to perform operations on intermediate results within the chain.
  _.tap = function(obj, interceptor) {
    interceptor(obj);
    return obj;
  };

  // Returns whether an object has a given set of `key:value` pairs.
  _.isMatch = function(object, attrs) {
    var keys = _.keys(attrs), length = keys.length;
    if (object == null) return !length;
    var obj = Object(object);
    for (var i = 0; i < length; i++) {
      var key = keys[i];
      if (attrs[key] !== obj[key] || !(key in obj)) return false;
    }
    return true;
  };


  // Internal recursive comparison function for `isEqual`.
  var eq = function(a, b, aStack, bStack) {
    // Identical objects are equal. `0 === -0`, but they aren't identical.
    // See the [Harmony `egal` proposal](http://wiki.ecmascript.org/doku.php?id=harmony:egal).
    if (a === b) return a !== 0 || 1 / a === 1 / b;
    // A strict comparison is necessary because `null == undefined`.
    if (a == null || b == null) return a === b;
    // Unwrap any wrapped objects.
    if (a instanceof _) a = a._wrapped;
    if (b instanceof _) b = b._wrapped;
    // Compare `[[Class]]` names.
    var className = toString.call(a);
    if (className !== toString.call(b)) return false;
    switch (className) {
      // Strings, numbers, regular expressions, dates, and booleans are compared by value.
      case '[object RegExp]':
      // RegExps are coerced to strings for comparison (Note: '' + /a/i === '/a/i')
      case '[object String]':
        // Primitives and their corresponding object wrappers are equivalent; thus, `"5"` is
        // equivalent to `new String("5")`.
        return '' + a === '' + b;
      case '[object Number]':
        // `NaN`s are equivalent, but non-reflexive.
        // Object(NaN) is equivalent to NaN
        if (+a !== +a) return +b !== +b;
        // An `egal` comparison is performed for other numeric values.
        return +a === 0 ? 1 / +a === 1 / b : +a === +b;
      case '[object Date]':
      case '[object Boolean]':
        // Coerce dates and booleans to numeric primitive values. Dates are compared by their
        // millisecond representations. Note that invalid dates with millisecond representations
        // of `NaN` are not equivalent.
        return +a === +b;
    }

    var areArrays = className === '[object Array]';
    if (!areArrays) {
      if (typeof a != 'object' || typeof b != 'object') return false;

      // Objects with different constructors are not equivalent, but `Object`s or `Array`s
      // from different frames are.
      var aCtor = a.constructor, bCtor = b.constructor;
      if (aCtor !== bCtor && !(_.isFunction(aCtor) && aCtor instanceof aCtor &&
                               _.isFunction(bCtor) && bCtor instanceof bCtor)
                          && ('constructor' in a && 'constructor' in b)) {
        return false;
      }
    }
    // Assume equality for cyclic structures. The algorithm for detecting cyclic
    // structures is adapted from ES 5.1 section 15.12.3, abstract operation `JO`.
    
    // Initializing stack of traversed objects.
    // It's done here since we only need them for objects and arrays comparison.
    aStack = aStack || [];
    bStack = bStack || [];
    var length = aStack.length;
    while (length--) {
      // Linear search. Performance is inversely proportional to the number of
      // unique nested structures.
      if (aStack[length] === a) return bStack[length] === b;
    }

    // Add the first object to the stack of traversed objects.
    aStack.push(a);
    bStack.push(b);

    // Recursively compare objects and arrays.
    if (areArrays) {
      // Compare array lengths to determine if a deep comparison is necessary.
      length = a.length;
      if (length !== b.length) return false;
      // Deep compare the contents, ignoring non-numeric properties.
      while (length--) {
        if (!eq(a[length], b[length], aStack, bStack)) return false;
      }
    } else {
      // Deep compare objects.
      var keys = _.keys(a), key;
      length = keys.length;
      // Ensure that both objects contain the same number of properties before comparing deep equality.
      if (_.keys(b).length !== length) return false;
      while (length--) {
        // Deep compare each member
        key = keys[length];
        if (!(_.has(b, key) && eq(a[key], b[key], aStack, bStack))) return false;
      }
    }
    // Remove the first object from the stack of traversed objects.
    aStack.pop();
    bStack.pop();
    return true;
  };

  // Perform a deep comparison to check if two objects are equal.
  _.isEqual = function(a, b) {
    return eq(a, b);
  };

  // Is a given array, string, or object empty?
  // An "empty" object has no enumerable own-properties.
  _.isEmpty = function(obj) {
    if (obj == null) return true;
    if (isArrayLike(obj) && (_.isArray(obj) || _.isString(obj) || _.isArguments(obj))) return obj.length === 0;
    return _.keys(obj).length === 0;
  };

  // Is a given value a DOM element?
  _.isElement = function(obj) {
    return !!(obj && obj.nodeType === 1);
  };

  // Is a given value an array?
  // Delegates to ECMA5's native Array.isArray
  _.isArray = nativeIsArray || function(obj) {
    return toString.call(obj) === '[object Array]';
  };

  // Is a given variable an object?
  _.isObject = function(obj) {
    var type = typeof obj;
    return type === 'function' || type === 'object' && !!obj;
  };

  // Add some isType methods: isArguments, isFunction, isString, isNumber, isDate, isRegExp, isError.
  _.each(['Arguments', 'Function', 'String', 'Number', 'Date', 'RegExp', 'Error'], function(name) {
    _['is' + name] = function(obj) {
      return toString.call(obj) === '[object ' + name + ']';
    };
  });

  // Define a fallback version of the method in browsers (ahem, IE < 9), where
  // there isn't any inspectable "Arguments" type.
  if (!_.isArguments(arguments)) {
    _.isArguments = function(obj) {
      return _.has(obj, 'callee');
    };
  }

  // Optimize `isFunction` if appropriate. Work around some typeof bugs in old v8,
  // IE 11 (#1621), and in Safari 8 (#1929).
  if (typeof /./ != 'function' && typeof Int8Array != 'object') {
    _.isFunction = function(obj) {
      return typeof obj == 'function' || false;
    };
  }

  // Is a given object a finite number?
  _.isFinite = function(obj) {
    return isFinite(obj) && !isNaN(parseFloat(obj));
  };

  // Is the given value `NaN`? (NaN is the only number which does not equal itself).
  _.isNaN = function(obj) {
    return _.isNumber(obj) && obj !== +obj;
  };

  // Is a given value a boolean?
  _.isBoolean = function(obj) {
    return obj === true || obj === false || toString.call(obj) === '[object Boolean]';
  };

  // Is a given value equal to null?
  _.isNull = function(obj) {
    return obj === null;
  };

  // Is a given variable undefined?
  _.isUndefined = function(obj) {
    return obj === void 0;
  };

  // Shortcut function for checking if an object has a given property directly
  // on itself (in other words, not on a prototype).
  _.has = function(obj, key) {
    return obj != null && hasOwnProperty.call(obj, key);
  };

  // Utility Functions
  // -----------------

  // Run Underscore.js in *noConflict* mode, returning the `_` variable to its
  // previous owner. Returns a reference to the Underscore object.
  _.noConflict = function() {
    root._ = previousUnderscore;
    return this;
  };

  // Keep the identity function around for default iteratees.
  _.identity = function(value) {
    return value;
  };

  // Predicate-generating functions. Often useful outside of Underscore.
  _.constant = function(value) {
    return function() {
      return value;
    };
  };

  _.noop = function(){};

  _.property = function(key) {
    return function(obj) {
      return obj == null ? void 0 : obj[key];
    };
  };

  // Generates a function for a given object that returns a given property.
  _.propertyOf = function(obj) {
    return obj == null ? function(){} : function(key) {
      return obj[key];
    };
  };

  // Returns a predicate for checking whether an object has a given set of 
  // `key:value` pairs.
  _.matcher = _.matches = function(attrs) {
    attrs = _.extendOwn({}, attrs);
    return function(obj) {
      return _.isMatch(obj, attrs);
    };
  };

  // Run a function **n** times.
  _.times = function(n, iteratee, context) {
    var accum = Array(Math.max(0, n));
    iteratee = optimizeCb(iteratee, context, 1);
    for (var i = 0; i < n; i++) accum[i] = iteratee(i);
    return accum;
  };

  // Return a random integer between min and max (inclusive).
  _.random = function(min, max) {
    if (max == null) {
      max = min;
      min = 0;
    }
    return min + Math.floor(Math.random() * (max - min + 1));
  };

  // A (possibly faster) way to get the current timestamp as an integer.
  _.now = Date.now || function() {
    return new Date().getTime();
  };

   // List of HTML entities for escaping.
  var escapeMap = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#x27;',
    '`': '&#x60;'
  };
  var unescapeMap = _.invert(escapeMap);

  // Functions for escaping and unescaping strings to/from HTML interpolation.
  var createEscaper = function(map) {
    var escaper = function(match) {
      return map[match];
    };
    // Regexes for identifying a key that needs to be escaped
    var source = '(?:' + _.keys(map).join('|') + ')';
    var testRegexp = RegExp(source);
    var replaceRegexp = RegExp(source, 'g');
    return function(string) {
      string = string == null ? '' : '' + string;
      return testRegexp.test(string) ? string.replace(replaceRegexp, escaper) : string;
    };
  };
  _.escape = createEscaper(escapeMap);
  _.unescape = createEscaper(unescapeMap);

  // If the value of the named `property` is a function then invoke it with the
  // `object` as context; otherwise, return it.
  _.result = function(object, property, fallback) {
    var value = object == null ? void 0 : object[property];
    if (value === void 0) {
      value = fallback;
    }
    return _.isFunction(value) ? value.call(object) : value;
  };

  // Generate a unique integer id (unique within the entire client session).
  // Useful for temporary DOM ids.
  var idCounter = 0;
  _.uniqueId = function(prefix) {
    var id = ++idCounter + '';
    return prefix ? prefix + id : id;
  };

  // By default, Underscore uses ERB-style template delimiters, change the
  // following template settings to use alternative delimiters.
  _.templateSettings = {
    evaluate    : /<%([\s\S]+?)%>/g,
    interpolate : /<%=([\s\S]+?)%>/g,
    escape      : /<%-([\s\S]+?)%>/g
  };

  // When customizing `templateSettings`, if you don't want to define an
  // interpolation, evaluation or escaping regex, we need one that is
  // guaranteed not to match.
  var noMatch = /(.)^/;

  // Certain characters need to be escaped so that they can be put into a
  // string literal.
  var escapes = {
    "'":      "'",
    '\\':     '\\',
    '\r':     'r',
    '\n':     'n',
    '\u2028': 'u2028',
    '\u2029': 'u2029'
  };

  var escaper = /\\|'|\r|\n|\u2028|\u2029/g;

  var escapeChar = function(match) {
    return '\\' + escapes[match];
  };

  // JavaScript micro-templating, similar to John Resig's implementation.
  // Underscore templating handles arbitrary delimiters, preserves whitespace,
  // and correctly escapes quotes within interpolated code.
  // NB: `oldSettings` only exists for backwards compatibility.
  _.template = function(text, settings, oldSettings) {
    if (!settings && oldSettings) settings = oldSettings;
    settings = _.defaults({}, settings, _.templateSettings);

    // Combine delimiters into one regular expression via alternation.
    var matcher = RegExp([
      (settings.escape || noMatch).source,
      (settings.interpolate || noMatch).source,
      (settings.evaluate || noMatch).source
    ].join('|') + '|$', 'g');

    // Compile the template source, escaping string literals appropriately.
    var index = 0;
    var source = "__p+='";
    text.replace(matcher, function(match, escape, interpolate, evaluate, offset) {
      source += text.slice(index, offset).replace(escaper, escapeChar);
      index = offset + match.length;

      if (escape) {
        source += "'+\n((__t=(" + escape + "))==null?'':_.escape(__t))+\n'";
      } else if (interpolate) {
        source += "'+\n((__t=(" + interpolate + "))==null?'':__t)+\n'";
      } else if (evaluate) {
        source += "';\n" + evaluate + "\n__p+='";
      }

      // Adobe VMs need the match returned to produce the correct offest.
      return match;
    });
    source += "';\n";

    // If a variable is not specified, place data values in local scope.
    if (!settings.variable) source = 'with(obj||{}){\n' + source + '}\n';

    source = "var __t,__p='',__j=Array.prototype.join," +
      "print=function(){__p+=__j.call(arguments,'');};\n" +
      source + 'return __p;\n';

    try {
      var render = new Function(settings.variable || 'obj', '_', source);
    } catch (e) {
      e.source = source;
      throw e;
    }

    var template = function(data) {
      return render.call(this, data, _);
    };

    // Provide the compiled source as a convenience for precompilation.
    var argument = settings.variable || 'obj';
    template.source = 'function(' + argument + '){\n' + source + '}';

    return template;
  };

  // Add a "chain" function. Start chaining a wrapped Underscore object.
  _.chain = function(obj) {
    var instance = _(obj);
    instance._chain = true;
    return instance;
  };

  // OOP
  // ---------------
  // If Underscore is called as a function, it returns a wrapped object that
  // can be used OO-style. This wrapper holds altered versions of all the
  // underscore functions. Wrapped objects may be chained.

  // Helper function to continue chaining intermediate results.
  var result = function(instance, obj) {
    return instance._chain ? _(obj).chain() : obj;
  };

  // Add your own custom functions to the Underscore object.
  _.mixin = function(obj) {
    _.each(_.functions(obj), function(name) {
      var func = _[name] = obj[name];
      _.prototype[name] = function() {
        var args = [this._wrapped];
        push.apply(args, arguments);
        return result(this, func.apply(_, args));
      };
    });
  };

  // Add all of the Underscore functions to the wrapper object.
  _.mixin(_);

  // Add all mutator Array functions to the wrapper.
  _.each(['pop', 'push', 'reverse', 'shift', 'sort', 'splice', 'unshift'], function(name) {
    var method = ArrayProto[name];
    _.prototype[name] = function() {
      var obj = this._wrapped;
      method.apply(obj, arguments);
      if ((name === 'shift' || name === 'splice') && obj.length === 0) delete obj[0];
      return result(this, obj);
    };
  });

  // Add all accessor Array functions to the wrapper.
  _.each(['concat', 'join', 'slice'], function(name) {
    var method = ArrayProto[name];
    _.prototype[name] = function() {
      return result(this, method.apply(this._wrapped, arguments));
    };
  });

  // Extracts the result from a wrapped and chained object.
  _.prototype.value = function() {
    return this._wrapped;
  };

  // Provide unwrapping proxy for some methods used in engine operations
  // such as arithmetic and JSON stringification.
  _.prototype.valueOf = _.prototype.toJSON = _.prototype.value;
  
  _.prototype.toString = function() {
    return '' + this._wrapped;
  };

  // AMD registration happens at the end for compatibility with AMD loaders
  // that may not enforce next-turn semantics on modules. Even though general
  // practice for AMD registration is to be anonymous, underscore registers
  // as a named module because, like jQuery, it is a base library that is
  // popular enough to be bundled in a third party lib, but not be part of
  // an AMD load request. Those cases could generate an error when an
  // anonymous define() is called outside of a loader request.
  if (typeof define === 'function' && define.amd) {
    define('underscore', [], function() {
      return _;
    });
  }
}.call(this));

},{}],51:[function(require,module,exports){
var buildPromise = require('./utils').buildPromise;
var EverliveError = require('./EverliveError').EverliveError;
var Platform = require('./constants').Platform;

module.exports = (function () {
    /**
     * @class CurrentDevice
     * @deprecated
     * @protected
     * @param pushHandler
     * @constructor
     */
    var CurrentDevice = function (pushHandler) {
        this._pushHandler = pushHandler;
        this._initSuccessCallback = null;
        this._initErrorCallback = null;

        //Suffix for the global callback functions
        this._globalFunctionSuffix = null;

        this.pushSettings = null;
        this.pushToken = null;
        this.isInitialized = false;
        this.isInitializing = false;

        this.emulatorMode = false;
    };

    CurrentDevice.prototype = {

        /**
         * Initializes the current device for push notifications. This method requests a push token from the device vendor and enables the push notification functionality on the device. Once this is done, you can register the device in {{site.TelerikBackendServices}} using the register() method.
         * @method enableNotifications
         * @name enableNotifications
         * @memberOf CurrentDevice.prototype
         * @param {PushSettings} pushSettings An object specifying various settings for the initialization.
         * @returns {Object} The promise for the request.
         */
        /**
         * Initializes the current device for push notifications. This method requests a push token from the device vendor and enables the push notification functionality on the device. Once this is done, you can register the device in Everlive using the register() method.
         * @method enableNotifications
         * @name enableNotifications
         * @memberOf CurrentDevice.prototype
         * @param {PushSettings} pushSettings An object specifying various settings for the initialization.
         * @param {Function} [success] Callback to invoke on success.
         * @param {Function} [error] Callback to invoke on error.
         */
        enableNotifications: function (pushSettings, success, error) {
            this.pushSettings = this._cleanPlatformsPushSettings(pushSettings);

            return buildPromise(_.bind(this._initialize, this), success, error);
        },

        /**
         * Disables push notifications for the current device. This method invalidates any push tokens that were obtained for the device from the current application.
         * @method disableNotifications
         * @name disableNotifications
         * @memberOf CurrentDevice.prototype
         * @returns {Object} The promise for the request.
         */
        /**
         * Disables push notifications for the current device. This method invalidates any push tokens that were obtained for the device from the current application.
         * @method disableNotifications
         * @name disableNotifications
         * @memberOf CurrentDevice.prototype
         * @param {Function} [success] Callback to invoke on success.
         * @param {Function} [error] Callback to invoke on error.
         */
        disableNotifications: function (success, error) {
            var self = this;

            return this.unregister().then(
                function () {
                    return buildPromise(
                        function (success, error) {
                            if (self.emulatorMode) {
                                success();
                            } else {
                                var pushNotification = window.plugins.pushNotification;
                                var unregisterOptions;
                                var platformType = self._getPlatformType(device.platform);
                                if (platformType === Platform.WindowsPhone) {
                                    unregisterOptions = {'channelName': self.pushSettings.wp8.channelName};
                                }
                                pushNotification.unregister(
                                    function () {
                                        self.isInitialized = false;
                                        success();
                                    },
                                    error,
                                    unregisterOptions
                                );
                            }
                        },
                        success,
                        error
                    );
                },
                error
            );
        },

        /**
         * Returns the push registration for the current device.
         * @memberOf CurrentDevice.prototype
         * @method getRegistration
         * @name getRegistration
         * @returns {Object} The promise for the request.
         */
        /**
         * Returns the push registration for the current device.
         * @memberOf CurrentDevice.prototype
         * @method getRegistration
         * @name getRegistration
         * @param {Function} success Callback to invoke on success.
         * @param {Function} error Callback to invoke on error.
         */
        getRegistration: function (success, error) {
            var deviceId = encodeURIComponent(this._getDeviceId());
            return this._pushHandler.devices.getById('HardwareId/' + deviceId, success, error);
        },

        /**
         * Registers the current device for push notifications in {{site.TelerikBackendServices}}. This method can be called only after [enableNotifications()](#CurrentDevice.enableNotifications) has completed successfully.
         * @memberOf CurrentDevice.prototype
         * @method register
         * @name register
         * @param {Object} customParameters Custom parameters for the registration.
         * @returns {Object} The promise for the request.
         */
        /**
         * Registers the current device for push notifications in {{site.TelerikBackendServices}}. This method can be called only after [enableNotifications()](#CurrentDevice.enableNotifications) has completed successfully.
         * @memberOf CurrentDevice.prototype
         * @method register
         * @name register
         * @param {Object} customParameters Custom parameters for the registration.
         * @param {Function} [success] Callback to invoke on success.
         * @param {Function} [error] Callback to invoke on error.
         */
        register: function (customParameters, success, error) {
            var self = this;

            var deviceRegistration = {};
            if (customParameters !== undefined) {
                deviceRegistration.Parameters = customParameters;
            }

            return this._populateRegistrationObject(deviceRegistration).then(
                function () {
                    return self._pushHandler.devices.create(deviceRegistration, success, error);
                },
                error
            );
        },

        /**
         * Unregisters the current device from push notifications in {{site.TelerikBackendServices}}. After this call completes successfully, {{site.bs}} will no longer send notifications to this device. Note that this does not prevent the device from receiving notifications and does not invalidate push tokens.
         * @memberOf CurrentDevice.prototype
         * @method unregister
         * @name unregister
         * @returns {Object} The promise for the request.
         */
        /**
         * Unregisters the current device from push notifications in {{site.TelerikBackendServices}}. After this call completes successfully, {{site.bs}} will no longer send notifications to this device. Note that this does not prevent the device from receiving notifications and does not invalidate push tokens.
         * @memberOf CurrentDevice.prototype
         * @method unregister
         * @name unregister
         * @param {Function} [success] Callback to invoke on success.
         * @param {Function} [error] Callback to invoke on error.
         */
        unregister: function (success, error) {
            var deviceId = encodeURIComponent(device.uuid);
            return this._pushHandler.devices.destroySingle({Id: 'HardwareId/' + deviceId}, success, error);
        },

        /**
         * Updates the registration of the current device.
         * @memberOf CurrentDevice.prototype
         * @method updateRegistration
         * @name updateRegistration
         * @param {Object} customParameters Custom parameters for the registration. If undefined, customParameters are not updated.
         * @returns {Object} The promise for the request.
         */
        /**
         * Updates the registration for the current device.
         * @memberOf CurrentDevice.prototype
         * @method updateRegistration
         * @name updateRegistration
         * @param {Object} customParameters Custom parameters for the registration. If undefined, customParameters are not updated.
         * @param {Function} [success] Callback to invoke on success.
         * @param {Function} [error] Callback to invoke on error.
         */
        updateRegistration: function (customParameters, success, error) {
            var self = this;

            var deviceRegistration = {};
            if (customParameters !== undefined) {
                deviceRegistration.Parameters = customParameters;
            }

            return this._populateRegistrationObject(deviceRegistration).then(
                function () {
                    deviceRegistration.Id = 'HardwareId/' + encodeURIComponent(deviceRegistration.HardwareId);
                    return self._pushHandler.devices.updateSingle(deviceRegistration, success, error);
                },
                error
            );
        },

        _initializeInteractivePush: function (iOSSettings, success, error) {
            var pushPlugin = window.plugins.pushNotification;

            var interactiveSettings = iOSSettings.interactiveSettings;
            var notificationTypes = [];
            if (iOSSettings.alert) {
                notificationTypes.push(pushPlugin.UserNotificationTypes.Alert);
            }
            if (iOSSettings.badge) {
                notificationTypes.push(pushPlugin.UserNotificationTypes.Badge);
            }
            if (iOSSettings.sound) {
                notificationTypes.push(pushPlugin.UserNotificationTypes.Sound);
            }

            var getAction = function (actionIdentifier) {
                var action = _.find(interactiveSettings.actions, function (action) {
                    return action.identifier === actionIdentifier;
                });

                return action;
            };
            var categories = _.map(interactiveSettings.categories, function (category) {
                return {
                    identifier: category.identifier,
                    actionsForDefaultContext: _.map(category.actionsForDefaultContext, getAction),
                    actionsForMinimalContext: _.map(category.actionsForMinimalContext, getAction)
                }
            });

            pushPlugin.registerUserNotificationSettings(
                // the success callback which will immediately return (APNs is not contacted for this)
                success,
                // called in case the configuration is incorrect
                error, {
                    // asking permission for these features
                    types: notificationTypes,
                    // register these categories
                    categories: categories
                }
            );
        },

        //Initializes the push functionality on the device.
        _initialize: function (success, error) {
            var self = this;

            if (this.isInitializing) {
                error(new EverliveError('Push notifications are currently initializing.'));
                return;
            }

            if (!this.emulatorMode && (!window.navigator || !window.navigator.globalization)) {
                error(new EverliveError('The globalization plugin is not initialized.'));
                return;
            }

            if (!this.emulatorMode && (!window.plugins || !window.plugins.pushNotification)) {
                error(new EverliveError('The push notifications plugin is not initialized.'));
                return;
            }

            this._initSuccessCallback = success;
            this._initErrorCallback = error;

            if (this.isInitialized) {
                this._deviceRegistrationSuccess(this.pushToken);
                return;
            }

            if (this.emulatorMode) {
                setTimeout(
                    function () {
                        self._deviceRegistrationSuccess('fake_push_token');
                    },
                    1000
                );
                return;
            }

            this.isInitializing = true;

            var suffix = this._globalFunctionSuffix;
            if (!suffix) {
                suffix = Date.now().toString();
                this._globalFunctionSuffix = suffix;
            }

            var pushNotification = window.plugins.pushNotification;

            var platformType = this._getPlatformType(device.platform);
            if (platformType === Platform.iOS) {
                //Initialize global APN callback
                var apnCallbackName = 'apnCallback_' + suffix;
                Everlive.PushCallbacks[apnCallbackName] = _.bind(this._onNotificationAPN, this);

                //Construct registration options object and validate iOS settings
                var apnRegistrationOptions = this.pushSettings.iOS;
                this._validateIOSSettings(apnRegistrationOptions);
                apnRegistrationOptions.ecb = 'Everlive.PushCallbacks.' + apnCallbackName;

                //Register for APN
                pushNotification.register(
                    _.bind(this._successfulRegistrationAPN, this),
                    _.bind(this._failedRegistrationAPN, this),
                    apnRegistrationOptions
                );
            } else if (platformType === Platform.Android) {
                //Initialize global GCM callback
                var gcmCallbackName = 'gcmCallback_' + suffix;
                Everlive.PushCallbacks[gcmCallbackName] = _.bind(this._onNotificationGCM, this);

                //Construct registration options object and validate the Android settings
                var gcmRegistrationOptions = this.pushSettings.android;
                this._validateAndroidSettings(gcmRegistrationOptions);
                gcmRegistrationOptions.ecb = 'Everlive.PushCallbacks.' + gcmCallbackName;

                //Register for GCM
                pushNotification.register(
                    _.bind(this._successSentRegistrationGCM, this),
                    _.bind(this._errorSentRegistrationGCM, this),
                    gcmRegistrationOptions
                );
            } else if (platformType === Platform.WindowsPhone) {
                //Initialize global WP8 callbacks.
                var wp8CallbackName = 'wp8Callback_' + suffix;
                var wp8RegistrationSuccessCallbackName = 'wp8RegistrationSuccessCallback_' + suffix;
                var wp8RegistrationErrorCallbackName = 'wp8RegistrationErrorCallback_' + suffix;

                Everlive.PushCallbacks[wp8CallbackName] = _.bind(this._onNotificationWP8, this);
                Everlive.PushCallbacks[wp8RegistrationSuccessCallbackName] = _.bind(this._deviceRegistrationSuccessWP, this);
                Everlive.PushCallbacks[wp8RegistrationErrorCallbackName] = _.bind(this._deviceRegistrationFailed, this);

                //Construct registration options object and validate the WP8  settings
                var wp8RegistrationOptions = this.pushSettings.wp8;
                this._validateWP8Settings(wp8RegistrationOptions);
                wp8RegistrationOptions.ecb = 'Everlive.PushCallbacks.' + wp8CallbackName;
                wp8RegistrationOptions.uccb = 'Everlive.PushCallbacks.' + wp8RegistrationSuccessCallbackName;
                wp8RegistrationOptions.errcb = 'Everlive.PushCallbacks.' + wp8RegistrationErrorCallbackName;


                pushNotification.register(
                    _.bind(this._successSentRegistrationWP8, this),
                    _.bind(this._errorSentRegistrationWP8, this),
                    wp8RegistrationOptions
                );

            } else {
                throw new EverliveError('The current platform is not supported: ' + device.platform);
            }
        },

        _deviceRegistrationSuccessWP: function (result) {
            this._deviceRegistrationSuccess(result.uri);
        },

        _validateAndroidSettings: function (androidSettings) {
            if (!androidSettings.senderID) {
                throw new EverliveError('Sender ID (project number) is not set in the android settings.');
            }
        },
        _validateWP8Settings: function (settings) {
            if (!settings.channelName) {
                throw new EverliveError('channelName is not set in the WP8 settings.');
            }
        },

        _validateIOSSettings: function (iOSSettings) {

        },

        _cleanPlatformsPushSettings: function (pushSettings) {
            var cleanSettings = {};
            pushSettings = pushSettings || {};

            var addSettingsForPlatform = function addSettingsForPlatform(newSettingsObject, platform, allowedFields) {
                if (!pushSettings[platform]) {
                    return;
                }

                newSettingsObject[platform] = newSettingsObject[platform] || {};
                var newPlatformSettings = pushSettings[platform];
                var settings = newSettingsObject[platform];
                _.each(allowedFields, function (allowedField) {
                    if (newPlatformSettings.hasOwnProperty(allowedField)) {
                        settings[allowedField] = newPlatformSettings[allowedField];
                    }
                });
            };

            addSettingsForPlatform(cleanSettings, 'iOS', ['badge', 'sound', 'alert', 'interactiveSettings']);
            addSettingsForPlatform(cleanSettings, 'android', ['senderID', 'projectNumber']);
            addSettingsForPlatform(cleanSettings, 'wp8', ['channelName']);

            var callbackFields = ['notificationCallbackAndroid', 'notificationCallbackIOS', 'notificationCallbackWP8'];
            _.each(callbackFields, function (callbackField) {
                var callback = pushSettings[callbackField];
                if (callback) {
                    if (typeof callback !== 'function') {
                        throw new EverliveError('The "' + callbackField + '" of the push settings should be a function');
                    }

                    cleanSettings[callbackField] = pushSettings[callbackField];
                }
            });

            if (pushSettings.customParameters) {
                cleanSettings.customParameters = pushSettings.customParameters;
            }

            return cleanSettings;
        },

        _populateRegistrationObject: function (deviceRegistration, success, error) {
            var self = this;

            return buildPromise(
                function (success, error) {
                    if (!self.pushToken) {
                        throw new EverliveError('Push token is not available.');
                    }

                    self._getLocaleName(
                        function (locale) {
                            var deviceId = self._getDeviceId();
                            var hardwareModel = device.model;
                            var platformType = self._getPlatformType(device.platform);
                            var timeZone = jstz.determine().name();
                            var pushToken = self.pushToken;
                            var language = locale.value;
                            var platformVersion = device.version;

                            deviceRegistration.HardwareId = deviceId;
                            deviceRegistration.HardwareModel = hardwareModel;
                            deviceRegistration.PlatformType = platformType;
                            deviceRegistration.PlatformVersion = platformVersion;
                            deviceRegistration.TimeZone = timeZone;
                            deviceRegistration.PushToken = pushToken;
                            deviceRegistration.Locale = language;

                            success();
                        },
                        error
                    );
                },
                success,
                error
            );
        },

        _getLocaleName: function (success, error) {
            if (this.emulatorMode) {
                success({value: 'en_US'});
            } else {
                navigator.globalization.getLocaleName(
                    function (locale) {
                        success(locale);
                    },
                    error
                );
                navigator.globalization.getLocaleName(
                    function (locale) {
                    },
                    error
                );
            }
        },

        _getDeviceId: function () {
            return device.uuid;
        },

        //Returns the Everlive device platform constant given a value aquired from cordova's device.platform.
        _getPlatformType: function (platformString) {
            var psLower = platformString.toLowerCase();
            switch (psLower) {
                case 'ios':
                case 'iphone':
                case 'ipad':
                    return Platform.iOS;
                case 'android':
                    return Platform.Android;
                case 'wince':
                    return Platform.WindowsPhone;
                case 'win32nt': // real wp8 devices return this string as platform identifier.
                    return Platform.WindowsPhone;
                default:
                    return Platform.Unknown;
            }
        },

        _deviceRegistrationFailed: function (error) {
            this.pushToken = null;
            this.isInitializing = false;
            this.isInitialized = false;

            if (this._initErrorCallback) {
                this._initErrorCallback({error: error});
            }
        },

        _deviceRegistrationSuccess: function (token) {
            this.pushToken = token;
            this.isInitializing = false;
            this.isInitialized = true;

            if (this._initSuccessCallback) {
                this._initSuccessCallback({token: token});
            }
        },

        //Occurs when the device registration in APN succeeds
        _successfulRegistrationAPN: function (token) {
            var self = this;
            if (this.pushSettings.iOS && this.pushSettings.iOS.interactiveSettings) {
                this._initializeInteractivePush(
                    this.pushSettings.iOS,
                    function () {
                        self._deviceRegistrationSuccess(token);
                    },
                    function (err) {
                        throw new EverliveError('The interactive push configuration is incorrect: ' + err);
                    }
                );
            } else {
                this._deviceRegistrationSuccess(token);
            }
        },

        //Occurs if the device registration in APN fails
        _failedRegistrationAPN: function (error) {
            this._deviceRegistrationFailed(error);
        },

        //Occurs when device registration has been successfully sent to GCM
        _successSentRegistrationGCM: function (id) {
            //console.log("Successfully sent request for registering with GCM.");
        },
        //Occurs when device registration has been successfully sent for WP8
        _successSentRegistrationWP8: function (id) {
            //console.log("Successfully sent request for registering WP8 .");
        },
        //Occurs when an error occured when sending registration request for WP8
        _errorSentRegistrationWP8: function (error) {
            this._deviceRegistrationFailed(error);
        },

        //Occurs when an error occured when sending registration request to GCM
        _errorSentRegistrationGCM: function (error) {
            this._deviceRegistrationFailed(error);
        },

        //This function receives all notification events from APN
        _onNotificationAPN: function (e) {
            this._raiseNotificationEventIOS(e);
        },
        //This function receives all notification events for WP8
        _onNotificationWP8: function (e) {
            this._raiseNotificationEventWP8(e);
        },

        //This function receives all notification events from GCM
        _onNotificationGCM: function onNotificationGCM(e) {
            switch (e.event) {
                case 'registered':
                    if (e.regid.length > 0) {
                        this._deviceRegistrationSuccess(e.regid);
                    }
                    break;
                case 'message':
                    this._raiseNotificationEventAndroid(e);
                    break;
                case 'error':
                    if (!this.pushToken) {
                        this._deviceRegistrationFailed(e);
                    } else {
                        this._raiseNotificationEventAndroid(e);
                    }
                    break;
                default:
                    this._raiseNotificationEventAndroid(e);
                    break;
            }
        },

        _raiseNotificationEventAndroid: function (e) {
            if (this.pushSettings.notificationCallbackAndroid) {
                this.pushSettings.notificationCallbackAndroid(e);
            }
        },
        _raiseNotificationEventIOS: function (e) {
            if (this.pushSettings.notificationCallbackIOS) {
                this.pushSettings.notificationCallbackIOS(e);
            }
        },
        _raiseNotificationEventWP8: function (e) {
            if (this.pushSettings.notificationCallbackWP8) {
                this.pushSettings.notificationCallbackWP8(e);
            }
        }
    };

    return CurrentDevice;
}());
},{"./EverliveError":53,"./constants":63,"./utils":80}],52:[function(require,module,exports){
var Setup = require('./Setup');
var Data = require('./types/Data');
var usersModule = require('./types/Users');
var filesModule = require('./types/Files');
var constants = require('./constants');
var utils = require('./utils');
var buildAuthHeader = utils.buildAuthHeader;
var Push = require('./Push');
var Authentication = require('./auth/Authentication');
var offlineModule = require('./offline/offline');
var Request = require('./Request');
var common = require('./common');
var rsvp = common.rsvp;
var _ = common._;
var EverliveError = require('./EverliveError').EverliveError;
var EventEmitter = require('events').EventEmitter;

module.exports = (function () {

    // The constructor of Everlive instances.
    // The entry point for the SDK.

    /**
     * @class Everlive
     * @classdesc The constructor of the {{site.bs}} (Everlive) JavaScript SDK. This is the entry point for the SDK.
     * @param {object|string} options - An object containing configuration options for the Setup object. Alternatively, you can pass a string representing your API key.
     * @param {string} options.apiKey - Your API key.
     * @param {string} [options.url=//api.everlive.com/v1/] - The {{site.TelerikBackendServices}} URL.
     * @param {string} [options.token] - An authentication token. The instance will be associated with the provided previously obtained token.
     * @param {string} [options.tokenType=bearer] - The type of the token that is used for authentication.
     * @param {string} [options.scheme=http] - The URI scheme used to make requests. Supported values: http, https
     * @param {boolean} [options.parseOnlyCompleteDateTimeObjects=false] - If set to true, the SDK will parse only complete date strings (according to the ISO 8601 standard).
     * @param {boolean} [options.emulatorMode=false] - Set this option to true to set the SDK in emulator mode.
     * @param {object|boolean} [options.offlineStorage] - Set this option to true to use the default offline settings.
     * @param {boolean} [options.offlineStorage.autoSync=true] - Whether to sync data automatically when going online.
     * @param {boolean} [options.offlineStorage.isOnline=true] - Whether the storage is in online mode initially.
     * @param {ConflictResolutionStrategy|function} [options.offlineStorage.conflictResolutionStrategy=ConflictResolutionStrategy.ClientWins] - A constant specifying the conflict resolution strategy or a function used to resolve the conflicts.
     * @param {StorageProviders|object} [options.offlineStorage.storageProviderSettings=StorageProviders.LocalStorage] - An object specifying settings for the offline storage provider.
     * @param {function} [options.offlineStorage.syncStart=null] - A function that is called whenever a synchronisation starts.
     * @param {function} [options.offlineStorage.syncEnd=null] - A function that is called when the synchronization completes. The function receives a list of sync errors.
     */
    function Everlive(options) {
        var self = this;
        this.setup = new Setup(options);
        _.each(initializations, function (init) {
            init.func.call(self, options);
        });

        if (Everlive.$ === null) {
            Everlive.$ = self;
        }

        this._emitter = new EventEmitter();
    }

    Everlive.prototype._emitterProxy = function (event, args) {
        this._emitter[event].apply(this._emitter, args);
    };

    Everlive.prototype.addListener = function () {
        this._emitterProxy('addListener', arguments);
    };
    Everlive.prototype.on = Everlive.prototype.addListener;

    Everlive.prototype.removeListener = function () {
        this._emitterProxy('removeListener', arguments);
    };
    Everlive.prototype.off = Everlive.prototype.removeListener;

    Everlive.prototype.once = function () {
        this._emitterProxy('once', arguments);
    };

    Everlive.prototype.removeAllListeners = function () {
        this._emitterProxy('removeAllListeners', arguments);
    };

    /** Reference to the current {{site.TelerikBackendServices}} (Everlive) JavaScript SDK
     * @memberOf Everlive
     * @type {Everlive}
     * @static
     */
    Everlive.$ = null;
    Everlive.idField = constants.idField;


    // An array keeping initialization functions called by the Everlive constructor.
    // These functions will be used to extend the functionality of an Everlive instance.
    var initializations = [];

    /** An array of functions that are invoked during instantiation of the {{site.TelerikBackendServices}} (Everlive) JavaScript SDK.
     * @memberOf Everlive
     * @type {Function[]}
     * @static
     * @private
     */
    Everlive.initializations = initializations;

    /** Creates a new {{site.TelerikBackendServices}} (Everlive) Java Script SDK instance.
     * @memberOf Everlive
     * @param {object} options - An object containing options used to initialize the {{site.bs}} JavaScript SDK instance.
     * @returns {Everlive} The instance of the {{site.bs}} (Everlive) JavaScript SDK that was created using the provided options.
     * @static
     * @method
     */
    Everlive.init = function (options) {
        Everlive.$ = null;
        return new Everlive(options);
    };

    Everlive.prototype.data = function (collectionName) {
        return new Data(this.setup, collectionName, this.offlineStorage, this);
    };

    /**
     * Returns the URL to the {{site.bs}} application endpoint that the SDK uses.
     * @memberOf Everlive.prototype
     * @method buildUrl
     * @returns {string} The generated URL.
     */
    Everlive.prototype.buildUrl = function () {
        return utils.buildUrl(this.setup);
    };

    /**
     * Generates the Authorization headers that are used by the {{site.TelerikBackendServices}} (Everlive) JavaScript SDK to make requests to the {{site.bs}} servers.
     * @memberOf Everlive
     * @returns {Object} AuthorizationHeaders The generated Authorization headers object.
     */
    Everlive.prototype.buildAuthHeader = function () {
        return buildAuthHeader(this.setup);
    };

    Everlive.disableRequestCache = function (url, method) {
        if (method === 'GET') {
            var timestamp = (new Date()).getTime();
            var separator = url.indexOf('?') > -1 ? '&' : '?';
            url += separator + '_el=' + timestamp;
        }

        return url;
    };

    Everlive.AuthStatus = constants.AuthStatus;

    /**
     * Gets the current authentication status of the {{site.TelerikBackendServices}} JavaScript SDK instance.
     * @memberOf Everlive.prototype
     * @method authInfo
     * @name authInfo
     * @returns {Promise} A promise to the authentication status.
     */
    /**
     * Gets the current authentication status of the {{site.TelerikBackendServices}} JavaScript SDK instance.
     * @memberOf Everlive.prototype
     * @method authInfo
     * @name authInfo
     * @param {Function} [success] A success callback.
     * @param {Function} [error] An error callback.
     */
    Everlive.prototype.authInfo = function (success, error) {
        var self = this;
        return utils.buildPromise(function (success, error) {
            var setup = self.setup;
            if (setup.masterKey) {
                return success({status: Everlive.AuthStatus.masterKey});
            }

            if (!setup.token) {
                return success({status: Everlive.AuthStatus.unauthenticated});
            }

            if (self.authentication && self.authentication.hasAuthenticationRequirement()) {
                return success({status: Everlive.AuthStatus.authenticating});
            }

            self.Users
                .skipAuth(true)
                .currentUser()
                .then(function (res) {
                    return success({status: Everlive.AuthStatus.authenticated, user: res.result});
                }, function (err) {
                    if (self.authentication && self.authentication.hasAuthenticationRequirement()) {
                        return success({status: Everlive.AuthStatus.authenticating});
                    } else if (err.code === 601) { // invalid request, i.e. the access token is invalid or missing
                        return success({status: Everlive.AuthStatus.invalidAuthentication});
                    } else if (err.code === 301 || err.code === 302) {
                        return success({status: Everlive.AuthStatus.expiredAuthentication});
                    } else {
                        return error(err);
                    }
                });
        }, success, error);
    };

    /**
     * Make a request to the current {{site.bs}} JavaScript SDK instance.
     * @method request
     * @memberOf Everlive.prototype
     * @param {object} options Object used to configure the request.
     * @param {object} [options.endpoint] The endpoint of the {{site.bs}} JavaScript API relative to the API key section. (For example, options.endpoint = MyType will make a request to the MyType type.)
     * @param {HttpMethod} [options.method] HTTP request method.
     * @param {object} [options.data] Data to be sent with the request.
     * @param {Function} [options.success] Success callback that will be called when the request finishes successfully.
     * @param {Function} [options.error] Error callback to be called in case of an error.
     * @param {object} [options.headers] Additional headers to be included in the request.
     * @param {Query|object} [options.filter] This is either a {@link Query} or a [filter]({% slug rest-api-querying-filtering %}) expression.
     * @param {boolean} [options.authHeaders=true] When set to false, no Authorization headers will be sent with the request.
     * @returns {function} The request configuration object containing the `send` function that sends the request.
     */
    Everlive.prototype.request = function (options) {
        return new Request(this.setup, options);
    };

    function protectOfflineEnabled() {
        if (!this._isOfflineStorageEnabled()) {
            throw new EverliveError('You have instantiated the SDK without support for offline storage');
        }
    }

    Everlive.prototype._isOfflineStorageEnabled = function () {
        return !!this.setup.offlineStorage;
    };

    Everlive.prototype.offline = function () {
        protectOfflineEnabled.call(this);
        this.offlineStorage._setOffline.apply(this.offlineStorage, arguments);
    };

    Everlive.prototype.isOffline = function () {
        protectOfflineEnabled.call(this);
        return !this.isOnline();
    };

    Everlive.prototype.isOnline = function () {
        protectOfflineEnabled.call(this);
        return this.offlineStorage.isOnline();
    };

    Everlive.prototype.sync = function () {
        protectOfflineEnabled.call(this);
        return this.offlineStorage.sync.apply(this.offlineStorage, arguments);
    };

    var initDefault = function () {
        /**
         * @memberOf Everlive
         * @instance
         * @description An instance of the [Users]{@link Users} class for working with users.
         * @member {Users} Users
         */
        this.Users = this.data('Users');
        usersModule.addUsersFunctions(this.Users, this);

        /**
         * @memberOf Everlive
         * @instance
         * @description An instance of the [Files]{@link Files} class for working with files.
         * @member {Files} Files
         */
        this.Files = this.data('Files');
        filesModule.addFilesFunctions(this.Files);

        /**
         * @memberOf Everlive
         * @instance
         * @description An instance of the [Push]{@link Push} class for working with push notifications.
         * @member {Push} Push
         */
        this.push = new Push(this);

        /**
         * @memberOf Everlive
         * @instance
         * @description An instance of the [Push]{@link Push} class for working with the authentication of the SDK.
         * @type {Authentication}
         */
        this.authentication = new Authentication(this, this.setup.authentication);
    };

    initializations.push({name: 'offlineStorage', func: offlineModule.initOfflineStorage});
    initializations.push({name: 'default', func: initDefault});

    return Everlive;
}());

},{"./EverliveError":53,"./Push":57,"./Request":58,"./Setup":59,"./auth/Authentication":60,"./common":62,"./constants":63,"./offline/offline":69,"./types/Data":77,"./types/Files":78,"./types/Users":79,"./utils":80,"events":6}],53:[function(require,module,exports){
var EverliveErrors = {
    itemNotFound: {
        code: 801,
        message: 'Item not found.'
    },
    syncConflict: {
        code: 4242,
        message: 'A conflict occurred while syncing data'
    },
    syncCancelled: {
        code: 4243,
        message: 'Synchronization cancelled by user'
    },
    syncInProgress: {
        code: 4244,
        message: 'Cannot perform operation while synchronization is in progress'
    },
    invalidToken: {
        code: 301,
        message: 'Invalid access token'
    },
    expiredToken: {
        code: 302,
        message: 'Expired access token'
    },
    invalidRequest: {
        code: 601,
        message: 'Invalid request.'
    }
};

var EverliveError = (function () {
    function EverliveError() {
        var tmp = Error.apply(this, arguments);

        tmp.name = this.name = 'EverliveError';

        this.message = tmp.message;

        Object.defineProperty(this, 'stack', {
            get: function () {
                return tmp.stack
            }
        });

        return this;
    }

    EverliveError.prototype = Object.create(Error.prototype);
    EverliveError.prototype.toJSON = function () {
        return {
            name: this.name,
            message: this.message,
            stack: this.stack
        };
    };

    return EverliveError;
}());

var DeviceRegistrationError = (function () {
    var DeviceRegistrationError = function (errorType, message, additionalInformation) {
        EverliveError.call(this, message);
        this.errorType = errorType;
        this.message = message;
        if (additionalInformation !== undefined) {
            this.additionalInformation = additionalInformation;
        }
    };

    DeviceRegistrationError.prototype = Object.create(EverliveError.prototype);

    DeviceRegistrationError.fromEverliveError = function (everliveError) {
        var deviceRegistrationError = new DeviceRegistrationError(DeviceRegistrationErrorTypes.EverliveError, everliveError.message, everliveError);
        return deviceRegistrationError;
    };

    DeviceRegistrationError.fromPluginError = function (errorObj) {
        var message = 'A plugin error occurred';
        if (errorObj) {
            if (typeof errorObj.error === 'string') {
                message = errorObj.error;
            } else if (typeof errorObj.message === 'string') {
                message = errorObj.message;
            }
        }

        var deviceRegistrationError = new DeviceRegistrationError(DeviceRegistrationErrorTypes.PluginError, message, errorObj);
        return deviceRegistrationError;
    };

    var DeviceRegistrationErrorTypes = {
        EverliveError: 1,
        PluginError: 2
    };

    return DeviceRegistrationError;
}());

module.exports = {
    EverliveError: EverliveError,
    EverliveErrors: EverliveErrors,
    DeviceRegistrationError: DeviceRegistrationError
};
},{}],54:[function(require,module,exports){
var Processor = require('./common').Processor;
var DataQuery = require('./query/DataQuery');
var Query = require('./query/Query');

module.exports = (function () {
    return new Processor({
        executionNodeFunction: function (node, expandContext, done) {
            var query = new DataQuery({
                operation: DataQuery.operations.read,
                collectionName: node.targetTypeName,
                filter: new Query(node.filter, node.select, node.sort, node.skip, node.take)
            });

            expandContext.offlineModule.processQuery(query).then(function (data) {
                done(null, data.result);
            }, done);
        },
        metadataProviderFunction: function (relationNames, map, prepareContext, done) {
            for (var rel in map) {
                if (map.hasOwnProperty(rel)) {
                    if (typeof map[rel] === 'object') {
                        map[rel].validated = true;
                    }
                }
            }
            done();
        }
    });
}());

},{"./common":62,"./query/DataQuery":72,"./query/Query":73}],55:[function(require,module,exports){
module.exports = (function () {
    function Expression(operator, operands) {
        this.operator = operator;
        this.operands = operands || [];
    }

    Expression.prototype = {
        addOperand: function (operand) {
            this.operands.push(operand);
        }
    };

    return Expression;
}());
},{}],56:[function(require,module,exports){
module.exports = (function () {
    //TODO add a function for calculating the distances in geospatial queries

    /**
     * @classdesc A class representing a value for the {{site.TelerikBackendServices}} GeoPoint field.
     * @class GeoPoint
     * @param longitude Longitude of the GeoPoint in decimal degrees (range: -180 to 180). Example: `123.3239467`
     * @param latitude Latitude of the GeoPoint in decimal degrees (range: -90 to 90). Example: `42.6954322`
     */
    function GeoPoint(longitude, latitude) {
        this.longitude = longitude || 0;
        this.latitude = latitude || 0;
    }

    return GeoPoint;
}());
},{}],57:[function(require,module,exports){
var utils = require('./utils');
var buildPromise = utils.buildPromise;
var DeviceRegistrationResult = utils.DeviceRegistrationResult;
var everliveErrorModule = require('./EverliveError').EverliveError;
var DeviceRegistrationError = everliveErrorModule.DeviceRegistrationError;
var EverliveError = everliveErrorModule.EverliveError;
var CurrentDevice = require('./CurrentDevice');


module.exports = (function () {
    /**
     * @class Push
     * @classdesc A class for managing push notifications in your application. Supported are push notifications for hybrid apps on Android and iOS.
     * @protected
     * @param el {Everlive} Everlive Object
     */
    function Push(el) {
        this._el = el;
        this.notifications = el.data('Push/Notifications');
        this.devices = el.data('Push/Devices');
    }

    Push.prototype = {

        /**
         * Ensures that the Telerik Push Notifications plug-in has been loaded and is ready to use. An {EverliveError} is returned if the plug-in is not available.
         * @method ensurePushIsAvailable
         * @memberOf Push.prototype
         */
        ensurePushIsAvailable: function () {
            var isPushNotificationPluginAvailable = (typeof window !== 'undefined' && window.plugins && window.plugins.pushNotification);

            if (!isPushNotificationPluginAvailable) {
                throw new EverliveError("The push notification plugin is not available. Ensure that the pushNotification plugin is included " +
                "and use after `deviceready` event has been fired.");
            }
        },
        /**
         * Returns the current device for sending push notifications
         * @deprecated since version 1.2.7
         * @see [Push.register]{@link push.register}
         * @memberOf Push.prototype
         * @method currentDevice
         * @name currentDevice
         * @param [emulatorMode] {Boolean} If set to true, emulator mode is enabled meaning you cannot send push notifications.
         * @returns {CurrentDevice} Returns an instance of CurrentDevice.
         */
        currentDevice: function (emulatorMode) {
            this.ensurePushIsAvailable();

            if (arguments.length === 0) {
                emulatorMode = this._el.setup._emulatorMode;
            }

            if (!window.cordova) {
                throw new EverliveError('Error: currentDevice() can only be called from within a hybrid mobile app, after \'deviceready\' event has been fired.');
            }

            if (!this._currentDevice) {
                this._currentDevice = new CurrentDevice(this);
            }

            this._currentDevice.emulatorMode = emulatorMode;

            return this._currentDevice;
        },

        /**
         * Enables push notifications on the device and registers it for the feature with {{site.TelerikBackendServices}} if it hasn't already been registered. If it has been registered, the registration details are updated.
         * @method register
         * @name register
         * @memberOf Push.prototype
         * @param {Object} settings An object containing settings for the registration. It can include custom parameters to be stored by {{site.bs}}.
         * @param {Object} settings.iOS=null iOS-specific settings.
         * @param {Boolean} settings.iOS.alert=true If set to true, the push notification will display as a standard iOS alert.
         * @param {String|Number} settings.iOS.badge='+1' Specifies the badge counter to be displayed on the device.
         * @param {Boolean} settings.iOS.sound=true If set to true, the device will play a notification sound.
         * @param {Object} settings.android=null Android-specific settings.
         * @param {String} settings.android.senderID=null Your Google API project number. It is required when obtaining a push token for an Android device.
         * @param {String} settings.android.projectNumber=null Synonym for android.senderID. Available in JavaScript SDK versions 1.2.7 and later.
         * @param {Object} settings.wp8=null Windows Phone specific settings.
         * @returns {Promise} The promise for the request.
         */
        /**
         * Enables push notifications on the device and registers it for the feature with {{site.TelerikBackendServices}} if it hasn't already been registered. If it has been registered, the registration details are updated.
         * Telerik Backend Services if it hasn't already been registered.
         * If it was registered the registration details are updated.
         * @method register
         * @name register
         * @memberOf Push.prototype
         * @param {Object} settings Settings for the registration. Can include custom parameters to be saved in backend services.
         * @param {Object} settings.iOS=null iOS specific settings
         * @param {Boolean} settings.iOS.alert=true Specifies whether the device will display an alert message.
         * @param {String|Number} settings.iOS.badge='+1' Specifies the badge counter to be displayed on the device.
         * @param {Boolean} settings.iOS.sound=true Specifies whether the device will play a sound.
         * @param {Object} settings.android=null Android specific settings
         * @param {String} settings.android.senderID=null This is your Google API project number. It is required when obtaining a push token for an Android device.
         * @param {String} settings.android.projectNumber=null Synonym for android.senderID. Available in JavaScript SDK versions 1.2.7 and later.
         * @param {Object} settings.wp8=null Windows Phone specific settings
         * @param {Function} [success] Callback to invoke on success.
         * @param {Function} [error] Callback to invoke on error.
         */
        register: function (settings, success, error) {
            this.ensurePushIsAvailable();

            var currentDevice = this.currentDevice();
            var self = this;
            settings = settings || {};

            if (settings.android) {
                settings.android.senderID = settings.android.projectNumber || settings.android.senderID;
            }

            var successCallback = function (token, callback) {
                var result = new DeviceRegistrationResult(token);
                callback(result);
            };

            var errorCallback = function (err, callback) {
                var registrationError = DeviceRegistrationError.fromEverliveError(err);
                callback(registrationError);
            };

            var clearBadgeIfNeeded = function (token, successCb, errorCb) {
                var platformType = currentDevice._getPlatformType(device.platform);
                var clearBadge = platformType === Platform.iOS;

                if (clearBadge && settings.iOS) {
                    clearBadge = settings.iOS.clearBadge !== false;
                }

                if (clearBadge) {
                    self.clearBadgeNumber().then(function () {
                        successCallback(token, successCb);
                    }, function (err) {
                        errorCallback(err, errorCb);
                    });
                } else {
                    successCallback(token, successCb);
                }
            };

            return buildPromise(function (successCb, errorCb) {
                currentDevice.enableNotifications(settings, function (response) {
                    var token = response.token;
                    var customParameters = settings.customParameters;
                    currentDevice.getRegistration()
                        .then(function () {
                            currentDevice.updateRegistration(customParameters, function () {
                                clearBadgeIfNeeded(token, successCb, errorCb);
                            }, function (err) {
                                errorCallback(err, errorCb);
                            });
                        }, function (err) {
                            if (err.code === 801) { //Not registered
                                currentDevice.register(customParameters, function () {
                                    clearBadgeIfNeeded(token, successCb, errorCb);
                                }, errorCb);
                            } else {
                                errorCallback(err, errorCb);
                            }
                        });
                }, function (err) {
                    var deviceRegistrationError = DeviceRegistrationError.fromPluginError(err);
                    errorCb(deviceRegistrationError);
                });
            }, success, error);
        },

        /**
         * Disables push notifications for the current device. This method invalidates any push tokens that were obtained for the device from the current application. The device will also be unregistered from {{site.TelerikBackendServices}}.
         * @method unregister
         * @name unregister
         * @memberOf Push.prototype
         * @returns {Promise} The promise for the request.
         */
        /**
         * Disables push notifications for the current device. This method invalidates any push tokens that were obtained for the device from the current application. The device will also be unregistered from {{site.TelerikBackendServices}}.
         * This method invalidates any push tokens that were obtained for the device from the current application.
         * The device will also be unregistered from Telerik Backend Services.
         * @method unregister
         * @name unregister
         * @memberOf Push.prototype
         * @param {Function} [onSuccess] Callback to invoke on success.
         * @param {Function} [onError] Callback to invoke on error.
         */
        unregister: function (onSuccess, onError) {
            this.ensurePushIsAvailable();

            var currentDevice = this.currentDevice();
            return currentDevice.disableNotifications.apply(currentDevice, arguments);
        },

        /**
         * Updates the registration of the current device.
         * @method updateRegistration
         * @name updateRegistration
         * @memberOf Push.prototype
         * @param {Object} customParameters Custom parameters for the registration. If {undefined}, customParameters are not updated.
         * @returns {Promise} The promise for the request.
         */
        /**
         * Updates the registration for the current device.
         * @method updateRegistration
         * @name updateRegistration
         * @memberOf Push.prototype
         * @param {Object} customParameters Custom parameters for the registration. If {undefined}, customParameters are not updated.
         * @param {Function} [onSuccess] Callback to invoke on success.
         * @param {Function} [onError] Callback to invoke on error.
         */
        updateRegistration: function (customParameters, onSuccess, onError) {
            this.ensurePushIsAvailable();

            var currentDevice = this.currentDevice();
            return currentDevice.updateRegistration.apply(currentDevice, arguments);
        },

        /**
         * Sets the badge number on the {{site.TelerikBackendServices}} server.
         * @method setBadgeNumber
         * @name setBadgeNumber
         * @memberOf Push.prototype
         * @param {Number|String} badge The number to be set as a badge.
         * @returns {Promise} The promise for the request.
         */
        /**
         * Sets the badge number on the server
         * @method setBadgeNumber
         * @name setBadgeNumber
         * @memberOf Push.prototype
         * @param {Number|String} badge The number to be set as a badge.
         * @param {Function} [onSuccess] Callback to invoke on success.
         * @param {Function} [onError] Callback to invoke on error.
         */
        setBadgeNumber: function (badge, onSuccess, onError) {
            this.ensurePushIsAvailable();

            badge = parseInt(badge);
            if (isNaN(badge)) {
                return buildPromise(function (success, error) {
                    error(new EverliveError('The badge must have a numeric value'));
                }, onSuccess, onError);
            }

            var deviceRegistration = {};
            var currentDevice = this.currentDevice();
            var deviceId = currentDevice._getDeviceId();
            deviceRegistration.Id = 'HardwareId/' + encodeURIComponent(deviceId);
            deviceRegistration.BadgeCounter = badge;
            return buildPromise(function (successCb, errorCb) {
                currentDevice._pushHandler.devices.updateSingle(deviceRegistration).then(
                    function () {
                        if (window.plugins && window.plugins.pushNotification) {
                            return window.plugins.pushNotification.setApplicationIconBadgeNumber(successCb, errorCb, badge);
                        } else {
                            return successCb();
                        }
                    }, errorCb)
            }, onSuccess, onError);
        },

        /**
         * Resets the badge number on the {{site.TelerikBackendServices}} server to 0.
         * @method clearBadgeNumber
         * @name clearBadgeNumber
         * @memberOf Push.prototype
         * @returns {Promise} The promise for the request.
         */
        /**
         * Clears the badge number on the server by setting it to 0
         * @method clearBadgeNumber
         * @name clearBadgeNumber
         * @memberOf Push.prototype
         * @param {Function} [onSuccess] Callback to invoke on success.
         * @param {Function} [onError] Callback to invoke on error.
         */
        clearBadgeNumber: function (onSuccess, onError) {
            this.ensurePushIsAvailable();

            return this.setBadgeNumber(0, onSuccess, onError);
        },

        /**
         * Returns the push notifications registration for the current device.
         * @method getRegistration
         * @name getRegistration
         * @memberOf Push.prototype
         * @returns {Promise} The promise for the request.
         */
        /**
         * Returns the push registration for the current device.
         * @method getRegistration
         * @name getRegistration
         * @memberOf Push.prototype
         * @param {Function} [onSuccess] Callback to invoke on success.
         * @param {Function} [onError] Callback to invoke on error.
         */
        getRegistration: function (onSuccess, onError) {
            this.ensurePushIsAvailable();

            var currentDevice = this.currentDevice();
            return currentDevice.getRegistration.apply(currentDevice, arguments);
        },

        /**
         * Sends a push notification.
         * @method send
         * @name send
         * @memberOf Push.prototype
         * @param {Object} notification The push notification object
         * @returns {Promise} The promise for request.
         */
        /**
         * Sends a push message
         * @method send
         * @name send
         * @memberOf Push.prototype
         * @param {Object} notification The push notification object
         * @param {Function} [onSuccess] Callback to invoke on success.
         * @param {Function} [onError] Callback to invoke on error.
         */
        send: function (notification, onSuccess, onError) {
            this.ensurePushIsAvailable();

            return this.notifications.create.apply(this.notifications, arguments);
        },

        /**
         * This method provides a different operation on each supported platform:
         *
         * - On iOS: Checks if Notifications is enabled for this application in the device's Notification Center.
         * - On Windows Phone: Checks if the application has an active open channel for communication with the Microsoft Push Notification Service. The outcome does not depend on the device's notification settings.
         * - On Android: Checks if the application has established a connection with Google Cloud Messaging. The outcome does not depend on the device's notification settings.
         * @method areNotificationsEnabled
         * @name areNotificationsEnabled
         * @memberOf Push.prototype
         * @param {Object} options An object passed to the Push Notification plugin's areNotificationsEnabled method
         * @returns {Promise} The promise for the request.
         */
        /**
         * iOS: Checks if the Notifications are enabled for this Application in the Device's Notification Center.
         * Windows Phone: Checks if the Application has an active opened Channel for communication with the Notification Service. Not relying on the device notification settings.
         * Android: Checks if the Application has established connection with the Notification Service. Not relying on the device notification settings.
         * @method areNotificationsEnabled
         * @name areNotificationsEnabled
         * @memberOf Push.prototype
         * @param {Object} options an object passed to the Push Notification plugin's areNotificationsEnabled method.
         * @param {Function} [onSuccess] Callback to invoke on successful check. Passes a single boolean value: true or false.
         * @param {Function} [onError] Callback to invoke when an error in the push plugin has occurred.
         */
        areNotificationsEnabled: function (options, onSuccess, onError) {
            this.ensurePushIsAvailable();

            options = options || {};
            var pushNotification = window.plugins.pushNotification;

            return buildPromise(function (successCb, errorCb) {
                pushNotification.areNotificationsEnabled(successCb, errorCb, options);
            }, onSuccess, onError);
        }
    };

    return Push;
}());
},{"./CurrentDevice":51,"./EverliveError":53,"./utils":80}],58:[function(require,module,exports){
var utils = require('./utils');
var _ = require('./common')._;
var rsvp = require('./common').rsvp;
var buildAuthHeader = utils.buildAuthHeader;
var parseUtilities = utils.parseUtilities;
var guardUnset = utils.guardUnset;
var common = require('./common');
var reqwest = common.reqwest;
var _ = common._;
var Headers = require('./constants').Headers;

module.exports = (function () {
    var _self;

    // The Request type is an abstraction over Ajax libraries
    // A Request object needs information about the Everlive connection and initialization options

    function Request(setup, options) {
        guardUnset(setup, 'setup');
        guardUnset(options, 'options');
        this.setup = setup;
        this.method = null;
        this.endpoint = null;
        this.data = null;
        this.headers = {};
        // TODO success and error callbacks should be uniformed for all ajax libs
        this.success = null;
        this.error = null;
        this.parse = Request.parsers.simple;

        _.extend(this, options);
        _self = this;
        this._init(options);
    }

    Request.prototype = {
        // Calls the underlying Ajax library
        send: function () {
            Request.sendRequest(this);
        },
        // Returns an authorization header used by the request.
        // If there is a logged in user for the Everlive instance then her/his authentication will be used.
        buildAuthHeader: buildAuthHeader,
        // Builds the URL of the target Everlive service
        buildUrl: function buildUrl(setup) {
            return utils.buildUrl(setup);
        },
        // Processes the given query to return appropriate headers to be used by the request
        buildQueryHeaders: function buildQueryHeaders(query) {
            if (query) {
                if (query instanceof Everlive.Query) {
                    return Request.prototype._buildQueryHeaders(query);
                }
                else {
                    return Request.prototype._buildFilterHeader(query);
                }
            }
            else {
                return {};
            }
        },
        // Initialize the Request object by using the passed options
        _init: function (options) {
            _.extend(this.headers, this.buildAuthHeader(this.setup, options), this.buildQueryHeaders(options.filter), options.headers);
        },
        // Translates an Everlive.Query to request headers
        _buildQueryHeaders: function (query) {
            query = query.build();
            var headers = {};
            if (query.$where !== null) {
                headers[Headers.filter] = JSON.stringify(query.$where);
            }
            if (query.$select !== null) {
                headers[Headers.select] = JSON.stringify(query.$select);
            }
            if (query.$sort !== null) {
                headers[Headers.sort] = JSON.stringify(query.$sort);
            }
            if (query.$skip !== null) {
                headers[Headers.skip] = query.$skip;
            }
            if (query.$take !== null) {
                headers[Headers.take] = query.$take;
            }
            if (query.$expand !== null) {
                headers[Headers.expand] = JSON.stringify(query.$expand);
            }
            return headers;
        },
        // Creates a header from a simple filter
        _buildFilterHeader: function (filter) {
            var headers = {};
            headers[Headers.filter] = JSON.stringify(filter);
            return headers;
        }
    };

    var parseOnlyCompleteDateTimeString = _self && _self.setup && _self.setup.parseOnlyCompleteDateTimeObjects;

    var reviver = parseUtilities.getReviver(parseOnlyCompleteDateTimeString);

    Request.parsers = {
        simple: {
            result: parseUtilities.parseResult.bind(null, reviver),
            error: parseUtilities.parseError.bind(null, reviver)
        },
        single: {
            result: parseUtilities.parseSingleResult.bind(null, reviver),
            error: parseUtilities.parseError.bind(null, reviver)
        },
        update: {
            result: parseUtilities.parseUpdateResult.bind(null, reviver),
            error: parseUtilities.parseError.bind(null, reviver)
        }
    };

    // TODO built for request
    if (typeof Request.sendRequest === 'undefined') {
        Request.sendRequest = function (request) {
            var url = request.buildUrl(request.setup) + request.endpoint;
            url = Everlive.disableRequestCache(url, request.method);
            var data = request.method === 'GET' ? request.data : JSON.stringify(request.data);

            reqwest({
                url: url,
                method: request.method,
                data: data,
                headers: request.headers,
                type: 'json',
                contentType: 'application/json',
                crossOrigin: true,
                //processData: request.method === "GET",
                success: function (data, textStatus, jqXHR) {
                    var result = request.parse.result(data);
                    request.success.call(request, result);
                },
                error: function (jqXHR, textStatus, errorThrown) {
                    var error = request.parse.error(jqXHR.responseText);
                    request.error.call(request, error);
                }
            });
        };
    }

    return Request;
}());
},{"./common":62,"./constants":63,"./utils":80}],59:[function(require,module,exports){
var _ = require('./common')._;
var constants = require('./constants');
var AuthenticationSetup = require('./auth/AuthenticationSetup');

module.exports = (function () {
    var everliveUrl = constants.everliveUrl;

    // An object that keeps information about an Everlive connection
    function Setup(options) {
        this.url = everliveUrl;
        this.apiKey = null;
        this.masterKey = null;
        this.token = null;
        this.tokenType = null;
        this.principalId = null;
        this.scheme = 'http'; // http or https
        this.parseOnlyCompleteDateTimeObjects = false;
        if (typeof options === 'string') {
            this.apiKey = options;
        } else {
            this._emulatorMode = options.emulatorMode;
            _.extend(this, options);
        }
        this.authentication = new AuthenticationSetup(this, options.authentication);
    }

    Setup.prototype.setAuthorizationProperties = function (token, tokenType, principalId) {
        this.token = token;
        this.tokenType = tokenType;
        this.principalId = principalId;
    };

    Setup.prototype.getAuthorizationProperties = function () {
        return {
            token: this.token,
            tokenType: this.tokenType,
            principalId: this.principalId
        };
    };

    return Setup;

}());
},{"./auth/AuthenticationSetup":61,"./common":62,"./constants":63}],60:[function(require,module,exports){
'use strict';
var utils = require('../utils');
var DataQuery = require('../query/DataQuery');
var Request = require('../Request');
var Everlive = require('../Everlive');
var usersCollectionName = 'Users';
var buildPromise = utils.buildPromise;
var localStore = require('../localStore');
var constants = require('../constants');

module.exports = (function () {
    var Authentication = function (el, setup) {
        this.authSetup = setup || {};
        this._el = el;
        this._authenticationCallbacks = null;
        this._localStore = localStore;
        if (this.authSetup.persist) {
            var self = this;
            var localStoreKey = this._getLocalStoreKey();
            var authOptions = this._localStore.getItem(localStoreKey);
            var authInfo;
            if (authOptions) {
                authInfo = JSON.parse(this._localStore.getItem(localStoreKey));
            }
            if (authInfo) {
                self._el.setup.setAuthorizationProperties(authInfo.token, authInfo.tokenType, authInfo.principalId);
            }
        }
    };

    /**
     *
     * Logs in a user using a username and a password to the current {{site.bs}} JavaScript SDK instance. All requests initiated by the current {{site.bs}} JavaScript SDK instance will be authenticated with that user's credentials.
     * @memberOf Authentication.prototype
     * @method login
     * @name login
     * @param {string} username The user's username.
     * @param {string} password The user's password.
     * @returns {Promise} The promise for the request.
     */
    /**
     * Logs in a user using a username and a password to the current {{site.bs}} JavaScript SDK instance. All requests initiated by the current {{site.bs}} JavaScript SDK instance will be authenticated with that user's credentials.
     * @memberOf Authentication.prototype
     * @method login
     * @name login
     * @param {string} username The user's username.
     * @param {string} password The user's password.
     * @param {Function} [success] A success callback.
     * @param {Function} [error] An error callback.
     */
    Authentication.prototype.login = function (username, password, success, error) {
        var self = this;
        return buildPromise(function (success, error) {
            var successFunc = function () {
                self._loginSuccess.apply(self, arguments);
                success.apply(null, arguments);
            };

            var query = new DataQuery({
                operation: DataQuery.operations.userLogin,
                collectionName: usersCollectionName,
                data: {
                    username: username,
                    password: password,
                    grant_type: 'password'
                },
                skipAuth: true,
                onSuccess: successFunc,
                onError: error
            });

            return self._el.Users.processDataQuery(query);
        }, success, error);
    };

    /**
     * Log out the user who is currently logged in.
     * @memberOf Authentication.prototype
     * @method logout
     * @name logout
     * @returns {Promise} The promise for the request.
     */
    /**
     * Log out the user who is currently logged in.
     * @memberOf Authentication.prototype
     * @method logout
     * @name logout
     * @param {Function} [success] A success callback.
     * @param {Function} [error] An error callback.
     */
    Authentication.prototype.logout = function (success, error) {
        var self = this;
        return buildPromise(function (success, error) {
            var successFunc = function () {
                self._logoutSuccess.apply(self, arguments);
                success.apply(null, arguments);
            };

            var errorFunc = function (err) {
                if (err.code === 301) { //invalid token
                    self.clearAuthorization();
                }

                error.apply(null, arguments);
            };

            var query = new DataQuery({
                operation: DataQuery.operations.userLogout,
                collectionName: usersCollectionName,
                skipAuth: true,
                onSuccess: successFunc,
                onError: errorFunc
            });

            return self._el.Users.processDataQuery(query);
        }, success, error);
    };

    Authentication.prototype._getLocalStoreKey = function () {
        return constants.AuthStoreKey + this._el.setup.apiKey + '$authentication';
    };

    /**
     * Log in a user using an Facebook access token.
     * @memberOf Authentication.prototype
     * @method loginWithFacebook
     * @name loginWithFacebook
     * @param {string} accessToken Facebook access token.
     * @returns {Promise} The promise for the request.
     */
    /**
     * Log in a user using an Facebook access token.
     * @memberOf Authentication.prototype
     * @method loginWithFacebook
     * @name loginWithFacebook
     * @param {string} accessToken Facebook access token.
     * @param {Function} [success] A success callback.
     * @param {Function} [error] An error callback.
     */
    Authentication.prototype.loginWithFacebook = function (accessToken, success, error) {
        var identity = {
            Provider: 'Facebook',
            Token: accessToken
        };
        return this._loginWithProvider(identity, success, error);
    };

    /**
     * Log in a user using an ADFS access token.
     * @memberOf Authentication.prototype
     * @method loginWithADFS
     * @name loginWithADFS
     * @param {string} accessToken ADFS access token.
     * @returns {Promise} The promise for the request.
     */
    /**
     * Log in a user using an ADFS access token.
     * @memberOf Authentication.prototype
     * @method loginWithADFS
     * @name loginWithADFS
     * @param {string} accessToken ADFS access token.
     * @param {Function} [success] A success callback.
     * @param {Function} [error] An error callback.
     */
    Authentication.prototype.loginWithADFS = function (accessToken, success, error) {
        var identity = {
            Provider: 'ADFS',
            Token: accessToken
        };
        return this._loginWithProvider(identity, success, error);
    };

    /**
     * Log in a user using a LiveID access token.
     * @memberOf Authentication.prototype
     * @method loginWithLiveID
     * @name loginWithLiveID
     * @param {string} accessToken LiveID access token.
     * @returns {Promise} The promise for the request.
     */
    /**
     * Log in a user using a LiveID access token.
     * @memberOf Authentication.prototype
     * @method loginWithLiveID
     * @name loginWithLiveID
     * @param {string} accessToken LiveID access token.
     * @param {Function} [success] A success callback.
     * @param {Function} [error] An error callback.
     */
    Authentication.prototype.loginWithLiveID = function (accessToken, success, error) {
        var identity = {
            Provider: 'LiveID',
            Token: accessToken
        };
        return this._loginWithProvider(identity, success, error);
    };

    /**
     * Log in a user using a Google access token.
     * @memberOf Authentication.prototype
     * @method loginWithGoogle
     * @name loginWithGoogle
     * @param {string} accessToken Google access token.
     * @returns {Promise} The promise for the request.
     */
    /**
     * Log in a user using a Google access token.
     * @memberOf Authentication.prototype
     * @method loginWithGoogle
     * @name loginWithGoogle
     * @param {string} accessToken Google access token.
     * @param {Function} [success] A success callback.
     * @param {Function} [error] An error callback.
     */
    Authentication.prototype.loginWithGoogle = function (accessToken, success, error) {
        var identity = {
            Provider: 'Google',
            Token: accessToken
        };

        return this._loginWithProvider(identity, success, error);
    };

    /**
     * Log in a user with a Twitter token. A secret token needs to be provided.
     * @memberOf Authentication.prototype
     * @method loginWithTwitter
     * @name loginWithTwitter
     * @param {string} token Twitter token.
     * @param {string} tokenSecret Twitter secret token.
     * @returns {Promise} The promise for the request.
     */
    /**
     * Log in a user with a Twitter token. A secret token needs to be provided.
     * @memberOf Authentication.prototype
     * @method loginWithTwitter
     * @name loginWithTwitter
     * @param {string} token Twitter token.
     * @param {string} tokenSecret Twitter secret token.
     * @param {Function} [success] A success callback.
     * @param {Function} [error] An error callback.
     */
    Authentication.prototype.loginWithTwitter = function (token, tokenSecret, success, error) {
        var identity = {
            Provider: 'Twitter',
            Token: token,
            TokenSecret: tokenSecret
        };

        return this._loginWithProvider(identity, success, error);
    };

    /**
     * Sets the token and token type that the {{site.TelerikBackendServices}} JavaScript SDK will use for authorization.
     * @memberOf Authentication.prototype
     * @method setAuthorization
     * @param {string} token Token that will be used for authorization.
     * @param {Everlive.TokenType} tokenType Token type. Currently only 'bearer' token is supported.
     * @param {string} principalId The id of the user that is logged in.
     */
    Authentication.prototype.setAuthorization = function setAuthorization(token, tokenType, principalId) {
        this._el.setup.setAuthorizationProperties(token, tokenType, principalId);

        if (this.authSetup.persist) {
            var localStoreKey = this._getLocalStoreKey();
            var authorizationProperties = this._el.setup.getAuthorizationProperties()
            this._localStore.setItem(localStoreKey, JSON.stringify(authorizationProperties));
        }

        if (this._authenticationCallbacks) {
            this._authenticationCallbacks.success();
            this._authenticationCallbacks = null;
        }
    };

    /**
     * Clears the authentication token that the {{site.bs}} JavaScript SDK currently uses. Note that this is different than logging out, because the current authorization token is not invalidated.
     * @method clearAuthorization
     * @memberOf Authentication.prototype
     */
    Authentication.prototype.clearAuthorization = function clearAuthorization() {
        this.setAuthorization(null, null, null);
    };


    /**
     * @memberOf Authentication.prototype
     * Returns whether authentication requirement is enabled for the current instance of the {{site.bs}} JavaScript SDK.
     * @returns {boolean} whether an onAuthenticationRequired function is provided
     */
    Authentication.prototype.hasAuthenticationRequirement = function () {
        return typeof this.authSetup.onAuthenticationRequired === 'function';
    };

    /** Ensures that authentication is completed before continuing.
     * @memberOf Authentication.prototype
     * @private
     * @returns {Promise} A promise that will be resolved when the authentication is complete. See {{@link Everlive.prototype.completeAuthentication}}.
     * @throws throws an error if no onAuthenticationRequired handler is provided to the setup.
     */
    Authentication.prototype._ensureAuthentication = function () {
        if (!this.hasAuthenticationRequirement()) {
            throw new Error('onAuthenticationRequired option of Everlive.Setup.Authentication is required.');
        }
        if (this.isAuthenticating()) {
            return this._authenticationCallbacks.promise;
        }
        this.clearAuthorization();
        this.authSetup.onAuthenticationRequired.call(this);
        this._authenticationCallbacks = utils.getCallbacks();
        return this._authenticationCallbacks.promise;
    };

    /**
     * A method that should be called with the authentication result.
     * @memberOf Authentication.prototype
     * @param authentication authentication object containing information about the
     * @param authentication.access_token
     * @param authentication.token_type
     * @param authentication.principal_id
     */
    Authentication.prototype.completeAuthentication = function (authentication) {
        this._el.setAuthorization(authentication.access_token, authentication.token_type, authentication.principal_id);
    };

    /** Returns whether the {{site.TelerikBackendServices}} is currently waiting for authentication to be completed. See {{@link Everlive.prototype.completeAuthentication}}.
     * @memberOf Everlive.prototype
     * @returns {boolean}
     */
    Authentication.prototype.isAuthenticating = function () {
        return !!this._authenticationCallbacks;
    };

    Authentication.prototype._loginSuccess = function (data) {
        var result = data.result;
        this.setAuthorization(result.access_token, result.token_type, result.principal_id);
    };

    Authentication.prototype._logoutSuccess = function () {
        this.clearAuthorization();
    };

    Authentication.prototype._loginWithProvider = function (identity, success, error) {
        var user = {
            Identity: identity
        };
        var self = this;
        return buildPromise(function (success, error) {
            var successFunc = function () {
                self._loginSuccess.apply(self, arguments);
                success.apply(null, arguments);
            };

            var query = new DataQuery({
                operation: DataQuery.operations.userLoginWithProvider,
                collectionName: usersCollectionName,
                data: user,
                authHeaders: false,
                skipAuth: true,
                parse: Request.parsers.single,
                onSuccess: successFunc,
                onError: error
            });

            self._el.Users.processDataQuery(query);
        }, success, error);
    };

    return Authentication;
}());

},{"../Everlive":52,"../Request":58,"../constants":63,"../localStore":67,"../query/DataQuery":72,"../utils":80}],61:[function(require,module,exports){
'use strict';
var AuthenticationSetup = function (everlive, options) {
    options = options || {};
    this.onAuthenticationRequired = options.onAuthenticationRequired;
    this.persist = options.persist;
};

module.exports = AuthenticationSetup;
},{}],62:[function(require,module,exports){
(function (global){
module.exports = (function () {
    var common = {};

    var platform = require('./everlive.platform');
    var isNativeScript = platform.isNativeScript;
    var isNodejs = platform.isNodejs;

    if (!isNodejs && !isNativeScript) {
        common.reqwest = require('reqwest');
    } else {
        var http = require('http');
        common.reqwest = function (options) {
            var httpRequestOptions = {
                url: options.url,
                method: options.method,
                headers: options.headers || {}
            };

            if (options.data) {
                httpRequestOptions.content = options.data; // NOTE: If we pass null/undefined, it will raise an exception in the http module.
            }

            httpRequestOptions.headers['Accept'] = 'application/json';
            httpRequestOptions.headers['Content-Type'] = 'application/json';

            var noop = function () {
            };
            var success = options.success || noop;
            var error = options.error || noop;
            http.request(httpRequestOptions).then(
                function (response) {
                    var contentString = response.content.toString();
                    if (response.statusCode < 400) {
                        // Success callback calls a custom parse function
                        success(contentString);
                    } else {
                        // Error callback relies on a JSON Object with ResponseText inside
                        error({
                            responseText: contentString
                        });
                    }
                },
                function (err) {
                    // error: function(jqXHR, textStatus, errorThrown)
                    // when timeouting for example (i.e. no internet connectivity), we get an err with content { message: "timeout...", stack: null }
                    error({
                        responseText: err
                    });
                });
        };
    }

    if (isNativeScript) {
        common.root = global;
    } else if (isNodejs) {
        common.root = global;
    }

    if (!common.root) {
        //browser/requirejs/cordova
        common.root = window;
    }

    var ensureDependency = function ensureDependency(globalName, localName) {
        if (!localName) {
            localName = globalName;
        }

        if (!Object.keys(common[localName]).length) {
            common[localName] = common.root[globalName];
        }
    };

    //for the everlive bundle without dependencies included browserify replaces them with empty objects
    common._ = require('underscore');
    ensureDependency('_');

    common.jstz = require('jstimezonedetect');
    ensureDependency('jstz');

    common.mongoQuery = require('mongo-query');
    ensureDependency('mongoQuery');

    common.Mingo = require('mingo');
    ensureDependency('Mingo');

    common.uuid = require('uuid');
    ensureDependency('uuid');

    common.Processor = require('../scripts/bs-expand-processor');
    ensureDependency('Processor');

    common.rsvp = require('rsvp');
    ensureDependency('RSVP', 'rsvp');

    if (!isNodejs && !isNativeScript) {
        ensureDependency('reqwest');
    }

    return common;
}());
}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{"../scripts/bs-expand-processor":46,"./everlive.platform":64,"http":"http","jstimezonedetect":25,"mingo":26,"mongo-query":28,"reqwest":39,"rsvp":40,"underscore":41,"uuid":43}],63:[function(require,module,exports){
var constants = {
    idField: 'Id',
    everliveUrl: '//api.everlive.com/v1/',
    /**
     * A class used to represent the conflict resolution strategies.
     * @property {string} ClientWins
     * @property {string} ServerWins
     * @property {string} Custom
     * @typedef {string} Everlive.ConflictResolutionStrategy
     */
    ConflictResolutionStrategy: {
        ClientWins: 'clientWins',
        ServerWins: 'serverWins',
        Custom: 'custom'
    },
    ConflictResolution: {
        KeepServer: 'keepServer',
        KeepClient: 'keepClient',
        Custom: 'custom'
    },
    /**
     * A class used to represent the available storage providers.
     * @property {string} LocalStorage
     * @property {string} FileSystem
     * @property {string} Custom
     * @typedef {string} Everlive.StorageProviders
     */
    StorageProviders: {
        LocalStorage: 'localStorage',
        FileSystem: 'fileSystem',
        Custom: 'custom'
    },
    // The headers used by the Everlive services
    Headers: {
        filter: 'X-Everlive-Filter',
        select: 'X-Everlive-Fields',
        sort: 'X-Everlive-Sort',
        skip: 'X-Everlive-Skip',
        take: 'X-Everlive-Take',
        expand: 'X-Everlive-Expand',
        singleField: 'X-Everlive-Single-Field',
        includeCount: 'X-Everlive-Include-Count',
        powerFields: 'X-Everlive-Power-Fields',
        debug: 'X-Everlive-Debug',
        overrideSystemFields: 'X-Everlive-Override-System-Fields'
    },
    //Constants for different platforms in Everlive
    Platform: {
        WindowsPhone: 1,
        Windows: 2,
        Android: 3,
        iOS: 4,
        OSX: 5,
        Blackberry: 6,
        Nokia: 7,
        Unknown: 100
    },
    OperatorType: {
        query: 1,

        where: 100,
        filter: 101,

        and: 110,
        or: 111,
        not: 112,

        equal: 120,
        not_equal: 121,
        lt: 122,
        lte: 123,
        gt: 124,
        gte: 125,
        isin: 126,
        notin: 127,
        all: 128,
        size: 129,
        regex: 130,
        contains: 131,
        startsWith: 132,
        endsWith: 133,

        nearShpere: 140,
        withinBox: 141,
        withinPolygon: 142,
        withinShpere: 143,

        select: 200,
        exclude: 201,

        order: 300,
        order_desc: 301,

        skip: 400,
        take: 401,
        expand: 402
    },

    /**
     * A class used to represent the current authentication status of the {{site.TelerikBackendServices}} JavaScript SDK instance.
     * @property {string} unauthenticated Indicates that no user is authenticated.
     * @property {string} masterKey Indicates that a master key authentication is used.
     * @property {string} invalidAuthentication Indicates an authentication has been attempted, but it was invalid.
     * @property {string} authenticated Indicates that a user is authenticated.
     * @property {string} authenticating Indicates that a user is currently authenticating. Some requests might be pending and waiting for the user to authenticate.
     * @typedef {string} Everlive.AuthStatus
     */
    AuthStatus: {
        unauthenticated: 'unauthenticated',
        masterKey: 'masterKey',
        invalidAuthentication: 'invalidAuthentication',
        authenticated: 'authenticated',
        expiredAuthentication: 'expiredAuthentication',
        authenticating: 'authenticating'
    },
    offlineItemStates: {
        created: 'created',
        modified: 'modified',
        deleted: 'deleted'
    },

    /**
     * HTTP Methods
     * @enum {string}
     */
    HttpMethod: {
        GET: 'GET',
        POST: 'POST',
        PUT: 'PUT',
        DELETE: 'DELETE'
    },
    maxDistanceConsts: {
        radians: '$maxDistance',
        km: '$maxDistanceInKilometers',
        miles: '$maxDistanceInMiles'
    },
    radiusConsts: {
        radians: 'radius',
        km: 'radiusInKilometers',
        miles: 'radiusInMiles'
    }
};

// using an invalid field name in the context of Everlive
// to ensure no naming collisions can occur
constants.offlineItemsStateMarker = '__everlive_offline_state';

constants.SyncErrors = {
    generalError: 'generalError',
    itemSyncError: 'itemSyncError'
};

constants.syncBatchSize = 10;

constants.AuthStoreKey = '__everlive_auth_key';

// the minimum interval between sync requests
constants.defaultSyncInterval = 1000 * 60 * 10; // 10 minutes

module.exports = constants;
},{}],64:[function(require,module,exports){
(function (global){
var isNativeScriptApplication = Boolean(((typeof android !== 'undefined' && android && android.widget && android.widget.Button)
    || (typeof UIButton !== 'undefined' && UIButton)));

if (isNativeScriptApplication) {
    global.isNativeScriptApplication = isNativeScriptApplication;
    global.isCordovaApplication = false;

    global.window = {
            localStorage: {
                removeItem: function () { } //shim for mongo-query under nativescript
            }
        };
} else if (typeof window !== 'undefined') {
    var isCordovaApplication = /^file:\/{3}[^\/]/i.test(window.location.href) && /ios|iphone|ipod|ipad|android/i.test(navigator.userAgent);
}

var isNodejs = typeof exports === 'object' && typeof window === 'undefined';
var isRequirejs = typeof define === 'function' && define.amd;

module.exports = {
    isCordova: isCordovaApplication,
    isNativeScript: isNativeScriptApplication,
    isNodejs: isNodejs,
    isRequirejs: isRequirejs
};
}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{}],65:[function(require,module,exports){
/*!
 Everlive SDK
 Version 1.2.14
 */
/*global device, define, window, navigator*/
(function () {

    var Everlive = require('./Everlive');
    var platform = require('./everlive.platform');
    var common = require('./common');
    common.root.Everlive = Everlive;

    if (!platform.isNativeScript) {
        var kendo = require('./kendo/kendo.everlive');
        Everlive.createDataSource = kendo.createDataSource;
        Everlive.createHierarchicalDataSource = kendo.createHierarchicalDataSource;
    }

    //Global event handlers for push notification events. Required by the cordova PushNotifications plugin that we use.
    Everlive.PushCallbacks = {};
    Everlive.Offline = {};

    Everlive.Query = require('./query/Query');
    Everlive.QueryBuilder = require('./query/QueryBuilder');
    Everlive.GeoPoint = require('./GeoPoint');
    Everlive.Constants = require('./constants');
    Everlive.Request = require('./Request');
    Everlive.Data = require('./types/Data');
    Everlive._traverseAndRevive = require('./utils').parseUtilities.traverseAndRevive;
    Everlive._utils = require('./utils');

    var persistersModule = require('./offline/offlinePersisters');
    Everlive.persister = {
        LocalStorage: persistersModule.LocalStoragePersister,
        FileSystem: persistersModule.FileSystemPersister
    };

    if (typeof exports === 'object') {
        module.exports = common.root.Everlive;
    }
}());
},{"./Everlive":52,"./GeoPoint":56,"./Request":58,"./common":62,"./constants":63,"./everlive.platform":64,"./kendo/kendo.everlive":66,"./offline/offlinePersisters":70,"./query/Query":73,"./query/QueryBuilder":74,"./types/Data":77,"./utils":80}],66:[function(require,module,exports){
var QueryBuilder = require('../query/QueryBuilder');
var Query = require('../query/Query');
var Request = require('../Request');
var constants = require('../constants');
var _ = require('../common')._;
var Everlive = require('../Everlive');

(function () {
    var $ = window.jQuery;
    var kendo = window.kendo;

    if ($ === undefined || kendo === undefined) {
        return;
    }

    var extend = $.extend;

    var everliveTransport = kendo.data.RemoteTransport.extend({
        init: function (options) {
            this.everlive$ = options.dataProvider || Everlive.$;
            if (!this.everlive$) {
                throw new Error('An instance of the Backend services sdk must be provided.');
            }

            if (!options.typeName) {
                throw new Error('A type name must be provided.');
            }

            this.headers = options.headers;

            this.dataCollection = this.everlive$.data(options.typeName);
            kendo.data.RemoteTransport.fn.init.call(this, options);
        },

        read: function (options) {
            var query = translateKendoQuery(options.data);
            var everliveQuery = new Query(query.$where, null, query.$sort, query.$skip, query.$take);
            var id = options.data.Id;
            if (id) {
                this.dataCollection.withHeaders(this.headers).getById(id).then(options.success, options.error);
            } else {
                this.dataCollection.withHeaders(this.headers).get(everliveQuery).then(options.success, options.error);
            }
        },

        update: function (options) {
            var isMultiple = _.isArray(options.data.models);
            if (isMultiple) {
                throw new Error('Batch update is not supported.');
            } else {
                var itemForUpdate = options.data;
                return this.dataCollection.withHeaders(this.headers).updateSingle(itemForUpdate)
                    .then(options.success.bind(this, itemForUpdate), options.error);
            }
        },

        create: function (options) {
            var isMultiple = _.isArray(options.data.models);
            var createData = isMultiple ? options.data.models : options.data;

            return this.dataCollection.withHeaders(this.headers).create(createData)
                .then(options.success.bind(this, createData), options.error);
        },

        destroy: function (options) {
            var isMultiple = _.isArray(options.data.models);
            if (isMultiple) {
                throw new Error('Batch destroy is not supported.');
            }
            return this.dataCollection.withHeaders(this.headers).destroy(options.data)
                .then(options.success, options.error);
        }
    });

    $.extend(true, kendo.data, {
        transports: {
            everlive: everliveTransport
        },
        schemas: {
            everlive: {
                type: 'json',
                total: 'count',
                data: function (data) {
                    return data.result || data;
                },
                model: {
                    id: constants.idField
                }
            }
        }
    });

    function translateKendoQuery(data) {
        var result = {};
        if (data) {
            if (data.skip) {
                result.$skip = data.skip;
                delete data.skip;
            }
            if (data.take) {
                result.$take = data.take;
                delete data.take;
            }
            if (data.sort) {
                var sortExpressions = data.sort;
                var sort = {};
                if (!$.isArray(sortExpressions)) {
                    sortExpressions = [sortExpressions];
                }
                $.each(sortExpressions, function (idx, value) {
                    sort[value.field] = value.dir === 'asc' ? 1 : -1;
                });
                result.$sort = sort;
                delete data.sort;
            }
            if (data.filter) {
                var filter = filterBuilder.build(data.filter);
                result.$where = filter;
                delete data.filter;
            }
        }
        return result;
    }

    var regexOperations = ['startswith', 'startsWith', 'endswith', 'endsWith', 'contains'];

    var filterBuilder = {
        build: function (filter) {
            return filterBuilder._build(filter);
        },
        _build: function (filter) {
            if (filterBuilder._isRaw(filter)) {
                return filterBuilder._raw(filter);
            }
            else if (filterBuilder._isSimple(filter)) {
                return filterBuilder._simple(filter);
            }
            else if (filterBuilder._isRegex(filter)) {
                return filterBuilder._regex(filter);
            }
            else if (filterBuilder._isAnd(filter)) {
                return filterBuilder._and(filter);
            }
            else if (filterBuilder._isOr(filter)) {
                return filterBuilder._or(filter);
            }
        },
        _isRaw: function (filter) {
            return filter.operator === '_raw';
        },
        _raw: function (filter) {
            var fieldTerm = {};
            fieldTerm[filter.field] = filter.value;
            return fieldTerm;
        },
        _isSimple: function (filter) {
            return typeof filter.logic === 'undefined' && !filterBuilder._isRegex(filter);
        },
        _simple: function (filter) {
            var term = {}, fieldTerm = {};
            var operator = filterBuilder._translateoperator(filter.operator);
            if (operator) {
                term[operator] = filter.value;
            }
            else {
                term = filter.value;
            }
            fieldTerm[filter.field] = term;
            return fieldTerm;
        },
        _isRegex: function (filter) {
            return $.inArray(filter.operator, regexOperations) !== -1;
        },
        _regex: function (filter) {
            var fieldTerm = {};
            var regex = filterBuilder._getRegex(filter);
            fieldTerm[filter.field] = filterBuilder._getRegexValue(regex);
            return fieldTerm;
        },
        _getRegex: function (filter) {
            var pattern = filter.value;
            var filterOperator = filter.operator;
            switch (filterOperator) {
                case 'contains':
                    return new RegExp(".*" + pattern + ".*", "i");
                case 'startsWith': // removing the camel case operators will be a breaking change
                case 'startswith': // the Kendo UI operators are in lower case
                    return new RegExp("^" + pattern, "i");
                case 'endsWith':
                case 'endswith':
                    return new RegExp(pattern + "$", "i");
            }
            throw new Error("Unknown operator type.");
        },
        _getRegexValue: function (regex) {
            return QueryBuilder.prototype._getRegexValue.call(this, regex);
        },
        _isAnd: function (filter) {
            return filter.logic === 'and';
        },
        _and: function (filter) {
            var i, l, term, result = {};
            var operands = filter.filters;
            for (i = 0, l = operands.length; i < l; i++) {
                term = filterBuilder._build(operands[i]);
                result = filterBuilder._andAppend(result, term);
            }
            return result;
        },
        _andAppend: function (andObj, newObj) {
            return QueryBuilder.prototype._andAppend.call(this, andObj, newObj);
        },
        _isOr: function (filter) {
            return filter.logic === 'or';
        },
        _or: function (filter) {
            var i, l, term, result = [];
            var operands = filter.filters;
            for (i = 0, l = operands.length; i < l; i++) {
                term = filterBuilder._build(operands[i]);
                result.push(term);
            }
            return {$or: result};
        },
        _translateoperator: function (operator) {
            switch (operator) {
                case 'eq':
                    return null;
                case 'neq':
                    return "$ne";
                case 'gt':
                    return "$gt";
                case 'lt':
                    return "$lt";
                case 'gte':
                    return "$gte";
                case 'lte':
                    return "$lte";
            }
            throw new Error("Unknown operator type.");
        }
    };

    /**
     * Creates a new Kendo UI [DataSource](http://docs.telerik.com/kendo-ui/api/javascript/data/datasource) that manages a certain Backend Services content type.
     * Kendo UI [DataSource](http://docs.telerik.com/kendo-ui/api/javascript/data/datasource) is used in conjunction with other Kendo UI widgets (such as [ListView](http://docs.telerik.com/kendo-ui/web/listview/overview) and [Grid](http://docs.telerik.com/kendo-ui/web/grid/overview)) to provide an easy way to render data from Backend Services.
     * *including Kendo scripts is required*.
     * @param options data source options. See Kendo UI documentation of [DataSource](http://docs.telerik.com/kendo-ui/api/javascript/data/datasource) for more info.
     * @param options.transport.typeName the content type name in Backend Services that will be managed.
     * @returns {DataSource} A new instance of Kendo UI DataSource. See Kendo UI documentation of [DataSource](http://docs.telerik.com/kendo-ui/api/javascript/data/datasource) for more info.
     * @example ```js
     * var booksDataSource = Everlive.createDataSource({
     *   transport: {
     *     typeName: 'Books'
     *   }
     * });
     * ```
     */
    var createDataSource = function (options) {
        options = options || {};
        var typeName = options.typeName;
        var everlive$ = options.dataProvider || Everlive.$;
        if (!everlive$) {
            throw new Error("You need to instantiate an Everlive instance in order to create a kendo DataSource.");
        }
        if (!typeName) {
            throw new Error("You need to specify a 'typeName' in order to create a kendo DataSource.");
        }
        delete options.typeName;
        delete options.dataProvider;

        var dataSourceOptions = {};
        dataSourceOptions.type = 'everlive';
        dataSourceOptions.transport = {
            typeName: typeName,
            dataProvider: everlive$
        };
        extend(true, dataSourceOptions, options);
        return new kendo.data.DataSource(dataSourceOptions);
    };

    Everlive.prototype.getKendoDataSource = function (typeName, datasourceOptions) {
        var defaultEverliveOptions = {
            type: 'everlive',
            transport: {
                typeName: typeName,
                dataProvider: this
            }
        };

        var dataSourceOptions = _.defaults(defaultEverliveOptions, datasourceOptions);

        return new kendo.data.DataSource(dataSourceOptions);
    };

    module.exports = {
        createDataSource: createDataSource,
        //createHierarchicalDataSource: createHierarchicalDataSource
    };
}());
},{"../Everlive":52,"../Request":58,"../common":62,"../constants":63,"../query/Query":73,"../query/QueryBuilder":74}],67:[function(require,module,exports){
'use strict';

var platform = require('./everlive.platform');
var isNativeScriptApplication = platform.isNativeScript;
var localSettings;

if (isNativeScriptApplication) {
    localSettings = require('application-settings');
}

var localStorageStore = {
    getItem: function (key) {
        return localStorage.getItem(key);
    },

    removeItem: function (key) {
        return localStorage.removeItem(key);
    },

    setItem: function (key, value) {
        return localStorage.setItem(key, value);
    }
};

var localSettingsStore = {
    getItem: function (key) {
        return localSettings.getString(key);
    },

    removeItem: function (key) {
        return localSettings.remove(key);
    },

    setItem: function (key, value) {
        return localSettings.setString(key, value);
    }
};

module.exports = isNativeScriptApplication ? localSettingsStore : localStorageStore;
}, { "./everlive.platform": 64, "application-settings": "application-settings" }], 68: [function (require, module, exports) {
var DataQuery = require('../query/DataQuery');
var everliveErrorModule = require('../EverliveError');
var EverliveError = everliveErrorModule.EverliveError;
var EverliveErrors = everliveErrorModule.EverliveErrors;
var constants = require('../constants');
var offlineItemStates = constants.offlineItemStates;
var Headers = constants.Headers;
var RequestOptionsBuilder = require('../query/RequestOptionsBuilder');
var common = require('../common');
var rsvp = common.rsvp;
var mingo = common.Mingo;
var mongoQuery = common.mongoQuery;
var uuid = common.uuid;
var _ = common._;
var utils = require('../utils');
var Request = require('../Request');
var expandProcessor = require('../ExpandProcessor');
var offlineTransformations = require('./offlineTransformations');
var buildPromise = require('../utils').buildPromise;

/**
 * @class OfflineModule
 * @classDesc A class providing access to some offline storage functionalities.
 */

/**
 * Represents the {@link OfflineModule} class.
 * @memberOf Everlive.prototype
 * @member {OfflineModule} storage
 */

module.exports = (function () {
    function OfflineModule(everlive, options, persister) {
        this.everlive = everlive;
        this.setup = options;
        this._persister = persister;
        this._isSynchronizing = false;
        this._collectionCache = {};
    }

    var getSyncFilterForItem = function (item) {
        return {
            Id: item.Id,
            ModifiedAt: item.ModifiedAt
        }
    };

    function buildUsersErrorMessage(dataQuery) {
        var operation = dataQuery.operation;
        if (operation === DataQuery.operations.userLoginWithProvider ||
            operation === DataQuery.operations.userLinkWithProvider ||
            operation === DataQuery.operations.userUnlinkFromProvider) {
            operation += dataQuery.data.Provider || dataQuery.data.Identity.Provider;
        }

        return 'The Users operation ' + operation + ' is not supported in offline mode';
    }

    var unsupportedUsersOperations = {};
    unsupportedUsersOperations[DataQuery.operations.create] = true;
    unsupportedUsersOperations[DataQuery.operations.update] = true;
    unsupportedUsersOperations[DataQuery.operations.remove] = true;
    unsupportedUsersOperations[DataQuery.operations.removeSingle] = true;
    unsupportedUsersOperations[DataQuery.operations.rawUpdate] = true;
    unsupportedUsersOperations[DataQuery.operations.setAcl] = true;
    unsupportedUsersOperations[DataQuery.operations.setOwner] = true;
    unsupportedUsersOperations[DataQuery.operations.userLoginWithProvider] = true;
    unsupportedUsersOperations[DataQuery.operations.userLinkWithProvider] = true;
    unsupportedUsersOperations[DataQuery.operations.userUnlinkFromProvider] = true;
    unsupportedUsersOperations[DataQuery.operations.userLogin] = true;
    unsupportedUsersOperations[DataQuery.operations.userLogout] = true;
    unsupportedUsersOperations[DataQuery.operations.userChangePassword] = true;

    var unsupportedOfflineHeaders = [Headers.powerFields];

    OfflineModule.prototype = {
        purgeAll: function (success, error) {
            var self = this;
            this._collectionCache = {};
            return buildPromise(function (success, error) {
                self._persister.purgeAll(success, error);
            }, success, error);
        },

        purge: function (contentType, success, error) {
            var self = this;
            return buildPromise(function (success, error) {
                self._persister.purge(contentType, success, error);
            }, success, error);
        },

        processQuery: function (dataQuery) {
            var unsupportedClientOpMessage = this.getUnsupportedClientOpMessage(dataQuery);
            if (unsupportedClientOpMessage && !dataQuery.isSync) {
                return new rsvp.Promise(function (resolve, reject) {
                    reject(new EverliveError(unsupportedClientOpMessage));
                });
            }

            var sort = dataQuery.getHeaderAsJSON(Headers.sort);
            var limit = dataQuery.getHeaderAsJSON(Headers.take);
            var skip = dataQuery.getHeaderAsJSON(Headers.skip);
            var select = dataQuery.getHeaderAsJSON(Headers.select);
            var filter = dataQuery.getHeaderAsJSON(Headers.filter);
            var expand = dataQuery.getHeaderAsJSON(Headers.expand);

            if (dataQuery.filter instanceof Everlive.Query) {
                var filterObj = dataQuery.filter.build();
                filter = filterObj.$where || filter;
                sort = filterObj.$sort || sort;
                limit = filterObj.$take || limit;
                skip = filterObj.$skip || skip;
                select = filterObj.$select || select;
                expand = filterObj.$expand || expand;
            } else {
                filter = dataQuery.filter || filter;
            }

            if (!filter) {
                filter = {};
            }

            var unsupportedOperators = utils.getUnsupportedOperators(filter);
            var unsupportedOperatorCount = unsupportedOperators.length;
            if (unsupportedOperatorCount) {
                return new rsvp.Promise(function (resolve, reject) {
                    var errorMessage;
                    if (unsupportedOperatorCount === 1) {
                        errorMessage = 'The operator ' + unsupportedOperators[0] + ' is not supported in offline mode.';
                    } else {
                        errorMessage = 'The operators ' + unsupportedOperators.join(',') + 'are not supported in offline mode.';
                    }

                    reject(new EverliveError(errorMessage));
                });
            }

            offlineTransformations.traverseAndTransformFilterId(filter);

            switch (dataQuery.operation) {
                case DataQuery.operations.read:
                    return this.read(dataQuery, filter, sort, skip, limit, select, expand);
                case DataQuery.operations.readById:
                    return this.readById(dataQuery, expand);
                case DataQuery.operations.count:
                    return this.count(dataQuery, filter);
                case DataQuery.operations.create:
                    return this.create(dataQuery);
                case DataQuery.operations.rawUpdate:
                case DataQuery.operations.update:
                    return this.update(dataQuery, filter);
                case DataQuery.operations.remove:
                    return this.remove(dataQuery, filter);
                case DataQuery.operations.removeSingle:
                    filter._id = dataQuery.additionalOptions.id;
                    return this.remove(dataQuery, filter);
                default:
                    return new rsvp.Promise(function (resolve, reject) {
                        if (dataQuery.isSync) {
                            resolve();
                        } else {
                            reject(new EverliveError(dataQuery.operation + ' is not supported in offline mode'));
                        }
                    });
            }
        },

        getUnsupportedClientOpMessage: function (dataQuery) {
            for (var i = 0; i < unsupportedOfflineHeaders.length; i++) {
                var header = unsupportedOfflineHeaders[i];
                if (dataQuery.getHeader(header)) {
                    return 'The header ' + header + ' is not supported in offline mode';
                }
            }

            if (dataQuery.collectionName.toLowerCase() === 'files') {
                return 'Operations on files are not supported in offline mode';
            }

            if (dataQuery.collectionName.toLowerCase() === 'users' && unsupportedUsersOperations[dataQuery.operation]) {
                return buildUsersErrorMessage(dataQuery);
            }
        },

        _getCreateResult: function (createdItems) {
            if (createdItems.length === 1) {
                return {
                    result: {
                        CreatedAt: utils.cloneDate(createdItems[0].CreatedAt),
                        Id: createdItems[0]._id
                    }
                }
            } else {
                var multipleCreateResult = [];
                _.each(createdItems, function (createdItem) {
                    multipleCreateResult.push({
                        CreatedAt: utils.cloneDate(createdItem.CreatedAt),
                        Id: createdItem._id
                    });
                });

                return {
                    result: multipleCreateResult
                }
            }
        },

        /**
         * Create the items of the specified type
         * @param dataQuery
         */
        create: function (dataQuery) {
            var self = this;

            return new rsvp.Promise(function (resolve, reject) {
                self._createItems(dataQuery.collectionName, dataQuery.data, dataQuery.isSync, dataQuery.preserveState, function (createdItems) {
                    var createResult = self._getCreateResult(createdItems);
                    resolve(createResult);
                }, reject);
            });
        },

        /**
         * Get items from a content type, based on a filter
         * @param dataQuery {Object} - the data query object
         * @param filter
         * @param sort
         * @param skip
         * @param limit
         * @param select
         * @param expand
         * @returns {RSVP.Promise} - filtered results
         */
        read: function (dataQuery, filter, sort, skip, limit, select, expand) {
            var self = this;

            return new rsvp.Promise(function (resolve, reject) {
                var collectionLength;

                self._prepareExpand(expand, dataQuery, true)
                    .then(function (prepareExpandResult) {
                        if (prepareExpandResult) {
                            select = prepareExpandResult.mainQueryFieldsExpression;
                        }

                        return self._getCollection(dataQuery.collectionName)
                            .then(function (collection) {
                                var result = self._readInternal(collection, filter, sort, skip, limit, select);

                                if (skip || limit) {
                                    var all = self._readInternal(collection);
                                    collectionLength = all.length;
                                }

                                result = offlineTransformations.idTransform(result);
                                return self._expandResult(prepareExpandResult, result);
                            });
                    })
                    .then(function (result) {
                        var response = self._transformOfflineResult(result, collectionLength, dataQuery);
                        resolve(response);
                    })
                    .catch(reject);
            });
        },

        _readInternal: function (collection, filter, sort, skip, limit, select) {
            filter = _.extend({}, filter);
            this._getWithoutDeletedFilter(filter);
            offlineTransformations.traverseAndTransformFilterId(filter);
            var query = mingo.Query(filter);
            var cursor = mingo.Cursor(collection, query, select);
            if (sort) {
                cursor = cursor.sort(sort);
            }

            if (skip) {
                cursor.skip(skip);
            }

            if (limit) {
                cursor.limit(limit);
            }

            return _.map(cursor.all(), function (item) {
                return _.extend({}, item);
            });
        },

        readById: function (dataQuery, expand) {
            var self = this;

            return self._prepareExpand(expand, dataQuery, false)
                .then(function (prepareExpandResult) {
                    return self._getCollection(dataQuery.collectionName)
                        .then(function (collection) {
                            return new rsvp.Promise(function (resolve, reject) {
                                var item = self._getById(collection, dataQuery.additionalOptions.id);

                                if (!item) {
                                    return reject(EverliveErrors.itemNotFound);
                                }

                                item = offlineTransformations.idTransform(item);
                                return self._expandResult(prepareExpandResult, item).then(resolve).catch(reject);
                            });
                        });
                })
                .then(function (result) {
                    var response = self._transformOfflineResult(result, null, dataQuery);
                    return response;
                });
        },

        _prepareExpand: function (expand, dataQuery, isArray) {
            return new rsvp.Promise(function (resolve, reject) {
                if (expand) {
                    expandProcessor.prepare(expand, dataQuery.collectionName, isArray, dataQuery.fields, null, null, function (err, prepareResult) {
                        if (err) {
                            return reject(err);
                        }
                        resolve(prepareResult);
                    });
                } else {
                    resolve();
                }
            });
        },

        _expandResult: function (prepareExpandResult, result) {
            var self = this;
            return new rsvp.Promise(function (resolve, reject) {
                if (prepareExpandResult) {
                    expandProcessor.expand(prepareExpandResult.relationsTree, result, {
                        offlineModule: self
                    }, function (err, result) {
                        if (err) {
                            return reject(err);
                        }
                        resolve(result);
                    });
                } else {
                    resolve(result);
                }
            })
        },

        _getWithoutDeletedFilter: function (filter) {
            filter = filter || {};
            filter[constants.offlineItemsStateMarker] = {'$ne': offlineItemStates.deleted};
            return filter;
        },

        /**
         * Update items of a content type
         * @param dataQuery {DataQuery} - the data query
         * @param [filter] {Object}- The filter to apply when updating
         */
        update: function (dataQuery, filter) {
            var self = this;

            return new rsvp.Promise(function (resolve, reject) {
                self._updateItems(dataQuery, dataQuery.data, filter, dataQuery.isSync, resolve, reject);
            });
        },

        /**
         * Remove items from a content type, based on a filter
         * @param dataQuery {DataQuery} - the data query
         * @param [filter] {Object} - Filter to apply when removing
         */
        remove: function (dataQuery, filter) {
            var self = this;
            return new rsvp.Promise(function (resolve, reject) {
                self._removeItems(dataQuery, filter, dataQuery.isSync, resolve, reject);
            });
        },

        count: function (dataQuery, filter) {
            var self = this;

            return new rsvp.Promise(function (resolve, reject) {
                self._getCollection(dataQuery.collectionName)
                    .then(function (collection) {
                        var filterResult = self._readInternal(collection, filter);
                        resolve({result: filterResult.length});
                    }).catch(reject);
            });
        },

        _setOffline: function (offline) {
            this.setup.offline = offline;
        },

        isOnline: function () {
            return !this.setup.offline;
        },

        _prepareSyncData: function (contentTypesForSync) {
            var self = this;

            var contentTypesSyncData = {};
            var conflicts = [];
            _.each(contentTypesForSync, function (contentType, typeName) {
                var syncItems = offlineTransformations.idTransform(contentType.offlineItemsToSync);
                var syncData = self._getSyncItemStates(typeName, syncItems, contentType.serverItems);
                conflicts.push(syncData.conflicts);
                contentTypesSyncData[typeName] = syncData.itemsForSync;
            });

            return {
                conflicts: conflicts,
                contentTypesSyncData: contentTypesSyncData
            };
        },

        _resolveConflicts: function (syncData) {
            var self = this;
            return this._applyResolutionStrategy(syncData.conflicts)
                .then(self._mergeResolvedConflicts.bind(self, syncData.conflicts, syncData.contentTypesSyncData))
                .then(function () {
                    return syncData.contentTypesSyncData;
                });
        },

        isSynchronizing: function () {
            return this._isSynchronizing;
        },

        _fireSyncStart: function () {
            var self = this;

            return new rsvp.Promise(function (resolve) {
                if (!self._isSynchronizing) {
                    self._isSynchronizing = true;
                    self.everlive._emitter.emit('syncStart');
                    resolve();
                } else {
                    resolve();
                }
            });
        },

        _fireSyncEnd: function (syncInfo) {
            this._isSynchronizing = false;
            delete this._syncItemsWithErrors;
            this.everlive._emitter.emit('syncEnd', syncInfo);
        },

        _eachSyncItem: function (items, operation) {
            var self = this;

            _.each(items, function (item) {
                var itemFilter = getSyncFilterForItem(item.remoteItem);
                // if we already have an error for this item we do not want to try and sync it again
                var resultItem = item.resultingItem;
                if (_.some(self._syncItemsWithErrors, {itemId: resultItem.Id})) {
                    return;
                }

                operation(resultItem, itemFilter);
            });
        },

        _addUpdatedItemsForSync: function (contentTypeData, syncPromises, dataCollection) {
            var self = this;
            self._eachSyncItem(contentTypeData.modifiedItems, function (item, itemFilter) {
                syncPromises[item.Id] = dataCollection
                    .isSync(true)
                    .applyOffline(false)
                    .update(item, itemFilter)
                    .then(function (res) {
                        return self._onSyncResponse(res, item, dataCollection.collectionName, DataQuery.operations.update);
                    });
            });
        },

        _addDeletedItemsForSync: function (contentTypeData, syncPromises, dataCollection) {
            var self = this;

            self._eachSyncItem(contentTypeData.deletedItems, function (item, itemFilter) {
                syncPromises[item.Id] = dataCollection
                    .isSync(true)
                    .applyOffline(false)
                    .destroy(itemFilter)
                    .then(function (res) {
                        return self._onSyncResponse(res, item, dataCollection.collectionName, DataQuery.operations.remove);
                    });
            });
        },

        _onSyncResponse: function (res, item, collectionName, operation) {
            if (res.result !== 1) {
                return new rsvp.Promise(function (resolve, reject) {
                    reject(EverliveErrors.syncConflict);
                });
            } else {
                if (operation === DataQuery.operations.update) {
                    var updatedItem = _.extend({}, item, {
                        ModifiedAt: res.ModifiedAt
                    });

                    var updateQuery = new DataQuery({
                        operation: operation,
                        data: updatedItem,
                        additionalOptions: {
                            id: item.Id
                        },
                        collectionName: collectionName,
                        isSync: true
                    });

                    return this.processQuery(updateQuery);
                } else if (operation === DataQuery.operations.remove) {
                    return this._purgeById(collectionName, item.Id);
                }
            }
        },

        _purgeById: function (contentType, itemId) {
            var self = this;

            return self._getCollection(contentType)
                .then(function (collection) {
                    delete collection[itemId];
                    return self._persistData(contentType);
                });
        },

        sync: function () {
            var self = this;

            if (!this.isOnline()) {
                throw new EverliveError('Cannot synchronize while offline');
            }

            self._fireSyncStart()
                .then(self._getServerItemsForSync.bind(self))
                .then(self._prepareSyncData.bind(self))
                .then(self._resolveConflicts.bind(self))
                .then(function (contentTypeSyncData) {
                    var syncPromises = {};
                    _.each(contentTypeSyncData, function (contentTypeData, typeName) {
                        var dataCollection = self.everlive.data(typeName);
                        if (contentTypeData.createdItems.length) {
                            var resultingItemsForCreate = _.pluck(contentTypeData.createdItems, 'resultingItem');
                            syncPromises['create'] =
                                new rsvp.Promise(function (resolve, reject) {
                                    dataCollection
                                        .isSync(true)
                                        .applyOffline(false)
                                        .create(resultingItemsForCreate)
                                        .then(function () {
                                            return dataCollection
                                                .isSync(true)
                                                .useOffline(true)
                                                .create(resultingItemsForCreate);
                                        })
                                        .then(resolve)
                                        .catch(function (err) {
                                            reject({
                                                items: resultingItemsForCreate,
                                                error: err
                                            });
                                        });
                                });
                        }

                        if (contentTypeData.modifiedItems.length) {
                            self._addUpdatedItemsForSync(contentTypeData, syncPromises, dataCollection);
                        }

                        if (contentTypeData.deletedItems.length) {
                            self._addDeletedItemsForSync(contentTypeData, syncPromises, dataCollection);
                        }
                    });

                    return rsvp.hashSettled(syncPromises);
                })
                .then(function (syncResults) {
                    var conflictsWhileSync = [];
                    _.each(syncResults, function (syncResult, itemId) {
                        if (syncResult && syncResult.state === 'rejected') {
                            if (syncResult.reason && syncResult.reason.code === EverliveErrors.syncConflict.code) {
                                conflictsWhileSync.push(syncResult);
                            } else {
                                self._syncItemsWithErrors = self._syncItemsWithErrors || [];
                                // to save time we are using a single create request for all items
                                // this is why if there is an error we need to split the items we tried to create
                                // and set the same error for all items.
                                if (itemId === 'create') {
                                    _.each(syncResult.reason.items, function (item) {
                                        self._syncItemsWithErrors.push({
                                            itemId: item.Id,
                                            error: syncResult.reason.error
                                        });
                                    });
                                } else {
                                    self._syncItemsWithErrors.push({
                                        error: syncResult.reason,
                                        itemId: itemId
                                    });
                                }
                            }
                        }
                    });

                    if (conflictsWhileSync.length) {
                        return self.sync();
                    } else {
                        if (self._syncItemsWithErrors && self._syncItemsWithErrors.length) {
                            self._fireSyncEnd({
                                type: constants.SyncErrors.itemSyncError,
                                items: self._syncItemsWithErrors
                            });
                        } else {
                            self._fireSyncEnd();
                        }
                    }
                })
                .catch(function (err) {
                    self._fireSyncEnd({
                        type: constants.SyncErrors.generalError,
                        error: err
                    });
                });
        },

        _handleKeepServer: function (typeName, conflictingItem, offlineSyncOperations) {
            var serverItem = conflictingItem.serverItem;
            var clientItem = conflictingItem.clientItem;
            var syncQuery;
            if (serverItem && clientItem) {
                // update the item offline
                syncQuery = new DataQuery({
                    collectionName: typeName,
                    operation: DataQuery.operations.update,
                    additionalOptions: {
                        id: serverItem.Id
                    },
                    data: serverItem
                });
            } else if (serverItem && !clientItem) {
                // create item offline
                syncQuery = new DataQuery({
                    collectionName: typeName,
                    operation: DataQuery.operations.create,
                    data: serverItem
                });
            } else if (!serverItem && clientItem) {
                // delete item offline
                syncQuery = new DataQuery({
                    collectionName: typeName,
                    operation: DataQuery.operations.removeSingle,
                    additionalOptions: {
                        id: clientItem.Id
                    }
                });
            } else {
                throw new EverliveError('Both serverItem and clientItem are not set when syncing data with "KeepServer" resolution strategy.');
            }

            syncQuery.isSync = true;
            offlineSyncOperations.push(this.processQuery(syncQuery));
        },

        _handleKeepClient: function (conflictingItem, contentTypeSyncData) {
            var serverItem = conflictingItem.serverItem;
            var clientItem = conflictingItem.clientItem;
            if (serverItem && clientItem) {
                var modifiedObject = _.extend(clientItem, {ModifiedAt: new Date(serverItem.ModifiedAt)});
                if (conflictingItem.result.force) {
                    delete modifiedObject.ModifiedAt;
                }

                contentTypeSyncData.modifiedItems.push({
                    remoteItem: conflictingItem.serverItem,
                    resultingItem: modifiedObject
                });
            } else if (serverItem && !clientItem) {
                contentTypeSyncData.deletedItems.push({
                    remoteItem: conflictingItem.serverItem,
                    resultingItem: serverItem
                });
            } else if (!serverItem && clientItem) {
                contentTypeSyncData.createdItems.push({
                    remoteItem: conflictingItem.serverItem,
                    resultingItem: clientItem
                });
            } else {
                throw new EverliveError('Both serverItem and clientItem are not set when syncing data with "KeepClient" resolution strategy.');
            }
        },

        _handleCustom: function (conflictingItem, typeName, offlineSyncOperations, contentTypeSyncData) {
            var serverItem = conflictingItem.serverItem;
            var clientItem = conflictingItem.clientItem;
            var customItem = conflictingItem.result.item;
            if (serverItem && customItem) {
                var createItemOfflineQuery = new DataQuery({
                    collectionName: typeName,
                    operation: DataQuery.operations.create,
                    data: serverItem // create the server item offline and it will be updated successfully when sync finishes
                });

                createItemOfflineQuery.preserveState = true;
                createItemOfflineQuery.isSync = true;

                offlineSyncOperations.push(this.processQuery(createItemOfflineQuery));
            }

            if (serverItem && customItem && !clientItem) {
                customItem.Id = serverItem.Id;
                contentTypeSyncData.modifiedItems.push({
                    remoteItem: serverItem,
                    resultingItem: customItem
                });
            } else if (serverItem && !customItem) {
                contentTypeSyncData.deletedItems.push({
                    remoteItem: conflictingItem.serverItem,
                    resultingItem: serverItem
                });
            } else if (!serverItem && customItem && clientItem) {
                var updateItemOfflineQuery = new DataQuery({
                    collectionName: typeName,
                    operation: DataQuery.operations.update,
                    data: customItem,
                    additionalOptions: {
                        id: clientItem.Id
                    }
                });

                offlineSyncOperations.push(this.processQuery(updateItemOfflineQuery));
                customItem.Id = clientItem.Id;

                contentTypeSyncData.createdItems.push({
                    remoteItem: serverItem,
                    resultingItem: customItem
                });
            } else {
                customItem.Id = serverItem.Id;
                contentTypeSyncData.modifiedItems.push({
                    remoteItem: serverItem,
                    resultingItem: customItem
                });
            }
        },

        _mergeResolvedConflicts: function (conflicts, syncData) {
            var self = this;

            var offlineSyncOperations = [];
            _.each(conflicts, function (conflict) {
                var typeName = conflict.contentTypeName;
                _.each(conflict.conflictingItems, function (conflictingItem) {
                    var contentTypeSyncData = syncData[typeName];
                    switch (conflictingItem.result.resolutionType) {
                        case constants.ConflictResolution.KeepServer:
                            self._handleKeepServer(typeName, conflictingItem, offlineSyncOperations);
                            break;
                        case constants.ConflictResolution.KeepClient:
                            self._handleKeepClient(conflictingItem, contentTypeSyncData);
                            break;
                        case constants.ConflictResolution.Custom:
                            self._handleCustom(conflictingItem, typeName, offlineSyncOperations, contentTypeSyncData);
                            break;
                    }
                });
            });

            return rsvp.all(offlineSyncOperations);
        },

        _getSyncItemStates: function (contentType, offlineItems, serverItems) {
            var contentTypeSyncData = {
                itemsForSync: {
                    createdItems: [],
                    modifiedItems: [],
                    deletedItems: []
                },
                conflicts: {
                    contentTypeName: contentType,
                    conflictingItems: []
                }
            };

            _.each(offlineItems, function (offlineItem) {
                var serverItem = _.findWhere(serverItems, {Id: offlineItem.Id});
                if (serverItem) {
                    var clientItemChanged = !!offlineItem[constants.offlineItemsStateMarker];
                    var hasUpdateConflict = false;

                    if (clientItemChanged) {
                        hasUpdateConflict = serverItem.ModifiedAt.getTime() !== offlineItem.ModifiedAt.getTime();
                    }

                    if (hasUpdateConflict) {
                        contentTypeSyncData.conflicts.conflictingItems.push({
                            // if the item was modified on the server and deleted locally we have a conflict and set the client item to null
                            // otherwise it is a simple modification conflict
                            clientItem: offlineItem[constants.offlineItemsStateMarker] === offlineItemStates.deleted ? null : offlineItem,
                            serverItem: serverItem,
                            result: {}
                        });
                    } else {
                        if (offlineItem[constants.offlineItemsStateMarker] === offlineItemStates.deleted) {
                            contentTypeSyncData.itemsForSync.deletedItems.push({
                                remoteItem: serverItem,
                                resultingItem: offlineItem
                            });
                        } else {
                            contentTypeSyncData.itemsForSync.modifiedItems.push({
                                remoteItem: serverItem,
                                resultingItem: offlineItem
                            });
                        }
                    }
                } else {
                    // if the item in memory has been modified, but the item on the server has been deleted
                    if (offlineItem[constants.offlineItemsStateMarker] === offlineItemStates.modified) {
                        contentTypeSyncData.conflicts.conflictingItems.push({
                            clientItem: offlineItem,
                            serverItem: null,
                            result: {}
                        });
                    } else {
                        contentTypeSyncData.itemsForSync.createdItems.push({
                            remoteItem: serverItem,
                            resultingItem: offlineItem
                        });
                    }
                }

                delete offlineItem[constants.offlineItemsStateMarker];
            });

            return contentTypeSyncData;
        },

        _setResolutionTypeForItem: function (resolutionType, force, conflictingItem) {
            conflictingItem.result = {
                resolutionType: resolutionType,
                force: force
            };
        },

        _applyResolutionStrategy: function (conflicts) {
            var self = this;
            var conflictResolutionStrategy = self.setup.conflictResolution;
            var promise = new rsvp.Promise(function (resolve, reject) {
                for (var i = 0; i < conflicts.length; i++) {
                    var conflict = conflicts[i];
                    if (conflict.conflictingItems.length) {
                        switch (conflictResolutionStrategy) {
                            case constants.ConflictResolutionStrategy.ServerWins:
                                _.each(conflict.conflictingItems,
                                    self._setResolutionTypeForItem.bind(self, constants.ConflictResolution.KeepServer, false));
                                break;
                            case constants.ConflictResolutionStrategy.ClientWins:
                                _.each(conflict.conflictingItems,
                                    self._setResolutionTypeForItem.bind(self, constants.ConflictResolution.KeepClient, true));
                                break;
                            case constants.ConflictResolutionStrategy.Custom:
                                var customStrategy = self.setup.conflictResolutionStrategy;
                                customStrategy(conflicts, resolve);
                                break;
                            default:
                                return reject(new EverliveError('Invalid resolution strategy provided'));
                        }
                    }
                }

                resolve();
            });

            return promise;
        },

        _getSyncPromiseBatch: function (contentType, batchIds) {
            var self = this;

            return new rsvp.Promise(function (resolve, reject) {
                var dataQuery = new DataQuery({
                    collectionName: contentType,
                    filter: {
                        'Id': {
                            '$in': batchIds
                        }
                    },
                    operation: DataQuery.operations.read,
                    onSuccess: function (res) {
                        resolve(res.result);
                    },
                    applyOffline: false,
                    onError: reject
                });

                var getRequestOptionsFromQuery = RequestOptionsBuilder[dataQuery.operation];
                var requestOptions = getRequestOptionsFromQuery(dataQuery);
                var request = new Request(self.everlive.setup, requestOptions);
                request.send();
            });
        },

        _getSyncPromiseForCollection: function (collection, contentType) {
            var self = this;

            var batches = [];
            var batchSize = constants.syncBatchSize;

            var offlineItemsToSync = self._getDirtyItems(collection);
            var allIdsForSync = _.pluck(offlineItemsToSync, '_id');

            var batchCount = Math.ceil(allIdsForSync.length / batchSize);

            for (var i = 0; i < batchCount; i++) {
                var batchSkipSize = i * batchSize;
                var batchIds = allIdsForSync.slice(batchSkipSize, batchSkipSize + batchSize);
                var syncGetServerItemsPromise = this._getSyncPromiseBatch(contentType, batchIds);
                batches.push(syncGetServerItemsPromise);
            }

            return rsvp.all(batches)
                .then(function (serverItemsSyncResponses) {
                    var result = {
                        serverItems: []
                    };

                    _.each(serverItemsSyncResponses, function (serverItems) {
                        result.serverItems = _.union(result.serverItems, serverItems);
                    });

                    result.offlineItemsToSync = offlineItemsToSync;
                    return result;
                });
        },

        _getServerItemsForSync: function () {
            var self = this;

            return this._getAllCollections()
                .then(function (collections) {
                    var promises = {};
                    _.each(collections, function (collection, contentType) {
                        promises[contentType] = self._getSyncPromiseForCollection(collection, contentType);
                    });

                    return rsvp.hash(promises);
                });
        },

        _getDirtyItems: function (collection) {
            var filter = {};
            filter[constants.offlineItemsStateMarker] = {$exists: true};
            var query = mingo.Query(filter);
            var cursor = mingo.Cursor(collection, query);
            return cursor.all();
        },

        _getAllCollections: function () {
            return new rsvp.Promise(this._persister.getAllData.bind(this._persister));
        },

        _getCollection: function (contentType) {
            var self = this;

            return new rsvp.Promise(function (resolve, reject) {
                // check the persister if there is no data in the collection cache for this content type
                if (!self._collectionCache[contentType]) {
                    self._persister.getData(contentType, function (data) {
                        self._collectionCache[contentType] = data || {};
                        resolve(self._collectionCache[contentType]);
                    }, reject);
                } else {
                    resolve(self._collectionCache[contentType]);
                }
            });
        },

        _persistData: function (contentType) {
            var self = this;

            return new rsvp.Promise(function (resolve, reject) {
                var contentTypeData = self._collectionCache[contentType];
                self._persister.saveData(contentType, contentTypeData, resolve, reject);
            });
        },

        _getById: function (collection, id) {
            if (!id) {
                throw new EverliveError('Id field is mandatory when using offline storage');
            }

            if (collection[id]) {
                var item = _.extend({}, collection[id]);
                var isDeleted = item && item[constants.offlineItemsStateMarker] === offlineItemStates.deleted;

                return isDeleted ? undefined : item;
            }
        },

        _setItem: function (collection, item, state) {
            if (!state) {
                delete item[constants.offlineItemsStateMarker];
            } else {
                item[constants.offlineItemsStateMarker] = state;
            }

            collection[item._id] = item;
        },

        _createItems: function (contentType, items, isSync, preserveState, success, error) {
            var self = this;
            this._getCollection(contentType)
                .then(function (collection) {
                    var itemsForCreate = _.isArray(items) ? items : [items];
                    var createdItems = _.map(itemsForCreate, function (currentItem, index) {
                        var itemToCreate = _.extend({}, currentItem);

                        itemToCreate._id = itemToCreate.Id || uuid.v1();
                        delete itemToCreate.Id;

                        var existingItem = self._getById(collection, itemToCreate._id);
                        var itemExists = !!existingItem;
                        var state;
                        if (itemExists && (!isSync && !preserveState)) {
                            // TODO: [offline] return the same error as the server does
                            return error(new Error('An item with the specified id already exists'));
                        } else {
                            if (isSync && preserveState && itemExists) {
                                state = existingItem[constants.offlineItemsStateMarker];
                            } else {
                                state = isSync ? undefined : offlineItemStates.created; // set the state to created only if not syncing
                            }
                        }

                        // we need to manually clone the dates in order to dereference them from the original object as
                        // _.extends will pass a reference to the original date instead of creating a new instance
                        if (currentItem.CreatedAt && currentItem.CreatedAt instanceof Date) {
                            itemToCreate.CreatedAt = utils.cloneDate(currentItem.CreatedAt);
                        } else {
                            itemToCreate.CreatedAt = new Date();
                        }

                        if (currentItem.ModifiedAt && currentItem.ModifiedAt instanceof Date) {
                            itemToCreate.ModifiedAt = utils.cloneDate(currentItem.ModifiedAt);
                        } else {
                            itemToCreate.ModifiedAt = utils.cloneDate(itemToCreate.CreatedAt);
                        }

                        self._setItem(collection, itemToCreate, state);
                        return itemToCreate;
                    });

                    return self._persistData(contentType).then(function () {
                        success(createdItems);
                    });
                }).catch(error);
        },

        _applyUpdateOperation: function (originalUpdateExpression, itemToUpdate, collection, hasDbOperator, isSync) {
            var updateExpression;
            if (!hasDbOperator) {
                updateExpression = {
                    $set: _.extend({}, originalUpdateExpression)
                };
            } else {
                updateExpression = _.extend({}, originalUpdateExpression);
            }

            updateExpression.$set = _.extend({}, updateExpression.$set);

            if (isSync) {
                updateExpression.$set.ModifiedAt = utils.cloneDate(originalUpdateExpression.ModifiedAt);
            }

            mongoQuery(itemToUpdate, {}, updateExpression, {strict: true}); // Setting strict to true so only exact matches would be updated

            itemToUpdate._id = itemToUpdate._id || updateExpression._id || updateExpression.Id;
            delete itemToUpdate.Id;

            var newState;
            if (isSync) {
                newState = undefined;
            } else if (itemToUpdate[constants.offlineItemsStateMarker] === offlineItemStates.created) {
                newState = offlineItemStates.created;
            } else {
                newState = offlineItemStates.modified;
            }
            this._setItem(collection, itemToUpdate, newState);
        },

        _updateItems: function (dataQuery, updateExpression, filter, isSync, resolve, reject) {
            var self = this;

            self._getCollection(dataQuery.collectionName)
                .then(function (collection) {
                    var updateItems;

                    var dbOperators = utils.getDbOperators(updateExpression, true);
                    var hasDbOperator = dbOperators.length !== 0;

                    if (dataQuery.additionalOptions && dataQuery.additionalOptions.id) {
                        itemToUpdate = self._getById(collection, dataQuery.additionalOptions.id);
                        self._applyUpdateOperation(updateExpression, itemToUpdate, collection, hasDbOperator, isSync);
                        updateItems = [itemToUpdate];
                    } else {
                        updateItems = self._readInternal(collection, filter);
                        for (var i = 0; i < updateItems.length; i++) {
                            var itemToUpdate = updateItems[i];
                            var itemExists = !!self._getById(collection, itemToUpdate._id.toString());

                            if (!itemExists && !isSync) {
                                return reject(EverliveErrors.itemNotFound);
                            }

                            self._applyUpdateOperation(updateExpression, itemToUpdate, collection, hasDbOperator, isSync);
                        }
                    }

                    return self._persistData(dataQuery.collectionName)
                        .then(function () {
                            var result = {
                                ModifiedAt: updateItems[0].ModifiedAt,
                                result: updateItems.length
                            };

                            resolve(result);
                        });
                }).catch(reject);
        },

        _clearItem: function (collection, item) {
            delete collection[item._id];
        },

        _removeItems: function (dataQuery, filter, isSync, resolve, reject) {
            var self = this;

            self._getCollection(dataQuery.collectionName)
                .then(function (collection) {
                    var itemsToRemove = self._readInternal(collection, filter);

                    for (var i = 0; i < itemsToRemove.length; i++) {
                        var itemToRemove = itemsToRemove[i];
                        itemToRemove._id = itemToRemove._id || itemToRemove.Id;
                        var itemExists = !!self._getById(collection, itemToRemove._id.toString());

                        if (!itemExists && !isSync) {
                            return reject(new EverliveError('Cannot delete item - item with id ' + itemToRemove._id + ' does not exist.'));
                        }

                        var removeFromMemory = itemToRemove[constants.offlineItemsStateMarker] === offlineItemStates.created || isSync;
                        if (removeFromMemory) {
                            self._clearItem(collection, itemToRemove);
                        } else {
                            self._setItem(collection, itemToRemove, offlineItemStates.deleted);
                        }
                    }

                    return self._persistData(dataQuery.collectionName)
                        .then(function () {
                            var response = self._transformOfflineResult(itemsToRemove.length);
                            resolve(response);
                        });
                }).catch(reject);
        },

        _applyTransformations: function (transformedResult, transformations) {
            if (Array.isArray(transformedResult.result)) {
                _.each(transformations, function (transformation) {
                    transformedResult.result.map(function (value, key) {
                        transformedResult.result[key] = transformation(value);
                    });
                });
            } else {
                _.each(transformations, function (transformation) {
                    transformedResult.result = transformation(transformedResult.result);
                });
            }
        },

        _transformOfflineResult: function (resultSet, count, dataQuery, additionalTransformations) {
            var transformedResult = {
                result: resultSet,
                count: count || (resultSet || []).length
            };

            if ((count !== undefined && count !== null) || Array.isArray(resultSet)) {
                transformedResult.count = count || resultSet.length;
            }

            var transformations = [];
            transformations.push(offlineTransformations.idTransform);
            transformations.push(offlineTransformations.removeMarkersTransform);

            if (dataQuery) {
                var includeCount = dataQuery.getHeader(Headers.includeCount);
                if (includeCount === false) {
                    delete transformedResult.count;
                }

                var singleFieldExpression = dataQuery.getHeader(Headers.singleField);
                if (typeof singleFieldExpression === 'string') {
                    transformations.push(offlineTransformations.singleFieldTransform.bind(this, singleFieldExpression));
                }
            }

            if (additionalTransformations) {
                transformations = transformations.concat(additionalTransformations);
            }

            this._applyTransformations(transformedResult, transformations);

            if (transformedResult.count === undefined) {
                delete transformedResult.count;
            }

            return transformedResult;
        }
    };

    return OfflineModule;
})();
},{"../EverliveError":53,"../ExpandProcessor":54,"../Request":58,"../common":62,"../constants":63,"../query/DataQuery":72,"../query/RequestOptionsBuilder":75,"../utils":80,"./offlineTransformations":71}],69:[function(require,module,exports){
var constants = require('../constants');
var persistersModule = require('./offlinePersisters');
var LocalStoragePersister = persistersModule.LocalStoragePersister;
var FileSystemPersister = persistersModule.FileSystemPersister;
var OfflineStorageModule = require('./OfflineStorageModule');
var EverliveError = require('../EverliveError').EverliveError;
var isNativeScript = require('../everlive.platform').isNativeScript;
var common = require('../common');
var _ = common._;
var rsvp = common.rsvp;

var defaultOfflineStorageOptions = {
    autoSync: true,
    enabled: true,
    conflictResolution: constants.ConflictResolutionStrategy.ClientWins,
    offline: false,
    provider: {
        type: isNativeScript ? constants.StorageProviders.FileSystem : constants.StorageProviders.LocalStorage
    },
    syncStart: function (cb) {
        cb();
    },
    syncEnd: _.noop,
    syncInterval: constants.defaultSyncInterval
};

module.exports = (function () {

    var conflictResolutionStrategies = {};

    conflictResolutionStrategies[constants.ConflictResolutionStrategy.ClientWins] = function (collection, local, server) {
        return new rsvp.Promise(function (resolve) {
            resolve(local);
        });
    };

    conflictResolutionStrategies[constants.ConflictResolutionStrategy.ServerWins] = function (collection, local, server) {
        return new rsvp.Promise(function (resolve) {
            resolve(server);
        });
    };

    var buildOfflineStorageModule = function (storageOptions) {
        var options;
        if (storageOptions === true) { // explicit check for shorthand initialization
            options = _.defaults({}, defaultOfflineStorageOptions);
        } else if (_.isObject(storageOptions)) {
            options = _.defaults(storageOptions, defaultOfflineStorageOptions);
        } else {
            return;
        }

        var persister;
        var providerType = options.provider.type;
        var storageKey = options.name || 'everliveOfflineStorage_' + this.setup.apiKey;
        if (typeof providerType === 'function') {
            persister = new providerType(storageKey, storageOptions.customOptions);
            throw new EverliveError('Custom storage not yet supported');
        } else {
            switch (providerType) {
                case constants.StorageProviders.LocalStorage:
                    persister = new LocalStoragePersister(storageKey);
                    break;
                case constants.StorageProviders.FileSystem:
                    persister = new FileSystemPersister(storageKey);
                    break;
                default:
                    throw new EverliveError('Unsupported storage type');
            }
        }

        return new OfflineStorageModule(this, options, persister);
    };

    var initOfflineStorage = function (options) {
        this.offlineStorage = buildOfflineStorageModule.call(this, options.offlineStorage);
    };

    return {
        initOfflineStorage: initOfflineStorage
    }
}());
},{"../EverliveError":53,"../common":62,"../constants":63,"../everlive.platform":64,"./OfflineStorageModule":68,"./offlinePersisters":70}],70:[function(require,module,exports){
var common = require('../common');
var _ = common._;
var platform = require('../everlive.platform');
var isNativeScript = platform.isNativeScript;
var isCordova = platform.isCordova;
var rsvp = common.rsvp;
var parseUtilities = require('../utils').parseUtilities;
var EverliveError = require('../EverliveError').EverliveError;

/**
 * Can be one of the following types: {@link LocalStoragePersister},
 * {@link FileSystemPersister} or a custom based on {@link BasePersister}
 * @memberOf OfflineModule
 * @instance
 * @member {BasePersister} local
 */

var BasePersister = (function () {

    /**
     * @class BasePersister
     * @classdesc An abstraction layer for all persisters. Every persister can write/read
     * data from a specific place. The data is saved as key-value pairs where the keys are
     * content types.
     */
    function BasePersister() {
    }

    BasePersister.prototype = {
        /**
         * Gets all the saved data.
         * @method getAllData
         * @memberof BasePersister
         * @param {Function} success A success callback
         * @param {Function} error An error callback
         * @returns {Object} Keys are the content types and the values are the corresponding data
         */
        getAllData: function (success, error) {
            throw new EverliveError('The method getAllData is not implemented');
        },

        /**
         * Returns the saved data for a specific content type
         * @method getData
         * @param {string} contentType The content type for which to retreive the data
         * @param {Function} success A success callback
         * @param {Function} error An error callback
         * @memberof BasePersister
         * @returns {Object} The retrieved data
         */
        getData: function (contentType, success, error) {
            throw new EverliveError('The method getData is not implemented');
        },

        /**
         * Saves data for a specific content type
         * @method saveData
         * @param {string} contentType The content for which to save the data
         * @param {object} data The data corresponding to the specified content type
         * @param {Function} success A success callback
         * @param {Function} error An error callback
         * @memberof BasePersister
         */
        saveData: function (contentType, data, success, error) {
            throw new EverliveError('The method saveData is not implemented');
        },

        /**
         * Clears the persisted data for a specific content type
         * @method clear
         * @param {string} contentType The content type for which to clear the data
         * @param {Function} success A success callback
         * @param {Function} error An error callback
         * @memberof BasePersister
         */
        purge: function (contentType, success, error) {
            throw new EverliveError('The method clear is not implemented');
        },

        /**
         * Clears the persisted data for a content type
         * @method clearAll
         * @memberof BasePersister
         * @param {Function} success A success callback
         * @param {Function} error An error callback
         */
        purgeAll: function (success, error) {
            throw new EverliveError('The method clearAll is not implemented');
        },

        _getKey: function (contentType) {
            return this.key + '_' + contentType;
        }
    };

    return BasePersister;
}());

var LocalStoragePersister = (function () {
    /**
     * @class LocalStoragePersister
     * @extends BasePersister
     */
    function LocalStoragePersister(key) {
        this.key = key;
        this._localStore = require('../localStore');
    }

    _.extend(LocalStoragePersister.prototype, BasePersister.prototype, {
        getAllData: function (success, error) {
            var self = this;
            var contentTypes = this._getContentTypes();
            var allCollections = {};
            _.each(contentTypes, function (contentType) {
                allCollections[contentType] = new rsvp.Promise(function (resolve, reject) {
                    self.getData(contentType, resolve, reject);
                });
            });

            rsvp.hash(allCollections).then(success, error);
        },

        getData: function (contentType, success, error) {
            try {
                var key = this._getKey(contentType);
                var storedItem = this._getItem(key) || '{}';
                var reviver = parseUtilities.getReviver();
                var storedItemObject = JSON.parse(storedItem, reviver);
                success(storedItemObject);
            } catch (err) {
                error(err);
            }
        },

        saveData: function (contentType, data, success, error) {
            try {
                var collectionsString = JSON.stringify(data);
                var contentTypeKey = this._getKey(contentType);
                this._setItem(contentTypeKey, collectionsString);
                success();
            } catch (err) {
                error(err);
            }
        },

        purge: function (contentType, success, error) {
            try {
                var key = this._getKey(contentType);
                this._removeItem(key);
                success();
            } catch (err) {
                error(err);
            }
        },

        purgeAll: function (success, error) {
            try {
                var self = this;

                var contentTypes = this._getContentTypes();
                _.each(contentTypes, function (contentType) {
                    var contentTypeKey = self._getKey(contentType);
                    self._removeItem(contentTypeKey);
                });

                var contentTypesKey = this._getContentTypesCollectionKey();
                this._removeItem(contentTypesKey);

                success();
            } catch (err) {
                error(err);
            }
        },

        _getItem: function (key) {
            return this._localStore.getItem(key);
        },

        _removeItem: function (key) {
            return this._localStore.removeItem(key);
        },

        _setItem: function (key, value) {
            return this._localStore.setItem(key, value);
        },

        _getKey: function (contentType) {
            this._addTypeToCollectionsCache(contentType);
            return this.key + '_' + contentType;
        },

        _getContentTypesCollectionKey: function () {
            return this.key + '@ContentTypes';
        },

        _getContentTypes: function () {
            var collectionKey = this._getContentTypesCollectionKey();
            var localStorageString = this._getItem(collectionKey);

            if (localStorageString) {
                return JSON.parse(localStorageString);
            }

            return [];
        },

        _setContentTypesCollection: function (collection) {
            var collectionKey = this._getContentTypesCollectionKey();
            this._setItem(collectionKey, JSON.stringify(collection));
        },

        _addTypeToCollectionsCache: function (typeName) {
            var contentTypesCollection = this._getContentTypes();
            if (!_.contains(contentTypesCollection, typeName)) {
                contentTypesCollection.push(typeName);
                this._setContentTypesCollection(contentTypesCollection);
            }
        }
    });

    return LocalStoragePersister;
}());

var FileSystemPersister = (function () {
    /**
     * @class FileSystemPersister
     * @extends BasePersister
     */
    function FileSystemPersister(key) {
        var separator = '/';
        if (!isCordova && !isNativeScript) {
            throw new EverliveError('FileSystemPersister can be used only with Cordova and NativeScript');
        }

        if (isCordova) {
            if (!cordova && !cordova.file) {
                throw new EverliveError('You need to enable the cordova file plugin to use file offline storage. ' +
                'Make sure to initialize your Everlive instance after the "deviceReady" event has fired.');
            }

            this.dataDirectoryPath = cordova.file.dataDirectory;
        } else if (isNativeScript) {
            this.fs = require('file-system');
            separator = this.fs.path.separator;
            this.dataDirectoryPath = this.fs.knownFolders.currentApp().path;
        }

        this.key = key;
        this.contentTypesStoreKey = '@ContentTypes';
        this.filesDirectoryPath = 'el_store' + separator;
    }

    _.extend(FileSystemPersister.prototype, BasePersister.prototype, {
        getAllData: function (success, error) {
            var self = this;
            var errorHandler = this._fileSystemErrorHandler(error);
            var promises = {};
            this._getContentTypesMetadata(function (contentTypes) {
                Object.keys(contentTypes).forEach(function (contentType) {
                    promises[contentType] = new rsvp.Promise(function (resolve, reject) {
                        self.getData(contentType, resolve, reject);
                    });
                });

                rsvp.hash(promises).then(success, errorHandler);
            }, errorHandler);
        },

        getData: function (contentType, success, error) {
            var self = this;
            var errorHandler = this._fileSystemErrorHandler(error);
            this._getFileFull(contentType, function (fileEntry) {
                self._readFileContent(fileEntry, success, errorHandler);
            });
        },

        saveData: function (contentType, data, success, error) {
            var self = this;
            var dataString = JSON.stringify(data);
            var errorHandler = this._fileSystemErrorHandler(error);
            this._getFileFull(contentType, function (fileEntry) {
                self._writeFileContent(fileEntry, dataString, function () {
                    self._saveContentTypesMetadata(contentType, success, errorHandler);
                }, errorHandler);
            }, errorHandler);
        },

        purge: function (contentType, success, error) {
            var self = this;
            var errorHandler = this._fileSystemErrorHandler(error);
            this._getFileFull(contentType, function (fileEntry) {
                self._removeFile(fileEntry, success, error);
            }, errorHandler);
        },

        purgeAll: function (success, error) {
            var self = this;
            var errorHandler = this._fileSystemErrorHandler(error);
            this._resolveDataDirectory(function (dataDirEntry) {
                self._removeFilesDirectory(dataDirEntry, success, errorHandler);
            }, errorHandler);
        },

        _getContentTypesMetadata: function (success, error) {
            this.getData(this.contentTypesStoreKey, success, error);
        },

        _saveContentTypesMetadata: function (contentType, success, error) {
            var self = this;
            this._getContentTypesMetadata(function (savedContentTypes) {
                savedContentTypes[contentType] = true;
                self._getFileFull(self.contentTypesStoreKey, function (contentTypesFile) {
                    self._writeFileContent(contentTypesFile, JSON.stringify(savedContentTypes), success, error);
                }, error);
            });
        },

        _getFileFull: function (contentType, success, error) {
            var self = this;
            this._ensureFilesDirectory(function () {
                var path = self._getFilePath(contentType);
                self._getFile(path, success, error);
            }, error);
        },

        _removeFilesDirectory: function (directoryEntry, success, error) {
            if (isCordova) {
                directoryEntry.getDirectory(this.filesDirectoryPath, {
                    create: true,
                    exclusive: false
                }, function (filesDirEntry) {
                    filesDirEntry.removeRecursively(function () {
                        success();
                    }, error);
                }, error)
            } else if (isNativeScript) {
                var filesDirectoryPath = this.fs.path.join(directoryEntry.path, this.filesDirectoryPath);
                var filesDirectory = this.fs.Folder.fromPath(filesDirectoryPath);
                filesDirectory.remove().then(success, error);
            }
        },

        _removeFile: function (fileEntry, success, error) {
            if (isCordova) {
                fileEntry.remove(function () {
                    success();
                }, error);
            } else if (isNativeScript) {
                fileEntry.remove().then(success, error);
            }
        },

        _readFileContent: function (fileEntry, success, error) {
            var readTextSuccess = function (content) {
                var reviver = parseUtilities.getReviver();
                var resultObject = JSON.parse(content || '{}', reviver);
                success(resultObject);
            };

            if (isCordova) {
                fileEntry.file(function (file) {
                    var reader = new FileReader();
                    reader.onloadend = function () {
                        readTextSuccess(this.result);
                    };
                    reader.onerror = error;
                    reader.readAsText(file);
                }, error);
            } else if (isNativeScript) {
                fileEntry.readText().then(readTextSuccess, error);
            }
        },

        _writeFileContent: function (fileEntry, content, success, error) {
            if (isCordova) {
                fileEntry.createWriter(function (fileWriter) {
                    fileWriter.onwriteend = function () {
                        success();
                    };
                    fileWriter.onerror = error;
                    fileWriter.write(content);
                }, error);
            } else if (isNativeScript) {
                fileEntry.writeText(content).then(success, error);
            }
        },

        _getFile: function (path, success, error) {
            this._resolveDataDirectory(function (directoryEntry) {
                if (isCordova) {
                    directoryEntry.getFile(path, {
                        create: true,
                        exclusive: false
                    }, success, error);
                } else if (isNativeScript) {
                    var fullFilePath = this.fs.path.join(directoryEntry.path, path);
                    var file = this.fs.File.fromPath(fullFilePath);
                    success(file);
                }
            }.bind(this), error)
        },

        _getFilePath: function (contentType) {
            return this.filesDirectoryPath + this._getKey(contentType);
        },

        _resolveDataDirectory: function (success, error) {
            if (isCordova) {
                resolveLocalFileSystemURL(this.dataDirectoryPath, success, error);
            } else if (isNativeScript) {
                var dataDirectory = this.fs.Folder.fromPath(this.dataDirectoryPath);
                success(dataDirectory);
            }
        },

        _ensureFilesDirectory: function (success, error) {
            var filesDirectoryPath = this.filesDirectoryPath;
            this._resolveDataDirectory(function (directoryEntry) {
                if (isCordova) {
                    directoryEntry.getDirectory(filesDirectoryPath, {
                        create: true,
                        exclusive: false
                    }, success, error);
                } else if (isNativeScript) {
                    var fileDirectoryPath = this.fs.path.join(directoryEntry.path, filesDirectoryPath);
                    this.fs.Folder.fromPath(fileDirectoryPath);
                    success();
                }
            }.bind(this), error);
        },

        _fileSystemErrorHandler: function (callback) {
            if (!isNativeScript) {
                var errorsMap = {};
                _.each(Object.keys(FileError), function (error) {
                    errorsMap[FileError[error]] = error;
                });

                return function (e) {
                    var msg = errorsMap[e.code];
                    console.log('Error: ' + msg);
                    e.message = msg;
                    callback && callback(e);
                }
            }

            return function (e) {
                console.log('Error: ' + JSON.stringify(e));
                callback && callback(e);
            }
        }
    });

    return FileSystemPersister;
}());

module.exports = {
    BasePersister: BasePersister,
    LocalStoragePersister: LocalStoragePersister,
    FileSystemPersister: FileSystemPersister
};
},{"../EverliveError":53,"../common":62,"../everlive.platform":64,"../localStore":67,"../utils":80,"file-system":"file-system"}],71:[function(require,module,exports){
'use strict';

var constants = require('../constants');
var _ = require('../common')._;
var offlineItemStateMarker = constants.offlineItemsStateMarker;

var offlineTransformations = {
    idTransform: function (value) {
        if (_.isArray(value)) {
            return _.map(value, function (item) {
                return offlineTransformations.idTransform(item);
            });
        }

        if (typeof value === 'object' && value._id && !value.Id) {
            value.Id = value._id;
            delete value._id;
        }

        return value;
    },
    singleFieldTransform: function (singleFieldExpression, value) {
        if (typeof value === 'undefined' || value === null) {
            return null;
        } else {
            return value[singleFieldExpression];
        }
    },
    traverseAndTransformFilterId: function (filterObj) {
        if (filterObj && filterObj.Id) {
            filterObj._id = filterObj.Id;
            delete filterObj.Id;
        }

        for (var prop in filterObj) {
            if (filterObj.hasOwnProperty(prop)) {
                var objectMember = filterObj[prop];
                if (typeof objectMember === 'object') {
                    offlineTransformations.traverseAndTransformFilterId(objectMember);
                }
            }
        }
    },
    removeMarkersTransform: function (value) {
        delete value[offlineItemStateMarker];
        return value;
    }
};

module.exports = offlineTransformations;
},{"../common":62,"../constants":63}],72:[function(require,module,exports){
var _ = require('../common')._;

module.exports = (function () {
    // TODO: [offline] Update the structure - filter field can be refactored for example and a skip/limit/sort property can be added
    var DataQuery = function (config) {
        this.collectionName = config.collectionName;
        this.headers = config.headers || {};
        this.filter = config.filter;
        this.onSuccess = config.onSuccess;
        this.onError = config.onError;
        this.operation = config.operation;
        this.parse = config.parse;
        this.additionalOptions = config.additionalOptions;
        this.data = config.data;
        this.useOffline = config.useOffline;
        this.applyOffline = config.applyOffline;
        this.noRetry = config.noRetry; //retry will be done by default, when a request fails because of expired token, once the authentication.completeAuthentication in sdk is called.
        this.skipAuth = config.skipAuth; //if set to true, the sdk will not require authorization if the data query fails because of expired token. Used internally for various login methods.
        this._normalizedHeaders = null;
        this.isSync = config.isSync;
    };

    DataQuery.prototype = {
        getHeader: function (header) {
            var self = this;
            var headerKeys = Object.keys(this.headers);

            if (!this._normalizedHeaders) {
                this._normalizedHeaders = {};
                _.each(headerKeys, function (headerKey) {
                    var normalizedKey = headerKey.toLowerCase();
                    var headerValue = self.headers[headerKey];
                    self._normalizedHeaders[normalizedKey] = headerValue;
                });
            }

            var normalizedHeader = header.toLowerCase();
            return this._normalizedHeaders[normalizedHeader];
        },

        getHeaderAsJSON: function (header) {
            var headerValue = this._normalizedHeaders[header.toLowerCase()];
            if (headerValue) {
                return JSON.parse(headerValue);
            }
        }
    };

    DataQuery.operations = {
        read: 'read',
        create: 'create',
        update: 'update',
        remove: 'destroy',
        removeSingle: 'destroySingle',
        readById: 'readById',
        count: 'count',
        rawUpdate: 'rawUpdate',
        setAcl: 'setAcl',
        setOwner: 'setOwner',
        userLogin: 'login',
        userLogout: 'logout',
        userChangePassword: 'changePassword',
        userLoginWithProvider: 'loginWith',
        userLinkWithProvider: 'linkWith',
        userUnlinkFromProvider: 'unlinkFrom',
        filesUpdateContent: 'updateContent',
        filesGetDownloadUrlById: 'downloadUrlById'
    };

    return DataQuery;
}());
},{"../common":62}],73:[function(require,module,exports){
var Expression = require('../Expression');
var OperatorType = require('../constants').OperatorType;
var WhereQuery = require('./WhereQuery');
var QueryBuilder = require('./QueryBuilder');

module.exports = (function () {
    /**
     * @class Query
     * @classdesc A query class used to describe a request that will be made to the {{site.TelerikBackendServices}} JavaScript API.
     * @param {object} [filter] A [filter expression]({% slug rest-api-querying-filtering %}) definition.
     * @param {object} [fields] A [fields expression]({% slug rest-api-querying-Subset-of-fields %}) definition.
     * @param {object} [sort] A [sort expression]({% slug rest-api-querying-sorting %}) definition.
     * @param {number} [skip] Number of items to skip. Used for paging.
     * @param {number} [take] Number of items to take. Used for paging.
     * @param {object} [expand] An [expand expression]({% slug features-data-relations-defining-expand %}) definition.
     */
    function Query(filter, fields, sort, skip, take, expand) {
        this.filter = filter;
        this.fields = fields;
        this.sort = sort;
        this.toskip = skip;
        this.totake = take;
        this.expand = expand;
        this.expr = new Expression(OperatorType.query);
    }

    Query.prototype = {
        /** Applies a filter to the current query. This allows you to retrieve only a subset of the items based on various filtering criteria.
         * @memberOf Query.prototype
         * @method where
         * @name where
         * @param {object} filter A [filter expression]({% slug rest-api-querying-filtering %}) definition.
         * @returns {Query}
         */
        /** Defines a filter definition for the current query.
         * @memberOf Query.prototype
         * @method where
         * @name where
         * @returns {WhereQuery}
         */
        where: function (filter) {
            if (filter) {
                return this._simple(OperatorType.filter, [filter]);
            }
            else {
                return new WhereQuery(this);
            }
        },
        /** Applies a fields selection to the current query. This allows you to retrieve only a subset of all available item fields.
         * @memberOf Query.prototype
         * @method select
         * @param {object} fieldsExpression A [fields expression]({% slug rest-api-querying-Subset-of-fields %}) definition.
         * @returns {Query}
         */
        select: function () {
            return this._simple(OperatorType.select, arguments);
        },
        // TODO
        //exclude: function () {
        //    return this._simple(OperatorType.exclude, arguments);
        //},
        /** Sorts the items in the current query in ascending order by the specified field.
         * @memberOf Query.prototype
         * @method order
         * @param {string} field The field name to order by in ascending order.
         * @returns {Query}
         */
        order: function (field) {
            return this._simple(OperatorType.order, [field]);
        },
        /** Sorts the items in the current query in descending order by the specified field.
         * @memberOf Query.prototype
         * @method orderDesc
         * @param {string} field The field name to order by in descending order.
         * @returns {Query}
         */
        orderDesc: function (field) {
            return this._simple(OperatorType.order_desc, [field]);
        },
        /** Skips a certain number of items from the beginning before returning the rest of the items. Used for paging.
         * @memberOf Query.prototype
         * @method skip
         * @see [query.take]{@link query.take}
         * @param {number} value The number of items to skip.
         * @returns {Query}
         */
        skip: function (value) {
            return this._simple(OperatorType.skip, [value]);
        },
        /** Takes a specified number of items from the query result. Used for paging.
         * @memberOf Query.prototype
         * @method take
         * @see [query.skip]{@link query.skip}
         * @param {number} value The number of items to take.
         * @returns {Query}
         */
        take: function (value) {
            return this._simple(OperatorType.take, [value]);
        },
        /** Sets an expand expression for the current query. This allows you to retrieve complex data sets using a single query based on relations between data types.
         * @memberOf Query.prototype
         * @method expand
         * @param {object} expandExpression An [expand expression]({% slug features-data-relations-defining-expand %}) definition.
         * @returns {Query}
         */
        expand: function (expandExpression) {
            return this._simple(OperatorType.expand, [expandExpression]);
        },
        /** Builds an object containing the different expressions that will be sent to {{site.TelerikBackendServices}}. It basically translates any previously specified expressions into standard queries that {{site.bs}} can understand.
         * @memberOf Query.prototype
         * @method build
         * @returns {{$where,$select,$sort,$skip,$take,$expand}}
         */
        build: function () {
            return new QueryBuilder(this).build();
        },
        _simple: function (op, oprs) {
            var args = [].slice.call(oprs);
            this.expr.addOperand(new Expression(op, args));
            return this;
        }
    };

    return Query;
}());
},{"../Expression":55,"../constants":63,"./QueryBuilder":74,"./WhereQuery":76}],74:[function(require,module,exports){
var constants = require('../constants');
var OperatorType = constants.OperatorType;
var _ = require('../common')._;
var GeoPoint = require('../GeoPoint');
var EverliveError = require('../EverliveError').EverliveError;
var Expression = require('../Expression');
var maxDistanceConsts = constants.maxDistanceConsts;
var radiusConsts = constants.radiusConsts;

module.exports = (function () {
    function QueryBuilder(query) {
        this.query = query;
        this.expr = query.expr;
    }

    QueryBuilder.prototype = {
        // TODO merge the two objects before returning them
        build: function () {
            var query = this.query;
            if (query.filter || query.fields || query.sort || query.toskip || query.totake || query.expand) {
                return {
                    $where: query.filter || null,
                    $select: query.fields || null,
                    $sort: query.sort || null,
                    $skip: query.toskip || null,
                    $take: query.totake || null,
                    $expand: query.expand || null
                };
            }
            return {
                $where: this._buildWhere(),
                $select: this._buildSelect(),
                $sort: this._buildSort(),
                $skip: this._getSkip(),
                $take: this._getTake(),
                $expand: this._getExpand()
            };
        },
        _getSkip: function () {
            var skipExpression = _.find(this.expr.operands, function (value, index, list) {
                return value.operator === OperatorType.skip;
            });
            return skipExpression ? skipExpression.operands[0] : null;
        },
        _getTake: function () {
            var takeExpression = _.find(this.expr.operands, function (value, index, list) {
                return value.operator === OperatorType.take;
            });
            return takeExpression ? takeExpression.operands[0] : null;
        },
        _getExpand: function () {
            var expandExpression = _.find(this.expr.operands, function (value, index, list) {
                return value.operator === OperatorType.expand;
            });
            return expandExpression ? expandExpression.operands[0] : null;
        },
        _buildSelect: function () {
            var selectExpression = _.find(this.expr.operands, function (value, index, list) {
                return value.operator === OperatorType.select;
            });
            var result = {};
            if (selectExpression) {
                _.reduce(selectExpression.operands, function (memo, value) {
                    memo[value] = 1;
                    return memo;
                }, result);
                return result;
            }
            else {
                return null;
            }
        },
        _buildSort: function () {
            var sortExpressions = _.filter(this.expr.operands, function (value, index, list) {
                return value.operator === OperatorType.order || value.operator === OperatorType.order_desc;
            });
            var result = {};
            if (sortExpressions.length > 0) {
                _.reduce(sortExpressions, function (memo, value) {
                    memo[value.operands[0]] = value.operator === OperatorType.order ? 1 : -1;
                    return memo;
                }, result);
                return result;
            }
            else {
                return null;
            }
        },
        _buildWhere: function () {
            var whereExpression = _.find(this.expr.operands, function (value, index, list) {
                return value.operator === OperatorType.where;
            });
            if (whereExpression) {
                return this._build(new Expression(OperatorType.and, whereExpression.operands));
            }
            else {
                var filterExpression = _.find(this.expr.operands, function (value, index, list) {
                    return value.operator === OperatorType.filter;
                });
                if (filterExpression) {
                    return filterExpression.operands[0];
                }
                return null;
            }
        },
        _build: function (expr) {
            if (this._isSimple(expr)) {
                return this._simple(expr);
            }
            else if (this._isRegex(expr)) {
                return this._regex(expr);
            }
            else if (this._isGeo(expr)) {
                return this._geo(expr);
            }
            else if (this._isAnd(expr)) {
                return this._and(expr);
            }
            else if (this._isOr(expr)) {
                return this._or(expr);
            }
            else if (this._isNot(expr)) {
                return this._not(expr);
            }
        },
        _isSimple: function (expr) {
            return expr.operator >= OperatorType.equal && expr.operator <= OperatorType.size;
        },
        _simple: function (expr) {
            var term = {}, fieldTerm = {};
            var operands = expr.operands;
            var operator = this._translateoperator(expr.operator);
            if (operator) {
                term[operator] = operands[1];
            }
            else {
                term = operands[1];
            }
            fieldTerm[operands[0]] = term;
            return fieldTerm;
        },
        _isRegex: function (expr) {
            return expr.operator >= OperatorType.regex && expr.operator <= OperatorType.endsWith;
        },
        _regex: function (expr) {
            var fieldTerm = {};
            var regex = this._getRegex(expr);
            var regexValue = this._getRegexValue(regex);
            var operands = expr.operands;
            fieldTerm[operands[0]] = regexValue;
            return fieldTerm;
        },
        _getRegex: function (expr) {
            var pattern = expr.operands[1];
            var flags = expr.operands[2] ? expr.operands[2] : '';
            switch (expr.operator) {
                case OperatorType.regex:
                    return pattern instanceof RegExp ? pattern : new RegExp(pattern, flags);
                case OperatorType.startsWith:
                    return new RegExp("^" + pattern, flags);
                case OperatorType.endsWith:
                    return new RegExp(pattern + "$", flags);
                default:
                    throw new EverliveError('Unknown operator type.');
            }
        },
        _getRegexValue: function (regex) {
            var options = '';
            if (regex.global) {
                options += 'g';
            }
            if (regex.multiline) {
                options += 'm';
            }
            if (regex.ignoreCase) {
                options += 'i';
            }
            return {$regex: regex.source, $options: options};
        },
        _isGeo: function (expr) {
            return expr.operator >= OperatorType.nearShpere && expr.operator <= OperatorType.withinShpere;
        },
        _geo: function (expr) {
            var fieldTerm = {};
            var operands = expr.operands;
            fieldTerm[operands[0]] = this._getGeoTerm(expr);
            return fieldTerm;
        },
        _getGeoTerm: function (expr) {
            switch (expr.operator) {
                case OperatorType.nearShpere:
                    return this._getNearSphereTerm(expr);
                case OperatorType.withinBox:
                    return this._getWithinBox(expr);
                case OperatorType.withinPolygon:
                    return this._getWithinPolygon(expr);
                case OperatorType.withinShpere:
                    return this._getWithinCenterSphere(expr);
                default:
                    throw new EverliveError('Unknown operator type.');
            }
        },
        _getNearSphereTerm: function (expr) {
            var operands = expr.operands;
            var center = this._getGeoPoint(operands[1]);
            var maxDistance = operands[2];
            var metrics = operands[3];
            var maxDistanceConst;
            var term = {
                '$nearSphere': center
            };
            if (typeof maxDistance !== 'undefined') {
                maxDistanceConst = maxDistanceConsts[metrics] || maxDistanceConsts.radians;
                term[maxDistanceConst] = maxDistance;
            }
            return term;
        },
        _getWithinBox: function (expr) {
            var operands = expr.operands;
            var bottomLeft = this._getGeoPoint(operands[1]);
            var upperRight = this._getGeoPoint(operands[2]);
            return {
                '$within': {
                    '$box': [bottomLeft, upperRight]
                }
            };
        },
        _getWithinPolygon: function (expr) {
            var operands = expr.operands;
            var points = this._getGeoPoints(operands[1]);
            return {
                '$within': {
                    '$polygon': points
                }
            };
        },
        _getWithinCenterSphere: function (expr) {
            var operands = expr.operands;
            var center = this._getGeoPoint(operands[1]);
            var radius = operands[2];
            var metrics = operands[3];
            var radiusConst = radiusConsts[metrics] || radiusConsts.radians;
            var sphereInfo = {
                'center': center
            };
            sphereInfo[radiusConst] = radius;
            return {
                '$within': {
                    '$centerSphere': sphereInfo
                }
            };
        },
        _getGeoPoint: function (point) {
            if (_.isArray(point)) {
                return new GeoPoint(point[0], point[1]);
            }
            return point;
        },
        _getGeoPoints: function (points) {
            var self = this;
            return _.map(points, function (point) {
                return self._getGeoPoint(point);
            });
        },
        _isAnd: function (expr) {
            return expr.operator === OperatorType.and;
        },
        _and: function (expr) {
            var i, l, term, result = {};
            var operands = expr.operands;
            for (i = 0, l = operands.length; i < l; i++) {
                term = this._build(operands[i]);
                result = this._andAppend(result, term);
            }
            return result;
        },
        _andAppend: function (andObj, newObj) {
            var i, l, key, value, newValue;
            var keys = _.keys(newObj);
            for (i = 0, l = keys.length; i < l; i++) {
                key = keys[i];
                value = andObj[key];
                if (typeof value === 'undefined') {
                    andObj[key] = newObj[key];
                }
                else {
                    newValue = newObj[key];
                    if (typeof value === 'object' && typeof newValue === 'object') {
                        value = _.extend(value, newValue);
                    } else {
                        value = newValue;
                    }
                    andObj[key] = value;
                }
            }
            return andObj;
        },
        _isOr: function (expr) {
            return expr.operator === OperatorType.or;
        },
        _or: function (expr) {
            var i, l, term, result = [];
            var operands = expr.operands;
            for (i = 0, l = operands.length; i < l; i++) {
                term = this._build(operands[i]);
                result.push(term);
            }
            return {$or: result};
        },
        _isNot: function (expr) {
            return expr.operator === OperatorType.not;
        },
        _not: function (expr) {
            return {$not: this._build(expr.operands[0])};
        },
        _translateoperator: function (operator) {
            switch (operator) {
                case OperatorType.equal:
                    return null;
                case OperatorType.not_equal:
                    return '$ne';
                case OperatorType.gt:
                    return '$gt';
                case OperatorType.lt:
                    return '$lt';
                case OperatorType.gte:
                    return '$gte';
                case OperatorType.lte:
                    return '$lte';
                case OperatorType.isin:
                    return '$in';
                case OperatorType.notin:
                    return '$nin';
                case OperatorType.all:
                    return '$all';
                case OperatorType.size:
                    return '$size';
            }
            throw new EverliveError('Unknown operator type.');
        }
    };

    return QueryBuilder;
}());
},{"../EverliveError":53,"../Expression":55,"../GeoPoint":56,"../common":62,"../constants":63}],75:[function(require,module,exports){
var DataQuery = require('./DataQuery');
var Request = require('../Request');
var _ = require('../common')._;

module.exports = (function () {
    var RequestOptionsBuilder = {};

    RequestOptionsBuilder._buildEndpointUrl = function (dataQuery) {
        var endpoint = dataQuery.collectionName;
        if (dataQuery.additionalOptions && dataQuery.additionalOptions.id) {
            endpoint += '/' + dataQuery.additionalOptions.id;
        }

        return endpoint;
    };

    RequestOptionsBuilder._buildBaseObject = function (dataQuery) {
        var defaultObject = {
            endpoint: RequestOptionsBuilder._buildEndpointUrl(dataQuery),
            filter: dataQuery.filter,
            success: dataQuery.onSuccess,
            error: dataQuery.onError,
            data: dataQuery.data,
            headers: dataQuery.headers
        };

        if (dataQuery.parse) {
            defaultObject.parse = dataQuery.parse;
        }

        return defaultObject;
    };

    RequestOptionsBuilder._build = function (dataQuery, additionalOptions) {
        return _.extend(RequestOptionsBuilder._buildBaseObject(dataQuery), additionalOptions);
    };

    RequestOptionsBuilder[DataQuery.operations.read] = function (dataQuery) {
        return RequestOptionsBuilder._build(dataQuery, {
            method: 'GET'
        });
    };

    RequestOptionsBuilder[DataQuery.operations.readById] = function (dataQuery) {
        return RequestOptionsBuilder._build(dataQuery, {
            method: 'GET'
        });
    };

    RequestOptionsBuilder[DataQuery.operations.count] = function (dataQuery) {
        return RequestOptionsBuilder._build(dataQuery, {
            method: 'GET',
            endpoint: dataQuery.collectionName + '/_count'
        });
    };

    RequestOptionsBuilder[DataQuery.operations.create] = function (dataQuery) {
        return RequestOptionsBuilder._build(dataQuery, {
            method: 'POST'
        });
    };

    RequestOptionsBuilder[DataQuery.operations.rawUpdate] = function (dataQuery) {
        var endpoint = dataQuery.collectionName;
        var filter = dataQuery.filter;
        var ofilter = null; // request options filter

        if (typeof filter === 'string') {
            endpoint += '/' + filter; // send the filter through query string
        } else if (typeof filter === 'object') {
            ofilter = filter; // send the filter as filter headers
        }

        return RequestOptionsBuilder._build(dataQuery, {
            method: 'PUT',
            endpoint: endpoint,
            filter: ofilter
        });
    };

    RequestOptionsBuilder[DataQuery.operations.update] = function (dataQuery) {
        return RequestOptionsBuilder._build(dataQuery, {
            method: 'PUT'
        });
    };

    RequestOptionsBuilder[DataQuery.operations.remove] = function (dataQuery) {
        return _.extend(RequestOptionsBuilder._buildBaseObject(dataQuery), {
            method: 'DELETE'
        });
    };

    RequestOptionsBuilder[DataQuery.operations.removeSingle] = RequestOptionsBuilder[DataQuery.operations.remove];

    RequestOptionsBuilder[DataQuery.operations.setAcl] = function (dataQuery) {
        var endpoint = dataQuery.collectionName;
        var filter = dataQuery.filter;

        if (typeof filter === 'string') { // if filter is string than will update a single item using the filter as an identifier
            endpoint += '/' + filter;
        } else if (typeof filter === 'object') { // else if it is an object than we will use it's id property
            endpoint += '/' + filter[idField];
        }
        endpoint += '/_acl';
        var method, data;
        if (dataQuery.additionalOptions.acl === null) {
            method = 'DELETE';
        } else {
            method = 'PUT';
            data = dataQuery.additionalOptions.acl;
        }

        return RequestOptionsBuilder._build(dataQuery, {
            method: method,
            endpoint: endpoint,
            data: data
        });
    };

    RequestOptionsBuilder[DataQuery.operations.setOwner] = function (dataQuery) {
        var endpoint = dataQuery.collectionName;
        var filter = dataQuery.filter;
        if (typeof filter === 'string') { // if filter is string than will update a single item using the filter as an identifier
            endpoint += '/' + filter;
        } else if (typeof filter === 'object') { // else if it is an object than we will use it's id property
            endpoint += '/' + filter[idField];
        }
        endpoint += '/_owner';

        return RequestOptionsBuilder._build(dataQuery, {
            method: 'PUT',
            endpoint: endpoint
        });
    };

    RequestOptionsBuilder[DataQuery.operations.userLogin] = function (dataQuery) {
        return RequestOptionsBuilder._build(dataQuery, {
            method: 'POST',
            endpoint: 'oauth/token',
            authHeaders: false,
            parse: Request.parsers.single
        });
    };

    RequestOptionsBuilder[DataQuery.operations.userLogout] = function (dataQuery) {
        return RequestOptionsBuilder._build(dataQuery, {
            method: 'GET',
            endpoint: 'oauth/logout'
        });
    };

    RequestOptionsBuilder[DataQuery.operations.userChangePassword] = function (dataQuery) {
        var keepTokens = dataQuery.additionalOptions.keepTokens;
        var endpoint = 'Users/changepassword';
        if (keepTokens) {
            endpoint += '?keepTokens=true';
        }

        return RequestOptionsBuilder._build(dataQuery, {
            method: 'POST',
            endpoint: endpoint,
            authHeaders: false,
            parse: Request.parsers.single
        });
    };

    RequestOptionsBuilder[DataQuery.operations.userLoginWithProvider] = function (dataQuery) {
        return RequestOptionsBuilder._build(dataQuery, {
            method: 'POST',
            authHeaders: false
        });
    };

    RequestOptionsBuilder[DataQuery.operations.userLinkWithProvider] = function (dataQuery) {
        return RequestOptionsBuilder._build(dataQuery, {
            method: 'POST',
            endpoint: RequestOptionsBuilder._buildEndpointUrl(dataQuery) + '/link'
        });
    };

    RequestOptionsBuilder[DataQuery.operations.userUnlinkFromProvider] = function (dataQuery) {
        return RequestOptionsBuilder._build(dataQuery, {
            method: 'POST',
            endpoint: RequestOptionsBuilder._buildEndpointUrl(dataQuery) + '/unlink'
        });
    };

    RequestOptionsBuilder[DataQuery.operations.filesUpdateContent] = function (dataQuery) {
        return RequestOptionsBuilder._build(dataQuery, {
            method: 'PUT',
            endpoint: RequestOptionsBuilder._buildEndpointUrl(dataQuery) + '/Content'
        });
    };

    RequestOptionsBuilder[DataQuery.operations.filesGetDownloadUrlById] = function (dataQuery) {
        return RequestOptionsBuilder._build(dataQuery, {
            method: 'GET'
        });
    };

    return RequestOptionsBuilder;
}());
},{"../Request":58,"../common":62,"./DataQuery":72}],76:[function(require,module,exports){
var Expression = require('../Expression');
var OperatorType = require('../constants').OperatorType;

module.exports = (function () {
    /**
     * @classdesc A fluent API operation for creating a filter for a query by chaining different rules.
     * @class WhereQuery
     * @protected
     * @borrows WhereQuery#eq as WhereQuery#equal
     * @borrows WhereQuery#ne as WhereQuery#notEqual
     * @borrows WhereQuery#gt as WhereQuery#greaterThan
     * @borrows WhereQuery#gte as WhereQuery#greaterThanEqual
     * @borrows WhereQuery#lt as WhereQuery#lessThan
     * @borrows WhereQuery#lte as WhereQuery#lessThanEqual
     */
    function WhereQuery(parentQuery, exprOp, singleOperand) {
        this.parent = parentQuery;
        this.single = singleOperand;
        this.expr = new Expression(exprOp || OperatorType.where);
        this.parent.expr.addOperand(this.expr);
    }

    WhereQuery.prototype = {
        /**
         * Adds an `and` clause to the current condition and returns it for further chaining.
         * @method and
         * @memberOf WhereQuery.prototype
         * @returns {WhereQuery}
         */
        and: function () {
            return new WhereQuery(this, OperatorType.and);
        },
        /**
         * Adds an `or` clause to the current condition and returns it for further chaining.
         * @method or
         * @memberOf WhereQuery.prototype
         * @returns {WhereQuery}
         */
        or: function () {
            return new WhereQuery(this, OperatorType.or);
        },
        /**
         * Adds a `not` clause to the current condition and returns it for further chaining.
         * @method not
         * @memberOf WhereQuery.prototype
         * @returns {WhereQuery}
         */
        not: function () {
            return new WhereQuery(this, OperatorType.not, true);
        },
        _simple: function (operator) {
            var args = [].slice.call(arguments, 1);
            this.expr.addOperand(new Expression(operator, args));
            return this._done();
        },
        /**
         * Adds a condition that a field must be equal to a specific value.
         * @method eq
         * @memberOf WhereQuery.prototype
         * @param {string} field Field name.
         * @param {*} value Comparison value (to which the fields must be equal).
         * @returns {WhereQuery}
         */
        eq: function (field, value) {
            return this._simple(OperatorType.equal, field, value);
        },
        /**
         * Adds a condition that a field must *not* be equal to a specific value.
         * @method ne
         * @memberOf WhereQuery.prototype
         * @param {string} field Field name.
         * @param {*} value Comparison value (to which the field must not be equal).
         * @returns {WhereQuery}
         */
        ne: function (field, value) {
            return this._simple(OperatorType.not_equal, field, value);
        },
        /**
         * Adds a condition that a field must be `greater than` a certain value. Applicable to Number, String, and Date fields.
         * @method gt
         * @memberOf WhereQuery.prototype
         * @param {string} field Field name.
         * @param {*} value Comparison value (that the field should be greater than).
         * @returns {WhereQuery}
         */
        gt: function (field, value) {
            return this._simple(OperatorType.gt, field, value);
        },
        /**
         * Adds a condition that a field must be `greater than or equal` to a certain value. Applicable to Number, String, and Date fields.
         * @method gte
         * @memberOf WhereQuery.prototype
         * @param {string} field Field name.
         * @param {*} value Comparison value (that the field should be greater than or equal to).
         * @returns {WhereQuery}
         */
        gte: function (field, value) {
            return this._simple(OperatorType.gte, field, value);
        },
        /**
         * Adds a condition that a field must be `less than` a certain value. Applicable to Number, String, and Date fields.
         * @method lt
         * @memberOf WhereQuery.prototype
         * @param {string} field Field name.
         * @param {*} value Comparison value (that the field should be less than).
         * @returns {WhereQuery}
         */
        lt: function (field, value) {
            return this._simple(OperatorType.lt, field, value);
        },
        /**
         * Adds a condition that a field must be `less than or equal` to a certain value. Applicable to Number, String, and Date fields.
         * @method lte
         * @memberOf WhereQuery.prototype
         * @param {string} field Field name.
         * @param {*} value Comparison value (that the field should be less than or equal to).
         * @returns {WhereQuery}
         */
        lte: function (field, value) {
            return this._simple(OperatorType.lte, field, value);
        },
        /**
         * Adds a condition that a field must be in a set of values.
         * @method isin
         * @memberOf WhereQuery.prototype
         * @param {string} field Field name.
         * @param {Array} value An array of the values that the field should be in.
         * @returns {WhereQuery}
         */
        isin: function (field, value) {
            return this._simple(OperatorType.isin, field, value);
        },
        /**
         * Adds a condition that a field must *not* be in a set of values.
         * @method notin
         * @memberOf WhereQuery.prototype
         * @param {string} field Field name.
         * @param {Array} value An array of values that the field should not be in.
         * @returns {WhereQuery}
         */
        notin: function (field, value) {
            return this._simple(OperatorType.notin, field, value);
        },
        /**
         * Adds a condition that a field must include *all* of the specified values. Applicable to Array fields.
         * @method all
         * @memberOf WhereQuery.prototype
         * @param {string} field Field name.
         * @param {Array} value An array of values that the field must include.
         * @returns {WhereQuery}
         */
        all: function (field, value) {
            return this._simple(OperatorType.all, field, value);
        },
        /**
         * Adds a condition that a field must contain an array whose length is larger than a specified value. Applicable to Array fields.
         * @method size
         * @memberOf WhereQuery.prototype
         * @param {string} field Field name.
         * @param {number} value The size that the array must be bigger than.
         * @returns {WhereQuery}
         */
        size: function (field, value) {
            return this._simple(OperatorType.size, field, value);
        },
        /**
         * Adds a condition that a field must satisfy a specified regex.
         * @method regex
         * @memberOf WhereQuery.prototype
         * @param {string} field Field name.
         * @param {string} regularExpression Regular expression in PCRE format.
         * @param {string} [options] A string of regex options to use. See [specs]({http://docs.mongodb.org/manual/reference/operator/query/regex/#op._S_options}) for a description of available options.
         * @returns {WhereQuery}
         */
        regex: function (field, value, flags) {
            return this._simple(OperatorType.regex, field, value, flags);
        },
        /**
         * Adds a condition that a field value must *start* with a specified string.
         * @method startsWith
         * @memberOf WhereQuery.prototype
         * @param {string} field Field name.
         * @param {string} value The string that the field should start with.
         * @param {string} [options] A string of regex options to use. See [specs]({http://docs.mongodb.org/manual/reference/operator/query/regex/#op._S_options}) for a description of available options.
         * @returns {WhereQuery}
         */
        startsWith: function (field, value, flags) {
            return this._simple(OperatorType.startsWith, field, value, flags);
        },
        /**
         * Adds a condition that a field value must *end* with a specified string.
         * @method endsWith
         * @memberOf WhereQuery.prototype
         * @param {string} field Field name.
         * @param {string} value The string that the field should end with.
         * @param {string} [options] A string of  regex options to use. See [specs]({http://docs.mongodb.org/manual/reference/operator/query/regex/#op._S_options}) for a description of available options.
         * @returns {WhereQuery}
         */
        endsWith: function (field, value, flags) {
            return this._simple(OperatorType.endsWith, field, value, flags);
        },
        /**
         * Adds a Geospatial condition that a specified geopoint must be within a certain distance from another geopoint. Applicable to GeoPoint fields only.
         * @method nearSphere
         * @memberOf WhereQuery.prototype
         * @param {string} field Field name containing a {GeoPoint} in the following format: `(decimal_degrees_latitude,decimal_degrees_longitude)`, where *decimal_degrees_latitude* ranges from -90 to 90 and *decimal_degrees_longitude* ranges from -180 to 180. Example: `(42.6954322,123.3239467)`
         * @param {Everlive.GeoPoint} point Comparison geopoint value.
         * @param {number} distance Distance value.
         * @param {string} [metrics=radians] A string representing what unit of measurement is used for distance. Possible values: radians, km, miles.
         * @returns {WhereQuery}
         */
        nearSphere: function (field, point, distance, metrics) {
            return this._simple(OperatorType.nearShpere, field, point, distance, metrics);
        },
        /**
         * Adds a Geospatial condition that a specified geopoint must be within a specified coordinate rectangle. Applicable to GeoPoint fields only.
         * @method withinBox
         * @memberOf WhereQuery.prototype
         * @param {string} field Field name containing a {GeoPoint} in the following format: `(decimal_degrees_latitude,decimal_degrees_longitude)`, where *decimal_degrees_latitude* ranges from -90 to 90 and *decimal_degrees_longitude* ranges from -180 to 180. Example: `(42.6954322,123.3239467)`
         * @param {Everlive.GeoPoint} pointBottomLeft Value representing the bottom left corner of the box.
         * @param {Everlive.GeoPoint} pointUpperRight Value representing the upper right corner of the box.
         * @example ```js
         var query = new Everlive.Query();
         query.where().withinBox('Location',
         new Everlive.GeoPoint(23.317871, 42.687709),
         new Everlive.GeoPoint(23.331346, 42.707075));
         ```
         * @returns {WhereQuery}
         */
        withinBox: function (field, pointBottomLeft, pointUpperRight) {
            return this._simple(OperatorType.withinBox, field, pointBottomLeft, pointUpperRight);
        },
        /**
         * Adds a Geospatial condition that a specified geopoint must be within a specified coordinate polygon. The polygon is specified as an array of geopoints. The last point in the array is implicitly connected to the first point thus closing the shape. Applicable to GeoPoint fields only.
         * @method withinPolygon
         * @memberOf WhereQuery.prototype
         * @param {string} field Field name containing a {GeoPoint} in the following format: `(decimal_degrees_latitude,decimal_degrees_longitude)`, where *decimal_degrees_latitude* ranges from -90 to 90 and *decimal_degrees_longitude* ranges from -180 to 180. Example: `(42.6954322,123.3239467)`
         * @param {Everlive.GeoPoint[]} points Comparison value in the form of an array of geopoints defining the polygon.
         * @example ```js
         var point1 = new Everlive.GeoPoint(23.317871, 42.687709);
         var point2 = new Everlive.GeoPoint(42.698749, 42.698749);
         var point3 = new Everlive.GeoPoint(23.331346, 42.702282);

         var query = new Everlive.Query();
         query.where().withinPolygon("location", [point1, point2, point3]);
         * ```
         * @returns {WhereQuery}
         */
        withinPolygon: function (field, points) {
            return this._simple(OperatorType.withinPolygon, field, points);
        },
        /**
         * Adds a Geospatial condition that a specified geopoint must be within a coordinate circle. Applicable to GeoPoint fields only.
         * @method withinCenterSphere
         * @memberOf WhereQuery.prototype
         * @param {string} field Field name containing a {GeoPoint} in the following format: `(decimal_degrees_latitude,decimal_degrees_longitude)`, where *decimal_degrees_latitude* ranges from -90 to 90 and *decimal_degrees_longitude* ranges from -180 to 180. Example: `(42.6954322,123.3239467)`
         * @param {Everlive.GeoPoint} center Comparison value specifying the center of the coordinate circle.
         * @param {number} radius Value specifying the radius length.
         * @param {string} [metrics=radians] A string representing what unit of measurement is used for radius length. Possible values: radians, km, miles.
         * @returns {WhereQuery}
         */
        withinCenterSphere: function (field, center, radius, metrics) {
            return this._simple(OperatorType.withinShpere, field, center, radius, metrics);
        },
        /**
         * Ends the definition of the current WhereQuery. You need to call this method in order to continue with the definition of the parent `Query`. All other `WhereQuery` methods return the current instance of `WhereQuery` to allow chaining.
         * @method done
         * @memberOf WhereQuery.prototype
         * @returns {Query}
         */
        done: function () {
            if (this.parent instanceof WhereQuery) {
                return this.parent._done();
            } else {
                return this.parent;
            }
        },
        _done: function () {
            if (this.single) {
                return this.parent;
            } else {
                return this;
            }
        }
    };

    WhereQuery.prototype.equal = WhereQuery.prototype.eq;
    WhereQuery.prototype.notEqual = WhereQuery.prototype.ne;
    WhereQuery.prototype.greaterThan = WhereQuery.prototype.gt;
    WhereQuery.prototype.greaterThanEqual = WhereQuery.prototype.gte;
    WhereQuery.prototype.lessThan = WhereQuery.prototype.lt;
    WhereQuery.prototype.lessThanEqual = WhereQuery.prototype.lte;

    return WhereQuery;
}());
},{"../Expression":55,"../constants":63}],77:[function(require,module,exports){
var buildPromise = require('../utils').buildPromise;
var DataQuery = require('../query/DataQuery');
var RequestOptionsBuilder = require('../query/RequestOptionsBuilder');
var rsvp = require('../common').rsvp;
var Request = require('../Request');
var idField = require('../constants').idField;
var Everlive = require('../Everlive');
var EverliveError = require('../EverliveError').EverliveError;
var EverliveErrors = require('../EverliveError').EverliveErrors;
var _ = require('../common')._;

module.exports = (function () {
    function mergeResultData(data, success) {
        return function (res, response) {
            var attrs = res.result;
            // support for kendo observable array
            if (_.isArray(data) || typeof data.length === 'number') {
                _.each(data, function (item, index) {
                    _.extend(item, attrs[index]);
                });
            }
            else {
                _.extend(data, attrs);
            }

            success(res, response);
        };
    }

    function mergeUpdateResultData(data, success) {
        return function (res) {
            var modifiedAt = res.ModifiedAt;
            data.ModifiedAt = modifiedAt;
            success(res);
        };
    }

    /**
     * @class Data
     * @classdesc A class that provides methods for all CRUD operations to a given {{site.bs}} data type. Covers advanced scenarios with custom headers and special server-side functionality.
     * @param {object} setup
     * @param {string} collectionName
     * @protected
     */
    function Data(setup, collectionName, offlineStorage, everlive) {
        this.setup = setup;
        this.collectionName = collectionName;
        this.options = null;
        this.offlineStorage = offlineStorage;
        this.everlive = everlive;
    }


    Data.prototype = {
        _isOnline: function () {
            return this.offlineStorage ? this.offlineStorage.isOnline() : true;
        },

        _getOfflineCreateData: function (query, requestResponse) {
            var createData;
            if (_.isArray(query.data)) {
                createData = [];
                for (var i = 0; i < query.data.length; i++) {
                    var objectToCreate = _.extend(query.data[i], requestResponse.result[i]);
                    createData.push(objectToCreate)
                }
            } else {
                createData = _.extend(query.data, requestResponse.result);
            }

            return createData;
        },
        _applyOffline: function (query, requestResponse) {
            var autoSyncEnabled = this.offlineStorage && this.offlineStorage.setup.autoSync;
            if (autoSyncEnabled) {
                switch (query.operation) {
                    case DataQuery.operations.read:
                    case DataQuery.operations.readById:
                        var syncReadQuery = new DataQuery(_.defaults({
                            data: requestResponse.result,
                            isSync: true
                        }, query));
                        return this.offlineStorage.create(syncReadQuery);
                    case DataQuery.operations.create:
                        var createData = this._getOfflineCreateData(query, requestResponse);
                        var createQuery = new DataQuery(_.defaults({
                            data: createData,
                            isSync: true
                        }, query));
                        return this.offlineStorage.create(createQuery);
                    default:
                        query.isSync = true;
                        return this.offlineStorage.processQuery(query);
                }
            }

            return new rsvp.Promise(function (resolve, reject) {
                resolve();
            });
        },

        _setOption: function (key, value) {
            this.options = this.options || {};
            if (_.isObject(value)) {
                this.options[key] = _.extend({}, this.options[key], value);
            } else {
                this.options[key] = value;
            }
            return this;
        },

        /**@memberOf Data.prototype
         * @method
         * Modifies whether the query should be invoked on the offline storage.
         * Default is true.
         * Only valid when offlineStorage is enabled.
         * @param workOffline
         * @returns {Data}
         * */
        useOffline: function (useOffline) {
            if (arguments.length !== 1) {
                throw new Error('A single value is expected in useOffline() query modifier');
            }
            return this._setOption('useOffline', useOffline);
        },

        isSync: function (isSync) {
            if (arguments.length !== 1) {
                throw new Error('A single value is expected in isSync() query modifier');
            }
            return this._setOption('isSync', isSync);
        },

        /**
         * @memberOf Data.prototype
         * @method
         * Modifies whether the query should invoke the {{@link Authentication.prototype.hasAuthenticationRequirement}}.
         * Default is false.
         * Only valid when authentication module has an onAuthenticationRequired function .
         * @param skipAuth
         * @returns {Data}
         * */
        skipAuth: function (skipAuth) {
            if (arguments.length !== 1) {
                throw new Error('A single value is expected in skipAuth() query modifier');
            }
            return this._setOption('skipAuth', skipAuth);
        },

        /**
         * Modifies whether the query should be applied offline, if the sdk is currenty working online.
         * Default is true.
         * Only valid when offlineStorage is enabled.
         * @memberOf Data.prototype
         * @method
         * @param applyOffline
         * @returns {Data}
         * */
        applyOffline: function (applyOffline) {
            if (arguments.length !== 1) {
                throw new Error('A single value is expected in applyOffline() query modifier');
            }
            return this._setOption('applyOffline', applyOffline);
        },

        /**
         * Sets additional non-standard HTTP headers in the current data request. See [List of Non-Standard HTTP Headers]{{% slug rest-api-headers}} for more information.
         * @memberOf Data.prototype
         * @method
         * @param {object} headers Additional headers to be sent with the data request.
         * @returns {Data}
         */
        withHeaders: function (headers) {
            return this._setOption('headers', headers);
        },
        /**
         * Sets an expand expression to be used in the data request. This allows you to retrieve complex data sets using a single query based on relations between data types.
         * @memberOf Data.prototype
         * @method
         * @param {object} expandExpression An [expand expression]({% slug features-data-relations-defining-expand %}) definition.
         * @returns {Data}
         */
        expand: function (expandExpression) {
            var expandHeader = {
                'X-Everlive-Expand': JSON.stringify(expandExpression)
            };
            return this.withHeaders(expandHeader);
        },

        /**
         * Processes a query with all of its options. Applies the operation online/offline
         * @param {DataQuery} query The query to process
         * @private
         * @param {DataQuery} query
         * @returns {Promise}
         */
        processDataQuery: function (query) {
            var self = this;

            var offlineStorageEnabled = this.everlive._isOfflineStorageEnabled();
            query.useOffline = offlineStorageEnabled ? !this.everlive.isOnline() : false;
            query.applyOffline = offlineStorageEnabled;

            if (this.options) {
                query = _.defaults(this.options, query);
            }

            this.options = null;
            if (!query.skipAuth && this.everlive.authentication && this.everlive.authentication.hasAuthenticationRequirement()) {
                query.onError = _.wrap(query.onError, function (errorFunc, err) {
                    if (err.code === EverliveErrors.invalidToken.code || err.code === EverliveErrors.expiredToken.code) {
                        var whenAuthenticatedPromise = self.everlive.authentication._ensureAuthentication();
                        if (!query.noRetry) {
                            whenAuthenticatedPromise.then(function () {
                                return self.processDataQuery(query);
                            });
                        }
                    } else {
                        errorFunc.call(self, err);
                    }
                });

                //if we are currently authenticating, queue the data query after we have logged in
                if (self.everlive.authentication.isAuthenticating()) {
                    var whenAuthenticatedPromise = self.everlive.authentication._ensureAuthentication();
                    if (!query.noRetry) {
                        whenAuthenticatedPromise.then(function () {
                            return self.processDataQuery(query);
                        });
                    }
                    return whenAuthenticatedPromise
                }
            }

            if ((!query.isSync && this.offlineStorage && this.offlineStorage.isSynchronizing())) {
                query.onError.call(this, EverliveErrors.syncInProgress);
            } else if (!query.useOffline) {
                var originalSuccess = query.onSuccess;
                query.onSuccess = function () {
                    var args = arguments;
                    var data = args[0];
                    if (query.applyOffline) {
                        return self._applyOffline(query, data)
                            .then(function () {
                                originalSuccess.apply(this, args);
                            }, function () {
                                query.onError.apply(this, arguments);
                            });
                    } else {
                        return originalSuccess.apply(this, args);
                    }
                };

                var getRequestOptionsFromQuery = RequestOptionsBuilder[query.operation];
                var requestOptions = getRequestOptionsFromQuery(query);
                var request = new Request(this.setup, requestOptions);
                request.send();
            } else {
                if (!query.applyOffline) {
                    return query.onError.call(this, new EverliveError('The applyOffline must be false when working offline.'));
                }

                self.offlineStorage.processQuery(query).then(function () {
                    query.onSuccess.apply(this, arguments);
                }, function () {
                    query.onError.apply(this, arguments);
                });
            }
        },
        // TODO implement options: { requestSettings: { executeServerCode: false } }. power fields queries could be added to that options argument
        /**
         * Gets all data items that match the filter. This allows you to retrieve a subset of the items based on various filtering criteria.
         * @memberOf Data.prototype
         * @method get
         * @name get
         * @param {object|null} filter A [filter expression]({% slug rest-api-querying-filtering %}) definition.
         * @returns {Promise} The promise for the request.
         */
        /**
         * Gets all data items that match the filter. This allows you to retrieve a subset of the items based on various filtering criteria.
         * @memberOf Data.prototype
         * @method get
         * @name get
         * @param {object|null} filter A [filter expression]({% slug rest-api-querying-filtering %}) definition.
         * @param {Function} [success] A success callback.
         * @param {Function} [error] An error callback.
         */
        get: function (filter, success, error) {
            var self = this;

            return buildPromise(function (successCb, errorCb) {
                var dataQuery = new DataQuery({
                    operation: DataQuery.operations.read,
                    collectionName: self.collectionName,
                    filter: filter,
                    onSuccess: successCb,
                    onError: errorCb
                });

                return self.processDataQuery(dataQuery);
            }, success, error);
        },
        // TODO handle options
        // TODO think to pass the id as a filter

        /**
         * Gets a data item by ID.
         * @memberOf Data.prototype
         * @method getById
         * @name getById
         * @param {string} id ID of the item.
         * @returns {Promise} The promise for the request.
         */
        /**
         * Gets an item by ID.
         * @memberOf Data.prototype
         * @method getById
         * @name getById
         * @param {string} id ID of the item.
         * @param {Function} [success] A success callback.
         * @param {Function} [error] An error callback.
         * */
        getById: function (id, success, error) {
            var self = this;

            return buildPromise(function (successCb, errorCb) {
                var dataQuery = new DataQuery({
                    operation: DataQuery.operations.readById,
                    collectionName: self.collectionName,
                    parse: Request.parsers.single,
                    additionalOptions: {
                        id: id
                    },
                    onSuccess: successCb,
                    onError: errorCb
                });


                return self.processDataQuery(dataQuery);
            }, success, error);
        },

        /**
         * Gets the count of the data items that match the filter.
         * @memberOf Data.prototype
         * @method count
         * @name count
         * @param {object|null} filter A [filter expression]({% slug rest-api-querying-filtering %}) definition.
         * @returns {Promise} The promise for the request.
         */
        /**
         * Gets the count of the items that match the filter.
         * @memberOf Data.prototype
         * @method count
         * @name count
         * @param {object|null} filter A [filter expression]({% slug rest-api-querying-filtering %}) definition.
         * @param {Function} [success] A success callback.
         * @param {Function} [error] An error callback.
         */
        count: function (filter, success, error) {
            var self = this;

            return buildPromise(function (sucessCb, errorCb) {
                var dataQuery = new DataQuery({
                    operation: DataQuery.operations.count,
                    collectionName: self.collectionName,
                    filter: filter,
                    parse: Request.parsers.single,
                    onSuccess: sucessCb,
                    onError: errorCb
                });
                return self.processDataQuery(dataQuery);
            }, success, error);
        },

        /**
         * Creates a data item.
         * @memberOf Data.prototype
         * @method create
         * @name create
         * @param {object|object[]} data Item or items that will be created.
         * @returns {Promise} The promise for the request.
         */
        /**
         * Creates an item.
         * @memberOf Data.prototype
         * @method create
         * @name create
         * @param {object|object[]} data The item or items that will be created.
         * @param {Function} [success] A success callback.
         * @param {Function} [error] An error callback.
         */
        create: function (data, success, error) {
            var self = this;

            return buildPromise(function (success, error) {
                var dataQuery = new DataQuery({
                    operation: DataQuery.operations.create,
                    collectionName: self.collectionName,
                    data: data,
                    parse: Request.parsers.single,
                    onSuccess: mergeResultData(data, success),
                    onError: error
                });


                return self.processDataQuery(dataQuery);
            }, success, error);
        },
        /**
         * Updates all objects that match a filter with the specified update expression.
         * @memberOf Data.prototype
         * @method rawUpdate
         * @name rawUpdate
         * @param {object} updateObject Update object that contains the new values.
         * @param {object|null} filter A [filter expression]({% slug rest-api-querying-filtering %}) definition.
         * @returns {Promise} The promise for the request.
         */
        /**
         * Updates all objects that match a filter with the specified update expression.
         * @memberOf Data.prototype
         * @method rawUpdate
         * @name rawUpdate
         * @param {object} updateObject Update object that contains the new values.
         * @param {object|null} filter A [filter expression]({% slug rest-api-querying-filtering %}) definition.
         * @param {Function} [success] A success callback.
         * @param {Function} [error] An error callback.
         */
        /**
         * Updates an object by ID with the specified update expression.
         * @memberOf Data.prototype
         * @method rawUpdate
         * @name rawUpdate
         * @param {object} updatedObject Updated object that contains the new values.
         * @param {string} id The ID of the item.
         * @returns {Promise} The promise for the request.
         */
        /**
         * Updates an object by ID with the specified update expression.
         * @memberOf Data.prototype
         * @method rawUpdate
         * @name rawUpdate
         * @param {object} updateObject Updated object that contains the new values.
         * @param {string} id The ID of the item.
         * @param {Function} [success] A success callback.
         * @param {Function} [error] An error callback.
         */
        rawUpdate: function (attrs, filter, success, error) {
            var self = this;

            return buildPromise(function (success, error) {
                var dataQuery = new DataQuery({
                    operation: DataQuery.operations.rawUpdate,
                    collectionName: self.collectionName,
                    filter: filter,
                    data: attrs,
                    onSuccess: success,
                    onError: error
                });
                return self.processDataQuery(dataQuery);
            }, success, error);
        },
        // TODO: Check if there is a case in which replace = true is passed to this function
        _update: function (attrs, filter, single, replace, success, error) {
            var self = this;

            return buildPromise(function (success, error) {
                var data = {};
                data[replace ? '$replace' : '$set'] = attrs;

                // if the update is for a single item - merge the update result and add the ModifiedAt field to the result
                var onSuccess = single ? mergeUpdateResultData(attrs, success) : success;

                var dataQuery = new DataQuery({
                    operation: DataQuery.operations.update,
                    collectionName: self.collectionName,
                    parse: Request.parsers.update,
                    filter: filter,
                    data: data,
                    additionalOptions: {
                        id: single ? attrs[idField] : undefined
                    },
                    onSuccess: onSuccess,
                    onError: error
                });
                return self.processDataQuery(dataQuery);
            }, success, error);
        },

        /**
         * Updates a single data item. This operation takes an object that specifies both the data item to be updated and the updated values.
         * @memberOf Data.prototype
         * @method updateSingle
         * @name updateSingle
         * @param {object} item The item that will be updated. Note: the ID property of the item will be used to determine which item will be updated.
         * @returns {Promise} The promise for the request.
         */
        /**
         * Updates the provided item.
         * @memberOf Data.prototype
         * @method updateSingle
         * @name updateSingle
         * @param {object} model The item that will be updated. Note: the ID property of the item will be used to determine which item will be updated.
         * @param {Function} [success] A success callback.
         * @param {Function} [error] An error callback.
         */
        updateSingle: function (model, success, error) {
            return this._update(model, null, true, false, success, error);
        },

        /**
         * Updates all items that match a filter with the specified update object.
         * @memberOf Data.prototype
         * @method update
         * @name update
         * @param {object} updateObject The update object.
         * @param {object|null} filter A [filter expression]({% slug rest-api-querying-filtering %}) definition.
         * @returns {Promise} The promise for the request.
         */
        /**
         * Updates all items that match the filter with the specified update object.
         * @memberOf Data.prototype
         * @method update
         * @name update
         * @param {object} model The update object.
         * @param {object|null} filter A [filter expression]({% slug rest-api-querying-filtering %}) definition.
         * @param {Function} [success] A success callback.
         * @param {Function} [error] An error callback.
         */
        update: function (model, filter, success, error) {
            return this._update(model, filter, false, false, success, error);
        },
        _destroy: function (attrs, filter, single, success, error) {
            var self = this;

            return buildPromise(function (success, error) {
                var dataQuery = new DataQuery({
                    operation: single ? DataQuery.operations.removeSingle : DataQuery.operations.remove,
                    collectionName: self.collectionName,
                    filter: filter,
                    onSuccess: success,
                    onError: error,
                    additionalOptions: {
                        id: single ? attrs[idField] : undefined
                    }
                });
                return self.processDataQuery(dataQuery);
            }, success, error);
        },

        /**
         * Deletes a single data item by ID.
         * @memberOf Data.prototype
         * @method destroySingle
         * @name destroySingle
         * @param {object} item Object containing the item ID to be deleted.
         * @returns {Promise} The promise for the request.
         */
        /**
         * Deletes a single data item by ID.
         * @memberOf Data.prototype
         * @method destroySingle
         * @name destroySingle
         * @param {object} model Object containing the item ID to be deleted.
         * @param {Function} [success] A success callback.
         * @param {Function} [error] An error callback.
         */
        destroySingle: function (model, success, error) {
            return this._destroy(model, null, true, success, error);
        },

        /**
         * Deletes all data items that match a filter.
         * @memberOf Data.prototype
         * @method destroy
         * @name destroy
         * @param {object|null} filter A [filter expression]({% slug rest-api-querying-filtering %}) definition.
         * @returns {Promise} The promise for the request.
         */
        /**
         * Deletes all items that match the filter.
         * @memberOf Data.prototype
         * @method destroy
         * @name destroy
         * @param {object|null} filter A [filter expression]({% slug rest-api-querying-filtering %}) definition.
         * @param {Function} [success] A success callback.
         * @param {Function} [error] An error callback.
         */
        destroy: function (filter, success, error) {
            return this._destroy(null, filter, false, success, error);
        },

        /**
         * Sets the Access Control List (ACL) of a specified data item.
         * @memberOf Data.prototype
         * @method setAcl
         * @name setAcl
         * @param {object} acl The acl object.
         * @param {object} item The item whose ACL will be updated. Note: the ID property of the item will be used to determine which item will be deleted.
         * @returns {Promise} The promise for the request.
         */
        /**
         * Sets the Access Control List (ACL) of a specified data item.
         * @memberOf Data.prototype
         * @method setAcl
         * @name setAcl
         * @param {object} acl The acl object.
         * @param {object} item The item whose ACL will be updated. Note: the ID property of the item will be used to determine which item will be deleted.
         * @param {object} operationParameters An object which accepts operation parameters
         * @param {Function} [success] A success callback.
         * @param {Function} [error] An error callback.
         */
        /**
         * Sets the Access Control List (ACL) of a specified data item.
         * @memberOf Data.prototype
         * @method setAcl
         * @name setAcl
         * @param {object} acl The acl object.
         * @param {string} id The ID of the item.
         * @returns {Promise} The promise for the request.
         */
        /**
         * Sets the Access Control List (ACL) of an item with a specified ID.
         * @memberOf Data.prototype
         * @method setAcl
         * @name setAcl
         * @param {object} acl The acl object.
         * @param {string} id The ID of the item.
         * @param {Function} [success] A success callback.
         * @param {Function} [error] An error callback.
         */
        setAcl: function (acl, filter, success, error) {
            var self = this;

            return buildPromise(function (success, error) {
                var dataQuery = new DataQuery({
                    operation: DataQuery.operations.setAcl,
                    collectionName: self.collectionName,
                    parse: Request.parsers.single,
                    filter: filter,
                    additionalOptions: {
                        acl: acl
                    },
                    onSuccess: success,
                    onError: error
                });

                return self.processDataQuery(dataQuery);
            }, success, error);
        },

        /**
         * Sets the owner of the specified data item.
         * @memberOf Data.prototype
         * @method setOwner
         * @name setOwner
         * @param {string} acl The new owner ID.
         * @param {object} item The item whose owner will be updated. Note: the ID property of the item will be used to determine which item will be deleted.
         * @returns {Promise} The promise for the request.
         */
        /**
         * Sets the owner of the specified data item.
         * @memberOf Data.prototype
         * @method setOwner
         * @name setOwner
         * @param {string} acl The new owner ID.
         * @param {object} item The item whose owner will be updated. Note: the ID property of the item will be used to determine which item will be deleted.
         * @param {object} operationParameters An object which accepts operation parameters
         * @param {Function} [operationParameters.success] A success callback.
         * @param {Function} [operationParameters.error] An error callback.
         * @param {Boolean} [operationParameters.useOffline] Whether to invoke the operation on the offline storage. Default is based on the current mode of the Everlive instance.
         * @param {Boolean} [operationParameters.applyOffline=true] If working online, whether to also apply the operation on the local storage.
         */
        /**
         * Sets the owner of the specified data item.
         * @memberOf Data.prototype
         * @method setOwner
         * @name setOwner
         * @param {string} ownerId The new owner ID.
         * @param {string} id The ID of the item.
         * @returns {Promise} The promise for the request.
         */
        /**
         * Sets the owner of the specified data item.
         * @memberOf Data.prototype
         * @method setOwner
         * @name setOwner
         * @param {string} ownerId The new owner ID.
         * @param {string} id The ID of the item.
         * @param {Function} [success] A success callback.
         * @param {Function} [error] An error callback.
         */
        setOwner: function (ownerId, filter, success, error) {
            var self = this;

            return buildPromise(function (success, error) {
                var dataQuery = new DataQuery({
                    operation: DataQuery.operations.setOwner,
                    collectionName: self.collectionName,
                    filter: filter,
                    data: {
                        Owner: ownerId
                    },
                    onSuccess: success,
                    onError: error
                });
                return self.processDataQuery(dataQuery);
            }, success, error);
        },
        /**
         * Saves the provided data item. This operation will create or update the item depending on whether it is new or existing.
         * @memberOf Data.prototype
         * @method save
         * @name save
         * @param {object} item An object containing the item that is being saved.
         * @returns {Promise} The promise for the request.
         */
        /**
         * Saves the provided data item. This operation will create or update the item depending on whether it is new or existing.
         * @memberOf Data.prototype
         * @method save
         * @name save
         * @param {object} model An object containing the item that is being saved.
         * @param {Function} [success] A success callback.
         * @param {Function} [error] An error callback.
         */
        save: function (model, success, error) {
            var self = this;
            var isNew = this.isNew(model);

            return buildPromise(function (success, error) {
                function saveSuccess(res) {
                    res.type = isNew ? 'create' : 'update';
                    success(res);
                }

                function saveError(err) {
                    err.type = isNew ? 'create' : 'update';
                    error(err);
                }

                if (isNew) {
                    return self.create(model, saveSuccess, saveError);
                } else {
                    return self.updateSingle(model, saveSuccess, saveError);
                }
            }, success, error);
        },
        /**
         * Checks if the specified data item is new or not.
         * @memberOf Data.prototype
         * @method
         * @param model Item to check.
         * @returns {boolean}
         */
        isNew: function (model) {
            return typeof model[idField] === 'undefined';
        }
    };

    return Data;
}());

},{"../Everlive":52,"../EverliveError":53,"../Request":58,"../common":62,"../constants":63,"../query/DataQuery":72,"../query/RequestOptionsBuilder":75,"../utils":80}],78:[function(require,module,exports){
/**
 * @class Files
 * @protected
 * @extends Data
 */

var buildPromise = require('../utils').buildPromise;
var DataQuery = require('../query/DataQuery');
var Request = require('../Request');
var utils = require('../utils');

module.exports.addFilesFunctions = function addFilesFunctions(ns) {
    /**
     * Get a URL that can be used as an endpoint for uploading a file. It is specific to each {{site.TelerikBackendServices}} app.
     * @memberof Files.prototype
     * @method getUploadUrl
     * @returns {string}
     */
    ns.getUploadUrl = function () {
        return utils.buildUrl(this.setup) + this.collectionName;
    };

    /**
     * Get the download URL for a file.
     * @memberof Files.prototype
     * @method getDownloadUrl
     * @deprecated
     * @param {string} fileId The ID of the file.
     * @returns {string} url The download URL.
     */
    ns.getDownloadUrl = function (fileId) {
        return utils.buildUrl(this.setup) + this.collectionName + '/' + fileId + '/Download';
    };

    ns._getUpdateUrl = function (fileId) {
        return this.collectionName + '/' + fileId + '/Content';
    };

    /**
     * Get a URL that can be used as an endpoint for updating a file. It is specific to each {{site.TelerikBackendServices}} app.
     * @memberof Files.prototype
     * @method getUpdateUrl
     * @param {string} fileId The ID of the file.
     * @returns {string} url The update URL.
     */
    ns.getUpdateUrl = function (fileId) {
        return utils.buildUrl(this.setup) + this._getUpdateUrl(fileId);
    };

    /**
     * Updates a file's content
     * @memberof Files.prototype
     * @method updateContent
     * @param {string} fileId File ID.
     * @param {string} file File contents in base64 encoding.
     * @param {Function} [success] A success callback.
     * @param {Function} [error] An error callback.
     * @returns {Promise} The promise for the request
     */
    ns.updateContent = function (fileId, file, success, error) {
        var self = this;

        return buildPromise(function (success, error) {
            var dataQuery = new DataQuery({
                operation: DataQuery.operations.filesUpdateContent,
                // the passed file content is base64 encoded
                data: file,
                collectionName: self.collectionName,
                additionalOptions: {
                    id: fileId
                },
                onSuccess: success,
                onError: error
            });


            return self.processDataQuery(dataQuery);
        }, success, error);
    };

    /**
     * Gets the download URL for a file by ID.
     * @memberof Files.prototype
     * @method getDownloadUrlById
     * @param {string} fileId File ID.
     * @param operationParameters
     * @returns {Promise} The promise for the request
     */
    ns.getDownloadUrlById = function (fileId, success, error) {
        var self = this;

        return buildPromise(function (success, error) {
            var dataQuery = new DataQuery({
                operation: DataQuery.operations.filesGetDownloadUrlById,
                collectionName: self.collectionName,
                additionalOptions: {
                    id: fileId
                },
                parse: Request.parsers.single,
                onSuccess: function (data) {
                    success(data.result.Uri);
                },
                onError: error
            });


            return self.processDataQuery(dataQuery);
        }, success, error);
    };
};
},{"../Request":58,"../query/DataQuery":72,"../utils":80}],79:[function(require,module,exports){
/**
 * @class Users
 * @extends Data
 * @protected
 */

var utils = require('../utils');
var buildPromise = utils.buildPromise;
var guardUnset = utils.guardUnset;
var DataQuery = require('../query/DataQuery');
var Request = require('../Request');
var _ = require('../common')._;

module.exports.addUsersFunctions = function addUsersFunctions(ns, everlive) {

    /**
     * Registers a new user with username and password.
     * @memberOf Users.prototype
     * @method register
     * @name register
     * @param {string} username The new user's username.
     * @param {string} password The new user's password.
     * @param {object} userInfo Additional information for the user (ex. DisplayName, Email, etc.)
     * @returns {Promise} The promise for the request.
     */
    /**
     * Registers a new user using a username and a password.
     * @memberOf Users.prototype
     * @method register
     * @name register
     * @param {string} username The new user's username.
     * @param {string} password The new user's password.
     * @param attrs
     * @param {Function} [success] A success callback.
     * @param {Function} [error] An error callback.
     */
    ns.register = function (username, password, attrs, success, error) {
        guardUnset(username, 'username');
        guardUnset(password, 'password');
        var user = {
            Username: username,
            Password: password
        };
        _.extend(user, attrs);
        return this.create(user, success, error);
    };

    /**
     * Gets information about the user that is currently authenticated to the {{site.bs}} JavaScript SDK.
     * @memberOf Users.prototype
     * @method currentUser
     * @name currentUser
     * @returns {Promise} The promise for the request.
     */
    /**
     * Gets information about the user that is currently authenticated to the {{site.bs}} JavaScript SDK.
     * @memberOf Users.prototype
     * @method currentUser
     * @name currentUser
     * @param {Function} [success] A success callback.
     * @param {Function} [error] An error callback.
     */
    ns.currentUser = function (success, error) {
        var self = this;
        var id = self.everlive._isOfflineStorageEnabled() && self.everlive.isOffline() ? self.everlive.setup.principalId : 'me';
        return buildPromise(function (success, error) {
            self.getById(id).then(function (res) {
                    if (typeof res.result !== 'undefined') {
                        success({result: res.result});
                    } else {
                        success({result: null});
                    }
                },
                function (err) {
                    if (self.everlive.authentication && self.everlive.authentication.hasAuthenticationRequirement()) {
                        success({result: null});
                    } else if (err.code === 601) { // invalid request, i.e. the access token is missing
                        success({result: null});
                    } else {
                        error(err);
                    }
                }
            );
        }, success, error);
    };

    /**
     * Changes the password of a user.
     * @memberOf Users.prototype
     * @method changePassword
     * @name changePassword
     * @param {string} username The user's username.
     * @param {string} password The user's password.
     * @param {string} newPassword The user's new password.
     * @param {boolean} keepTokens If set to true, the user tokens will be preserved even after the password change.
     * @returns {Promise} The promise for the request.
     */
    /**
     * Changes the password of a user.
     * @memberOf Users.prototype
     * @method changePassword
     * @name changePassword
     * @param {string} username The user's username.
     * @param {string} password The user's password.
     * @param {string} newPassword The user's new password.
     * @param {boolean} keepTokens If set to true, the user tokens will be preserved even after the password change.
     * @param {Function} [success] A success callback.
     * @param {Function} [error] An error callback.
     */
    ns.changePassword = function (username, password, newPassword, keepTokens, success, error) {
        var self = this;
        return buildPromise(function (success, error) {
            success = _.wrap(success, function (success, data) {
                if (data && data.result) {
                    if (!keepTokens) {
                        ns.clearAuthorization();
                    }
                }
                return success(data);
            });

            var dataQuery = new DataQuery({
                operation: DataQuery.operations.userChangePassword,
                collectionName: self.collectionName,
                data: {
                    Username: username,
                    Password: password,
                    NewPassword: newPassword
                },
                additionalOptions: {
                    keepTokens: keepTokens
                },
                skipAuth: true,
                onSuccess: success,
                onError: error
            });

            return self.processDataQuery(dataQuery)
        }, success, error)
    };

    /**
     *
     * Logs in a user using a username and a password to the current {{site.bs}} JavaScript SDK instance. All requests initiated by the current {{site.bs}} JavaScript SDK instance will be authenticated with that user's credentials.
     * @memberOf Users.prototype
     * @method login
     * @name login
     * @param {string} username The user's username.
     * @param {string} password The user's password.
     * @returns {Promise} The promise for the request.
     */
    /**
     * Logs in a user using a username and a password to the current {{site.bs}} JavaScript SDK instance. All requests initiated by the current {{site.bs}} JavaScript SDK instance will be authenticated with that user's credentials.
     * @memberOf Users.prototype
     * @method login
     * @name login
     * @deprecated
     * @param {string} username The user's username.
     * @param {string} password The user's password.
     * @param {Function} [success] A success callback.
     * @param {Function} [error] An error callback.
     */
    ns.login = function (username, password, success, error) {
        return everlive.authentication.login(username, password, success, error);

    };

    /**
     * Log out the user who is currently logged in.
     * @memberOf Users.prototype
     * @method logout
     * @name logout
     * @deprecated
     * @returns {Promise} The promise for the request.
     */
    /**
     * Log out the user who is currently logged in.
     * @memberOf Users.prototype
     * @method logout
     * @name logout
     * @deprecated
     * @param {Function} [success] A success callback.
     * @param {Function} [error] An error callback.
     */
    ns.logout = function (success, error) {
        return everlive.authentication.logout(success, error);

    };

    /**
     * Log in a user using an Facebook access token.
     * @memberOf Users.prototype
     * @method loginWithFacebook
     * @name loginWithFacebook
     * @param {string} accessToken Facebook access token.
     * @returns {Promise} The promise for the request.
     */
    /**
     * Log in a user using an Facebook access token.
     * @memberOf Users.prototype
     * @method loginWithFacebook
     * @name loginWithFacebook
     * @deprecated
     * @param {string} accessToken Facebook access token.
     * @param {Function} [success] A success callback.
     * @param {Function} [error] An error callback.
     */
    ns.loginWithFacebook = function (accessToken, success, error) {
        return everlive.authentication.loginWithFacebook(accessToken, success, error);
    };

    /**
     * Links a {{site.TelerikBackendServices}} user account to a Facebook access token.
     * @memberOf Users.prototype
     * @method linkWithFacebook
     * @name linkWithFacebook
     * @param {string} userId The user's ID in {{site.bs}}.
     * @param {string} accessToken The Facebook access token that will be linked to the {{site.bs}} user account.
     * @returns {Promise} The promise for the request.
     */
    /**
     * Links a Backend Services user with a Facebook access token.
     * @memberOf Users.prototype
     * @method linkWithFacebook
     * @name linkWithFacebook
     * @param {string} userId The user's ID in {{site.bs}}.
     * @param {string} accessToken The Facebook access token that will be linked to the {{site.bs}} user account.         * @param {Function} [success] a success callback.
     * @param {Function} [success] A success callback.
     * @param {Function} [error] An error callback.
     */
    ns.linkWithFacebook = function (userId, accessToken, success, error) {
        var identity = {
            Provider: 'Facebook',
            Token: accessToken
        };
        return ns._linkWithProvider(identity, userId, success, error);
    };

    /**
     * Unlinks a {{site.TelerikBackendServices}} user account from the Facebook token that it is linked to.
     * @memberOf Users.prototype
     * @method unlinkFromFacebook
     * @name unlinkFromFacebook
     * @param {string} userId The user's ID in {{site.bs}}.
     * @returns {Promise} The promise for the request.
     */
    /**
     * Unlinks a {{site.TelerikBackendServices}} user account from the Facebook token that it is linked to.
     * @memberOf Users.prototype
     * @method unlinkFromFacebook
     * @name unlinkFromFacebook
     * @param {string} userId The user's ID in {{site.bs}}.
     * @param {Function} [success] A success callback.
     * @param {Function} [error] An error callback.
     */
    ns.unlinkFromFacebook = function (userId, success, error) {
        return ns._unlinkFromProvider('Facebook', userId, success, error);
    };

    /**
     * Log in a user using an ADFS access token.
     * @memberOf Users.prototype
     * @method loginWithADFS
     * @name loginWithADFS
     * @param {string} accessToken ADFS access token.
     * @returns {Promise} The promise for the request.
     */
    /**
     * Log in a user using an ADFS access token.
     * @memberOf Users.prototype
     * @method loginWithADFS
     * @name loginWithADFS
     * @deprecated
     * @param {string} accessToken ADFS access token.
     * @param {Function} [success] A success callback.
     * @param {Function} [error] An error callback.
     */
    ns.loginWithADFS = function (accessToken, success, error) {
        return everlive.authentication.loginWithADFS(accessToken, success, error);
    };

    /**
     * Links a {{site.TelerikBackendServices}} user account to an ADFS access token.
     * @memberOf Users.prototype
     * @method linkWithADFS
     * @name linkWithADFS
     * @param {string} userId The user's ID in {{site.bs}}.
     * @param {string} accessToken The ADFS access token that will be linked to the {{site.bs}} user account.
     * @returns {Promise} The promise for the request.
     */
    /**
     * Links a {{site.TelerikBackendServices}} user account to an ADFS access token.
     * @memberOf Users.prototype
     * @method linkWithADFS
     * @name linkWithADFS
     * @param {string} userId The user's ID in {{site.bs}}.
     * @param {string} accessToken The ADFS access token that will be linked to the {{site.bs}} user account.
     * @param {Function} [success] A success callback.
     * @param {Function} [error] An error callback.
     */
    ns.linkWithADFS = function (userId, accessToken, success, error) {
        var identity = {
            Provider: 'ADFS',
            Token: accessToken
        };
        return ns._linkWithProvider(identity, userId, success, error);
    };

    /**
     * Unlinks a {{site.TelerikBackendServices}} user account from the ADFS token that it is linked to.
     * @memberOf Users.prototype
     * @method unlinkFromADFS
     * @name unlinkFromADFS
     * @param {string} userId The user's ID in {{site.bs}}.
     * @returns {Promise} The promise for the request.
     */
    /**
     * Unlinks a {{site.TelerikBackendServices}} user account from the ADFS token that it is linked to.
     * @memberOf Users.prototype
     * @method unlinkFromADFS
     * @name unlinkFromADFS
     * @param {string} userId The user's ID in {{site.bs}}.
     * @param {Function} [success] A success callback.
     * @param {Function} [error] An error callback.
     */
    ns.unlinkFromADFS = function (userId, success, error) {
        return ns._unlinkFromProvider('ADFS', userId, success, error);
    };

    /**
     * Log in a user using a LiveID access token.
     * @memberOf Users.prototype
     * @method loginWithLiveID
     * @name loginWithLiveID
     * @param {string} accessToken LiveID access token.
     * @returns {Promise} The promise for the request.
     */
    /**
     * Log in a user using a LiveID access token.
     * @memberOf Users.prototype
     * @method loginWithLiveID
     * @name loginWithLiveID
     * @deprecated
     * @param {string} accessToken LiveID access token.
     * @param {Function} [success] A success callback.
     * @param {Function} [error] An error callback.
     */
    ns.loginWithLiveID = function (accessToken, success, error) {
        return everlive.authentication.loginWithLiveID(accessToken, success, error);
    };

    /**
     * Links a {{site.TelerikBackendServices}} user account to a LiveId access token.
     * @memberOf Users.prototype
     * @method linkWithLiveID
     * @name linkWithLiveID
     * @param {string} userId The user's ID in {{site.bs}}.
     * @param {string} accessToken The LiveID access token that will be linked to the {{site.bs}} user account.
     * @returns {Promise} The promise for the request.
     */
    /**
     * Links a {{site.TelerikBackendServices}} user account to a LiveId access token.
     * @memberOf Users.prototype
     * @method linkWithLiveID
     * @name linkWithLiveID
     * @param {string} userId The user's ID in {{site.bs}}.
     * @param {string} accessToken The LiveID access token that will be linked to the {{site.bs}} user account.
     * @param {Function} [success] A success callback.
     * @param {Function} [error] An error callback.
     */
    ns.linkWithLiveID = function (userId, accessToken, success, error) {
        var identity = {
            Provider: 'LiveID',
            Token: accessToken
        };
        return ns._linkWithProvider(identity, userId, success, error);
    };

    /**
     * Unlinks a {{site.TelerikBackendServices}} user account from the LiveID access token that it is linked to.
     * @memberOf Users.prototype
     * @method unlinkFromLiveID
     * @name unlinkFromLiveID
     * @param {string} userId The user's ID in {{site.bs}}.
     * @returns {Promise} The promise for the request.
     */
    /**
     * Unlinks a {{site.TelerikBackendServices}} user account from the LiveID access token that it is linked to.
     * @memberOf Users.prototype
     * @method unlinkFromLiveID
     * @name unlinkFromLiveID
     * @param {string} userId The user's ID in {{site.bs}}.
     * @param {Function} [success] A success callback.
     * @param {Function} [error] An error callback.
     */
    ns.unlinkFromLiveID = function (userId, success, error) {
        return ns._unlinkFromProvider('LiveID', userId, success, error);
    };

    /**
     * Log in a user using a Google access token.
     * @memberOf Users.prototype
     * @method loginWithGoogle
     * @name loginWithGoogle
     * @param {string} accessToken Google access token.
     * @returns {Promise} The promise for the request.
     */
    /**
     * Log in a user using a Google access token.
     * @memberOf Users.prototype
     * @method loginWithGoogle
     * @name loginWithGoogle
     * @deprecated
     * @param {string} accessToken Google access token.
     * @param {Function} [success] A success callback.
     * @param {Function} [error] An error callback.
     */
    ns.loginWithGoogle = function (accessToken, success, error) {
        return everlive.authentication.loginWithGoogle(accessToken, success, error);
    };

    /**
     * Links a {{site.TelerikBackendServices}} user account to a Google access token.
     * @memberOf Users.prototype
     * @method linkWithGoogle
     * @name linkWithGoogle
     * @param {string} userId The user's ID in {{site.bs}}.
     * @param {string} accessToken The Google access token that will be linked to the {{site.bs}} user account.
     * @returns {Promise} The promise for the request.
     */
    /**
     * Links a {{site.TelerikBackendServices}} user account to a Google access token.
     * @memberOf Users.prototype
     * @method linkWithGoogle
     * @name linkWithGoogle
     * @param {string} userId The user's ID in {{site.bs}}.
     * @param {string} accessToken The Google access token that will be linked to the {{site.bs}} user account.
     * @param {Function} [success] A success callback.
     * @param {Function} [error] An error callback.
     */
    ns.linkWithGoogle = function (userId, accessToken, success, error) {
        var identity = {
            Provider: 'Google',
            Token: accessToken
        };

        return ns._linkWithProvider(identity, userId, success, error);
    };

    /**
     * Unlinks a {{site.TelerikBackendServices}} user account from the Google access token that it is linked to.
     * @memberOf Users.prototype
     * @method unlinkFromGoogle
     * @name unlinkFromGoogle
     * @param {string} userId The user's ID in {{site.bs}}.
     * @returns {Promise} The promise for the request.
     */
    /**
     * Unlinks a {{site.TelerikBackendServices}} user account from the Google access token that it is linked to.
     * @memberOf Users.prototype
     * @method unlinkFromGoogle
     * @name unlinkFromGoogle
     * @param {string} userId The user's ID in {{site.bs}}.
     * @param {Function} [success] A success callback.
     * @param {Function} [error] An error callback.
     */
    ns.unlinkFromGoogle = function (userId, success, error) {
        return ns._unlinkFromProvider('Google', userId, success, error);
    };

    /**
     * Log in a user with a Twitter token. A secret token needs to be provided.
     * @memberOf Users.prototype
     * @method loginWithTwitter
     * @name loginWithTwitter
     * @param {string} token Twitter token.
     * @param {string} tokenSecret Twitter secret token.
     * @returns {Promise} The promise for the request.
     */
    /**
     * Log in a user with a Twitter token. A secret token needs to be provided.
     * @memberOf Users.prototype
     * @method loginWithTwitter
     * @name loginWithTwitter
     * @param {string} token Twitter token.
     * @param {string} tokenSecret Twitter secret token.
     * @param {Function} [success] A success callback.
     * @param {Function} [error] An error callback.
     */
    ns.loginWithTwitter = function (token, tokenSecret, success, error) {
        return everlive.authentication.loginWithTwitter(token, tokenSecret, success, error);
    };

    /**
     * Links a {{site.TelerikBackendServices}} user to a Twitter token. A secret token needs to be provided.
     * @memberOf Users.prototype
     * @method linkWithTwitter
     * @name linkWithTwitter
     * @param {string} userId The user's ID in {{site.bs}}.
     * @param {string} token The Twitter access token that will be linked to the {{site.bs}} user account.
     * @param {string} tokenSecret The Twitter secret token.
     * @returns {Promise} The promise for the request.
     */
    /**
     * Links a {{site.TelerikBackendServices}} user to a Twitter token. A secret token needs to be provided.         * Links a Backend Services user with a Twitter token. A secret token needs to be provided.
     * @memberOf Users.prototype
     * @method linkWithTwitter
     * @name linkWithTwitter
     * @param {string} userId The user's ID in {{site.bs}}.
     * @param {string} token The Twitter access token that will be linked to the {{site.bs}} user account.
     * @param {string} tokenSecret The Twitter secret token.
     * @param {Function} [success] A success callback.
     * @param {Function} [error] An error callback.
     */
    ns.linkWithTwitter = function (userId, token, tokenSecret, success, error) {
        var identity = {
            Provider: 'Twitter',
            Token: token,
            TokenSecret: tokenSecret
        };

        return ns._linkWithProvider(identity, userId, success, error);
    };

    /**
     * Unlinks a {{site.TelerikBackendServices}} user account from the Twitter access token that it is linked to.
     * @memberOf Users.prototype
     * @method unlinkFromTwitter
     * @name unlinkFromTwitter
     * @param {string} userId The user's ID in {{site.bs}}.
     * @returns {Promise} The promise for the request.
     */
    /**
     * Unlinks a {{site.TelerikBackendServices}} user account from the Twitter access token that it is linked to.
     * @memberOf Users.prototype
     * @method unlinkFromTwitter
     * @name unlinkFromTwitter
     * @param {string} userId The user's ID in {{site.bs}}.
     * @param {Function} [success] A success callback.
     * @param {Function} [error] An error callback.
     */
    ns.unlinkFromTwitter = function (userId, success, error) {
        return ns._unlinkFromProvider('Twitter', userId, success, error);
    };

    /**
     * Sets the token and token type that the {{site.TelerikBackendServices}} JavaScript SDK will use for authorization.
     * @memberOf Users.prototype
     * @method setAuthorization
     * @deprecated
     * @param {string} token Token that will be used for authorization.
     * @param {Everlive.TokenType} tokenType Token type. Currently only 'bearer' token is supported.
     * @param {string} principalId The id of the user that is logged in.
     */
    ns.setAuthorization = function setAuthorization(token, tokenType, principalId) {
        everlive.authentication.setAuthorization(token, tokenType, principalId)
    };

    /**
     * Clears the authentication token that the {{site.bs}} JavaScript SDK currently uses. Note that this is different than logging out, because the current authorization token is not invalidated.
     * @method clearAuthorization
     * @deprecated
     * @memberOf Users.prototype
     */
    ns.clearAuthorization = function clearAuthorization() {
        everlive.authentication.setAuthorization(null, null, null);
    };

    ns._linkWithProvider = function (identity, userId, success, error) {
        var self = this;
        return buildPromise(function (success, error) {
            var query = new DataQuery({
                additionalOptions: {
                    id: userId
                },
                operation: DataQuery.operations.userLinkWithProvider,
                collectionName: self.collectionName,
                data: identity,
                parse: Request.parsers.single,
                skipAuth: true,
                onSuccess: success,
                onError: error
            });

            return self.processDataQuery(query);
        }, success, error);
    };

    ns._unlinkFromProvider = function (providerName, userId, success, error) {
        var identity = {
            Provider: providerName
        };
        var self = this;
        return buildPromise(function (success, error) {
            var query = new DataQuery({
                additionalOptions: {
                    userId: userId
                },
                operation: DataQuery.operations.userUnlinkFromProvider,
                collectionName: self.collectionName,
                data: identity,
                parse: Request.parsers.single,
                skipAuth: true,
                onSuccess: success,
                onError: error
            });

            return self.processDataQuery(query);
        }, success, error);
    };
};
},{"../Request":58,"../common":62,"../query/DataQuery":72,"../utils":80}],80:[function(require,module,exports){
var EverliveError = require('./EverliveError').EverliveError;
var common = require('./common');
var _ = common._;
var rsvp = common.rsvp;
var Everlive = require('./Everlive');
var utils = {};

utils.guardUnset = function guardUnset(value, name, message) {
    if (!message) {
        message = 'The ' + name + ' is required';
    }
    if (typeof value === 'undefined' || value === null) {
        throw new EverliveError(message);
    }
};

utils.parseUtilities = {
    getReviver: function (parseOnlyCompleteDateTimeString) {
        var dateParser;
        if (parseOnlyCompleteDateTimeString) {
            dateParser = utils.parseUtilities.parseIsoDateString;
        } else {
            dateParser = utils.parseUtilities.parseOnlyCompleteDateTimeString;
        }

        return function (key, value) {
            if (typeof value === 'string') {
                var date = dateParser(value);
                if (date) {
                    value = date;
                }
            }

            return value;
        }
    },

    parseIsoDateString: function (string) {
        var match;
        if (match = string.match(/^(\d{4})(-(\d{2})(-(\d{2})(T(\d{2}):(\d{2})(:(\d{2})(\.(\d+))?)?(Z|((\+|-)(\d{2}):(\d{2}))))?))$/)) {
            // DateTime
            var secondParts = match[12];
            if (secondParts) {
                if (secondParts.length > 3) {
                    secondParts = Math.round(Number(secondParts.substr(0, 3) + '.' + secondParts.substr(3)));
                }
                else if (secondParts.length < 3) {
                    // if the secondParts are one or two characters then two or one zeros should be appended
                    // in order to have the correct number for milliseconds ('.67' means 670ms not 67ms)
                    secondParts += secondParts.length === 2 ? '0' : '00';
                }
            }
            var date = new Date(
                Date.UTC(
                    Number(match[1]), // year
                    (Number(match[3]) - 1) || 0, // month
                    Number(match[5]) || 0, // day
                    Number(match[7]) || 0, // hour
                    Number(match[8]) || 0, // minute
                    Number(match[10]) || 0, // second
                    Number(secondParts) || 0
                )
            );

            if (match[13] && match[13] !== "Z") {
                var h = Number(match[16]) || 0,
                    m = Number(match[17]) || 0;

                h *= 3600000;
                m *= 60000;

                var offset = h + m;
                if (match[15] === "+")
                    offset = -offset;

                date = new Date(date.valueOf() + offset);
            }

            return date;
        } else {
            return null;
        }
    },

    parseOnlyCompleteDateTimeString: function (string) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(string)) {
            // Date
            return null;
        }

        if (/^(\d{2}):(\d{2})(:(\d{2})(\.(\d+))?)?(Z|((\+|-)(\d{2}):(\d{2})))?$/.test(string)) {
            // Time
            return null;
        }

        return utils.parseUtilities.parseIsoDateString(string);
    },

    traverse: function (obj, func) {
        var key, value, newValue;
        for (key in obj) {
            if (obj.hasOwnProperty(key)) {
                value = obj[key];
                newValue = func(key, value);
                obj[key] = newValue;
                if (value === newValue && typeof value === 'object') {
                    utils.parseUtilities.traverse(value, func);
                }
            }
        }
    },

    traverseAndRevive: function (data, reviver) {
        if (!reviver) {
            reviver = utils.parseUtilities.getReviver();
        }

        utils.parseUtilities.traverse(data, reviver);
    },

    parseError: function (reviver, error) {
        if (typeof error === 'string' && error.length > 0) {
            try {
                error = JSON.parse(error);
                return {message: error.message, code: error.errorCode};
            } catch (e) {
                return error;
            }
        } else {
            return error;
        }
    },

    _parseInternal: function (reviver, data) {
        if (typeof data === 'string' && data.length > 0) {
            data = JSON.parse(data, reviver);
        } else if (typeof data === 'object') {
            utils.parseUtilities.traverseAndRevive(data, reviver);
        }

        return data;
    },

    _transformResult: function (data, additionalProperties) {
        if (data) {
            var result = {result: data.Result};
            _.extend(result, additionalProperties);
            return result;
        } else {
            return data;
        }
    },

    parseResult: function (reviver, data) {
        data = utils.parseUtilities._parseInternal.apply(null, arguments);
        return utils.parseUtilities._transformResult(data, {count: data.Count});
    },

    parseSingleResult: function (reviver, data) {
        data = utils.parseUtilities._parseInternal.apply(null, arguments);
        return utils.parseUtilities._transformResult(data);
    },

    parseUpdateResult: function (reviver, data) {
        data = utils.parseUtilities._parseInternal.apply(null, arguments);
        return utils.parseUtilities._transformResult(data, {ModifiedAt: data.ModifiedAt});
    }
};

utils.buildPromise = function buildPromise(operation, success, error) {
    var callbacks = utils.getCallbacks(success, error);
    operation(callbacks.success, callbacks.error);
    return callbacks.promise;
};

utils.getCallbacks = function (success, error) {
    var promise;
    if (typeof success !== 'function' && typeof error !== 'function') {
        promise = new rsvp.Promise(function (resolve, reject) {
            success = function (data) {
                resolve(data);
            };
            error = function (error) {
                reject(error);
            };
        });
    }

    return {promise: promise, success: success, error: error};
};

utils.buildAuthHeader = function buildAuthHeader(setup, options) {
    var authHeaderValue = null;
    if (options && options.authHeaders === false) {
        return authHeaderValue;
    }
    if (setup.token) {
        authHeaderValue = (setup.tokenType || 'bearer') + ' ' + setup.token;
    }
    else if (setup.masterKey) {
        authHeaderValue = 'masterkey ' + setup.masterKey;
    }
    if (authHeaderValue) {
        return {Authorization: authHeaderValue};
    } else {
        return null;
    }
};

utils.DeviceRegistrationResult = function DeviceRegistrationResult(token) {
    this.token = token;
};

utils.cloneDate = function (date) {
    return new Date(date);
};

utils.buildUrl = function (setup) {
    var url = '';
    if (typeof setup.scheme === 'string') {
        url += setup.scheme + ':';
    }
    url += setup.url;
    if (setup.apiKey) {
        url += setup.apiKey + '/';
    }
    return url;
};

utils.getDbOperators = function (expression, shallow) {
    var dbOperators = [];

    if (typeof expression === 'string') {
        return dbOperators;
    }

    var modifierKeys = Object.keys(expression);
    _.each(modifierKeys, function (key) {
        if (key.indexOf('$') === 0) {
            dbOperators.push(key);
        } else if (typeof expression[key] === 'object' && !shallow) {
            dbOperators = dbOperators.concat(utils.getDbOperators(expression[key]));
        }
    });

    return dbOperators;
};


var unsupportedDbOperators = [
    '$geoWithin',
    '$geoIntersects',
    '$near',
    '$within',
    '$nearSphere'
];

utils.getUnsupportedOperators = function (filter) {
    var dbOperators = utils.getDbOperators(filter);
    return _.intersection(dbOperators, unsupportedDbOperators);
};

module.exports = utils;

},{"./Everlive":52,"./EverliveError":53,"./common":62}]},{},[65])
if (typeof module === "object" && typeof exports === "object") { module.exports = Everlive; }
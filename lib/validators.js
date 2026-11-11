'use strict';

const net = require('net');

// a label of a hostname per RFC1123, and of any other domain name (such as
// the owner of a SRV record), where underscores are in common use
const HOST_LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i;
const DOMAIN_LABEL = /^[a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?$/i;

const MAX_NAME_LENGTH = 253;
const MAX_STRING_LENGTH = 255;
const MAX_DATA_LENGTH = 0xFFFF;
const MAX_UINT32 = 0xFFFFFFFF;
const MAX_UINT16 = 0xFFFF;
const MAX_TTL = 0x7FFFFFFF;  // RFC2181

function isUInt(v, max) {
  return Number.isInteger(v) && v >= 0 && v <= max;
}

// A name is a list of labels separated by dots. A trailing dot marks it as
// fully qualified, and a dot alone is the root.
function isName(v, label) {
  if (typeof (v) !== 'string' || v.length === 0)
    return false;
  if (v === '.')
    return true;

  const name = v.charCodeAt(v.length - 1) === 0x2E ? v.slice(0, -1) : v;
  if (name.length > MAX_NAME_LENGTH)
    return false;

  let start = 0;
  for (;;) {
    const dot = name.indexOf('.', start);
    const end = dot === -1 ? name.length : dot;
    if (!label.test(name.slice(start, end)))
      return false;
    if (dot === -1)
      return true;
    start = dot + 1;
  }
}

module.exports = {
  // a hostname
  nsName: function (v) {
    return isName(v, HOST_LABEL);
  },
  // a domain name that is not necessarily the name of a host
  nsDomain: function (v) {
    return isName(v, DOMAIN_LABEL);
  },
  UInt32BE: function (v) {
    return isUInt(v, MAX_UINT32);
  },
  UInt16BE: function (v) {
    return isUInt(v, MAX_UINT16);
  },
  // a time-to-live, in seconds
  ttl: function (v) {
    return isUInt(v, MAX_TTL);
  },
  // a tcp or udp port
  port: function (v) {
    return isUInt(v, MAX_UINT16) && v !== 0;
  },
  // a single character-string, of at most 255 bytes
  nsText: function (v) {
    return typeof (v) === 'string' &&
      Buffer.byteLength(v) <= MAX_STRING_LENGTH;
  },
  // the text of a TXT record, which is sent as a list of character-strings
  // that must fit in the data of a single record
  nsTextData: function (v) {
    if (typeof (v) !== 'string')
      return false;
    const size = Buffer.byteLength(v);
    return size + Math.max(1, Math.ceil(size / MAX_STRING_LENGTH)) <=
      MAX_DATA_LENGTH;
  },
  IPv4: function (v) {
    return net.isIPv4(v);
  },
  IPv6: function (v) {
    // a zone (fe80::1%eth0) is local to a host, and can not be sent
    return net.isIPv6(v) && !v.includes('%');
  },
  // the names of the properties in the model for which the validator fails
  invalid: function (obj, model) {
    return Object.keys(model).filter((key) => !model[key](obj[key]));
  },
  // checks every property named in the model with the validator given for it
  validate: function (obj, model) {
    for (const key of Object.keys(model)) {
      if (!model[key](obj[key]))
        return false;
    }
    return true;
  }
};

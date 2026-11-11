'use strict';

const Record = require('./record');
const validators = require('../validators');

class MX extends Record {
  constructor(exchange, opts) {
    if (typeof (exchange) !== 'string')
      throw new TypeError('exchange (string) is required');

    super();

    opts = opts || {};

    this.exchange = exchange;
    this.ttl = 'ttl' in opts ? opts.ttl : 600;
    this.priority = 'priority' in opts ? opts.priority : 0;
    this._type = 'MX';
  }
}

MX.MODEL = {
  exchange: validators.nsName,
  ttl: validators.ttl,
  priority: validators.UInt16BE
};

module.exports = MX;

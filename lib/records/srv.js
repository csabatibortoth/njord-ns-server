'use strict';

const Record = require('./record');
const validators = require('../validators');

class SRV extends Record {
  constructor(target, port, opts) {
    if (typeof (target) !== 'string')
      throw new TypeError('host (string) is required');
    if (!port)
      throw new TypeError('port (integer) is required'); //XXX

    super();

    opts = opts || {};

    this.target = target;
    this.port = port;
    this.weight = 'weight' in opts ? opts.weight : 10;
    this.priority = 'priority' in opts ? opts.priority : 0;
    this._type = 'SRV';
  }
}

SRV.MODEL = {
  target: validators.nsDomain,
  port: validators.port,
  weight: validators.UInt16BE,
  priority: validators.UInt16BE
};

module.exports = SRV;

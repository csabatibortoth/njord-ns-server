'use strict';

const Record = require('./record');
const validators = require('../validators');

class AAAA extends Record {
  constructor(target) {
    if (typeof (target) !== 'string')
      throw new TypeError('IPv6Addr (string) is required');

    super();

    this.target = target;
    this._type = 'AAAA';
  }
}

AAAA.MODEL = {
  target: validators.IPv6
};

module.exports = AAAA;

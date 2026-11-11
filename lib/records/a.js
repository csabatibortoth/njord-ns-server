'use strict';

const Record = require('./record');
const validators = require('../validators');

class A extends Record {
  constructor(target) {
    if (typeof (target) !== 'string')
      throw new TypeError('IPv4Addr (string) is required');

    super();

    this.target = target;
    this._type = 'A';
  }
}

A.MODEL = {
  target: validators.IPv4
};

module.exports = A;

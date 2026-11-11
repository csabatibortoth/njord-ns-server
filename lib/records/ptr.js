'use strict';

const Record = require('./record');
const validators = require('../validators');

class PTR extends Record {
  constructor(target) {
    if (typeof (target) !== 'string')
      throw new TypeError('target (string) is required');

    super();

    this.target = target;
    this._type = 'PTR';
  }
}

PTR.MODEL = {
  target: validators.nsName
};

module.exports = PTR;

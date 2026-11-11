'use strict';

const Record = require('./record');
const validators = require('../validators');

class CNAME extends Record {
  constructor(target) {
    if (typeof (target) !== 'string')
      throw new TypeError('target (string) is required');

    super();

    this.target = target;
    this._type = 'CNAME';
  }
}

CNAME.MODEL = {
  target: validators.nsName
};

module.exports = CNAME;

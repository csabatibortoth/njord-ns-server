'use strict';

const Record = require('./record');
const validators = require('../validators');

class TXT extends Record {
  constructor(target) {
    if (typeof (target) !== 'string')
      throw new TypeError('target (string) is required');

    super();

    this.target = target;
    this._type = 'TXT';
  }
}

TXT.MODEL = {
  target: validators.nsTextData
};

module.exports = TXT;

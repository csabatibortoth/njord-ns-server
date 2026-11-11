'use strict';

const Record = require('./record');
const validators = require('../validators');

class NS extends Record {
  constructor(target) {
    if (typeof (target) !== 'string')
      throw new TypeError('target (string) is required');

    super();

    this.target = target;
    this._type = 'NS';
  }
}

NS.MODEL = {
  target: validators.nsName
};

module.exports = NS;

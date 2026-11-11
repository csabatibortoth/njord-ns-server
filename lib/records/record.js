'use strict';

const validators = require('../validators');

// The base of all the records. A record class describes its data with a
// MODEL, which maps each of its properties to a validator.
class Record {
  // true when all of the data of the record can be sent to a client
  valid() {
    return validators.validate(this, this.constructor.MODEL);
  }

  // the names of the properties that hold invalid data
  invalid() {
    return validators.invalid(this, this.constructor.MODEL);
  }
}

module.exports = Record;

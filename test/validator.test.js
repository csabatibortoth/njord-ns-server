'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const validators = require('../lib/validators');

const toTest = {
  nsName: [
    [ 'example.com', true ],
    [ '0example.com', true ],
    [ '_example.com', false ],
    [ '0_example.com', false ],
    [ '-example.com', false ],
    [ '0-example.com', true ],
    [ 'example-one.com', true ],
    [ 'example-111.com', true ],
    [ 'Example-111.com', true ],
    [ 'a name with spaces', false ],
    [ 'a'.repeat(64) + '.com', false ],
    [ 'a'.repeat(63) + '.com', true ],
    [ 'example.com.', true ],
    [ '.', true ],
    [ '', false ],
    [ 'example..com', false ],
    [ '.example.com', false ],
    [ 'example.com..', false ],
    [ Array(64).fill('abc').join('.'), false ],  // 255 characters
    [ Array(63).fill('abc').join('.') + '.', true ],
    [ 12345, false ]
  ],
  nsDomain: [
    [ 'example.com', true ],
    [ '_sip._tcp.example.com', true ],
    [ 'dns_admin.example.com.', true ],
    [ '.', true ],
    [ '-example.com', false ],
    [ 'a name with spaces', false ],
    [ 'example..com', false ],
    [ '', false ],
    [ null, false ]
  ],
  ttl: [
    [ 0, true ],
    [ 300, true ],
    [ 2147483647, true ],
    [ 2147483648, false ],
    [ -1, false ],
    [ 1.5, false ],
    [ '300', false ]
  ],
  port: [
    [ 53, true ],
    [ 65535, true ],
    [ 0, false ],
    [ 65536, false ],
    [ '53', false ]
  ],
  UInt32BE: [
    [ 'hello', false ],
    [ '12345', false ],
    [ 4294967296, false ],
    [ 4294967295, true ],
    [ -1, false ],
    [ 1.5, false ],
    [ NaN, false ],
    [ 0, true ],
    [ 10, true ]
  ],
  UInt16BE: [
    [ 'hello', false ],
    [ '12345', false ],
    [ 65536, false ],
    [ 65535, true ],
    [ -1, false ],
    [ 1.5, false ],
    [ 0, true ],
    [ 10, true ]
  ],
  nsText: [
    [ 'hello world', true ],
    [ '', true ],
    [ 'a'.repeat(255), true ],
    [ 'a'.repeat(256), false ],
    [ String.fromCharCode(233).repeat(128), false ],  // 256 bytes
    [ 12345, false ]
  ],
  nsTextData: [
    [ '', true ],
    [ 'a'.repeat(256), true ],
    [ 'a'.repeat(65278), true ],   // with its 256 length bytes: 65534
    [ 'a'.repeat(65280), false ],
    [ 12345, false ]
  ],
  IPv4: [
    [ '127.0.0.1', true ],
    [ '256.0.0.1', false ],
    [ '::1', false ]
  ],
  IPv6: [
    [ '::1', true ],
    [ '2001:db8::1', true ],
    [ 'fe80::1%eth0', false ],
    [ '127.0.0.1', false ]
  ]
};

for (const name of Object.keys(toTest)) {
  test('testing validator (' + name + ')', () => {
    for (const [value, expected] of toTest[name]) {
      assert.equal(validators[name](value), expected,
                   name + '(' + JSON.stringify(value) + ')');
    }
  });
}

test('testing validator (validate)', () => {
  const model = { a: validators.UInt16BE, b: validators.nsName };
  assert.equal(validators.validate({ a: 1, b: 'example.com' }, model), true);
  assert.equal(validators.validate({ a: -1, b: 'example.com' }, model), false);
  assert.equal(validators.validate({ a: 1, b: '' }, model), false);
  assert.equal(validators.validate({ a: 1 }, model), false);

  assert.deepEqual(validators.invalid({ a: 1, b: 'example.com' }, model), []);
  assert.deepEqual(validators.invalid({ a: -1 }, model), ['a', 'b']);
});

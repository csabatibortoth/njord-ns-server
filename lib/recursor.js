/*

  # Recursor

  A DNS client that answers a query by asking other DNS servers. The lookups
  are made with the resolver of node, which is built on c-ares.

*/

'use strict';

const { Resolver } = require('dns').promises;

const A = require('./records/a');
const AAAA = require('./records/aaaa');
const CNAME = require('./records/cname');
const MX = require('./records/mx');
const NS = require('./records/ns');
const PTR = require('./records/ptr');
const SOA = require('./records/soa');
const SRV = require('./records/srv');
const TXT = require('./records/txt');

// used for the records of which the resolver does not report the ttl
const DEFAULT_TTL = 60;

// what a failed lookup means for the response to our own client; anything
// that is not listed is a failure of the server
const ERRORS = {
  ENOTFOUND: 'enoname',
  ENODATA: 'enoerr',  // the name exists, but has no records of this type
  EREFUSED: 'erefuse',
  ENOTIMP: 'enotimp'
};

function targets(Record, type) {
  return (resolver, name, ttl) => resolver.resolve(name, type)
    .then((names) => names.map((target) => ({
      record: new Record(target),
      ttl: ttl
    })));
}

function addresses(Record, method) {
  return (resolver, name) => resolver[method](name, {ttl: true})
    .then((answers) => answers.map((answer) => ({
      record: new Record(answer.address),
      ttl: answer.ttl
    })));
}

// type -> function that resolves with a list of {record, ttl}
const LOOKUPS = {
  A: addresses(A, 'resolve4'),
  AAAA: addresses(AAAA, 'resolve6'),
  CNAME: targets(CNAME, 'CNAME'),
  NS: targets(NS, 'NS'),
  PTR: targets(PTR, 'PTR'),
  MX: (resolver, name, ttl) => resolver.resolveMx(name)
    .then((answers) => answers.map((mx) => ({
      record: new MX(mx.exchange, {priority: mx.priority, ttl: ttl}),
      ttl: ttl
    }))),
  SOA: (resolver, name, ttl) => resolver.resolveSoa(name)
    .then((soa) => [{
      record: new SOA(soa.nsname, {
        admin: soa.hostmaster,
        serial: soa.serial,
        refresh: soa.refresh,
        retry: soa.retry,
        expire: soa.expire,
        ttl: soa.minttl
      }),
      ttl: ttl
    }]),
  SRV: (resolver, name, ttl) => resolver.resolveSrv(name)
    .then((answers) => answers.map((srv) => ({
      record: new SRV(srv.name, srv.port, {
        priority: srv.priority,
        weight: srv.weight
      }),
      ttl: ttl
    }))),
  // the strings of a record are joined; they are split again when sent
  TXT: (resolver, name, ttl) => resolver.resolveTxt(name)
    .then((answers) => answers.map((strings) => ({
      record: new TXT(strings.join('')),
      ttl: ttl
    })))
};


class Recursor {
  // options:
  //   servers: the addresses of the servers to ask, with an optional port
  //            ('192.0.2.1', '192.0.2.1:5353', '[2001:db8::1]:53'). Defaults
  //            to the servers of the system.
  //   timeout: milliseconds to wait for an answer to each attempt
  //   tries: number of attempts made for each lookup
  //   ttl: ttl of the answers for which the server asked does not give one
  //        (it is only known for A and AAAA records). Defaults to 60.
  constructor(options) {
    options = options || {};
    if (typeof (options) !== 'object')
      throw new TypeError('options (object) required');

    const settings = {};
    if (options.timeout !== undefined)
      settings.timeout = options.timeout;
    if (options.tries !== undefined)
      settings.tries = options.tries;

    this._resolver = new Resolver(settings);
    if (options.servers !== undefined)
      this._resolver.setServers(options.servers);

    this._ttl = options.ttl === undefined ? DEFAULT_TTL : options.ttl;
  }

  // the types of record that can be looked up
  types() {
    return Object.keys(LOOKUPS);
  }

  servers() {
    return this._resolver.getServers();
  }

  // Looks up the records of a type for a name. Returns a promise for a list
  // of {record, ttl}, which is rejected with the error of the resolver (see
  // the error codes of the dns module of node) when the lookup fails.
  lookup(name, type) {
    if (typeof (name) !== 'string')
      return Promise.reject(new TypeError('name (string) is required'));

    if (!Object.prototype.hasOwnProperty.call(LOOKUPS, type)) {
      const err = new Error('unable to look up records of type ' + type);
      err.code = 'ENOTIMP';
      return Promise.reject(err);
    }

    return LOOKUPS[type](this._resolver, name || '.', this._ttl);
  }

  // Answers a query of a server with the records that are found for it. A
  // lookup that fails sets the response code of the query instead, so all
  // that is left to do is to send it:
  //
  //   server.on('query', (query) => {
  //     recursor.resolve(query, () => server.send(query));
  //   });
  //
  // Returns a promise for the query when there is no callback.
  resolve(query, callback) {
    const resolved = this._resolve(query);

    if (typeof (callback) !== 'function')
      return resolved;

    resolved.then(() => {
      process.nextTick(callback, null, query);
    }, (err) => {
      process.nextTick(callback, err, query);
    });
    return undefined;
  }

  async _resolve(query) {
    const name = query.name();

    query._flags.ra = true;  // recursion is available

    try {
      for (const answer of await this.lookup(name, query.type()))
        query.addAnswer(name, answer.record, answer.ttl);
    } catch (err) {
      query.setError(ERRORS[err.code] || 'eserver');
    }

    return query;
  }

  // Cancels the lookups that are in progress, which then fail
  cancel() {
    this._resolver.cancel();
  }
}

module.exports = Recursor;

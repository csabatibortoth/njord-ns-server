'use strict';

/**
 * A server that listens on UDP as well as on TCP, and that transfers its zone
 * to the clients that ask for it (AXFR).
 *
 * You can test it like this:
 *
 *   $ dig @127.0.0.1 -p 9999 www.example.com
 *   $ dig @127.0.0.1 -p 9999 example.com AXFR
 */

const named = require('../lib');

const PORT = 9999;
const ZONE = 'example.com';
const TTL = 300;

const soa = new named.SOARecord('ns.' + ZONE, {serial: 2024010101});

// name -> records
const records = {
  'example.com': [
    new named.NSRecord('ns.example.com'),
    new named.MXRecord('smtp.example.com', {priority: 10})
  ],
  'ns.example.com': [new named.ARecord('192.0.2.1')],
  'smtp.example.com': [new named.ARecord('192.0.2.2')],
  'www.example.com': [new named.CNAMERecord('example.com')],
  '_sip._tcp.example.com': [new named.SRVRecord('sip.example.com', 5060)]
};

const server = named.createServer();

server.on('query', (query) => {
  const domain = query.name();
  const type = query.type();
  console.log('DNS Query: (%s) %s over %s', type, domain, query.transport());

  if (type === 'AXFR') {
    // Zone transfers are only possible over TCP. This is also the place to
    // check query._client.address: a zone should not be given to everyone.
    if (query.transport() !== 'tcp' || domain !== ZONE) {
      query.setError('erefuse');
    } else {
      // a transfer starts and ends with the SOA record of the zone
      query.addAnswer(ZONE, soa, TTL);
      for (const name of Object.keys(records)) {
        for (const record of records[name])
          query.addAnswer(name, record, TTL);
      }
      query.addAnswer(ZONE, soa, TTL);
    }
  } else if (type === 'SOA' && domain === ZONE) {
    query.addAnswer(ZONE, soa, TTL);
  } else if (records[domain] === undefined) {
    query.setError('enoname');
  } else {
    for (const record of records[domain]) {
      if (record._type === type)
        query.addAnswer(domain, record, TTL);
    }
  }

  server.send(query);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('DNS server started on udp port %d', PORT);
});

server.listenTcp(PORT, '127.0.0.1', () => {
  console.log('DNS server started on tcp port %d', PORT);
});

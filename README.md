# Njord NS Server - DNS Server in Node.js

Njord NS Server based on Node-named is a lightweight DNS server written in pure javascript. It has
limited support for the DNS spec, but aims to implement all of the *common*
functionality that is in use today.





## Requirements

Node.js 20 or newer.

## Testing

```
npm install
npm test
```

The tests use the test runner that is built into Node.js, and query a running
server with the `dns` resolver of Node.js, so no other tools are needed.

## Creating a DNS Server
```javascript
var named = require('./lib/index');
var server = named.createServer();
var ttl = 300;

server.listen(9999, '127.0.0.1', function() {
  console.log('DNS server started on port 9999');
});

server.on('query', function(query) {
  var domain = query.name();
  console.log('DNS Query: %s', domain)
  var target = new named.SOARecord(domain, {serial: 12345});
  query.addAnswer(domain, target, ttl);
  server.send(query);
});
```
## Creating DNS Records

node-named provides helper functions for creating DNS records.
The records are available under 'named.record.NAME' where NAME is one
of ['A', 'AAAA', 'CNAME', 'SOA', 'MX', 'NS', 'PTR', 'TXT, 'SRV']. It is important to
remember that these DNS records are not permanently added to the server.
They only exist for the length of the particular request. After that, they are
destroyed. This means you have to create your own lookup mechanism.
```javascript
var named = require('node-named');

var soaRecord = new named.SOARecord('example.com', {serial: 201205150000});
console.log(soaRecord);
```
### Supported Record Types

The following record types are supported

 * A (ipv4)
 * AAAA (ipv6)
 * CNAME (aliases)
 * SOA (start of authority)
 * MX (mail server records)
 * NS (nameserver entries)
 * PTR (reverse entries)
 * TXT (arbitrary text entries)
 * SRV (service discovery)

## Logging

node-named uses [http://github.com/trentm/node-bunyan](bunyan) for logging.
It's a lot nicer to use if you npm install bunyan and put the bunyan tool in
your path. Otherwise, you will end up with JSON formatted log output by default.

### Replacing the default logger

You can pass in an alternate logger if you wish. If you do not, then it will use
bunyan by default. Your logger must expose the functions 'info', 'debug',
'warn', 'trace', 'error', and 'notice'.

### Validating records

`record.valid()` tells you whether a record can be sent to a client, and
`record.invalid()` which of its properties can not:
```javascript
var srv = new named.SRVRecord('sip example', 70000);
srv.valid();    // false
srv.invalid();  // [ 'target', 'port' ]
```

## TCP and zone transfers (AXFR)

A server listens on UDP with `listen`, and on TCP with `listenTcp`. Queries
that arrive over TCP are emitted and answered in the same way as the ones that
arrive over UDP, and `query.transport()` tells them apart.

A zone transfer is a query of the type `AXFR`, that is answered with all of
the records of the zone, between two copies of its SOA record. A transfer that
is too large for one DNS message is split over as many messages as it takes.
```javascript
server.listen(9999, '127.0.0.1');
server.listenTcp(9999, '127.0.0.1');

server.on('query', function(query) {
  if (query.type() === 'AXFR') {
    if (query.transport() !== 'tcp' || query.name() !== 'example.com') {
      query.setError('erefuse');
    } else {
      query.addAnswer('example.com', soa, 300);
      // ... one addAnswer for each record of the zone ...
      query.addAnswer('example.com', soa, 300);
    }
  }
  server.send(query);
});
```
See `examples/axfr.js` for a complete server. Anyone who can reach the TCP
port can ask for a transfer, so check `query._client.address` before you
answer one.

## Recursor

A recursor is a DNS client that answers a query by asking other DNS servers,
which are the ones of the system unless you name them. A lookup that fails
sets the response code of the query (`query.setError`), so the query can be
sent either way.
```javascript
var recursor = named.createRecursor({servers: ['1.1.1.1', '8.8.8.8']});

server.on('query', function(query) {
  recursor.resolve(query, function() {
    server.send(query);
  });
});
```
The client can be used by itself as well:
```javascript
recursor.lookup('example.com', 'MX').then(function(answers) {
  // [ { record: MX { exchange: ..., priority: ... }, ttl: 60 }, ... ]
});
```
The A, AAAA, CNAME, MX, NS, PTR, SOA, SRV and TXT records can be looked up.
See `examples/recursor.js`.

## Tell me even more...

When DNS was designed it was designed prior
to the web existing, so many of the features in the RFC are either never used,
or were never implemented. This server aims to be RFC compliant, but does not
implement any other protocol other than INET (the one we're all used to), and
only supports a handful of record types (the ones that are in use on a regular
basis).

## Looking up Records

There are a few handy ways to lookup DNS records in node.
https://github.com/LCMApps/dns-lookup-cache

## Release notes

See [RELEASE.md](RELEASE.md) for what changed in each release.

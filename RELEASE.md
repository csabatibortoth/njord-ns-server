# Njord NS Server 2.1.0

This release completes the TODO list of the project: PTR records, better
validation of records, queries over TCP including zone transfers (AXFR), and a
recursor that answers queries by asking other DNS servers.

Everything is an addition to 2.0.0. Existing servers keep working without
changes, with the exceptions listed under "Behaviour changes".

## New features

### PTR records

`named.PTRRecord(target)` is the answer to a reverse lookup, such as a query
for `1.2.0.192.in-addr.arpa`.

### Record validation

- `record.valid()` checks that names are valid host or domain names, that
  addresses are valid addresses, and that numbers are integers within the
  range of their field.
- `record.invalid()` returns the names of the properties that hold invalid
  data, for example `['target', 'port']`.
- `query.addAnswer` throws a `RangeError` for a TTL that is not an integer
  from 0 to 2147483647.

### TCP and zone transfers (AXFR)

- `server.listenTcp(port, [host], [onListen])` accepts queries over TCP, next
  to or instead of the UDP socket of `server.listen`. `server.close()` closes
  both.
- Queries that arrive over TCP are emitted with the same `query` event and
  answered with the same `server.send`. `query.transport()` returns `'udp'` or
  `'tcp'`.
- A zone transfer is a query of the type `AXFR`, answered with the SOA record
  of the zone, its records, and the SOA record again. A response of more than
  65535 bytes is split over several DNS messages.
- Idle connections are closed after 30 seconds, which the `tcpTimeout` option
  of `createServer` changes.

There is no access control for zone transfers: check `query._client.address`
before you answer one. See `examples/axfr.js`.

### Recursor

- `named.createRecursor({servers, timeout, tries, ttl})` creates a DNS client
  on top of the resolver of Node.js (c-ares). Without `servers` it asks the
  DNS servers of the system.
- `recursor.resolve(query, [callback])` adds the answers that are found to a
  query, or sets its response code when the lookup fails, so that the query
  can be sent either way.
- `recursor.lookup(name, type)` is the client by itself, and returns a promise
  for a list of records with their TTL.
- The A, AAAA, CNAME, MX, NS, PTR, SOA, SRV and TXT records can be looked up.

The resolver only reports the TTL of A and AAAA records. The other records get
the `ttl` of the recursor, which is 60 seconds by default. See
`examples/recursor.js`.

### Response codes

`query.setError(name)` sets the response code of a query, with `'enoerr'`,
`'eformat'`, `'eserver'`, `'enoname'`, `'enotimp'` or `'erefuse'`.

## Behaviour changes

- The target of a SRV record must be a domain name to be valid. It used to be
  any text of up to 255 characters.
- The port of a SRV record must be from 1 to 65535 to be valid.
- An IPv6 address with a zone (`fe80::1%eth0`) is not valid.
- The TTL of a MX record must be at most 2147483647 to be valid.
- A TXT record of more than 255 bytes is valid, as it is sent as several
  strings.
- Host names may end with a dot, and may be the root (`.`), which is what a
  null MX record and a SRV record of an unavailable service use.
- `query.addAnswer` rejects a TTL that is negative, fractional or too large
  when the answer is added. It used to fail when the response was sent.

## Known limitations

- A response that is too large for UDP is sent as it is. It is not truncated
  to make the client retry over TCP.
- `examples/cluster.js` does not run on Windows.

## Testing

```
npm install
npm test
```

The 105 tests cover the new features with a live server: queries over TCP, a
zone transfer of 6000 records, and a recursor that asks a second server.

---

# Njord NS Server 2.0.0

This release modernizes the codebase, updates every dependency, and makes
encoding a response several times faster. The exported API is unchanged, but
the minimum Node.js version is raised and a number of bugs are fixed in ways
that callers can observe, hence the new major version.

## Requirements

Node.js 20 or newer (was 0.6).

## Upgrading from 1.x

No code changes are needed for most users: the exports, method signatures and
events are the same, and `error.message()` is still a function. Check the list
of behaviour changes below if you relied on any of the old behaviour.

## Dependencies

| Package   | 1.0.1 | 2.0.0   |
|-----------|-------|---------|
| bunyan    | 0.7.0 | 1.8.15  |
| ipaddr.js | 0.1.1 | 2.5.0   |
| nodeunit  | 0.9.0 | removed |

The tests now use the test runner that is built into Node.js, so there are no
development dependencies, and `dig` is no longer needed to run them.

## Performance

A response is written in a single pass into one buffer, instead of one small
buffer per field. Names are compressed with DNS pointers (RFC 1035 4.1.4), so
responses are smaller as well.

Parsing a query and encoding its response, measured on one machine:

| Response | 1.0.1 (ops/s) | 2.0.0 (ops/s) | Size (bytes) |
|----------|---------------|---------------|--------------|
| A        | 53k           | 236k          | 62 → 48      |
| AAAA     | 41k           | 144k          | 74 → 60      |
| SOA      | 44k           | 234k          | 113 → 79     |
| 4 × MX   | 21k           | 118k          | 208 → 112    |

This is a micro-benchmark of the protocol code, not of network throughput.

## Behaviour changes

- `record.valid()` validates the record. It used to return `true` for
  everything.
- `query.addAnswer(name, record, 0)` sends a TTL of 0. It used to be replaced
  by the default of 5.
- `server.listen(port, '::1')` listens on IPv6. A UDP4 socket used to be
  opened whatever the address was.
- The address family of the client of a query is the real one. It used to be
  reported as `udp6` for every client.
- The counts in the header of a response describe what is sent. A query with
  EDNS options used to get a response that announced an additional record
  which was not there.
- The opcode of a query is decoded correctly, so `query.operation()` works for
  status, notify and update messages.
- Names with a trailing dot, and the root name, are encoded correctly.
- TXT records longer than 255 bytes are split into several strings.
- The constructors of the records leave the options that are passed to them
  alone.
- Invalid addresses and names are rejected when the response is encoded, which
  is reported with the `uncaughtException` event of the server.

## Other changes

- `lib/` is written with classes and in strict mode, and no longer leaks
  global variables.
- The examples listen on port 9999, as their output always claimed.
- `examples/cluster.js` documents that it does not run on Windows, where
  Node.js can not share a UDP socket between the workers of a cluster.

## Testing

```
npm install
npm test
```

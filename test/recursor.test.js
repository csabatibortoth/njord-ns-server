'use strict';

const assert = require('node:assert/strict');
const { Resolver } = require('node:dns').promises;
const { after, before, test } = require('node:test');

const named = require('../lib');

const HOST = '127.0.0.1';
const UPSTREAM_PORT = 9998;
const PORT = 9997;

// what the upstream server knows
const ZONE = {
  'example.com': {
    A: () => new named.ARecord('192.0.2.1'),
    AAAA: () => new named.AAAARecord('2001:db8::1'),
    NS: () => new named.NSRecord('ns.example.com'),
    MX: () => new named.MXRecord('smtp.example.com', {priority: 10}),
    SOA: () => new named.SOARecord('ns.example.com', {serial: 42, ttl: 30}),
    TXT: () => new named.TXTRecord('hello world')
  },
  'www.example.com': {
    CNAME: () => new named.CNAMERecord('example.com')
  },
  '_sip._tcp.example.com': {
    SRV: () => new named.SRVRecord('sip.example.com', 5060, {priority: 1})
  },
  '1.2.0.192.in-addr.arpa': {
    PTR: () => new named.PTRRecord('example.com')
  }
};

let upstream;
let server;
let recursor;

// asks the server that answers with the recursor
const client = new Resolver({ timeout: 2000, tries: 1 });
client.setServers([HOST + ':' + PORT]);

function listen(srv, port) {
  return new Promise((resolve) => srv.listen(port, HOST, resolve));
}

function close(srv) {
  return new Promise((resolve) => srv.close(resolve));
}

function fakeQuery(name, type) {
  const raw = named.Protocol.encode({
    header: {
      id: 1, flags: { opcode: 0, rd: true, rcode: 0 },
      qdCount: 1, anCount: 0, nsCount: 0, srCount: 0
    },
    question: { name: name, type: type, qclass: 1 }
  }, 'queryMessage');
  return named.Query.createQuery(
    named.Query.parse({ buf: raw, len: raw.length },
                      { family: 'udp4', address: HOST, port: 1 }));
}


///--- Tests

before(async () => {
  upstream = named.createServer();
  upstream.on('query', (query) => {
    const name = query.name();
    const records = ZONE[name];

    if (name === 'refused.example.com')
      query.setError('erefuse');
    else if (records === undefined)
      query.setError('enoname');
    else if (records[query.type()] !== undefined)
      query.addAnswer(name, records[query.type()](), 120);

    query.respond();
  });

  recursor = named.createRecursor({
    servers: [HOST + ':' + UPSTREAM_PORT],
    timeout: 1000,
    tries: 1,
    ttl: 77
  });

  server = named.createServer();
  server.on('query', (query) => {
    recursor.resolve(query, (err) => {
      assert.equal(err, null);
      server.send(query);
    });
  });

  await listen(upstream, UPSTREAM_PORT);
  await listen(server, PORT);
});

after(async () => {
  await close(server);
  await close(upstream);
});


test('recursor settings', () => {
  assert.deepEqual(recursor.servers(), [HOST + ':' + UPSTREAM_PORT]);
  assert.deepEqual(recursor.types().sort(), [
    'A', 'AAAA', 'CNAME', 'MX', 'NS', 'PTR', 'SOA', 'SRV', 'TXT'
  ]);
  assert.ok(named.createRecursor().servers().length >= 0);
  assert.throws(() => named.createRecursor('nope'), TypeError);
});

test('lookup: A, with the ttl of the upstream server', async () => {
  const answers = await recursor.lookup('example.com', 'A');
  assert.equal(answers.length, 1);
  assert.ok(answers[0].record instanceof named.ARecord);
  assert.equal(answers[0].record.target, '192.0.2.1');
  assert.equal(answers[0].ttl, 120);
});

test('lookup: every supported type', async () => {
  const lookups = {
    AAAA: ['example.com', { target: '2001:db8::1' }],
    CNAME: ['www.example.com', { target: 'example.com' }],
    NS: ['example.com', { target: 'ns.example.com' }],
    PTR: ['1.2.0.192.in-addr.arpa', { target: 'example.com' }],
    MX: ['example.com', { exchange: 'smtp.example.com', priority: 10 }],
    SOA: ['example.com', {
      host: 'ns.example.com', admin: 'hostmaster.ns.example.com',
      serial: 42, refresh: 10, retry: 10, expire: 10, ttl: 30
    }],
    SRV: ['_sip._tcp.example.com', {
      target: 'sip.example.com', port: 5060, priority: 1, weight: 10
    }],
    TXT: ['example.com', { target: 'hello world' }]
  };

  for (const type of Object.keys(lookups)) {
    const [name, expected] = lookups[type];
    const answers = await recursor.lookup(name, type);
    assert.equal(answers.length, 1, type);

    const record = answers[0].record;
    assert.equal(record._type, type);
    assert.equal(record.valid(), true, type);
    for (const key of Object.keys(expected))
      assert.equal(record[key], expected[key], type + '.' + key);
  }
});

test('lookup: failures', async () => {
  await assert.rejects(recursor.lookup('nope.example.com', 'A'),
                       { code: 'ENOTFOUND' });
  await assert.rejects(recursor.lookup('www.example.com', 'MX'),
                       { code: 'ENODATA' });
  await assert.rejects(recursor.lookup('refused.example.com', 'A'),
                       { code: 'EREFUSED' });
  await assert.rejects(recursor.lookup('example.com', 'AXFR'),
                       { code: 'ENOTIMP' });
  await assert.rejects(recursor.lookup(null, 'A'), TypeError);
});

test('resolve: returns a promise without a callback', async () => {
  const query = fakeQuery('example.com', 15);
  assert.equal(await recursor.resolve(query), query);
  assert.equal(query._flags.ra, true);
  assert.equal(query._flags.rcode, 0);

  const answers = query.answers();
  assert.equal(answers.length, 1);
  assert.equal(answers[0].name, 'example.com');
  assert.equal(answers[0].type, 'MX');
  assert.equal(answers[0].ttl, 77);  // the ttl of the recursor
  assert.equal(answers[0].record.exchange, 'smtp.example.com');
});

test('resolve: failures set the response code', async () => {
  const codes = {
    'nope.example.com': [1, 3],     // A: no such name
    'www.example.com': [15, 0],     // MX: no data
    'refused.example.com': [1, 5],  // A: refused
    'example.com': [252, 4]         // AXFR: not implemented
  };

  for (const name of Object.keys(codes)) {
    const [type, rcode] = codes[name];
    const query = await recursor.resolve(fakeQuery(name, type));
    assert.equal(query._flags.rcode, rcode, name);
    assert.deepEqual(query.answers(), []);
  }
});

test('resolve: unreachable servers are a server failure', async () => {
  const dead = named.createRecursor({
    servers: [HOST + ':9'], timeout: 200, tries: 1
  });
  const query = await dead.resolve(fakeQuery('example.com', 1));
  assert.equal(query._flags.rcode, 2);
});

test('a server that answers with the recursor', async () => {
  assert.deepEqual(await client.resolve4('example.com', { ttl: true }),
                   [{ address: '192.0.2.1', ttl: 120 }]);
  assert.deepEqual(await client.resolve6('example.com'), ['2001:db8::1']);
  assert.deepEqual(await client.resolveCname('www.example.com'),
                   ['example.com']);
  assert.deepEqual(await client.resolvePtr('1.2.0.192.in-addr.arpa'),
                   ['example.com']);
  assert.deepEqual(await client.resolveTxt('example.com'), [['hello world']]);

  const [srv] = await client.resolveSrv('_sip._tcp.example.com');
  assert.equal(srv.name, 'sip.example.com');
  assert.equal(srv.port, 5060);

  const soa = await client.resolveSoa('example.com');
  assert.equal(soa.nsname, 'ns.example.com');
  assert.equal(soa.serial, 42);

  await assert.rejects(client.resolve4('nope.example.com'),
                       { code: 'ENOTFOUND' });
  await assert.rejects(client.resolveMx('www.example.com'),
                       { code: 'ENODATA' });
});

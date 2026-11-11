'use strict';

const assert = require('node:assert/strict');
const dgram = require('node:dgram');
const net = require('node:net');
const { once } = require('node:events');
const { after, before, test } = require('node:test');

const named = require('../lib');
const dnsBuffer = require('./dnsbuffer');

const PORT = 1155;
const HOST = '127.0.0.1';
const ZONE = 'example.com';
const HOSTS = 6000;  // enough for a transfer that does not fit in one message

// example.com, without the type and class
const QUESTION = '07 65 78 61 6d 70 6c 65 03 63 6f 6d 00';

let server;
const sent = [];

function question(id, type) {
  return dnsBuffer.encode(id + ' 00 00 00 01 00 00 00 00 00 00 ' + QUESTION +
                          ' 00 ' + type + ' 00 01');
}

function frame(message) {
  const prefix = Buffer.alloc(2);
  prefix.writeUInt16BE(message.length);
  return Buffer.concat([prefix, message]);
}

// splits what was received over a connection into the messages it holds
function unframe(buffer) {
  const messages = [];
  let pos = 0;
  while (buffer.length - pos >= 2) {
    const end = pos + 2 + buffer.readUInt16BE(pos);
    if (end > buffer.length)
      break;
    messages.push(buffer.subarray(pos + 2, end));
    pos = end;
  }
  return { messages: messages, rest: buffer.length - pos };
}

// Writes the chunks to a new connection, and resolves with the messages that
// were received once `done` returns true for them
function exchange(chunks, done) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(PORT, HOST);
    let received = Buffer.alloc(0);

    socket.setTimeout(5000, () => {
      socket.destroy(new Error('timeout'));
    });
    socket.on('error', reject);
    socket.on('connect', () => {
      for (const chunk of chunks)
        socket.write(chunk);
    });
    socket.on('data', (chunk) => {
      received = Buffer.concat([received, chunk]);
      const { messages, rest } = unframe(received);
      if (rest === 0 && done(messages)) {
        socket.destroy();
        resolve(messages);
      }
    });
  });
}

function answerCount(messages) {
  return messages.reduce((sum, m) => sum + m.readUInt16BE(6), 0);
}


///--- Tests

before(async () => {
  server = named.createServer();

  server.on('query', (query) => {
    const domain = query.name();

    switch (query.type()) {
    case 'AXFR':
      // zone transfers are only possible over TCP
      if (query.transport() !== 'tcp' || domain !== ZONE) {
        query.setError('erefuse');
        break;
      }
      // a transfer starts and ends with the SOA record of the zone
      query.addAnswer(ZONE, new named.SOARecord(ZONE, {serial: 7}), 300);
      for (let i = 0; i < HOSTS; i++) {
        query.addAnswer('host' + i + '.' + ZONE,
                        new named.ARecord('10.0.' + (i >> 8) + '.' + (i & 255)),
                        300);
      }
      query.addAnswer(ZONE, new named.SOARecord(ZONE, {serial: 7}), 300);
      break;
    case 'A':
      query.addAnswer(domain, new named.ARecord('127.0.0.1'), 300);
      break;
    }
    query.respond();
  });

  server.on('after', (query, bytes) => {
    sent.push({ query: query, bytes: bytes });
  });

  await new Promise((resolve) => server.listen(PORT, HOST, resolve));
  await new Promise((resolve) => server.listenTcp(PORT, HOST, resolve));
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});


test('answer a query over tcp', async () => {
  const [response] = await exchange([frame(question('00 01', '01'))],
                                    (messages) => messages.length === 1);
  assert.equal(response.readUInt16BE(0), 1);          // id
  assert.equal(response[2] & 0x80, 0x80);             // a response
  assert.equal(response.readUInt16BE(6), 1);          // anCount
  assert.deepEqual([...response.subarray(-4)], [127, 0, 0, 1]);

  const last = sent[sent.length - 1];
  assert.equal(last.query.transport(), 'tcp');
  assert.equal(last.query._client.family, 'tcp4');
  assert.equal(last.query._client.address, HOST);
  assert.equal(last.bytes, response.length);
});

test('answer several queries on one connection', async () => {
  const messages = await exchange([
    Buffer.concat([frame(question('00 02', '01')),
                   frame(question('00 03', '01'))])
  ], (received) => received.length === 2);
  assert.deepEqual(messages.map((m) => m.readUInt16BE(0)), [2, 3]);
});

test('answer a query that arrives in pieces', async () => {
  const framed = frame(question('00 04', '01'));
  const [response] = await exchange([
    framed.subarray(0, 1), framed.subarray(1, 9), framed.subarray(9)
  ], (messages) => messages.length === 1);
  assert.equal(response.readUInt16BE(0), 4);
  assert.equal(response.readUInt16BE(6), 1);
});

test('transfer a zone (AXFR)', async () => {
  const messages = await exchange(
    [frame(question('00 05', 'fc'))],
    (received) => answerCount(received) === HOSTS + 2);

  // the zone is too large for one message
  assert.ok(messages.length > 1);

  for (const message of messages) {
    assert.ok(message.length <= 65535);
    assert.equal(message.readUInt16BE(0), 5);    // id
    assert.equal(message[2] & 0x80, 0x80);       // a response
    assert.equal(message[3] & 0x0f, 0);          // no error
    assert.equal(message.readUInt16BE(4), 1);    // qdCount
    assert.ok(message.readUInt16BE(6) > 0);      // anCount
  }

  // the first answer is the SOA record, with the name of the zone compressed
  const first = messages[0].subarray(12 + 17);
  assert.equal(first.readUInt16BE(0), 0xc00c);
  assert.equal(first.readUInt16BE(2), 6);

  // and so is the last one, which ends with its five 32 bit numbers
  const last = messages[messages.length - 1];
  assert.deepEqual([...last.subarray(-20, -16)], [0, 0, 0, 7]);

  const total = messages.reduce((sum, m) => sum + m.length, 0);
  assert.equal(sent[sent.length - 1].bytes, total);
});

test('refuse a zone transfer over udp', async () => {
  const socket = dgram.createSocket('udp4');
  try {
    socket.send(question('00 06', 'fc'), PORT, HOST);
    const [response] = await once(socket, 'message',
                                  { signal: AbortSignal.timeout(2000) });
    assert.equal(response.readUInt16BE(0), 6);
    assert.equal(response[3] & 0x0f, 5);         // refused
    assert.equal(response.readUInt16BE(6), 0);
  } finally {
    socket.close();
  }
});

test('close the connection of a client that sends garbage', async () => {
  const error = once(server, 'clientError',
                     { signal: AbortSignal.timeout(2000) });
  const socket = net.connect(PORT, HOST);
  socket.on('error', () => {});
  socket.on('connect', () => socket.write(frame(Buffer.from('nope'))));

  const [err] = await error;
  assert.equal(err.name, 'ProtocolError');
  await once(socket, 'close', { signal: AbortSignal.timeout(2000) });
});

test('close idle connections', async () => {
  const srv = named.createServer({ tcpTimeout: 100 });
  await new Promise((resolve) => srv.listenTcp(PORT + 1, HOST, resolve));

  try {
    const socket = net.connect(PORT + 1, HOST);
    socket.on('error', () => {});
    await once(socket, 'close', { signal: AbortSignal.timeout(2000) });
  } finally {
    await new Promise((resolve) => srv.close(resolve));
  }
});

test('close with open connections, and emit close once', async () => {
  const srv = named.createServer();
  let closed = 0;
  srv.on('close', () => closed++);

  await new Promise((resolve) => srv.listen(PORT + 1, HOST, resolve));
  await new Promise((resolve) => srv.listenTcp(PORT + 1, HOST, resolve));

  const socket = net.connect(PORT + 1, HOST);
  socket.on('error', () => {});
  await once(socket, 'connect');
  // give the server the time to accept the connection
  await new Promise((resolve) => setTimeout(resolve, 50));

  const gone = once(socket, 'close', { signal: AbortSignal.timeout(2000) });
  await new Promise((resolve) => srv.close(resolve));
  await gone;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(closed, 1);
});

test('listenTcp requires a port', () => {
  assert.throws(() => named.createServer().listenTcp(), TypeError);
});

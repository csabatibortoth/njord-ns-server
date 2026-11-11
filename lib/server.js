'use strict';

const assert = require('assert');
const dgram = require('dgram');
const EventEmitter = require('events');
const net = require('net');

const Query = require('./query');
const errors = require('./errors');

const ExceptionError = errors.ExceptionError;
const ProtocolError = errors.ProtocolError;

const DEFAULT_ADDRESS = '0.0.0.0';
const DEFAULT_TCP_TIMEOUT = 30000;  // milliseconds
const MAX_TCP_MESSAGE = 0xFFFF;     // the length prefix is 16 bits
const LENGTH_PREFIX = 2;


///--- API

class Server extends EventEmitter {
  constructor(options) {
    if (options === null || typeof (options) !== 'object')
      throw new TypeError('options (object) is required');

    super();

    this._log = options.log.child({component: 'agent'}, true);
    this._name = options.name || 'named';
    this._tcpTimeout = options.tcpTimeout === undefined ?
      DEFAULT_TCP_TIMEOUT : options.tcpTimeout;
    this._socket = null;             // UDP
    this._tcp = null;                // TCP
    this._connections = new Set();   // the open TCP connections
  }

  // Stops listening, on UDP as well as on TCP
  close(callback) {
    const socket = this._socket;
    const tcp = this._tcp;

    if (socket === null && tcp === null) {
      if (typeof (callback) === 'function')
        process.nextTick(callback);
      return;
    }

    if (typeof (callback) === 'function')
      this.once('close', callback);

    if (socket !== null)
      socket.close();

    if (tcp !== null) {
      tcp.close();
      for (const connection of this._connections)
        connection.destroy();
    }
  }

  // Starts listening for queries over UDP
  listen(port, address, callback) {
    if (!port)
      throw new TypeError('port (number) is required');

    if (typeof (address) === 'function' || !address) {
      callback = address;
      address = DEFAULT_ADDRESS;
    }

    const type = net.isIPv6(address) ? 'udp6' : 'udp4';
    const socket = dgram.createSocket({type: type});

    socket.once('listening', () => {
      this.emit('listening');
      if (typeof (callback) === 'function')
        process.nextTick(callback);
    });
    socket.on('close', () => {
      if (this._socket === socket)
        this._socket = null;
      this._onClosed();
    });
    socket.on('error', (err) => {
      this.emit('error', err);
    });
    socket.on('message', (buffer, rinfo) => {
      this._onMessage(buffer, {
        family: type,
        address: rinfo.address,
        port: rinfo.port
      }, null);
    });

    this._socket = socket;
    socket.bind(port, address);
  }

  // Starts listening for queries over TCP, which is what zone transfers
  // (AXFR) and clients that received a truncated response use
  listenTcp(port, address, callback) {
    if (!port)
      throw new TypeError('port (number) is required');

    if (typeof (address) === 'function' || !address) {
      callback = address;
      address = DEFAULT_ADDRESS;
    }

    const tcp = net.createServer((connection) => {
      this._onConnection(connection);
    });

    tcp.once('listening', () => {
      this.emit('listening');
      if (typeof (callback) === 'function')
        process.nextTick(callback);
    });
    tcp.on('close', () => {
      if (this._tcp === tcp)
        this._tcp = null;
      this._onClosed();
    });
    tcp.on('error', (err) => {
      // a server that failed to start listening never emits 'close'
      if (!tcp.listening && this._tcp === tcp)
        this._tcp = null;
      this.emit('error', err);
    });

    this._tcp = tcp;
    tcp.listen(port, address);
  }

  _onClosed() {
    if (this._socket === null && this._tcp === null)
      this.emit('close');
  }

  _onConnection(connection) {
    const connections = this._connections;
    const src = {
      family: net.isIPv6(connection.remoteAddress) ? 'tcp6' : 'tcp4',
      address: connection.remoteAddress,
      port: connection.remotePort
    };
    let pending = null;  // an incomplete message

    connections.add(connection);

    if (this._tcpTimeout > 0) {
      connection.setTimeout(this._tcpTimeout, () => {
        connection.destroy();
      });
    }

    connection.on('close', () => {
      connections.delete(connection);
    });
    connection.on('error', (err) => {
      this._log.trace({err: err}, 'tcp: connection error');
    });
    connection.on('data', (chunk) => {
      const buffer = pending === null ? chunk : Buffer.concat([pending, chunk]);
      let pos = 0;

      // each message is prefixed with its length (RFC1035 4.2.2)
      while (buffer.length - pos >= LENGTH_PREFIX) {
        const end = pos + LENGTH_PREFIX + buffer.readUInt16BE(pos);
        if (end > buffer.length)
          break;

        const message = buffer.subarray(pos + LENGTH_PREFIX, end);
        pos = end;

        if (!this._onMessage(message, src, connection)) {
          connection.destroy();
          return;
        }
      }

      pending = pos < buffer.length ? buffer.subarray(pos) : null;
    });
  }

  // Returns false for a message that is not a valid query
  _onMessage(buffer, src, connection) {
    let query;

    try {
      const decoded = Query.parse({
        buf: buffer,
        len: buffer.length
      }, src);
      query = Query.createQuery(decoded);
    } catch (e) {
      this.emit('clientError', new ProtocolError('invalid DNS datagram'));
      return false;
    }

    query._server = this;
    query._connection = connection;

    try {
      this.emit('query', query);
    } catch (e) {
      this._log.warn({
        err: e
      }, 'query handler threw an uncaughtException');
      this.emit('uncaughtException', e);
    }

    return true;
  }

  send(res) {
    assert.ok(res);

    const connection = res._connection;
    let messages = null;

    try {
      res._flags.qr = 1;  // replace with function
      if (connection)
        messages = res.encodeMessages(MAX_TCP_MESSAGE);
      else
        res.encode();
    } catch (e) {
      this._log.trace({err: e}, 'send: uncaughtException');
      this.emit('uncaughtException',
                new ExceptionError('unable to encode response'));
      return false;
    }

    const addr = res._client.address;
    const port = res._client.port;
    const log = this._log;

    const done = (err, bytes) => {
      if (err) {
        log.warn({
          adddress: addr,
          port: port,
          err: err
        }, 'send: unable to send response');
        // a TCP client that went away is not an error of the server
        if (messages === null)
          this.emit('error', new ExceptionError(err.message));
      } else {
        log.trace({
          adddress: addr,
          port: port
        }, 'send: DNS response sent');
        this.emit('after', res, bytes);
      }
    };

    if (messages === null) {
      log.trace({
        adddress: addr,
        port: port,
        len: res._raw.len
      }, 'send: writing DNS message to socket');

      this._socket.send(res._raw.buf, port, addr, done);
      return undefined;
    }

    // over TCP, the messages are written as one buffer, each one prefixed
    // with its length
    let size = 0;
    for (const message of messages)
      size += message.length;

    const framed = Buffer.allocUnsafe(size + messages.length * LENGTH_PREFIX);
    let pos = 0;
    for (const message of messages) {
      pos = framed.writeUInt16BE(message.length, pos);
      pos += message.copy(framed, pos);
    }

    log.trace({
      adddress: addr,
      port: port,
      len: size,
      messages: messages.length
    }, 'send: writing DNS messages to connection');

    if (connection.destroyed) {
      // the client did not wait for the answer
      log.trace({
        adddress: addr,
        port: port
      }, 'send: connection is closed');
      return undefined;
    }

    connection.write(framed, (err) => done(err, size));
    return undefined;
  }

  toString() {
    const address = this._socket ? this._socket.address() : {};
    return '[object named.Server <name=' + this._name +
      ', socket=' + JSON.stringify(address) + '>]';
  }
}


///--- Exports

module.exports = Server;

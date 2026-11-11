'use strict';

const protocol = require('./protocol');
const validators = require('./validators');

const queryTypes = protocol.queryTypes;

const QCLASS_IN = 1;
const DEFAULT_TTL = 5;

const OPERATIONS = {
  0: 'query',
  2: 'status',
  4: 'notify',
  5: 'update'
};

// the names accepted by setError
const ERROR_CODES = {
  enoerr: protocol.DNS_ENOERR,
  eformat: protocol.DNS_EFORMAT,
  eserver: protocol.DNS_ESERVER,
  enoname: protocol.DNS_ENONAME,
  enotimp: protocol.DNS_ENOTIMP,
  erefuse: protocol.DNS_EREFUSE
};


class Query {
  constructor(arg) {
    if (arg === null || typeof (arg) !== 'object')
      throw new TypeError('arg (object) is missing');

    this.id = arg.id;
    this._qdCount = arg.qdCount;
    this._anCount = arg.anCount || 0;
    this._nsCount = arg.nsCount || 0;
    this._srCount = arg.srCount || 0;
    this._flags = arg.flags;
    this._question = arg.question;
    this._answers = [];

    this._raw = null;
    this._client = null;
    this._server = null;      // set by the server that received the query
    this._connection = null;  // the socket of a query received over TCP
  }

  answers() {
    return this._answers.map((r) => ({
      name: r.name,
      type: queryTypes[r.rtype],
      record: r.rdata,
      ttl: r.rttl
    }));
  }

  name() {
    return this._question.name;
  }

  type() {
    return queryTypes[this._question.type];
  }

  operation() {
    const operation = OPERATIONS[this._flags.opcode];
    if (operation === undefined)
      throw new Error('invalid operation ' + this._flags.opcode);
    return operation;
  }

  // 'tcp' or 'udp', depending on how the query was received
  transport() {
    return this._connection === null ? 'udp' : 'tcp';
  }

  // Sets the response code. `name` is one of 'enoerr', 'eformat', 'eserver',
  // 'enoname', 'enotimp' or 'erefuse', with or without a 'DNS_' prefix.
  setError(name) {
    const key = typeof (name) === 'string' ?
      name.toLowerCase().replace(/^dns_/, '') : name;
    if (!Object.prototype.hasOwnProperty.call(ERROR_CODES, key))
      throw new Error('invalid error code ' + name);
    this._flags.rcode = ERROR_CODES[key];
  }

  _message() {
    return {
      header: {
        id: this.id,
        flags: this._flags,
        // the counts describe what is actually written: a single question,
        // our answers, and no authority or additional records (whatever the
        // client sent in those sections, such as EDNS options, is not echoed)
        qdCount: 1,
        anCount: this._answers.length,
        nsCount: 0,
        srCount: 0
      },
      question: this._question,
      answers: this._answers
    };
  }

  encode() {
    const encoded = protocol.encode(this._message(), 'answerMessage');

    this._raw = {
      buf: encoded,
      len: encoded.length
    };
  }

  // Encodes the query as a list of messages of at most `maxSize` bytes each,
  // for a response (such as a zone transfer) that may not fit in one message.
  encodeMessages(maxSize) {
    const message = this._message();
    message.header.anCount = 0;  // counted per message

    const messages = protocol.encodeAnswerMessages(message, maxSize);

    this._raw = {
      buf: messages[0],
      len: messages[0].length
    };
    return messages;
  }

  addAnswer(name, record, ttl) {
    if (typeof (name) !== 'string')
      throw new TypeError('name (string) required');
    if (record === null || typeof (record) !== 'object')
      throw new TypeError('record (Record) required');
    if (ttl !== undefined && typeof (ttl) !== 'number')
      throw new TypeError('ttl (number) required');
    if (ttl !== undefined && !validators.ttl(ttl))
      throw new RangeError('ttl must be an integer from 0 to 2147483647');

    const rtype = typeof (record._type) === 'string' ?
      queryTypes[record._type] : undefined;
    if (typeof (rtype) !== 'number')
      throw new Error('unknown queryType: ' + record._type);

    // Note:
    //
    // You can only have multiple answers in certain circumstances in no
    // circumstance can you mix different answer types other than 'A' with
    // 'AAAA' unless they are in the 'additional' section.
    //
    // There are also restrictions on what you can answer with depending on
    // the question.
    //
    // We will not attempt to enforce that here at the moment.
    //

    this._answers.push({
      name: name,
      rtype: rtype,
      rclass: QCLASS_IN,
      rttl: ttl === undefined ? DEFAULT_TTL : ttl,
      rdata: record
    });
    this._anCount++;
  }

  respond() {
    if (this._server === null)
      throw new Error('query was not received by a server');
    return this._server.send(this);
  }
}


function parseQuery(raw, src) {
  const decoded = protocol.decode(raw.buf, 'queryMessage').val;
  const header = decoded.header;

  return {
    id: header.id,
    flags: header.flags,
    qdCount: header.qdCount,
    anCount: header.anCount,
    nsCount: header.nsCount,
    srCount: header.srCount,
    question: decoded.question,
    src: src,
    raw: raw
  };
}

function createQuery(req) {
  const query = new Query(req);
  query._raw = req.raw;
  query._client = req.src;
  return query;
}


module.exports = {
  createQuery: createQuery,
  parse: parseQuery
};

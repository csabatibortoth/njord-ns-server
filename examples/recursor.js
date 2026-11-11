'use strict';

/**
 * A server that answers what it knows itself, and asks other DNS servers for
 * everything else.
 *
 * You can test it like this:
 *
 *   $ dig @127.0.0.1 -p 9999 local.test
 *   $ dig @127.0.0.1 -p 9999 nodejs.org MX
 */

const named = require('../lib');

const PORT = 9999;
const server = named.createServer();

// Without `servers` the DNS servers of the system are asked
const recursor = named.createRecursor({
  // servers: ['1.1.1.1', '8.8.8.8'],
  timeout: 2000,
  tries: 2
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('DNS server started on port %d', PORT);
  console.log('asking %s for what we do not know', recursor.servers());
});

server.on('query', (query) => {
  const domain = query.name();
  console.log('DNS Query: (%s) %s', query.type(), domain);

  if (domain === 'local.test' && query.type() === 'A') {
    query.addAnswer(domain, new named.ARecord('127.0.0.1'), 300);
    server.send(query);
    return;
  }

  // adds the answers that are found, or sets the response code when the
  // lookup fails
  recursor.resolve(query, () => server.send(query));
});

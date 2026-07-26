// Fixture for the server protocol that used to be invisible.
//
// `connect` is the server's own documented alias for `connection`, so anchoring
// only on the reserved spelling hid an entire realtime app's event surface. The
// alias alone would be far too loose — every client library in existence fires
// an event by that name — so the two are told apart structurally: a connection
// callback is handed a two-way channel and subscribes on it, and a client's
// reconnect callback is handed nothing.

export function registerHandlers(io, cache) {
  io.on('connect', (socket) => {
    socket.on('message', (msg) => process(msg));
    socket.on('disconnect', () => cleanup());
  });

  // Same word, no channel: a client library reconnecting, not a protocol.
  cache.on('connect', () => cleanup());
}

function process(msg) {
  return msg;
}

function cleanup() {
  return null;
}

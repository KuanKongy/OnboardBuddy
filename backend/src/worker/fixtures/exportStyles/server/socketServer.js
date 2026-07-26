const { Server } = require('socket.io');
const EventEmitter = require('events');

const io = new Server(3000);
const bus = new EventEmitter();

/**
 * Decoys. `.on` is used by EventEmitter, process, and every queue library, so
 * an unanchored `.on('<string>', fn)` rule would flag all of these as
 * application events.
 */
bus.on('internal-tick', () => {});
process.on('SIGTERM', () => {});

io.on('connection', (socket) => {
  socket.on('create-room', (payload) => {
    saveRoom(payload);
  });

  socket.on('chat-message', (payload) => {
    broadcast(payload);
  });

  // Named handler rather than an inline body.
  socket.on('disconnect', handleDisconnect);

  // Another decoy: an emitter that happens to be in scope inside the callback
  // but is not the socket parameter.
  bus.on('room-updated', () => {});
});

function handleDisconnect() {
  return 'bye';
}

function saveRoom(payload) {
  return payload;
}

function broadcast(payload) {
  return payload;
}

module.exports = { io };

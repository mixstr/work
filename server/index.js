'use strict';

const http = require('http');
const path = require('path');
const express = require('express');
const { WebSocketServer } = require('ws');
const { Game } = require('./game');

const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('/healthz', (_req, res) => res.send('ok'));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// ---------------------------------------------------------------------------
// Rooms
// ---------------------------------------------------------------------------

const PLAYER_COLORS = [
  '#e6473a', // red
  '#3a78e6', // blue
  '#3ab54a', // green
  '#e6b73a', // yellow
  '#9b3ae6', // purple
  '#3ae6d2', // cyan
];

const rooms = new Map(); // roomId -> room

function makeRoomId() {
  let id;
  do {
    id = Math.random().toString(36).slice(2, 6).toUpperCase();
  } while (rooms.has(id));
  return id;
}

function getRoom(id) { return rooms.get(id); }

function createRoom(opts) {
  const id = makeRoomId();
  const room = {
    id,
    seats: [], // {token, name, color, index, ws}
    game: null,
    opts: {
      width: opts.width,
      height: opts.height,
      maxPlayers: Math.min(Math.max(opts.maxPlayers || 4, 2), 6),
    },
    createdAt: Date.now(),
  };
  rooms.set(id, room);
  return room;
}

function seatByToken(room, token) {
  return room.seats.find((s) => s.token === token) || null;
}

function send(ws, msg) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function broadcastLobby(room) {
  const players = room.seats.map((s) => ({
    name: s.name, color: s.color, index: s.index, connected: !!(s.ws && s.ws.readyState === 1),
  }));
  for (const s of room.seats) {
    send(s.ws, {
      type: 'lobby',
      roomId: room.id,
      players,
      you: s.index,
      host: s.index === 0,
      started: !!room.game,
      maxPlayers: room.opts.maxPlayers,
    });
  }
}

function broadcastState(room) {
  if (!room.game) return;
  const snapshot = room.game.serialize();
  for (const s of room.seats) {
    send(s.ws, { type: 'state', you: s.index, game: snapshot });
  }
}

// ---------------------------------------------------------------------------
// WebSocket handling
// ---------------------------------------------------------------------------

wss.on('connection', (ws) => {
  ws.roomId = null;
  ws.token = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (!msg || typeof msg.type !== 'string') return;
    try {
      handleMessage(ws, msg);
    } catch (err) {
      console.error('handler error', err);
      send(ws, { type: 'error', message: 'Внутренняя ошибка сервера' });
    }
  });

  ws.on('close', () => {
    const room = ws.roomId ? getRoom(ws.roomId) : null;
    if (!room) return;
    const seat = seatByToken(room, ws.token);
    if (seat && seat.ws === ws) {
      seat.ws = null;
      // if lobby not started and host leaves, just keep seat; cleanup empty rooms
      broadcastLobby(room);
      maybeCleanupRoom(room);
    }
  });
});

function maybeCleanupRoom(room) {
  const anyConnected = room.seats.some((s) => s.ws && s.ws.readyState === 1);
  if (!anyConnected) {
    // give a grace period then delete if still empty
    setTimeout(() => {
      const r = getRoom(room.id);
      if (r && !r.seats.some((s) => s.ws && s.ws.readyState === 1)) {
        rooms.delete(room.id);
      }
    }, 5 * 60 * 1000);
  }
}

function handleMessage(ws, msg) {
  switch (msg.type) {
    case 'create': return onCreate(ws, msg);
    case 'join': return onJoin(ws, msg);
    case 'start': return onStart(ws, msg);
    case 'action': return onAction(ws, msg);
    default: return;
  }
}

function attachSeat(ws, room, seat) {
  // detach token from previous connection if any
  ws.roomId = room.id;
  ws.token = seat.token;
  seat.ws = ws;
}

function onCreate(ws, msg) {
  const room = createRoom({
    width: msg.width,
    height: msg.height,
    maxPlayers: msg.maxPlayers,
  });
  const seat = {
    token: msg.token,
    name: (msg.name || 'Игрок').slice(0, 16),
    color: PLAYER_COLORS[0],
    index: 0,
    ws,
  };
  room.seats.push(seat);
  attachSeat(ws, room, seat);
  send(ws, { type: 'created', roomId: room.id });
  broadcastLobby(room);
}

function onJoin(ws, msg) {
  const room = getRoom((msg.roomId || '').toUpperCase());
  if (!room) return send(ws, { type: 'error', message: 'Комната не найдена' });

  // reconnect path: seat with same token already exists
  let seat = seatByToken(room, msg.token);
  if (seat) {
    if (msg.name) seat.name = msg.name.slice(0, 16);
    attachSeat(ws, room, seat);
    send(ws, { type: 'joined', roomId: room.id, you: seat.index });
    broadcastLobby(room);
    if (room.game) broadcastState(room);
    return;
  }

  if (room.game) return send(ws, { type: 'error', message: 'Игра уже началась' });
  if (room.seats.length >= room.opts.maxPlayers) {
    return send(ws, { type: 'error', message: 'Комната заполнена' });
  }

  const index = room.seats.length;
  seat = {
    token: msg.token,
    name: (msg.name || 'Игрок').slice(0, 16),
    color: PLAYER_COLORS[index],
    index,
    ws,
  };
  room.seats.push(seat);
  attachSeat(ws, room, seat);
  send(ws, { type: 'joined', roomId: room.id, you: seat.index });
  broadcastLobby(room);
}

function onStart(ws, msg) {
  const room = ws.roomId ? getRoom(ws.roomId) : null;
  if (!room) return;
  const seat = seatByToken(room, ws.token);
  if (!seat || seat.index !== 0) {
    return send(ws, { type: 'error', message: 'Запустить игру может только хост' });
  }
  if (room.game) return;
  if (room.seats.length < 2) {
    return send(ws, { type: 'error', message: 'Нужно минимум 2 игрока' });
  }
  const players = room.seats.map((s) => ({ name: s.name, color: s.color }));
  room.game = new Game(players, { width: room.opts.width, height: room.opts.height });
  broadcastLobby(room);
  broadcastState(room);
}

function onAction(ws, msg) {
  const room = ws.roomId ? getRoom(ws.roomId) : null;
  if (!room || !room.game) return;
  const seat = seatByToken(room, ws.token);
  if (!seat) return;
  const ok = room.game.applyAction(seat.index, msg.action);
  if (!ok && room.game.lastError) {
    send(ws, { type: 'error', message: room.game.lastError });
  }
  broadcastState(room);
}

server.listen(PORT, () => {
  console.log(`Antiyoy web server listening on http://localhost:${PORT}`);
});

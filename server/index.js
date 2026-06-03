'use strict';

const http = require('http');
const path = require('path');
const express = require('express');
const { WebSocketServer } = require('ws');
const { Game } = require('./game');
const { authenticate } = require('./db');
const {
  setSessionCookie, clearSessionCookie, userFromRequest, parseCookies, verifySession, COOKIE_NAME,
} = require('./auth');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, '..', 'public');

const app = express();
app.use(express.json());

// ---- public assets (login page) ------------------------------------------
app.get('/login', (_req, res) => res.sendFile(path.join(PUBLIC, 'login.html')));
app.get('/login.js', (_req, res) => res.sendFile(path.join(PUBLIC, 'login.js')));
app.get('/style.css', (_req, res) => res.sendFile(path.join(PUBLIC, 'style.css')));
app.get('/healthz', (_req, res) => res.send('ok'));

// ---- auth API ------------------------------------------------------------
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const user = authenticate(username, password);
  if (!user) return res.status(401).json({ error: 'Неверный логин или пароль' });
  setSessionCookie(res, user.username);
  res.json({ ok: true, username: user.username });
});

app.post('/api/logout', (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  const username = userFromRequest(req);
  if (!username) return res.status(401).json({ error: 'unauthorized' });
  res.json({ username });
});

// ---- gated app -----------------------------------------------------------
function requirePage(req, res, next) {
  if (userFromRequest(req)) return next();
  return res.redirect('/login');
}

app.get('/', requirePage, (_req, res) => res.sendFile(path.join(PUBLIC, 'index.html')));
app.get('/app.js', requirePage, (_req, res) => res.sendFile(path.join(PUBLIC, 'app.js')));
app.use((_req, res) => res.redirect('/login'));

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const cookies = parseCookies(req.headers.cookie);
  const username = verifySession(cookies[COOKIE_NAME]);
  if (!username) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, (ws) => {
    ws.username = username;
    wss.emit('connection', ws, req);
  });
});

// ---------------------------------------------------------------------------
// Rooms
// ---------------------------------------------------------------------------

const PLAYER_COLORS = [
  '#e6473a', '#3a78e6', '#3ab54a', '#e6b73a',
  '#9b3ae6', '#3ae6d2', '#e6803a', '#e63a9b',
];
const MAX_SEATS = 8;
const ALLOWED_TURN_TIMERS = [0, 30, 45, 60];

const rooms = new Map();
const userRoom = new Map();

function makeRoomId() {
  let id;
  do { id = Math.random().toString(36).slice(2, 6).toUpperCase(); } while (rooms.has(id));
  return id;
}
function getRoom(id) { return rooms.get(id); }
function clamp(v, lo, hi) { return Math.min(Math.max(v | 0, lo), hi); }

function createRoom(opts) {
  const id = makeRoomId();
  const room = {
    id,
    seats: [],
    game: null,
    turnTimerHandle: null,
    turnKey: null,
    turnDeadline: null,
    chatLog: [],
    opts: {
      width: clamp(opts.width || 14, 6, 24),
      height: clamp(opts.height || 11, 6, 20),
      maxPlayers: clamp(opts.maxPlayers || 4, 2, MAX_SEATS),
      trees: opts.trees !== false,
      turnTimer: ALLOWED_TURN_TIMERS.includes(opts.turnTimer | 0) ? (opts.turnTimer | 0) : 0,
    },
    createdAt: Date.now(),
  };
  rooms.set(id, room);
  return room;
}

function seatByUser(room, username) { return room.seats.find((s) => s.username === username) || null; }
function send(ws, msg) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); }

function lobbyPayload(room, seat) {
  return {
    type: 'lobby',
    roomId: room.id,
    players: room.seats.map((s) => ({
      name: s.name, color: s.color, index: s.index,
      connected: !!(s.ws && s.ws.readyState === 1),
    })),
    you: seat.index,
    host: seat.index === 0,
    started: !!room.game,
    opts: room.opts,
  };
}

function broadcastLobby(room) {
  for (const s of room.seats) send(s.ws, lobbyPayload(room, s));
}

function broadcastState(room) {
  if (!room.game) return;
  for (const s of room.seats) {
    send(s.ws, { type: 'state', you: s.index, game: room.game.serialize(s.index), turnDeadline: room.turnDeadline });
  }
}

function broadcastFx(room, events) {
  if (!events || !events.length) return;
  for (const s of room.seats) send(s.ws, { type: 'fx', events });
}

function sendChatHistory(ws, room) {
  for (const m of room.chatLog) send(ws, m);
}

// ---- turn timer ----------------------------------------------------------
function clearTurnTimer(room) {
  if (room.turnTimerHandle) { clearTimeout(room.turnTimerHandle); room.turnTimerHandle = null; }
  room.turnKey = null;
  room.turnDeadline = null;
}

function armTurnTimer(room) {
  if (!room.game || room.game.status !== 'playing' || !room.opts.turnTimer) {
    if (room.turnTimerHandle) { clearTimeout(room.turnTimerHandle); room.turnTimerHandle = null; }
    room.turnDeadline = null;
    return;
  }
  const key = `${room.game.current}:${room.game.turnCount}`;
  if (key === room.turnKey && room.turnTimerHandle) return; // same turn, keep running
  if (room.turnTimerHandle) clearTimeout(room.turnTimerHandle);
  room.turnKey = key;
  room.turnDeadline = Date.now() + room.opts.turnTimer * 1000;
  room.turnTimerHandle = setTimeout(() => {
    if (!room.game || room.game.status !== 'playing') return;
    if (`${room.game.current}:${room.game.turnCount}` !== key) return;
    room.game.applyAction(room.game.current, { type: 'endTurn' });
    if (room.game.status === 'finished') { for (const s of room.seats) userRoom.delete(s.username); }
    armTurnTimer(room);
    broadcastState(room);
  }, room.opts.turnTimer * 1000);
}

function leaveLobby(username) {
  const rid = userRoom.get(username);
  if (!rid) return;
  const room = getRoom(rid);
  if (!room || room.game) return;
  room.seats = room.seats.filter((s) => s.username !== username);
  userRoom.delete(username);
  room.seats.forEach((s, i) => { s.index = i; s.color = PLAYER_COLORS[i]; });
  if (room.seats.length === 0) rooms.delete(room.id);
  else broadcastLobby(room);
}

// ---------------------------------------------------------------------------
// WebSocket handling
// ---------------------------------------------------------------------------

wss.on('connection', (ws) => {
  ws.roomId = null;
  send(ws, { type: 'me', username: ws.username });

  const rid = userRoom.get(ws.username);
  if (rid) {
    const room = getRoom(rid);
    const seat = room && seatByUser(room, ws.username);
    if (room && seat) {
      seat.ws = ws; ws.roomId = room.id;
      send(ws, lobbyPayload(room, seat));
      if (room.game) {
        send(ws, { type: 'state', you: seat.index, game: room.game.serialize(seat.index), turnDeadline: room.turnDeadline });
        sendChatHistory(ws, room);
      }
      broadcastLobby(room);
    } else {
      userRoom.delete(ws.username);
    }
  }

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (!msg || typeof msg.type !== 'string') return;
    try { handleMessage(ws, msg); } catch (err) {
      console.error('handler error', err);
      send(ws, { type: 'error', message: 'Внутренняя ошибка сервера' });
    }
  });

  ws.on('close', () => {
    const room = ws.roomId ? getRoom(ws.roomId) : null;
    if (!room) return;
    const seat = seatByUser(room, ws.username);
    if (seat && seat.ws === ws) { seat.ws = null; broadcastLobby(room); }
  });
});

function handleMessage(ws, msg) {
  switch (msg.type) {
    case 'create': return onCreate(ws, msg);
    case 'join': return onJoin(ws, msg);
    case 'config': return onConfig(ws, msg);
    case 'start': return onStart(ws);
    case 'leave': return onLeave(ws);
    case 'endGame': return onEndGame(ws);
    case 'action': return onAction(ws, msg);
    case 'chat': return onChat(ws, msg);
    default: return;
  }
}

function onChat(ws, msg) {
  const room = ws.roomId ? getRoom(ws.roomId) : null;
  if (!room) return;
  const seat = seatByUser(room, ws.username);
  if (!seat) return;
  const text = String(msg.text == null ? '' : msg.text).slice(0, 240).trim();
  if (!text) return;
  const out = { type: 'chat', index: seat.index, name: seat.name, color: seat.color, text };
  room.chatLog.push(out);
  if (room.chatLog.length > 60) room.chatLog.shift();
  for (const s of room.seats) send(s.ws, out);
}

function onCreate(ws, msg) {
  const existing = userRoom.get(ws.username);
  if (existing && getRoom(existing) && getRoom(existing).game) {
    const room = getRoom(existing);
    const seat = seatByUser(room, ws.username);
    seat.ws = ws; ws.roomId = room.id;
    send(ws, lobbyPayload(room, seat));
    broadcastState(room);
    return send(ws, { type: 'error', message: 'Вы уже в активной игре — возвращаю вас в неё' });
  }
  leaveLobby(ws.username);

  const room = createRoom({
    width: msg.width, height: msg.height, maxPlayers: msg.maxPlayers,
    trees: msg.trees, turnTimer: msg.turnTimer,
  });
  const seat = { username: ws.username, name: (msg.name || ws.username).slice(0, 16), color: PLAYER_COLORS[0], index: 0, ws };
  room.seats.push(seat);
  userRoom.set(ws.username, room.id);
  ws.roomId = room.id;
  send(ws, { type: 'created', roomId: room.id });
  broadcastLobby(room);
}

function onJoin(ws, msg) {
  const room = getRoom((msg.roomId || '').toUpperCase());
  if (!room) return send(ws, { type: 'error', message: 'Комната не найдена' });

  let seat = seatByUser(room, ws.username);
  if (seat) {
    if (msg.name) seat.name = msg.name.slice(0, 16);
    seat.ws = ws; ws.roomId = room.id;
    userRoom.set(ws.username, room.id);
    send(ws, { type: 'joined', roomId: room.id, you: seat.index });
    broadcastLobby(room);
    if (room.game) { broadcastState(room); sendChatHistory(ws, room); }
    return;
  }

  if (room.game) return send(ws, { type: 'error', message: 'Игра уже началась' });
  if (room.seats.length >= room.opts.maxPlayers) return send(ws, { type: 'error', message: 'Комната заполнена' });
  leaveLobby(ws.username);

  const index = room.seats.length;
  seat = { username: ws.username, name: (msg.name || ws.username).slice(0, 16), color: PLAYER_COLORS[index], index, ws };
  room.seats.push(seat);
  userRoom.set(ws.username, room.id);
  ws.roomId = room.id;
  send(ws, { type: 'joined', roomId: room.id, you: seat.index });
  broadcastLobby(room);
}

function onConfig(ws, msg) {
  const room = ws.roomId ? getRoom(ws.roomId) : null;
  if (!room || room.game) return;
  const seat = seatByUser(room, ws.username);
  if (!seat || seat.index !== 0) return;
  if (msg.width != null) room.opts.width = clamp(msg.width, 6, 24);
  if (msg.height != null) room.opts.height = clamp(msg.height, 6, 20);
  if (msg.maxPlayers != null) room.opts.maxPlayers = clamp(Math.max(msg.maxPlayers, room.seats.length), 2, MAX_SEATS);
  if (msg.trees != null) room.opts.trees = !!msg.trees;
  if (msg.turnTimer != null && ALLOWED_TURN_TIMERS.includes(msg.turnTimer | 0)) room.opts.turnTimer = msg.turnTimer | 0;
  broadcastLobby(room);
}

function onStart(ws) {
  const room = ws.roomId ? getRoom(ws.roomId) : null;
  if (!room) return;
  const seat = seatByUser(room, ws.username);
  if (!seat || seat.index !== 0) return send(ws, { type: 'error', message: 'Запустить игру может только хост' });
  if (room.game) return;
  if (room.seats.length < 2) return send(ws, { type: 'error', message: 'Нужно минимум 2 игрока' });
  const players = room.seats.map((s) => ({ name: s.name, color: s.color }));
  room.game = new Game(players, { width: room.opts.width, height: room.opts.height, trees: room.opts.trees });
  broadcastLobby(room);
  armTurnTimer(room);
  broadcastState(room);
}

function onLeave(ws) {
  const room = ws.roomId ? getRoom(ws.roomId) : null;
  if (!room || room.game) return; // can't abandon a running game seat
  leaveLobby(ws.username);
  ws.roomId = null;
}

function onEndGame(ws) {
  const room = ws.roomId ? getRoom(ws.roomId) : null;
  if (!room || !room.game) return;
  const seat = seatByUser(room, ws.username);
  if (!seat || seat.index !== 0) return send(ws, { type: 'error', message: 'Завершить игру может только хост' });
  room.game = null;
  clearTurnTimer(room);
  for (const s of room.seats) send(s.ws, { type: 'gameEnded' });
  broadcastLobby(room);
}

function onAction(ws, msg) {
  const room = ws.roomId ? getRoom(ws.roomId) : null;
  if (!room || !room.game) return;
  const seat = seatByUser(room, ws.username);
  if (!seat) return;
  const ok = room.game.applyAction(seat.index, msg.action);
  if (!ok && room.game.lastError) send(ws, { type: 'error', message: room.game.lastError });
  if (ok) broadcastFx(room, room.game.lastEvents);
  if (room.game.status === 'finished') {
    clearTurnTimer(room);
    for (const s of room.seats) userRoom.delete(s.username);
  } else {
    armTurnTimer(room);
  }
  broadcastState(room);
}

server.listen(PORT, () => {
  console.log(`Antiyoy web server listening on http://localhost:${PORT}`);
});

'use strict';

// ===========================================================================
// Small helpers
// ===========================================================================
const $ = (id) => document.getElementById(id);
const SQRT3 = Math.sqrt(3);
const SIZE = 34; // base hex radius in world units

let MY_USERNAME = '';

// ===========================================================================
// Networking
// ===========================================================================
let ws = null;
let wsReady = false;
const outbox = [];

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);
  ws.onopen = () => {
    wsReady = true;
    while (outbox.length) ws.send(JSON.stringify(outbox.shift()));
    // server auto-resumes us into any room/game we belong to (keyed by account)
  };
  ws.onmessage = (e) => { try { onServer(JSON.parse(e.data)); } catch (err) { console.error(err); } };
  ws.onclose = () => { wsReady = false; setTimeout(connect, 1500); };
  ws.onerror = () => {};
}

function net(msg) {
  if (wsReady && ws.readyState === 1) ws.send(JSON.stringify(msg));
  else outbox.push(msg);
}

function nameInput() {
  return ($('name').value || localStorage.getItem('antiyoy_name') || MY_USERNAME || 'Игрок').slice(0, 16);
}

// ===========================================================================
// Screens
// ===========================================================================
function show(screen) {
  for (const s of ['menu', 'lobby', 'game']) $(s).classList.toggle('hidden', s !== screen);
}

// ===========================================================================
// State
// ===========================================================================
let YOU = 0;
let roomId = null;
let state = null;            // serialized game
let hexMap = new Map();      // "q,r" -> hex
let provMembers = new Map(); // provinceId -> [hex]

let selectedProvince = null; // capital coord {q,r}
let selectedUnit = null;     // hex coord {q,r}
let selectedBallista = null; // hex coord {q,r}
let hand = null;             // {kind, level}
let reachable = new Set();
let capturable = new Set();
let fireTargets = new Set();
let turnDeadline = null;

const UNIT_DEFS = [
  { kind: 'peasant', level: 1, cost: 10, name: 'Крестьянин', sub: 'ур.1 · содерж. 2', desc: 'Базовый юнит. Захватывает незащищённые клетки, рубит деревья.' },
  { kind: 'spearman', level: 2, cost: 20, name: 'Копейщик', sub: 'ур.2 · содерж. 6', desc: 'Бьёт защиту 1 уровня. Получается из двух крестьян.' },
  { kind: 'baron', level: 3, cost: 30, name: 'Барон', sub: 'ур.3 · содерж. 18', desc: 'Бьёт защиту 2 уровня. Дорогое содержание.' },
  { kind: 'knight', level: 4, cost: 40, name: 'Рыцарь', sub: 'ур.4 · содерж. 54', desc: 'Сильнейший. Пробивает любую защиту, неуязвим для баллисты и метеора.' },
  { kind: 'horseman', level: 2, cost: 25, name: 'Всадник', sub: 'ур.2 · содерж. 10', desc: 'Сила копейщика, дальность ×1.5 (рейды на 2 гекса). Вне своей провинции живёт 3 хода.' },
  { kind: 'scout', level: 1, cost: 15, name: 'Лазутчик', sub: 'ур.1 · содерж. 4', desc: 'Скрытность: невидим врагу, пока не подойдёт к его земле. Диверсант.' },
  { kind: 'summoner', level: 2, cost: 35, name: 'Призыватель', sub: 'ур.2 · содерж. 12', desc: 'Раз в ход бесплатно призывает крестьянина на соседнюю свою клетку.' },
];
const BUILD_DEFS = [
  { kind: 'farm', cost: 12, name: 'Ферма', sub: '+4 к доходу', desc: 'Строится рядом со столицей или другой фермой. Каждая следующая дороже на 2.' },
  { kind: 'tower', cost: 15, name: 'Башня', sub: 'защита 2', desc: 'Защищает себя и соседние клетки на уровень 2.' },
  { kind: 'strongTower', cost: 35, name: 'Сильная башня', sub: 'защита 3', desc: 'Защита 3 уровня — пробивает только рыцарь.' },
  { kind: 'ballista', cost: 80, name: 'Баллиста', sub: 'защита 3 · содерж. 60', desc: 'Не двигается. Раз в ход бьёт по вражескому юниту в радиусе 2 (до ур.3). Ломается рыцарём.' },
];
const SPELL_DEFS = [
  { kind: 'thunder', cost: 30, name: 'Громовой удар', sub: 'оглушение', desc: 'Оглушает вражеского юнита — он пропускает свой следующий ход.' },
  { kind: 'meteor', cost: 60, name: 'Метеор', sub: 'урон по клетке', desc: 'Бьёт в любую клетку: уничтожает юнита (до ур.3) или постройку. Не захватывает клетку.' },
  { kind: 'earthquake', cost: 180, name: 'Землетрясение', sub: 'área 3×3', desc: 'Ломает все укрепления (башни, сильные башни, баллисты) в области 3×3.' },
];
const UNIT_KINDS = UNIT_DEFS.map((u) => u.kind);
const BUILD_KINDS = BUILD_DEFS.map((b) => b.kind);
const SPELL_KINDS = SPELL_DEFS.map((s) => s.kind);
const isUnitKind = (kind) => UNIT_KINDS.includes(kind);
const isBuildKind = (kind) => BUILD_KINDS.includes(kind);
const isSpellKind = (kind) => SPELL_KINDS.includes(kind);
function unitDef(kind) { return UNIT_DEFS.find((u) => u.kind === kind); }
function defByKind(kind) {
  return UNIT_DEFS.concat(BUILD_DEFS, SPELL_DEFS).find((d) => d.kind === kind);
}

const cam = { x: 0, y: 0, scale: 1, ready: false };

const k = (q, r) => q + ',' + r;

function onServer(msg) {
  switch (msg.type) {
    case 'me':
      MY_USERNAME = msg.username || '';
      $('meName').textContent = MY_USERNAME;
      if (!$('name').value) $('name').value = localStorage.getItem('antiyoy_name') || MY_USERNAME;
      break;
    case 'created':
      roomId = msg.roomId; break;
    case 'joined':
      roomId = msg.roomId; YOU = msg.you; break;
    case 'lobby':
      roomId = msg.roomId; YOU = msg.you; renderLobby(msg);
      if (!msg.started) show('lobby');
      break;
    case 'state':
      YOU = msg.you; turnDeadline = msg.turnDeadline || null; ingestState(msg.game); show('game'); break;
    case 'gameEnded':
      state = null; clearSelection(); $('overlay').classList.add('hidden'); show('lobby'); break;
    case 'error':
      showError(msg.message); break;
  }
}

function showError(text) {
  if (!$('game').classList.contains('hidden')) toast(text);
  else { $('menuError').textContent = text; }
}

// ===========================================================================
// Menu
// ===========================================================================
$('btnCreate').onclick = () => {
  localStorage.setItem('antiyoy_name', nameInput());
  net({
    type: 'create', name: nameInput(),
    width: +$('optW').value, height: +$('optH').value, maxPlayers: +$('optMax').value,
    trees: $('optTrees').checked, turnTimer: +$('optTimer').value,
  });
};
$('btnJoin').onclick = () => {
  const code = $('joinCode').value.trim().toUpperCase();
  if (code.length < 3) return showError('Введите код комнаты');
  localStorage.setItem('antiyoy_name', nameInput());
  net({ type: 'join', roomId: code, name: nameInput() });
};
$('name').value = localStorage.getItem('antiyoy_name') || '';

$('btnLogout').onclick = async () => {
  try { await fetch('/api/logout', { method: 'POST' }); } catch {}
  location.href = '/login';
};

// ===========================================================================
// Lobby
// ===========================================================================
let configEcho = false; // guard so server echoes don't fight user typing
function renderLobby(msg) {
  $('lobbyCode').textContent = msg.roomId;
  const list = $('playerList');
  list.innerHTML = '';
  for (const p of msg.players) {
    const li = document.createElement('li');
    li.innerHTML = `<span class="swatch ${p.connected ? '' : 'dot-off'}" style="background:${p.color}"></span>
      <span>${escapeHtml(p.name)}</span>${p.index === 0 ? ' <small>(хост)</small>' : ''}`;
    list.appendChild(li);
  }
  const btn = $('btnStart');
  btn.classList.toggle('hidden', !msg.host);
  btn.disabled = msg.players.length < 2;
  $('lobbyHint').textContent = msg.host
    ? (msg.players.length < 2 ? 'Ждём ещё игроков…' : 'Можно начинать!')
    : 'Ждём, пока хост начнёт игру…';

  // settings: editable by host, read-only for everyone else
  if (msg.opts) {
    configEcho = true;
    $('lobW').value = msg.opts.width;
    $('lobH').value = msg.opts.height;
    $('lobMax').value = msg.opts.maxPlayers;
    $('lobTrees').checked = msg.opts.trees !== false;
    $('lobTimer').value = String(msg.opts.turnTimer || 0);
    configEcho = false;
  }
  for (const id of ['lobW', 'lobH', 'lobMax', 'lobTrees', 'lobTimer']) $(id).disabled = !msg.host;
  $('settingsHint').textContent = msg.host
    ? 'Можно менять до старта.'
    : 'Настройки задаёт хост.';
}
$('btnStart').onclick = () => net({ type: 'start' });
$('btnLeave').onclick = () => { net({ type: 'leave' }); show('menu'); };

function sendConfig() {
  if (configEcho) return;
  net({
    type: 'config',
    width: +$('lobW').value, height: +$('lobH').value, maxPlayers: +$('lobMax').value,
    trees: $('lobTrees').checked, turnTimer: +$('lobTimer').value,
  });
}
for (const id of ['lobW', 'lobH', 'lobMax', 'lobTrees', 'lobTimer']) $(id).addEventListener('change', sendConfig);

function escapeHtml(s) { return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// ===========================================================================
// Game state ingestion
// ===========================================================================
function ingestState(g) {
  state = g;
  hexMap = new Map();
  for (const h of g.hexes) hexMap.set(k(h.q, h.r), h);
  provMembers = new Map();
  for (const h of g.hexes) {
    if (h.province) {
      if (!provMembers.has(h.province)) provMembers.set(h.province, []);
      provMembers.get(h.province).push(h);
    }
  }
  if (!cam.ready) fitCamera();

  // drop selections that no longer belong to us / are stale
  if (selectedUnit) {
    const h = hexMap.get(k(selectedUnit.q, selectedUnit.r));
    if (!h || h.owner !== YOU || !h.unit) { selectedUnit = null; }
  }
  if (selectedBallista) {
    const h = hexMap.get(k(selectedBallista.q, selectedBallista.r));
    if (!h || h.owner !== YOU || h.building !== 'ballista' || h.fired) selectedBallista = null;
  }
  if (selectedProvince) {
    const h = hexMap.get(k(selectedProvince.q, selectedProvince.r));
    if (!h || !h.capital || h.owner !== YOU) selectedProvince = null;
  }
  computeHighlights();
  renderPanel();
  startTimerTicker();
  draw();
}

// turn timer countdown display
let timerInterval = null;
function startTimerTicker() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  const tag = $('timerTag');
  if (!turnDeadline || !state || state.status !== 'playing') { tag.classList.add('hidden'); return; }
  const tick = () => {
    if (!state || state.status !== 'playing' || !turnDeadline) {
      tag.classList.add('hidden');
      if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
      return;
    }
    const left = Math.max(0, Math.ceil((turnDeadline - Date.now()) / 1000));
    tag.textContent = '⏱ ' + left + 'с';
    tag.classList.remove('hidden');
    tag.classList.toggle('warn', left <= 10);
    if (left <= 0 && timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  };
  tick();
  timerInterval = setInterval(tick, 500);
}

// ===========================================================================
// Hex math & camera
// ===========================================================================
function hexToWorld(q, r) {
  return { x: SIZE * SQRT3 * (q + r / 2), y: SIZE * 1.5 * r };
}
function worldToScreen(x, y) { return { x: x * cam.scale + cam.x, y: y * cam.scale + cam.y }; }
function screenToWorld(x, y) { return { x: (x - cam.x) / cam.scale, y: (y - cam.y) / cam.scale }; }

function worldToHex(x, y) {
  const q = (SQRT3 / 3 * x - 1 / 3 * y) / SIZE;
  const r = (2 / 3 * y) / SIZE;
  return axialRound(q, r);
}
function axialRound(q, r) {
  let x = q, z = r, y = -x - z;
  let rx = Math.round(x), ry = Math.round(y), rz = Math.round(z);
  const dx = Math.abs(rx - x), dy = Math.abs(ry - y), dz = Math.abs(rz - z);
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dy > dz) ry = -rx - rz;
  else rz = -rx - ry;
  return { q: rx, r: rz };
}

function fitCamera() {
  if (!state || !state.hexes.length) return;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const h of state.hexes) {
    const w = hexToWorld(h.q, h.r);
    minX = Math.min(minX, w.x); maxX = Math.max(maxX, w.x);
    minY = Math.min(minY, w.y); maxY = Math.max(maxY, w.y);
  }
  const pad = SIZE * 2;
  const cw = canvas.width / dpr, ch = (canvas.height / dpr) - 180; // leave room for panel
  const sx = cw / (maxX - minX + pad), sy = ch / (maxY - minY + pad);
  cam.scale = Math.min(Math.max(Math.min(sx, sy), 0.4), 1.6);
  cam.x = cw / 2 - (minX + maxX) / 2 * cam.scale;
  cam.y = (ch / 2 + 30) - (minY + maxY) / 2 * cam.scale;
  cam.ready = true;
}

// ===========================================================================
// Canvas
// ===========================================================================
const canvas = $('board');
const ctx = canvas.getContext('2d');
let dpr = window.devicePixelRatio || 1;

function resize() {
  dpr = window.devicePixelRatio || 1;
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  canvas.style.width = window.innerWidth + 'px';
  canvas.style.height = window.innerHeight + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  draw();
}
window.addEventListener('resize', resize);

const NEUTRAL = '#7c8aa0';
const HEX_DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
const EDGE_FOR_DIR = [0, 5, 4, 3, 2, 1]; // which polygon edge faces each neighbour dir

function color(owner) {
  if (owner === null || owner === undefined) return NEUTRAL;
  return state.players[owner] ? state.players[owner].color : NEUTRAL;
}

function hexCorners(cx, cy, R) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 180 * (60 * i - 30);
    pts.push([cx + R * Math.cos(a), cy + R * Math.sin(a)]);
  }
  return pts;
}

function draw() {
  if (!state) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const R = SIZE * cam.scale;

  // fill hexes
  for (const h of state.hexes) {
    const w = hexToWorld(h.q, h.r);
    const s = worldToScreen(w.x, w.y);
    const pts = hexCorners(s.x, s.y, R * 0.99);
    ctx.beginPath();
    pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]));
    ctx.closePath();
    ctx.fillStyle = color(h.owner);
    ctx.fill();
  }

  // highlight own territory during your turn
  if (isMyTurn()) drawTerritoryGlow(R);

  // highlights
  drawHighlightSet(reachable, 'rgba(255,255,255,0.28)', R);
  drawHighlightSet(capturable, 'rgba(255,80,60,0.45)', R);
  drawHighlightSet(fireTargets, 'rgba(255,150,40,0.55)', R);

  // selected province outline
  if (selectedProvince) {
    const members = provMembers.get(k(selectedProvince.q, selectedProvince.r)) || [];
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(2, R * 0.08);
    for (const h of members) {
      const w = hexToWorld(h.q, h.r); const s = worldToScreen(w.x, w.y);
      const pts = hexCorners(s.x, s.y, R * 0.96);
      ctx.beginPath();
      pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]));
      ctx.closePath(); ctx.stroke();
    }
  }

  // contents
  for (const h of state.hexes) {
    const w = hexToWorld(h.q, h.r);
    const s = worldToScreen(w.x, w.y);
    drawContent(h, s.x, s.y, R);
  }

  // selected unit ring
  if (selectedUnit) {
    const w = hexToWorld(selectedUnit.q, selectedUnit.r); const s = worldToScreen(w.x, w.y);
    ctx.strokeStyle = '#ffe066'; ctx.lineWidth = Math.max(2, R * 0.1);
    ctx.beginPath(); ctx.arc(s.x, s.y, R * 0.55, 0, Math.PI * 2); ctx.stroke();
  }
  // selected ballista ring
  if (selectedBallista) {
    const w = hexToWorld(selectedBallista.q, selectedBallista.r); const s = worldToScreen(w.x, w.y);
    ctx.strokeStyle = '#ff9028'; ctx.lineWidth = Math.max(2, R * 0.1);
    ctx.beginPath(); ctx.arc(s.x, s.y, R * 0.6, 0, Math.PI * 2); ctx.stroke();
  }

  // province money labels
  if (R > 18) {
    ctx.font = `bold ${Math.round(R * 0.42)}px system-ui`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const p of state.provinces) {
      const w = hexToWorld(p.capital.q, p.capital.r); const s = worldToScreen(w.x, w.y);
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillText('💰' + p.money, s.x, s.y - R * 0.78);
      ctx.fillStyle = '#fff';
      ctx.fillText('💰' + p.money, s.x, s.y - R * 0.82);
    }
  }
}

function drawTerritoryGlow(R) {
  // soft tint on owned hexes
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  for (const h of state.hexes) {
    if (h.owner !== YOU) continue;
    const w = hexToWorld(h.q, h.r); const s = worldToScreen(w.x, w.y);
    const pts = hexCorners(s.x, s.y, R * 0.99);
    ctx.beginPath();
    pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]));
    ctx.closePath(); ctx.fill();
  }
  // bright outline along the territory border
  ctx.strokeStyle = 'rgba(255,236,140,0.95)';
  ctx.lineWidth = Math.max(2, R * 0.09);
  ctx.lineCap = 'round';
  for (const h of state.hexes) {
    if (h.owner !== YOU) continue;
    const w = hexToWorld(h.q, h.r); const s = worldToScreen(w.x, w.y);
    const pts = hexCorners(s.x, s.y, R * 0.99);
    for (let j = 0; j < 6; j++) {
      const nb = hexMap.get(k(h.q + HEX_DIRS[j][0], h.r + HEX_DIRS[j][1]));
      if (nb && nb.owner === YOU) continue; // interior edge -> skip
      const e = EDGE_FOR_DIR[j];
      const a = pts[e], b = pts[(e + 1) % 6];
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    }
  }
}

function drawHighlightSet(set, fill, R) {
  ctx.fillStyle = fill;
  for (const key of set) {
    const [q, r] = key.split(',').map(Number);
    const w = hexToWorld(q, r); const s = worldToScreen(w.x, w.y);
    const pts = hexCorners(s.x, s.y, R * 0.99);
    ctx.beginPath();
    pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]));
    ctx.closePath(); ctx.fill();
  }
}

function drawContent(h, cx, cy, R) {
  // trees
  if (h.tree) {
    ctx.fillStyle = '#2e7d32';
    ctx.beginPath();
    ctx.moveTo(cx, cy - R * 0.5);
    ctx.lineTo(cx + R * 0.4, cy + R * 0.3);
    ctx.lineTo(cx - R * 0.4, cy + R * 0.3);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#5d4037';
    ctx.fillRect(cx - R * 0.06, cy + R * 0.25, R * 0.12, R * 0.2);
    return;
  }
  if (h.gravestone) {
    ctx.fillStyle = '#566'; ctx.strokeStyle = '#334'; ctx.lineWidth = 2;
    roundRect(cx - R * 0.25, cy - R * 0.35, R * 0.5, R * 0.6, R * 0.2);
    ctx.fill();
    ctx.strokeStyle = '#dfe6f0'; ctx.lineWidth = Math.max(2, R * 0.07);
    ctx.beginPath(); ctx.moveTo(cx, cy - R * 0.18); ctx.lineTo(cx, cy + R * 0.15);
    ctx.moveTo(cx - R * 0.12, cy - R * 0.05); ctx.lineTo(cx + R * 0.12, cy - R * 0.05); ctx.stroke();
    return;
  }

  // buildings
  if (h.building === 'castle') {
    ctx.fillStyle = '#2b2b2b';
    roundRect(cx - R * 0.32, cy - R * 0.3, R * 0.64, R * 0.6, R * 0.08); ctx.fill();
    ctx.fillStyle = '#444';
    for (const dx of [-0.3, 0, 0.3]) ctx.fillRect(cx + dx * R - R * 0.07, cy - R * 0.42, R * 0.14, R * 0.16);
  } else if (h.building === 'tower') {
    drawTower(cx, cy, R, '#cfd6e0', 1);
  } else if (h.building === 'strongTower') {
    drawTower(cx, cy, R, '#ff7043', 2);
  } else if (h.building === 'farm') {
    ctx.fillStyle = '#caa44a';
    roundRect(cx - R * 0.3, cy - R * 0.22, R * 0.6, R * 0.44, R * 0.06); ctx.fill();
    ctx.strokeStyle = '#7a5b1e'; ctx.lineWidth = 2;
    for (const dx of [-0.15, 0.15]) { ctx.beginPath(); ctx.moveTo(cx + dx * R, cy - R * 0.2); ctx.lineTo(cx + dx * R, cy + R * 0.2); ctx.stroke(); }
  } else if (h.building === 'ballista') {
    drawBallista(ctx, cx, cy, R, h.fired);
  }

  // unit on top
  if (h.unit) drawUnit(ctx, h.unit, cx, cy, R);
}

function drawBallista(g, cx, cy, R, fired) {
  g.globalAlpha = fired ? 0.5 : 1;
  // base + wheels
  g.fillStyle = '#5d4037';
  g.beginPath(); g.arc(cx - R * 0.22, cy + R * 0.28, R * 0.13, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.arc(cx + R * 0.22, cy + R * 0.28, R * 0.13, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#7a5230';
  g.fillRect(cx - R * 0.34, cy + R * 0.1, R * 0.68, R * 0.16);
  // the bow arms (V)
  g.strokeStyle = '#caa44a'; g.lineWidth = Math.max(2, R * 0.12); g.lineCap = 'round';
  g.beginPath();
  g.moveTo(cx - R * 0.36, cy - R * 0.32);
  g.lineTo(cx, cy + R * 0.06);
  g.lineTo(cx + R * 0.36, cy - R * 0.32);
  g.stroke();
  // bowstring + bolt
  g.strokeStyle = '#e8eef7'; g.lineWidth = Math.max(1, R * 0.04);
  g.beginPath(); g.moveTo(cx - R * 0.36, cy - R * 0.32); g.lineTo(cx + R * 0.36, cy - R * 0.32); g.stroke();
  g.strokeStyle = '#9b3a2a'; g.lineWidth = Math.max(2, R * 0.08);
  g.beginPath(); g.moveTo(cx, cy - R * 0.05); g.lineTo(cx, cy - R * 0.5); g.stroke();
  g.globalAlpha = 1;
}

function drawTower(cx, cy, R, col, count) {
  ctx.fillStyle = col;
  const w = R * 0.5, hh = R * 0.6;
  if (count === 2) {
    ctx.beginPath();
    ctx.moveTo(cx, cy - hh); ctx.lineTo(cx + w * 0.7, cy + hh * 0.5); ctx.lineTo(cx - w * 0.7, cy + hh * 0.5);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ffd2c0';
    ctx.beginPath();
    ctx.moveTo(cx, cy - hh * 0.5); ctx.lineTo(cx + w * 0.4, cy + hh * 0.4); ctx.lineTo(cx - w * 0.4, cy + hh * 0.4);
    ctx.closePath(); ctx.fill();
  } else {
    ctx.beginPath();
    ctx.moveTo(cx, cy - hh * 0.7); ctx.lineTo(cx + w * 0.6, cy + hh * 0.4); ctx.lineTo(cx - w * 0.6, cy + hh * 0.4);
    ctx.closePath(); ctx.fill();
  }
}

// Distinct sprite per unit. `unit` = {kind, level, moved, stunned, stranded}.
function drawUnit(g, unit, cx, cy, R, ignoreMoved) {
  const kind = unit.kind || ['peasant', 'spearman', 'baron', 'knight'][unit.level - 1];
  g.save();
  g.globalAlpha = (!ignoreMoved && unit.moved) ? 0.5 : 1;
  if (kind === 'horseman') drawHorseman(g, cx, cy, R);
  else if (kind === 'scout') drawScout(g, cx, cy, R);
  else if (kind === 'summoner') drawSummoner(g, cx, cy, R);
  else drawPerson(g, cx, cy, R, kind);
  g.restore();

  // status indicators
  if (unit.stunned) {
    g.fillStyle = '#ffe066';
    g.font = `bold ${Math.round(R * 0.6)}px system-ui`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('⚡', cx + R * 0.45, cy - R * 0.45);
  }
  if (unit.stranded > 0) {
    g.fillStyle = '#ff6b6b';
    g.font = `bold ${Math.round(R * 0.42)}px system-ui`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const left = Math.max(0, 4 - unit.stranded);
    g.fillText('⌛' + left, cx - R * 0.4, cy - R * 0.5);
  }
}

function drawScout(g, cx, cy, R) {
  g.lineWidth = Math.max(1, R * 0.04); g.strokeStyle = '#0d1422';
  // dark hooded cloak
  g.fillStyle = '#3a4a5e';
  g.beginPath();
  g.moveTo(cx, cy - R * 0.5);
  g.lineTo(cx + R * 0.3, cy + R * 0.42);
  g.lineTo(cx - R * 0.3, cy + R * 0.42);
  g.closePath(); g.fill(); g.stroke();
  // shadowed face
  g.fillStyle = '#11161f';
  g.beginPath(); g.arc(cx, cy - R * 0.12, R * 0.13, 0, Math.PI * 2); g.fill();
  // dagger
  g.strokeStyle = '#cfd6e0'; g.lineWidth = Math.max(1.5, R * 0.06);
  g.beginPath(); g.moveTo(cx + R * 0.18, cy + R * 0.3); g.lineTo(cx + R * 0.34, cy + R * 0.02); g.stroke();
}

function drawSummoner(g, cx, cy, R) {
  g.lineWidth = Math.max(1, R * 0.04); g.strokeStyle = '#1b2940';
  // long robe
  g.fillStyle = '#2e8b8b';
  g.beginPath();
  g.moveTo(cx - R * 0.26, cy + R * 0.45);
  g.lineTo(cx - R * 0.14, cy - R * 0.06);
  g.lineTo(cx + R * 0.14, cy - R * 0.06);
  g.lineTo(cx + R * 0.26, cy + R * 0.45);
  g.closePath(); g.fill(); g.stroke();
  // hood/head
  g.fillStyle = SKIN;
  g.beginPath(); g.arc(cx, cy - R * 0.2, R * 0.15, 0, Math.PI * 2); g.fill(); g.stroke();
  // staff + glowing orb
  g.strokeStyle = '#7a5230'; g.lineWidth = Math.max(2, R * 0.06);
  g.beginPath(); g.moveTo(cx + R * 0.3, cy + R * 0.45); g.lineTo(cx + R * 0.3, cy - R * 0.4); g.stroke();
  g.fillStyle = '#7ee0ff';
  g.beginPath(); g.arc(cx + R * 0.3, cy - R * 0.46, R * 0.12, 0, Math.PI * 2); g.fill();
}

const SKIN = '#f0d0a8';
const CLOTH = { peasant: '#8d9aa8', spearman: '#5b86c4', baron: '#9b59b6', knight: '#cfd6e0' };

function drawPerson(g, cx, cy, R, kind) {
  const body = CLOTH[kind] || '#8d9aa8';
  g.lineWidth = Math.max(1, R * 0.04);
  g.strokeStyle = '#1b2940';

  // torso
  g.fillStyle = body;
  g.beginPath();
  g.moveTo(cx - R * 0.22, cy + R * 0.42);
  g.lineTo(cx - R * 0.16, cy - R * 0.02);
  g.lineTo(cx + R * 0.16, cy - R * 0.02);
  g.lineTo(cx + R * 0.22, cy + R * 0.42);
  g.closePath(); g.fill(); g.stroke();

  // head
  g.fillStyle = SKIN;
  g.beginPath(); g.arc(cx, cy - R * 0.18, R * 0.17, 0, Math.PI * 2); g.fill(); g.stroke();

  if (kind === 'peasant') {
    // a hoe over the shoulder
    g.strokeStyle = '#7a5230'; g.lineWidth = Math.max(2, R * 0.07);
    g.beginPath(); g.moveTo(cx + R * 0.05, cy + R * 0.3); g.lineTo(cx + R * 0.3, cy - R * 0.32); g.stroke();
    g.strokeStyle = '#9aa3b2'; g.beginPath();
    g.moveTo(cx + R * 0.3, cy - R * 0.32); g.lineTo(cx + R * 0.42, cy - R * 0.3); g.stroke();
  } else if (kind === 'spearman') {
    // a spear
    g.strokeStyle = '#7a5230'; g.lineWidth = Math.max(2, R * 0.06);
    g.beginPath(); g.moveTo(cx + R * 0.28, cy + R * 0.42); g.lineTo(cx + R * 0.28, cy - R * 0.48); g.stroke();
    g.fillStyle = '#cfd6e0';
    g.beginPath();
    g.moveTo(cx + R * 0.28, cy - R * 0.58);
    g.lineTo(cx + R * 0.18, cy - R * 0.42);
    g.lineTo(cx + R * 0.38, cy - R * 0.42);
    g.closePath(); g.fill();
  } else if (kind === 'baron') {
    // a sword + a crown
    g.strokeStyle = '#dfe6f0'; g.lineWidth = Math.max(2, R * 0.07);
    g.beginPath(); g.moveTo(cx + R * 0.28, cy + R * 0.42); g.lineTo(cx + R * 0.28, cy - R * 0.34); g.stroke();
    g.strokeStyle = '#caa44a'; g.lineWidth = Math.max(2, R * 0.06);
    g.beginPath(); g.moveTo(cx + R * 0.18, cy + R * 0.18); g.lineTo(cx + R * 0.38, cy + R * 0.18); g.stroke();
    g.fillStyle = '#ffd84a';
    g.beginPath();
    g.moveTo(cx - R * 0.17, cy - R * 0.3);
    g.lineTo(cx - R * 0.17, cy - R * 0.45);
    g.lineTo(cx - R * 0.06, cy - R * 0.34);
    g.lineTo(cx, cy - R * 0.48);
    g.lineTo(cx + R * 0.06, cy - R * 0.34);
    g.lineTo(cx + R * 0.17, cy - R * 0.45);
    g.lineTo(cx + R * 0.17, cy - R * 0.3);
    g.closePath(); g.fill(); g.stroke();
  } else if (kind === 'knight') {
    // helmet over the head + shield
    g.fillStyle = '#b9c2d0';
    g.beginPath(); g.arc(cx, cy - R * 0.2, R * 0.2, Math.PI, 0); g.fill(); g.stroke();
    g.fillRect(cx - R * 0.2, cy - R * 0.22, R * 0.4, R * 0.12);
    g.strokeStyle = '#1b2940'; g.strokeRect(cx - R * 0.2, cy - R * 0.22, R * 0.4, R * 0.12);
    g.fillStyle = '#1b2940';
    g.fillRect(cx - R * 0.1, cy - R * 0.16, R * 0.2, R * 0.04); // visor slit
    // shield
    g.fillStyle = '#e6473a';
    g.beginPath();
    g.moveTo(cx - R * 0.42, cy - R * 0.02);
    g.lineTo(cx - R * 0.2, cy - R * 0.02);
    g.lineTo(cx - R * 0.2, cy + R * 0.22);
    g.lineTo(cx - R * 0.31, cy + R * 0.34);
    g.lineTo(cx - R * 0.42, cy + R * 0.22);
    g.closePath(); g.fill(); g.stroke();
  }
}

function drawHorseman(g, cx, cy, R) {
  g.lineWidth = Math.max(1, R * 0.04);
  g.strokeStyle = '#1b2940';
  // horse body
  g.fillStyle = '#7a5230';
  g.beginPath(); g.ellipse(cx, cy + R * 0.16, R * 0.4, R * 0.2, 0, 0, Math.PI * 2); g.fill(); g.stroke();
  // legs
  g.strokeStyle = '#5d4037'; g.lineWidth = Math.max(2, R * 0.06);
  for (const dx of [-0.28, -0.1, 0.12, 0.3]) {
    g.beginPath(); g.moveTo(cx + dx * R, cy + R * 0.28); g.lineTo(cx + dx * R, cy + R * 0.5); g.stroke();
  }
  // neck + head
  g.fillStyle = '#7a5230'; g.strokeStyle = '#1b2940'; g.lineWidth = Math.max(1, R * 0.04);
  g.beginPath();
  g.moveTo(cx + R * 0.3, cy + R * 0.16);
  g.lineTo(cx + R * 0.5, cy - R * 0.22);
  g.lineTo(cx + R * 0.62, cy - R * 0.18);
  g.lineTo(cx + R * 0.44, cy + R * 0.1);
  g.closePath(); g.fill(); g.stroke();
  // rider
  g.fillStyle = '#5b86c4';
  g.beginPath();
  g.moveTo(cx - R * 0.14, cy + R * 0.04);
  g.lineTo(cx - R * 0.08, cy - R * 0.26);
  g.lineTo(cx + R * 0.08, cy - R * 0.26);
  g.lineTo(cx + R * 0.12, cy + R * 0.04);
  g.closePath(); g.fill(); g.stroke();
  g.fillStyle = SKIN;
  g.beginPath(); g.arc(cx, cy - R * 0.36, R * 0.13, 0, Math.PI * 2); g.fill(); g.stroke();
  // lance
  g.strokeStyle = '#dfe6f0'; g.lineWidth = Math.max(2, R * 0.05);
  g.beginPath(); g.moveTo(cx - R * 0.1, cy - R * 0.1); g.lineTo(cx + R * 0.5, cy - R * 0.5); g.stroke();
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ===========================================================================
// Highlights & rules (client-side mirror for UX; server is authoritative)
// ===========================================================================
function selfDef(h) {
  let d = 0;
  if (h.building === 'castle') d = Math.max(d, 1);
  else if (h.building === 'tower') d = Math.max(d, 2);
  else if (h.building === 'strongTower' || h.building === 'ballista') d = Math.max(d, 3);
  if (h.unit) d = Math.max(d, h.unit.level);
  return d;
}
function neighborsOf(h) {
  const dirs = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
  const out = [];
  for (const d of dirs) { const n = hexMap.get(k(h.q + d[0], h.r + d[1])); if (n) out.push(n); }
  return out;
}
function defenseOf(h) {
  if (h.owner === null || h.owner === undefined) return 0;
  let d = selfDef(h);
  for (const n of neighborsOf(h)) if (n.owner === h.owner) d = Math.max(d, selfDef(n));
  return d;
}

function hexDist(a, b) {
  return (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.q + a.r - b.q - b.r)) / 2;
}

function computeHighlights() {
  reachable = new Set();
  capturable = new Set();
  fireTargets = new Set();
  if (!isMyTurn()) return;

  // ballista targets
  if (selectedBallista) {
    const bh = hexMap.get(k(selectedBallista.q, selectedBallista.r));
    if (bh && bh.building === 'ballista' && !bh.fired) {
      for (const h of state.hexes) {
        if (h.owner === YOU || !h.unit) continue;
        if (h.unit.level > 3) continue; // knight is too tough
        if (hexDist(bh, h) <= 2) fireTargets.add(k(h.q, h.r));
      }
    }
    return;
  }

  if (!selectedUnit) return;
  const uh = hexMap.get(k(selectedUnit.q, selectedUnit.r));
  if (!uh || !uh.unit || uh.unit.moved) return;
  const lv = uh.unit.level;
  const isHorse = uh.unit.kind === 'horseman';
  const range = isHorse ? 2 : 1;
  const members = provMembers.get(uh.province) || [uh];
  const memberSet = new Set(members.map((m) => k(m.q, m.r)));

  // internal moves / merges
  for (const m of members) {
    if (k(m.q, m.r) === k(uh.q, uh.r)) continue;
    if (m.unit) {
      if (!isHorse && m.unit.kind !== 'horseman' && m.unit.level + lv <= 4) reachable.add(k(m.q, m.r));
    } else {
      reachable.add(k(m.q, m.r));
    }
  }
  // captures: any enemy/neutral hex within `range` of the province, level > defense
  for (const h of state.hexes) {
    const key = k(h.q, h.r);
    if (memberSet.has(key)) continue;
    let near = false;
    for (const m of members) { if (hexDist(m, h) <= range) { near = true; break; } }
    if (near && lv > defenseOf(h)) capturable.add(key);
  }
}

// ===========================================================================
// Input
// ===========================================================================
const pointers = new Map();
let dragInfo = null;
let pinchDist = 0;

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 1) {
    dragInfo = { startX: e.clientX, startY: e.clientY, lastX: e.clientX, lastY: e.clientY, moved: false, t: Date.now() };
  } else if (pointers.size === 2) {
    const p = [...pointers.values()];
    pinchDist = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
  }
});

canvas.addEventListener('pointermove', (e) => {
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (pointers.size === 2) {
    const p = [...pointers.values()];
    const d = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
    const mid = { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 };
    if (pinchDist > 0) zoomAt(mid.x, mid.y, d / pinchDist);
    pinchDist = d;
    dragInfo = null;
    return;
  }

  if (dragInfo) {
    const dx = e.clientX - dragInfo.lastX, dy = e.clientY - dragInfo.lastY;
    dragInfo.lastX = e.clientX; dragInfo.lastY = e.clientY;
    if (Math.hypot(e.clientX - dragInfo.startX, e.clientY - dragInfo.startY) > 8) dragInfo.moved = true;
    if (dragInfo.moved) { cam.x += dx; cam.y += dy; draw(); }
  }
});

function endPointer(e) {
  if (dragInfo && pointers.size === 1 && !dragInfo.moved && Date.now() - dragInfo.t < 500) {
    handleClick(e.clientX, e.clientY);
  }
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinchDist = 0;
  if (pointers.size === 0) dragInfo = null;
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.12 : 0.89);
}, { passive: false });

function zoomAt(sx, sy, factor) {
  const before = screenToWorld(sx, sy);
  cam.scale = Math.min(Math.max(cam.scale * factor, 0.35), 3);
  const after = screenToWorld(sx, sy);
  cam.x += (after.x - before.x) * cam.scale;
  cam.y += (after.y - before.y) * cam.scale;
  draw();
}

function isMyTurn() { return state && state.status === 'playing' && state.current === YOU; }

function handleClick(sx, sy) {
  if (!state) return;
  const w = screenToWorld(sx, sy);
  const c = worldToHex(w.x, w.y);
  const h = hexMap.get(k(c.q, c.r));
  if (!h) { clearSelection(); return; }

  // Placement / cast mode
  if (hand && isMyTurn()) {
    if (hand.kind === 'summon') {
      net({ type: 'action', action: { type: 'summon', from: hand.from, to: { q: h.q, r: h.r } } });
      hand = null; setHandUI();
      return;
    }
    if (!selectedProvince) { toast('Сначала выберите свою провинцию'); return; }
    placeFromHand(h);
    return;
  }

  if (!isMyTurn()) {
    // allow inspecting your provinces even when not your turn
    if (h.owner === YOU && h.province) selectProvince(h);
    else clearSelection();
    return;
  }

  // If a unit is selected and target is actionable -> move
  if (selectedUnit) {
    const key = k(h.q, h.r);
    if (reachable.has(key) || capturable.has(key)) {
      net({ type: 'action', action: { type: 'moveUnit', from: selectedUnit, to: { q: h.q, r: h.r } } });
      selectedUnit = null; reachable.clear(); capturable.clear();
      return;
    }
  }

  // If a ballista is selected and target is in range -> fire
  if (selectedBallista) {
    if (fireTargets.has(k(h.q, h.r))) {
      net({ type: 'action', action: { type: 'fireBallista', from: selectedBallista, to: { q: h.q, r: h.r } } });
      selectedBallista = null; fireTargets.clear();
      return;
    }
  }

  // Select own movable unit
  if (h.owner === YOU && h.unit && !h.unit.moved) {
    selectedUnit = { q: h.q, r: h.r }; selectedBallista = null;
    if (h.province) selectedProvince = capitalCoord(h.province);
    computeHighlights(); renderPanel(); draw();
    return;
  }

  // Select own ballista that can still fire
  if (h.owner === YOU && h.building === 'ballista' && !h.fired) {
    selectedBallista = { q: h.q, r: h.r }; selectedUnit = null;
    if (h.province) selectedProvince = capitalCoord(h.province);
    computeHighlights(); renderPanel(); draw();
    return;
  }

  // Select own province
  if (h.owner === YOU && h.province) {
    selectProvince(h);
    return;
  }

  clearSelection();
}

function capitalCoord(provId) {
  const [q, r] = provId.split(',').map(Number);
  return { q, r };
}

function selectProvince(h) {
  selectedProvince = capitalCoord(h.province);
  selectedUnit = null; selectedBallista = null; hand = null;
  reachable.clear(); capturable.clear(); fireTargets.clear();
  closeUnitMenu(); setHandUI();
  renderPanel(); draw();
}

function clearSelection() {
  selectedProvince = null; selectedUnit = null; selectedBallista = null; hand = null;
  reachable.clear(); capturable.clear(); fireTargets.clear();
  closeUnitMenu(); setHandUI(); renderPanel(); draw();
}

const BUILD_ACTION = { farm: 'buildFarm', tower: 'buildTower', strongTower: 'buildStrongTower', ballista: 'buildBallista' };

function placeFromHand(h) {
  const prov = selectedProvince;
  const to = { q: h.q, r: h.r };
  if (isUnitKind(hand.kind)) {
    net({ type: 'action', action: { type: 'buyUnit', province: prov, to, kind: hand.kind } });
  } else if (isBuildKind(hand.kind)) {
    net({ type: 'action', action: { type: BUILD_ACTION[hand.kind], province: prov, to } });
  } else if (isSpellKind(hand.kind)) {
    net({ type: 'action', action: { type: 'castSpell', province: prov, spell: hand.kind, to } });
  }
  hand = null; setHandUI();
}

// ===========================================================================
// Panel / buttons
// ===========================================================================
let openMenuCat = null;

function closeUnitMenu() { $('popMenu').classList.add('hidden'); openMenuCat = null; }

function farmCostOf(pd) {
  const members = provMembers.get(pd ? k(pd.capital.q, pd.capital.r) : '') || [];
  return 12 + 2 * members.filter((m) => m.building === 'farm').length;
}

function toggleMenu(cat) {
  if (!isMyTurn()) return toast('Сейчас не ваш ход');
  if (!selectedProvince) return toast('Сначала выберите свою провинцию');
  if (openMenuCat === cat) { closeUnitMenu(); return; }
  buildMenu(cat);
  $('popMenu').classList.remove('hidden');
  openMenuCat = cat;
}
$('btnUnit').onclick = () => toggleMenu('unit');
$('btnBuild').onclick = () => toggleMenu('build');
$('btnSpell').onclick = () => toggleMenu('spell');

function buildMenu(cat) {
  const menu = $('popMenu');
  menu.innerHTML = '';
  const pd = provinceData();
  const defs = cat === 'unit' ? UNIT_DEFS : cat === 'build' ? BUILD_DEFS : SPELL_DEFS;
  for (const def of defs) {
    const cost = (cat === 'build' && def.kind === 'farm') ? farmCostOf(pd) : def.cost;
    const opt = document.createElement('div');
    opt.className = 'unit-opt';
    const afford = pd && pd.money >= cost;
    if (!afford) opt.setAttribute('disabled', '');

    const cv = document.createElement('canvas');
    cv.width = 60; cv.height = 60;
    drawIcon(cv.getContext('2d'), 30, 32, 26, cat, def);
    opt.appendChild(cv);

    const nm = document.createElement('div');
    nm.className = 'nm';
    nm.innerHTML = `<span>${def.name}</span><small>${def.sub || ''}</small>`;
    opt.appendChild(nm);

    const price = document.createElement('span');
    price.className = 'price'; price.textContent = '💰' + cost;
    opt.appendChild(price);

    if (afford) opt.onclick = () => {
      hand = { kind: def.kind };
      selectedUnit = null; selectedBallista = null;
      reachable.clear(); capturable.clear(); fireTargets.clear();
      closeUnitMenu(); setHandUI(); draw();
    };
    menu.appendChild(opt);
  }
}

// draw a small icon for a catalog entry into context g
function drawIcon(g, cx, cy, R, cat, def) {
  if (cat === 'unit') { drawUnit(g, { kind: def.kind, level: def.level, moved: false }, cx, cy, R, true); return; }
  if (cat === 'build') {
    if (def.kind === 'farm') { g.fillStyle = '#caa44a'; roundRectG(g, cx - R * 0.4, cy - R * 0.3, R * 0.8, R * 0.6, R * 0.08); g.fill(); }
    else if (def.kind === 'tower') drawTowerG(g, cx, cy, R, '#cfd6e0', 1);
    else if (def.kind === 'strongTower') drawTowerG(g, cx, cy, R, '#ff7043', 2);
    else if (def.kind === 'ballista') drawBallista(g, cx, cy, R, false);
    return;
  }
  // spells
  const emoji = { thunder: '⚡', meteor: '☄️', earthquake: '🌋' }[def.kind] || '✨';
  g.fillStyle = '#e8eef7';
  g.font = `${Math.round(R * 1.4)}px system-ui`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(emoji, cx, cy);
}

function roundRectG(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function drawTowerG(g, cx, cy, R, col, count) {
  g.fillStyle = col;
  const w = R * 0.5, hh = R * 0.6;
  if (count === 2) {
    g.beginPath();
    g.moveTo(cx, cy - hh); g.lineTo(cx + w * 0.7, cy + hh * 0.5); g.lineTo(cx - w * 0.7, cy + hh * 0.5);
    g.closePath(); g.fill();
    g.fillStyle = '#ffd2c0';
    g.beginPath();
    g.moveTo(cx, cy - hh * 0.5); g.lineTo(cx + w * 0.4, cy + hh * 0.4); g.lineTo(cx - w * 0.4, cy + hh * 0.4);
    g.closePath(); g.fill();
  } else {
    g.beginPath();
    g.moveTo(cx, cy - hh * 0.7); g.lineTo(cx + w * 0.6, cy + hh * 0.4); g.lineTo(cx - w * 0.6, cy + hh * 0.4);
    g.closePath(); g.fill();
  }
}

// summoner ability
$('btnAbility').onclick = () => {
  if (!selectedUnit) return;
  const u = hexMap.get(k(selectedUnit.q, selectedUnit.r));
  if (!u || !u.unit || u.unit.kind !== 'summoner' || u.unit.summoned) return;
  hand = { kind: 'summon', from: { q: selectedUnit.q, r: selectedUnit.r } };
  reachable.clear(); capturable.clear();
  setHandUI(); draw();
};

$('btnInfo').onclick = () => showBestiary();

$('btnEnd').onclick = () => {
  if (!isMyTurn()) return;
  net({ type: 'action', action: { type: 'endTurn' } });
  clearSelection();
};

$('btnUndo').onclick = () => {
  if (!isMyTurn()) return;
  net({ type: 'action', action: { type: 'undo' } });
  selectedUnit = null; selectedBallista = null; hand = null;
  reachable.clear(); capturable.clear(); fireTargets.clear();
  closeUnitMenu(); setHandUI();
};

$('btnEndGame').onclick = () => {
  if (confirm('Завершить игру для всех и вернуться в лобби?')) net({ type: 'endGame' });
};

const HAND_NAMES = {
  peasant: 'крестьянина', spearman: 'копейщика', baron: 'барона', knight: 'рыцаря',
  horseman: 'всадника', scout: 'лазутчика', summoner: 'призывателя',
  farm: 'ферму', tower: 'башню', strongTower: 'сильную башню', ballista: 'баллисту',
  thunder: 'громовой удар', meteor: 'метеор', earthquake: 'землетрясение', summon: 'призыв',
};
function setHandUI() {
  $('btnUnit').classList.toggle('active', hand && isUnitKind(hand.kind));
  $('btnBuild').classList.toggle('active', hand && isBuildKind(hand.kind));
  $('btnSpell').classList.toggle('active', hand && isSpellKind(hand.kind));
  const el = $('hand');
  if (hand) {
    const verb = isSpellKind(hand.kind) ? 'Примените' : hand.kind === 'summon' ? 'Призовите на соседнюю клетку:' : 'Поставьте';
    el.textContent = `${verb} ${HAND_NAMES[hand.kind]} — кликните по клетке (повторно — отмена)`;
    el.classList.remove('hidden');
  } else { el.classList.add('hidden'); }
}

function provinceData() {
  if (!selectedProvince) return null;
  return state.provinces.find((p) => p.capital.q === selectedProvince.q && p.capital.r === selectedProvince.r) || null;
}

function renderPanel() {
  if (!state) return;
  // top tags
  $('roomTag').textContent = 'Комната ' + roomId;
  const cur = state.players[state.current];
  if (state.status === 'finished') {
    $('turnTag').textContent = state.winner === YOU ? '🏆 Вы победили!' : `Победил ${state.players[state.winner] ? state.players[state.winner].name : '—'}`;
    showOverlay(state.winner === YOU ? 'Победа!' : `Победил ${state.players[state.winner].name}`);
  } else {
    $('turnTag').textContent = isMyTurn() ? '➡ Ваш ход' : `Ход: ${cur ? cur.name : ''}`;
    $('turnTag').style.background = isMyTurn() ? '#2e7d46' : `rgba(13,20,34,0.85)`;
  }

  const info = $('provInfo');
  const pd = provinceData();
  if (pd) {
    const sign = pd.income >= 0 ? '+' : '';
    info.innerHTML = `Провинция: <b>💰 ${pd.money}</b> &nbsp; доход <b>${sign}${pd.income}/ход</b> &nbsp; (${pd.size} гекс.)`;
  } else {
    info.textContent = isMyTurn() ? 'Выберите свою провинцию' : 'Ожидайте свой ход';
  }

  const canAct = isMyTurn() && !!pd;
  const money = pd ? pd.money : 0;
  $('btnUnit').disabled = !canAct || money < 10;          // cheapest unit
  $('btnBuild').disabled = !canAct || money < farmCostOf(pd); // cheapest build (farm)
  $('btnSpell').disabled = !canAct || money < 30;         // cheapest spell
  if (!canAct) closeUnitMenu();

  // summoner ability button
  let showAbility = false;
  if (isMyTurn() && selectedUnit) {
    const u = hexMap.get(k(selectedUnit.q, selectedUnit.r));
    showAbility = !!(u && u.unit && u.unit.kind === 'summoner' && !u.unit.summoned);
  }
  $('btnAbility').classList.toggle('hidden', !showAbility);

  $('btnUndo').disabled = !(isMyTurn() && state.canUndo);
  $('btnEnd').disabled = !isMyTurn();
  $('btnEnd').classList.toggle('ready', isMyTurn());

  const isHost = YOU === 0;
  $('btnEndGame').classList.toggle('hidden', !(isHost && state.status === 'playing'));
}

// ===========================================================================
// Bestiary
// ===========================================================================
function bestiaryItem(cat, def) {
  const cost = (cat === 'build' && def.kind === 'farm') ? '12+' : def.cost;
  const cv = document.createElement('canvas');
  cv.width = 80; cv.height = 80;
  drawIcon(cv.getContext('2d'), 40, 42, 34, cat, def);
  const row = document.createElement('div');
  row.className = 'bestiary-item';
  row.appendChild(cv);
  const txt = document.createElement('div');
  txt.innerHTML = `<div class="b-title">${def.name}<span class="price">💰${cost}</span></div>
    <div class="b-desc">${def.sub ? def.sub + ' — ' : ''}${def.desc || ''}</div>`;
  row.appendChild(txt);
  return row;
}

function showBestiary() {
  const el = $('bestiary');
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = '<h2>Бестиарий</h2>';
  const sections = [['Юниты', 'unit', UNIT_DEFS], ['Постройки', 'build', BUILD_DEFS], ['Заклинания', 'spell', SPELL_DEFS]];
  for (const [title, cat, defs] of sections) {
    const h = document.createElement('h3'); h.textContent = title; card.appendChild(h);
    for (const def of defs) card.appendChild(bestiaryItem(cat, def));
  }
  const close = document.createElement('button');
  close.className = 'primary'; close.textContent = 'Закрыть'; close.style.marginTop = '12px';
  close.onclick = () => el.classList.add('hidden');
  card.appendChild(close);
  el.innerHTML = '';
  el.appendChild(card);
  el.classList.remove('hidden');
}

let toastTimer = null;
function toast(text) {
  const el = $('toast');
  el.textContent = text; el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2200);
}

function showOverlay(text) {
  const el = $('overlay');
  el.innerHTML = `<div class="card"><h2>${escapeHtml(text)}</h2>
    <button class="primary" onclick="location.reload()">В меню</button></div>`;
  el.classList.remove('hidden');
}

// ===========================================================================
// Boot
// ===========================================================================
resize();
connect();

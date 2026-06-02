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
let hand = null;             // {kind}
let reachable = new Set();
let capturable = new Set();

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
      YOU = msg.you; ingestState(msg.game); show('game'); break;
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
    configEcho = false;
  }
  for (const id of ['lobW', 'lobH', 'lobMax']) $(id).disabled = !msg.host;
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
  });
}
for (const id of ['lobW', 'lobH', 'lobMax']) $(id).addEventListener('change', sendConfig);

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
  if (selectedProvince) {
    const h = hexMap.get(k(selectedProvince.q, selectedProvince.r));
    if (!h || !h.capital || h.owner !== YOU) selectedProvince = null;
  }
  computeHighlights();
  renderPanel();
  draw();
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

  // highlights
  drawHighlightSet(reachable, 'rgba(255,255,255,0.28)', R);
  drawHighlightSet(capturable, 'rgba(255,80,60,0.45)', R);

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
  }

  // unit on top
  if (h.unit) drawUnit(h, cx, cy, R);
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

function drawUnit(h, cx, cy, R) {
  const lv = h.unit.level;
  ctx.globalAlpha = h.unit.moved ? 0.55 : 1;
  // body
  ctx.fillStyle = '#f4f6fa';
  ctx.strokeStyle = '#1b2940';
  ctx.lineWidth = Math.max(1.5, R * 0.05);
  ctx.beginPath(); ctx.arc(cx, cy, R * 0.4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  // level number
  ctx.fillStyle = '#1b2940';
  ctx.font = `bold ${Math.round(R * 0.5)}px system-ui`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(String(lv), cx, cy + R * 0.02);
  ctx.globalAlpha = 1;
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
  else if (h.building === 'strongTower') d = Math.max(d, 3);
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

function computeHighlights() {
  reachable = new Set();
  capturable = new Set();
  if (!selectedUnit || !isMyTurn()) return;
  const uh = hexMap.get(k(selectedUnit.q, selectedUnit.r));
  if (!uh || !uh.unit || uh.unit.moved) return;
  const lv = uh.unit.level;
  const members = provMembers.get(uh.province) || [uh];
  const memberSet = new Set(members.map((m) => k(m.q, m.r)));
  // internal moves / merges
  for (const m of members) {
    if (k(m.q, m.r) === k(uh.q, uh.r)) continue;
    if (m.unit) { if (m.unit.level + lv <= 4) reachable.add(k(m.q, m.r)); }
    else if (!m.building || m.building === 'farm' || m.building === 'tower' || m.building === 'strongTower' || m.building === 'castle') {
      // can stand on own hex (buildings stay underneath); avoid stacking 2 units handled above
      reachable.add(k(m.q, m.r));
    }
  }
  // captures
  for (const m of members) {
    for (const n of neighborsOf(m)) {
      if (memberSet.has(k(n.q, n.r))) continue;
      if (lv > defenseOf(n)) capturable.add(k(n.q, n.r));
    }
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

  // Buy/build placement mode
  if (hand && isMyTurn()) {
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

  // Select own movable unit
  if (h.owner === YOU && h.unit && !h.unit.moved) {
    selectedUnit = { q: h.q, r: h.r };
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
  selectedUnit = null; hand = null; reachable.clear(); capturable.clear();
  setHandUI();
  renderPanel(); draw();
}

function clearSelection() {
  selectedProvince = null; selectedUnit = null; hand = null;
  reachable.clear(); capturable.clear();
  setHandUI(); renderPanel(); draw();
}

function placeFromHand(h) {
  const prov = selectedProvince;
  const to = { q: h.q, r: h.r };
  if (hand.kind === 'peasant') {
    net({ type: 'action', action: { type: 'buyUnit', province: prov, to } });
  } else if (hand.kind === 'farm') {
    net({ type: 'action', action: { type: 'buildFarm', province: prov, to } });
  } else if (hand.kind === 'tower') {
    net({ type: 'action', action: { type: 'buildTower', province: prov, to } });
  } else if (hand.kind === 'strongTower') {
    net({ type: 'action', action: { type: 'buildStrongTower', province: prov, to } });
  }
  hand = null; setHandUI();
}

// ===========================================================================
// Panel / buttons
// ===========================================================================
document.querySelectorAll('.buy').forEach((btn) => {
  btn.onclick = () => {
    if (!isMyTurn()) return toast('Сейчас не ваш ход');
    if (!selectedProvince) return toast('Сначала выберите свою провинцию');
    const kind = btn.dataset.buy;
    hand = hand && hand.kind === kind ? null : { kind };
    selectedUnit = null; reachable.clear(); capturable.clear();
    setHandUI(); draw();
  };
});

$('btnEnd').onclick = () => {
  if (!isMyTurn()) return;
  net({ type: 'action', action: { type: 'endTurn' } });
  clearSelection();
};

function setHandUI() {
  document.querySelectorAll('.buy').forEach((b) => b.classList.toggle('active', hand && hand.kind === b.dataset.buy));
  const el = $('hand');
  if (hand) {
    const names = { peasant: 'крестьянина', farm: 'ферму', tower: 'башню', strongTower: 'сильную башню' };
    el.textContent = `Поставьте ${names[hand.kind]} — кликните по клетке (повторно — отмена)`;
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
    // farm cost
    const members = provMembers.get(k(pd.capital.q, pd.capital.r)) || [];
    const farms = members.filter((m) => m.building === 'farm').length;
    $('farmCost').textContent = String(12 + 2 * farms);
  } else {
    info.textContent = isMyTurn() ? 'Выберите свою провинцию' : 'Ожидайте свой ход';
  }

  const canAct = isMyTurn() && !!pd;
  document.querySelectorAll('.buy').forEach((b) => {
    const costs = { peasant: 10, farm: 12 + 2 * ((provMembers.get(pd ? k(pd.capital.q, pd.capital.r) : '') || []).filter((m) => m.building === 'farm').length), tower: 15, strongTower: 35 };
    b.disabled = !canAct || (pd && pd.money < costs[b.dataset.buy]);
  });
  $('btnEnd').disabled = !isMyTurn();
  $('btnEnd').classList.toggle('ready', isMyTurn());
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

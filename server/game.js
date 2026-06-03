'use strict';

// ---------------------------------------------------------------------------
// Antiyoy game logic (authoritative server-side model)
// Axial hex coordinates (q, r). Water tiles simply do not exist in the map.
// ---------------------------------------------------------------------------

const DIRS = [
  [1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1],
];

const UPKEEP = { 1: 2, 2: 6, 3: 18, 4: 54 };

// Unit catalog: combat level, purchase cost, per-turn upkeep, special flags.
const UNIT_CATALOG = {
  peasant: { level: 1, cost: 10, upkeep: 2 },
  spearman: { level: 2, cost: 20, upkeep: 6 },
  baron: { level: 3, cost: 30, upkeep: 18 },
  knight: { level: 4, cost: 40, upkeep: 54 },
  horseman: { level: 2, cost: 25, upkeep: 10, range: 2, special: true },
  scout: { level: 1, cost: 15, upkeep: 4, stealth: true, special: true },
  summoner: { level: 2, cost: 35, upkeep: 12, special: true },
};

// Spell costs (paid from the casting province).
const SPELL = {
  thunder: { cost: 30 },
  meteor: { cost: 60 },
  earthquake: { cost: 180 },
};

const BALLISTA_COST = 80;
const BALLISTA_UPKEEP = 60;
const BALLISTA_RANGE = 2;
const BALLISTA_LEVEL = 3;

const TOWER_COST = 15;
const STRONG_TOWER_COST = 35;
const FARM_BASE = 12;
const FARM_STEP = 2;

const BUILDING_DEFENSE = { castle: 1, tower: 2, strongTower: 3, ballista: 3, farm: 0 };
const BUILDING_UPKEEP = { ballista: BALLISTA_UPKEEP };
const FORTIFICATIONS = ['tower', 'strongTower', 'ballista'];

const STARTING_MONEY = 10;
const STRANDED_LIMIT = 3; // turns a unit survives on an unfunded lone hex

const KIND_BY_LEVEL = ['peasant', 'spearman', 'baron', 'knight'];
function deriveKind(level) { return KIND_BY_LEVEL[level - 1] || 'knight'; }

function key(q, r) { return q + ',' + r; }

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function hexDistance(a, b) {
  return (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.q + a.r - b.q - b.r)) / 2;
}

function unitUpkeep(unit) {
  if (!unit) return 0;
  const cat = UNIT_CATALOG[unit.kind];
  if (cat) return cat.upkeep;
  return UPKEEP[unit.level] || 0;
}

class Game {
  constructor(players, opts = {}) {
    this.players = players.map((p, i) => ({
      index: i, name: p.name, color: p.color, alive: true,
    }));
    this.hexes = new Map();
    this.current = 0;
    this.status = 'playing';
    this.winner = null;
    this.turnCount = 0;
    this.lastError = null;
    this.treesEnabled = opts.trees !== false;
    this.undoStack = [];

    this.generateMap(opts);
    this.recomputeProvinces();
    this.beginTurn();
  }

  // ---- map helpers ---------------------------------------------------------

  hex(q, r) { return this.hexes.get(key(q, r)); }

  neighbors(h) {
    const out = [];
    for (const d of DIRS) {
      const nb = this.hexes.get(key(h.q + d[0], h.r + d[1]));
      if (nb) out.push(nb);
    }
    return out;
  }

  hexesWithin(center, rad) {
    const out = [];
    for (const h of this.hexes.values()) if (hexDistance(center, h) <= rad) out.push(h);
    return out;
  }

  newHex(q, r) {
    return {
      q, r, owner: null, building: null, unit: null,
      tree: false, gravestone: false, money: 0, fired: false,
    };
  }

  generateMap(opts) {
    const width = Math.min(Math.max(opts.width || 14, 6), 24);
    const height = Math.min(Math.max(opts.height || 11, 6), 20);
    const waterRatio = opts.water != null ? opts.water : 0.14;
    const treeRatio = this.treesEnabled ? 0.05 : 0;

    for (let r = 0; r < height; r++) {
      for (let q = 0; q < width; q++) {
        if (Math.random() < waterRatio) continue;
        this.hexes.set(key(q, r), this.newHex(q, r));
      }
    }

    this.keepLargestLandmass();

    const land = [...this.hexes.values()];
    shuffle(land);
    const starts = [];
    const minDist = Math.max(3, Math.floor(Math.min(width, height) / 2));
    const tryPlace = (dist) => {
      for (const h of land) {
        if (starts.length >= this.players.length) break;
        if (starts.includes(h)) continue;
        if (this.neighbors(h).length === 0) continue;
        let ok = true;
        for (const s of starts) if (hexDistance(h, s) < dist) { ok = false; break; }
        if (ok) starts.push(h);
      }
    };
    tryPlace(minDist);
    let relax = minDist;
    while (starts.length < this.players.length && relax > 1) { relax--; tryPlace(relax); }

    starts.forEach((h, i) => {
      h.owner = i;
      h.building = 'castle';
      h.money = STARTING_MONEY;
      h.unit = { level: 1, kind: 'peasant', moved: false };
      const nbs = this.neighbors(h).filter((n) => n.owner === null);
      if (nbs.length) nbs[Math.floor(Math.random() * nbs.length)].owner = i;
    });

    for (const h of this.hexes.values()) {
      if (h.owner === null && !h.building && Math.random() < treeRatio) h.tree = true;
    }
  }

  keepLargestLandmass() {
    const seen = new Set();
    let best = null;
    for (const [kk, h] of this.hexes) {
      if (seen.has(kk)) continue;
      const comp = [];
      const stack = [h];
      seen.add(kk);
      while (stack.length) {
        const c = stack.pop();
        comp.push(c);
        for (const nb of this.neighbors(c)) {
          const nk = key(nb.q, nb.r);
          if (!seen.has(nk)) { seen.add(nk); stack.push(nb); }
        }
      }
      if (!best || comp.length > best.length) best = comp;
    }
    if (!best) return;
    const keep = new Set(best.map((h) => key(h.q, h.r)));
    for (const kk of [...this.hexes.keys()]) if (!keep.has(kk)) this.hexes.delete(kk);
  }

  // ---- provinces -----------------------------------------------------------

  componentFrom(start, seen) {
    const comp = [];
    const stack = [start];
    seen.add(key(start.q, start.r));
    while (stack.length) {
      const c = stack.pop();
      comp.push(c);
      for (const nb of this.neighbors(c)) {
        if (nb.owner === start.owner && !seen.has(key(nb.q, nb.r))) {
          seen.add(key(nb.q, nb.r));
          stack.push(nb);
        }
      }
    }
    return comp;
  }

  getProvinces() {
    const seen = new Set();
    const provinces = [];
    for (const [kk, h] of this.hexes) {
      if (h.owner === null || seen.has(kk)) continue;
      const comp = this.componentFrom(h, seen);
      if (comp.length >= 2) {
        const cap = comp.find((x) => x.building === 'castle') || null;
        provinces.push({ capital: cap, members: comp });
      }
    }
    return provinces;
  }

  recomputeProvinces() {
    const seen = new Set();
    for (const [kk, h] of this.hexes) {
      if (h.owner === null || seen.has(kk)) continue;
      const comp = this.componentFrom(h, seen);
      if (comp.length >= 2) {
        const caps = comp.filter((x) => x.building === 'castle');
        let money = 0;
        for (const c of caps) money += c.money || 0;
        let cap;
        if (caps.length) {
          cap = caps[0];
          for (const c of caps) if (c !== cap) { c.building = null; c.money = 0; }
        } else {
          cap = this.pickCapitalHex(comp);
          cap.building = 'castle';
        }
        cap.money = money;
        for (const c of comp) if (c !== cap) c.money = 0;
      } else {
        for (const c of comp) {
          if (c.building === 'castle') c.building = null;
          c.money = 0;
        }
      }
    }
  }

  pickCapitalHex(comp) {
    return (
      comp.find((h) => !h.unit && !h.building && !h.tree) ||
      comp.find((h) => !h.building && !h.tree) ||
      comp.find((h) => !h.building) ||
      comp[0]
    );
  }

  provinceOf(hex) {
    if (hex.owner === null) return null;
    const comp = this.componentFrom(hex, new Set());
    const capital = comp.find((x) => x.building === 'castle') || null;
    return { capital, members: comp };
  }

  // ---- defense / combat ----------------------------------------------------

  hexSelfDefense(h) {
    let d = 0;
    if (h.building) d = Math.max(d, BUILDING_DEFENSE[h.building] || 0);
    if (h.unit) d = Math.max(d, h.unit.level);
    return d;
  }

  defenseOf(hex) {
    if (hex.owner === null) return 0;
    let d = this.hexSelfDefense(hex);
    for (const nb of this.neighbors(hex)) {
      if (nb.owner === hex.owner) d = Math.max(d, this.hexSelfDefense(nb));
    }
    return d;
  }

  // ---- turn flow -----------------------------------------------------------

  playerHasHexes(idx) {
    for (const h of this.hexes.values()) if (h.owner === idx) return true;
    return false;
  }

  beginTurn() {
    const me = this.current;
    this.undoStack = [];

    for (const h of this.hexes.values()) {
      if (h.gravestone) {
        h.gravestone = false;
        if (this.treesEnabled) h.tree = true;
      }
    }
    if (this.treesEnabled) this.spreadTrees();

    this.recomputeProvinces();

    // income / starvation for funded provinces
    const fundedHexes = new Set();
    for (const prov of this.getProvinces()) {
      if (!prov.capital || prov.capital.owner !== me) continue;
      let income = 0;
      let farms = 0;
      let upkeep = 0;
      for (const h of prov.members) {
        if (h.tree) income -= 1; else income += 1;
        if (h.building === 'farm') farms += 1;
        if (h.building && BUILDING_UPKEEP[h.building]) upkeep += BUILDING_UPKEEP[h.building];
        if (h.unit) upkeep += unitUpkeep(h.unit);
      }
      income += farms * 4 - upkeep;
      prov.capital.money += income;
      if (prov.capital.money < 0) {
        prov.capital.money = 0;
        for (const h of prov.members) if (h.unit) { h.unit = null; h.gravestone = true; }
      } else {
        for (const h of prov.members) fundedHexes.add(key(h.q, h.r));
      }
    }

    // stranded units: those on unfunded lone hexes die after STRANDED_LIMIT turns
    for (const h of this.hexes.values()) {
      if (h.owner !== me || !h.unit) continue;
      if (fundedHexes.has(key(h.q, h.r))) {
        h.unit.stranded = 0;
      } else {
        h.unit.stranded = (h.unit.stranded || 0) + 1;
        if (h.unit.stranded > STRANDED_LIMIT) { h.unit = null; h.gravestone = true; }
      }
    }

    // refresh actions for current player's pieces; consume stun
    for (const h of this.hexes.values()) {
      if (h.owner !== me) continue;
      if (h.unit) {
        if (h.unit.stunned) { h.unit.stunned = false; h.unit.moved = true; }
        else h.unit.moved = false;
        h.unit.summoned = false;
      }
      if (h.building === 'ballista') h.fired = false;
    }
  }

  spreadTrees() {
    const newTrees = [];
    for (const h of this.hexes.values()) {
      if (!h.tree || Math.random() > 0.15) continue;
      const cands = this.neighbors(h).filter(
        (n) => !n.tree && !n.gravestone && !n.building && !n.unit,
      );
      if (cands.length) newTrees.push(cands[Math.floor(Math.random() * cands.length)]);
    }
    for (const n of newTrees) n.tree = true;
  }

  advanceTurn() {
    for (const p of this.players) p.alive = this.playerHasHexes(p.index);
    const aliveCount = this.players.filter((p) => p.alive).length;
    if (aliveCount <= 1) {
      this.status = 'finished';
      this.winner = this.players.find((p) => p.alive) || null;
      return;
    }
    let next = this.current;
    do { next = (next + 1) % this.players.length; } while (!this.players[next].alive);
    if (next <= this.current) this.turnCount += 1;
    this.current = next;
    this.beginTurn();
    const stillAlive = this.players.filter((p) => this.playerHasHexes(p.index));
    if (stillAlive.length <= 1) {
      this.status = 'finished';
      this.winner = stillAlive[0] || null;
    }
  }

  // ---- undo ----------------------------------------------------------------

  snapshot() {
    const m = {};
    for (const [kk, h] of this.hexes) {
      m[kk] = {
        owner: h.owner, building: h.building,
        unit: h.unit ? { ...h.unit } : null,
        tree: h.tree, gravestone: h.gravestone, money: h.money, fired: h.fired,
      };
    }
    return m;
  }

  restore(m) {
    for (const [kk, h] of this.hexes) {
      const s = m[kk];
      if (!s) continue;
      h.owner = s.owner; h.building = s.building;
      h.unit = s.unit ? { ...s.unit } : null;
      h.tree = s.tree; h.gravestone = s.gravestone; h.money = s.money; h.fired = s.fired;
    }
  }

  // ---- actions -------------------------------------------------------------

  fail(msg) { this.lastError = msg; return false; }

  applyAction(playerIndex, action) {
    this.lastError = null;
    if (this.status !== 'playing') return this.fail('Игра завершена');
    if (playerIndex !== this.current) return this.fail('Сейчас не ваш ход');
    if (!action || typeof action.type !== 'string') return this.fail('Некорректное действие');

    if (action.type === 'endTurn') { this.advanceTurn(); return true; }
    if (action.type === 'undo') return this.actUndo();

    const reversible = ['moveUnit', 'buyUnit', 'buildFarm', 'buildTower', 'buildStrongTower',
      'buildBallista', 'fireBallista', 'summon', 'castSpell'];
    if (!reversible.includes(action.type)) return this.fail('Неизвестное действие');

    const snap = this.snapshot();
    let ok = false;
    switch (action.type) {
      case 'moveUnit': ok = this.actMoveUnit(playerIndex, action); break;
      case 'buyUnit': ok = this.actBuyUnit(playerIndex, action); break;
      case 'buildFarm': ok = this.actBuild(playerIndex, action, 'farm'); break;
      case 'buildTower': ok = this.actBuild(playerIndex, action, 'tower'); break;
      case 'buildStrongTower': ok = this.actBuild(playerIndex, action, 'strongTower'); break;
      case 'buildBallista': ok = this.actBuild(playerIndex, action, 'ballista'); break;
      case 'fireBallista': ok = this.actFireBallista(playerIndex, action); break;
      case 'summon': ok = this.actSummon(playerIndex, action); break;
      case 'castSpell': ok = this.actCastSpell(playerIndex, action); break;
    }
    if (ok) this.undoStack.push(snap);
    return ok;
  }

  actUndo() {
    if (!this.undoStack.length) return this.fail('Нечего отменять');
    this.restore(this.undoStack.pop());
    return true;
  }

  resolveHex(coord) {
    if (!coord) return null;
    return this.hex(coord.q, coord.r) || null;
  }

  addMoney(prov, amount) { if (prov.capital) prov.capital.money += amount; }

  placeUnit(player, prov, from, to, spec, fresh) {
    const inProvince = prov.members.includes(to);
    const cat = UNIT_CATALOG[spec.kind] || {};
    const range = cat.range || 1;
    if (!inProvince) {
      const dist = Math.min(...prov.members.map((m) => hexDistance(m, to)));
      if (dist > range) return this.fail('Слишком далеко');
    }

    if (inProvince) {
      if (to.unit) {
        const specSpecial = cat.special;
        const targetSpecial = UNIT_CATALOG[to.unit.kind] && UNIT_CATALOG[to.unit.kind].special;
        if (specSpecial || targetSpecial) return this.fail('Этот юнит не объединяется');
        const combined = spec.level + to.unit.level;
        if (combined > 4) return this.fail('Юниты не объединяются (макс. уровень 4)');
        const mergedMoved = (from ? from.unit.moved : false) || to.unit.moved;
        to.unit = { level: combined, kind: deriveKind(combined), moved: mergedMoved };
        if (from) from.unit = null;
        return true;
      }
      const movedFlag = fresh ? false : true;
      if (to.tree) { to.tree = false; this.addMoney(prov, 3); }
      to.unit = { level: spec.level, kind: spec.kind, moved: movedFlag };
      if (from) from.unit = null;
      return true;
    }

    const def = this.defenseOf(to);
    if (spec.level <= def) return this.fail('Клетка слишком хорошо защищена');
    if (to.tree) this.addMoney(prov, 3);
    to.owner = player;
    to.tree = false; to.gravestone = false; to.building = null; to.fired = false;
    to.unit = { level: spec.level, kind: spec.kind, moved: true };
    if (from) from.unit = null;
    this.recomputeProvinces();
    return true;
  }

  actMoveUnit(player, action) {
    const from = this.resolveHex(action.from);
    const to = this.resolveHex(action.to);
    if (!from || !to) return this.fail('Нет такой клетки');
    if (from.owner !== player || !from.unit) return this.fail('Здесь нет вашего юнита');
    if (from.unit.moved) return this.fail('Этот юнит уже ходил');
    if (from === to) return this.fail('Юнит уже здесь');
    const prov = this.provinceOf(from);
    return this.placeUnit(player, prov, from, to, from.unit, false);
  }

  actBuyUnit(player, action) {
    const cap = this.resolveHex(action.province);
    const to = this.resolveHex(action.to);
    if (!cap || cap.owner !== player || cap.building !== 'castle') {
      return this.fail('Не выбрана столица провинции');
    }
    if (!to) return this.fail('Нет такой клетки');
    const cat = UNIT_CATALOG[action.kind];
    if (!cat) return this.fail('Неизвестный юнит');
    const spec = { level: cat.level, kind: action.kind };
    const cost = cat.cost;
    const prov = this.provinceOf(cap);
    if (cap.money < cost) return this.fail('Недостаточно монет');

    const inProvince = prov.members.includes(to);
    if (!inProvince) {
      const range = cat.range || 1;
      const dist = Math.min(...prov.members.map((m) => hexDistance(m, to)));
      if (dist > range) return this.fail('Слишком далеко от провинции');
      if (spec.level <= this.defenseOf(to)) return this.fail('Клетка слишком хорошо защищена');
    } else if (to.unit) {
      if (cat.special || (UNIT_CATALOG[to.unit.kind] && UNIT_CATALOG[to.unit.kind].special)) {
        return this.fail('Этот юнит не объединяется');
      }
      if (spec.level + to.unit.level > 4) return this.fail('Юниты не объединяются (макс. уровень 4)');
    }

    cap.money -= cost;
    const ok = this.placeUnit(player, prov, null, to, spec, true);
    if (!ok) cap.money += cost;
    return ok;
  }

  actBuild(player, action, type) {
    const cap = this.resolveHex(action.province);
    const to = this.resolveHex(action.to);
    if (!cap || cap.owner !== player || cap.building !== 'castle') {
      return this.fail('Не выбрана столица провинции');
    }
    if (!to) return this.fail('Нет такой клетки');
    const prov = this.provinceOf(cap);
    if (!prov.members.includes(to)) return this.fail('Строить можно только на своей земле');
    if (to.building) return this.fail('Клетка уже занята постройкой');
    if (to.unit) return this.fail('На клетке стоит юнит');
    if (to.tree) return this.fail('Сначала уберите дерево');

    let cost;
    if (type === 'farm') {
      const farms = prov.members.filter((m) => m.building === 'farm').length;
      cost = FARM_BASE + FARM_STEP * farms;
      const adjOk = this.neighbors(to).some(
        (n) => n.owner === player && (n.building === 'castle' || n.building === 'farm'),
      );
      if (!adjOk) return this.fail('Ферма строится рядом со столицей или другой фермой');
    } else if (type === 'tower') cost = TOWER_COST;
    else if (type === 'strongTower') cost = STRONG_TOWER_COST;
    else if (type === 'ballista') cost = BALLISTA_COST;
    else return this.fail('Неизвестная постройка');

    if (cap.money < cost) return this.fail('Недостаточно монет');
    cap.money -= cost;
    to.building = type;
    if (type === 'ballista') to.fired = false;
    return true;
  }

  actFireBallista(player, action) {
    const from = this.resolveHex(action.from);
    const to = this.resolveHex(action.to);
    if (!from || from.owner !== player || from.building !== 'ballista') return this.fail('Нет вашей баллисты');
    if (from.fired) return this.fail('Баллиста уже стреляла в этот ход');
    if (!to) return this.fail('Нет такой клетки');
    if (to.owner === player) return this.fail('Нельзя бить по своим');
    if (hexDistance(from, to) > BALLISTA_RANGE) return this.fail('Цель вне радиуса');
    if (!to.unit) return this.fail('В цели нет юнита');
    if (to.unit.level > BALLISTA_LEVEL) return this.fail('Слишком сильный юнит (нужен 4-й уровень)');
    to.unit = null;
    to.gravestone = true;
    from.fired = true;
    this.recomputeProvinces();
    return true;
  }

  actSummon(player, action) {
    const from = this.resolveHex(action.from);
    const to = this.resolveHex(action.to);
    if (!from || from.owner !== player || !from.unit || from.unit.kind !== 'summoner') {
      return this.fail('Нет вашего призывателя');
    }
    if (from.unit.summoned) return this.fail('Призыватель уже призывал в этот ход');
    if (!to || to.owner !== player) return this.fail('Призыв только на свою клетку');
    if (hexDistance(from, to) !== 1) return this.fail('Только на соседнюю клетку');
    if (to.unit) return this.fail('Клетка занята');
    if (to.tree) return this.fail('Сначала уберите дерево');
    to.unit = { level: 1, kind: 'peasant', moved: true };
    from.unit.summoned = true;
    return true;
  }

  actCastSpell(player, action) {
    const cap = this.resolveHex(action.province);
    if (!cap || cap.owner !== player || cap.building !== 'castle') {
      return this.fail('Не выбрана столица провинции');
    }
    const spell = SPELL[action.spell];
    if (!spell) return this.fail('Неизвестное заклинание');
    if (cap.money < spell.cost) return this.fail('Недостаточно монет');
    const to = this.resolveHex(action.to);
    if (!to) return this.fail('Нет такой клетки');

    if (action.spell === 'meteor') {
      if (to.unit) {
        if (to.unit.level > 3) return this.fail('Метеор не пробивает рыцаря');
        to.unit = null; to.gravestone = true;
      } else if (to.building && to.building !== 'castle') {
        to.building = null; to.fired = false;
      } else {
        return this.fail('В цели нечего разрушать');
      }
    } else if (action.spell === 'thunder') {
      if (!to.unit || to.owner === player) return this.fail('Цель — вражеский юнит');
      to.unit.stunned = true;
      to.unit.moved = true;
    } else if (action.spell === 'earthquake') {
      let any = false;
      for (const h of this.hexesWithin(to, 1)) {
        if (FORTIFICATIONS.includes(h.building)) { h.building = null; h.fired = false; any = true; }
      }
      if (!any) return this.fail('Поблизости нет укреплений');
    }

    cap.money -= spell.cost;
    this.recomputeProvinces();
    return true;
  }

  // ---- serialization -------------------------------------------------------

  serialize(forPlayer = null) {
    const provinces = this.getProvinces();
    const provByHex = new Map();
    const provInfo = [];
    for (const prov of provinces) {
      if (!prov.capital) continue;
      let income = 0;
      let farms = 0;
      let upkeep = 0;
      for (const h of prov.members) {
        if (h.tree) income -= 1; else income += 1;
        if (h.building === 'farm') farms += 1;
        if (h.building && BUILDING_UPKEEP[h.building]) upkeep += BUILDING_UPKEEP[h.building];
        if (h.unit) upkeep += unitUpkeep(h.unit);
        provByHex.set(key(h.q, h.r), key(prov.capital.q, prov.capital.r));
      }
      income += farms * 4 - upkeep;
      provInfo.push({
        capital: { q: prov.capital.q, r: prov.capital.r },
        owner: prov.capital.owner,
        money: prov.capital.money,
        income,
        size: prov.members.length,
      });
    }

    const hexes = [];
    for (const h of this.hexes.values()) {
      let unit = h.unit;
      // stealth: hide enemy scouts unless adjacent to the viewer's territory
      if (unit && UNIT_CATALOG[unit.kind] && UNIT_CATALOG[unit.kind].stealth
          && forPlayer != null && h.owner !== forPlayer) {
        const revealed = this.neighbors(h).some((n) => n.owner === forPlayer);
        if (!revealed) unit = null;
      }
      hexes.push({
        q: h.q, r: h.r, owner: h.owner, building: h.building,
        unit: unit ? {
          level: unit.level, moved: unit.moved, kind: unit.kind,
          stunned: !!unit.stunned, stranded: unit.stranded || 0,
          summoned: !!unit.summoned,
        } : null,
        tree: h.tree, gravestone: h.gravestone, fired: !!h.fired,
        capital: h.building === 'castle',
        province: provByHex.get(key(h.q, h.r)) || null,
      });
    }

    return {
      hexes,
      provinces: provInfo,
      players: this.players.map((p) => ({
        index: p.index, name: p.name, color: p.color, alive: p.alive,
      })),
      current: this.current,
      status: this.status,
      winner: this.winner ? this.winner.index : null,
      turn: this.turnCount,
      canUndo: this.status === 'playing' && this.undoStack.length > 0,
    };
  }
}

module.exports = { Game };

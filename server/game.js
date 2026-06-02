'use strict';

// ---------------------------------------------------------------------------
// Antiyoy game logic (authoritative server-side model)
// Axial hex coordinates (q, r). Water tiles simply do not exist in the map.
// ---------------------------------------------------------------------------

const DIRS = [
  [1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1],
];

// Upkeep per turn by unit level.
const UPKEEP = { 1: 2, 2: 6, 3: 18, 4: 54 };

// Build / purchase costs.
const PEASANT_COST = 10;
const TOWER_COST = 15;
const STRONG_TOWER_COST = 35;
const FARM_BASE = 12;
const FARM_STEP = 2;

// Defense level provided by a building when sitting on a hex.
const BUILDING_DEFENSE = { castle: 1, tower: 2, strongTower: 3, farm: 0 };

const STARTING_MONEY = 10;

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

class Game {
  /**
   * @param {Array<{name:string,color:string}>} players ordered seats
   * @param {{width?:number,height?:number,water?:number,trees?:number}} opts
   */
  constructor(players, opts = {}) {
    this.players = players.map((p, i) => ({
      index: i,
      name: p.name,
      color: p.color,
      alive: true,
    }));
    this.hexes = new Map(); // key -> hex
    this.current = 0;
    this.status = 'playing';
    this.winner = null;
    this.turnCount = 0;
    this.lastError = null;

    this.generateMap(opts);
    this.recomputeProvinces();
    this.beginTurn(); // first player's turn setup
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

  generateMap(opts) {
    const width = Math.min(Math.max(opts.width || 14, 6), 24);
    const height = Math.min(Math.max(opts.height || 11, 6), 20);
    const waterRatio = opts.water != null ? opts.water : 0.14;
    const treeRatio = opts.trees != null ? opts.trees : 0.05;

    // Build a rhombus of hexes, then carve out some water.
    for (let r = 0; r < height; r++) {
      for (let q = 0; q < width; q++) {
        if (Math.random() < waterRatio) continue; // water = missing hex
        this.hexes.set(key(q, r), {
          q, r,
          owner: null,
          building: null,
          unit: null,
          tree: false,
          gravestone: false,
          money: 0,
        });
      }
    }

    // Make sure we have a decent connected landmass: keep largest component.
    this.keepLargestLandmass();

    // Place starting positions for each player, spread apart.
    const land = [...this.hexes.values()];
    shuffle(land);
    const starts = [];
    const minDist = Math.max(3, Math.floor(Math.min(width, height) / 2));
    for (const h of land) {
      if (starts.length >= this.players.length) break;
      // needs at least one land neighbour to form a 2-hex province
      if (this.neighbors(h).length === 0) continue;
      let ok = true;
      for (const s of starts) {
        if (hexDistance(h, s) < minDist) { ok = false; break; }
      }
      if (ok) starts.push(h);
    }
    // Relax distance constraint if the map was too small to place everyone.
    let relax = minDist;
    while (starts.length < this.players.length && relax > 1) {
      relax--;
      for (const h of land) {
        if (starts.length >= this.players.length) break;
        if (starts.includes(h)) continue;
        if (this.neighbors(h).length === 0) continue;
        let ok = true;
        for (const s of starts) if (hexDistance(h, s) < relax) { ok = false; break; }
        if (ok) starts.push(h);
      }
    }

    starts.forEach((h, i) => {
      h.owner = i;
      h.building = 'castle';
      h.money = STARTING_MONEY;
      h.unit = { level: 1, moved: false };
      // claim one neighbour so the province has size >= 2
      const nbs = this.neighbors(h).filter((n) => n.owner === null);
      if (nbs.length) {
        const n = nbs[Math.floor(Math.random() * nbs.length)];
        n.owner = i;
      }
    });

    // Scatter some trees on neutral land.
    for (const h of this.hexes.values()) {
      if (h.owner === null && !h.building && Math.random() < treeRatio) {
        h.tree = true;
      }
    }
  }

  keepLargestLandmass() {
    const seen = new Set();
    let best = null;
    for (const [k, h] of this.hexes) {
      if (seen.has(k)) continue;
      const comp = [];
      const stack = [h];
      seen.add(k);
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
    for (const k of [...this.hexes.keys()]) {
      if (!keep.has(k)) this.hexes.delete(k);
    }
  }

  // ---- provinces -----------------------------------------------------------

  /** Returns list of {capital, members} for every province (size >= 2). */
  getProvinces() {
    const seen = new Set();
    const provinces = [];
    for (const [k, h] of this.hexes) {
      if (h.owner === null || seen.has(k)) continue;
      const comp = [];
      const stack = [h];
      seen.add(k);
      while (stack.length) {
        const c = stack.pop();
        comp.push(c);
        for (const nb of this.neighbors(c)) {
          if (nb.owner === h.owner && !seen.has(key(nb.q, nb.r))) {
            seen.add(key(nb.q, nb.r));
            stack.push(nb);
          }
        }
      }
      if (comp.length >= 2) {
        const cap = comp.find((x) => x.building === 'castle') || null;
        provinces.push({ capital: cap, members: comp });
      }
    }
    return provinces;
  }

  /** Re-derive capitals & money after any ownership change. */
  recomputeProvinces() {
    const seen = new Set();
    for (const [k, h] of this.hexes) {
      if (h.owner === null || seen.has(k)) continue;
      const comp = [];
      const stack = [h];
      seen.add(k);
      while (stack.length) {
        const c = stack.pop();
        comp.push(c);
        for (const nb of this.neighbors(c)) {
          if (nb.owner === h.owner && !seen.has(key(nb.q, nb.r))) {
            seen.add(key(nb.q, nb.r));
            stack.push(nb);
          }
        }
      }
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
        // lone hex: no province, no money
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
    // component containing hex (same owner), returns {capital, members} or null
    if (hex.owner === null) return null;
    const comp = [];
    const seen = new Set([key(hex.q, hex.r)]);
    const stack = [hex];
    while (stack.length) {
      const c = stack.pop();
      comp.push(c);
      for (const nb of this.neighbors(c)) {
        if (nb.owner === hex.owner && !seen.has(key(nb.q, nb.r))) {
          seen.add(key(nb.q, nb.r));
          stack.push(nb);
        }
      }
    }
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

  /** Protection of a hex against attackers (from its own owner). */
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

    // 1. gravestones owned by current player turn into trees
    for (const h of this.hexes.values()) {
      if (h.gravestone) { h.gravestone = false; h.tree = true; }
    }

    // 2. trees spread a little onto empty adjacent hexes
    this.spreadTrees();

    this.recomputeProvinces();

    // 3. income / starvation for current player's provinces
    for (const prov of this.getProvinces()) {
      if (!prov.capital || prov.capital.owner !== me) continue;
      let income = 0;
      let farms = 0;
      let upkeep = 0;
      for (const h of prov.members) {
        if (h.tree) income -= 1; else income += 1;
        if (h.building === 'farm') farms += 1;
        if (h.unit) upkeep += UPKEEP[h.unit.level] || 0;
      }
      income += farms * 4 - upkeep;
      prov.capital.money += income;
      if (prov.capital.money < 0) {
        // starvation: all units in the province die
        prov.capital.money = 0;
        for (const h of prov.members) {
          if (h.unit) { h.unit = null; h.gravestone = true; }
        }
      }
    }

    // 4. refresh movement for current player's units
    for (const h of this.hexes.values()) {
      if (h.owner === me && h.unit) h.unit.moved = false;
    }
  }

  spreadTrees() {
    const newTrees = [];
    for (const h of this.hexes.values()) {
      if (!h.tree) continue;
      if (Math.random() > 0.15) continue;
      const cands = this.neighbors(h).filter(
        (n) => !n.tree && !n.gravestone && !n.building && !n.unit,
      );
      if (cands.length) {
        newTrees.push(cands[Math.floor(Math.random() * cands.length)]);
      }
    }
    for (const n of newTrees) n.tree = true;
  }

  advanceTurn() {
    // eliminate players with no hexes
    for (const p of this.players) p.alive = this.playerHasHexes(p.index);

    const aliveCount = this.players.filter((p) => p.alive).length;
    if (aliveCount <= 1) {
      this.status = 'finished';
      this.winner = this.players.find((p) => p.alive) || null;
      return;
    }

    let next = this.current;
    do {
      next = (next + 1) % this.players.length;
    } while (!this.players[next].alive);

    if (next <= this.current) this.turnCount += 1; // wrapped around -> new round
    this.current = next;
    this.beginTurn();

    // check again in case beginTurn changed things
    const stillAlive = this.players.filter((p) => this.playerHasHexes(p.index));
    if (stillAlive.length <= 1) {
      this.status = 'finished';
      this.winner = stillAlive[0] || null;
    }
  }

  // ---- actions -------------------------------------------------------------

  fail(msg) { this.lastError = msg; return false; }

  /** Entry point used by the server. Returns true on success. */
  applyAction(playerIndex, action) {
    this.lastError = null;
    if (this.status !== 'playing') return this.fail('Игра завершена');
    if (playerIndex !== this.current) return this.fail('Сейчас не ваш ход');
    if (!action || typeof action.type !== 'string') return this.fail('Некорректное действие');

    switch (action.type) {
      case 'moveUnit': return this.actMoveUnit(playerIndex, action);
      case 'buyUnit': return this.actBuyUnit(playerIndex, action);
      case 'buildFarm': return this.actBuild(playerIndex, action, 'farm');
      case 'buildTower': return this.actBuild(playerIndex, action, 'tower');
      case 'buildStrongTower': return this.actBuild(playerIndex, action, 'strongTower');
      case 'endTurn': this.advanceTurn(); return true;
      default: return this.fail('Неизвестное действие');
    }
  }

  resolveHex(coord) {
    if (!coord) return null;
    return this.hex(coord.q, coord.r) || null;
  }

  /** Place a unit of `level` from province `prov` onto `to`. Handles move/merge/capture. */
  placeUnit(player, prov, from, to, level, freshlyBought) {
    const inProvince = prov.members.includes(to);
    const adjacentToProvince = !inProvince &&
      prov.members.some((m) => this.neighbors(m).includes(to));

    if (!inProvince && !adjacentToProvince) return this.fail('Слишком далеко');

    if (inProvince) {
      if (to.unit) {
        // merge
        const combined = level + to.unit.level;
        if (combined > 4) return this.fail('Юниты не объединяются (макс. уровень 4)');
        const mergedMoved = (from ? from.unit.moved : false) || to.unit.moved;
        to.unit = { level: combined, moved: mergedMoved };
        if (from) from.unit = null;
        return true;
      }
      // empty own hex (possibly with own tree / own building underneath)
      const movedFlag = freshlyBought ? false : true;
      if (to.tree) { to.tree = false; this.addMoney(prov, 3); }
      to.unit = { level, moved: movedFlag };
      if (from) from.unit = null;
      return true;
    }

    // capture attempt
    const def = this.defenseOf(to);
    if (level <= def) return this.fail('Клетка слишком хорошо защищена');
    if (to.tree) this.addMoney(prov, 3);
    to.owner = player;
    to.tree = false;
    to.gravestone = false;
    to.building = null;
    to.unit = { level, moved: true };
    if (from) from.unit = null;
    this.recomputeProvinces();
    return true;
  }

  addMoney(prov, amount) {
    if (prov.capital) prov.capital.money += amount;
  }

  actMoveUnit(player, action) {
    const from = this.resolveHex(action.from);
    const to = this.resolveHex(action.to);
    if (!from || !to) return this.fail('Нет такой клетки');
    if (from.owner !== player || !from.unit) return this.fail('Здесь нет вашего юнита');
    if (from.unit.moved) return this.fail('Этот юнит уже ходил');
    if (from === to) return this.fail('Юнит уже здесь');
    const prov = this.provinceOf(from);
    return this.placeUnit(player, prov, from, to, from.unit.level, false);
  }

  actBuyUnit(player, action) {
    const cap = this.resolveHex(action.province);
    const to = this.resolveHex(action.to);
    if (!cap || cap.owner !== player || cap.building !== 'castle') {
      return this.fail('Не выбрана столица провинции');
    }
    if (!to) return this.fail('Нет такой клетки');
    const prov = this.provinceOf(cap);
    if (cap.money < PEASANT_COST) return this.fail('Недостаточно монет');

    // validate placement before charging
    const inProvince = prov.members.includes(to);
    const adjacent = !inProvince && prov.members.some((m) => this.neighbors(m).includes(to));
    if (!inProvince && !adjacent) return this.fail('Слишком далеко от провинции');
    if (inProvince && to.unit && to.unit.level + 1 > 4) {
      return this.fail('Юниты не объединяются (макс. уровень 4)');
    }
    if (!inProvince) {
      const def = this.defenseOf(to);
      if (1 <= def) return this.fail('Свежий крестьянин не пробьёт защиту');
    }

    cap.money -= PEASANT_COST;
    const ok = this.placeUnit(player, prov, null, to, 1, true);
    if (!ok) { cap.money += PEASANT_COST; } // refund on unexpected failure
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
      // farms must be adjacent to capital or another farm
      const adjOk = this.neighbors(to).some(
        (n) => n.owner === player && (n.building === 'castle' || n.building === 'farm'),
      );
      if (!adjOk) return this.fail('Ферма строится рядом со столицей или другой фермой');
    } else if (type === 'tower') {
      cost = TOWER_COST;
    } else {
      cost = STRONG_TOWER_COST;
    }

    if (cap.money < cost) return this.fail('Недостаточно монет');
    cap.money -= cost;
    to.building = type;
    return true;
  }

  // ---- serialization -------------------------------------------------------

  /** Build a client-facing snapshot of the game. */
  serialize() {
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
        if (h.unit) upkeep += UPKEEP[h.unit.level] || 0;
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
      hexes.push({
        q: h.q,
        r: h.r,
        owner: h.owner,
        building: h.building,
        unit: h.unit ? { level: h.unit.level, moved: h.unit.moved } : null,
        tree: h.tree,
        gravestone: h.gravestone,
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
    };
  }
}

module.exports = { Game };

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
// moveRange  = how many friendly tiles the unit may walk through in a turn.
// captureReach = how far from a reachable friendly tile it can grab enemy land.
// landAnywhere = ignores reach entirely (flying raider).
// noCapture  = may reposition but can never take territory (saboteur).
const UNIT_CATALOG = {
  peasant: { level: 1, cost: 10, upkeep: 2, moveRange: 4, captureReach: 1 },
  spearman: { level: 2, cost: 20, upkeep: 6, moveRange: 4, captureReach: 1 },
  baron: { level: 3, cost: 30, upkeep: 18, moveRange: 4, captureReach: 1 },
  knight: { level: 4, cost: 40, upkeep: 54, moveRange: 4, captureReach: 1 },
  horseman: { level: 2, cost: 25, upkeep: 10, moveRange: 6, captureReach: 2, special: true },
  scout: { level: 1, cost: 15, upkeep: 4, stealth: true, special: true, moveRange: 4, noCapture: true },
  summoner: { level: 2, cost: 35, upkeep: 12, special: true, moveRange: 4, captureReach: 1 },
  wolf: { level: 1, cost: 0, upkeep: 0, special: true, summonOnly: true, moveRange: 4, captureReach: 1 },
  // griffon: flies anywhere ONLY on the turn it's bought (landAnywhere). Once on
  // the board it moves like a baron (range 4, reach 1). 3-turn TTL off home soil.
  griffon: { level: 3, cost: 120, upkeep: 18, special: true, landAnywhere: true, moveRange: 4, captureReach: 1 },
};

// One-time state upgrades, purchased once per player from a province treasury.
const UPGRADES = {
  farmIncome: { cost: 200 },
};

const FARM_INCOME = 4;
const FARM_INCOME_UPGRADED = 8;
const BASE_MOVE = 4;

// Highest unit level (knight). A max-level attack also breaks an equal max-level
// defence — that single rule is what lets a knight kill another knight or smash
// a ballista, instead of scattering `=== 4` special cases through the code.
const MAX_LEVEL = 4;

// Spell catalog. `target` documents what the spell needs; `destroyPower` is the
// highest unit level a damage spell can kill — so the rule is data, not a
// hardcoded "is the target a knight?" branch. `radius` is the area of effect.
const SPELL = {
  thunder: { cost: 30, target: 'enemyUnit' },
  meteor: { cost: 60, target: 'enemyUnitOrBuilding', destroyPower: 3 },
  earthquake: { cost: 180, target: 'fortifications', radius: 1 },
};

// Building catalog: everything about a building lives in one place — its
// defence rating, purchase cost, per-turn upkeep, and special behaviour.
//   farm.cost grows by farm.costStep for each farm already in the province;
//   ballista.range / .destroyPower drive its once-per-turn ranged attack.
const BUILDINGS = {
  castle: { defense: 1 },
  farm: { defense: 0, cost: 12, costStep: 2 },
  tower: { defense: 2, cost: 15 },
  strongTower: { defense: 3, cost: 35 },
  ballista: { defense: 4, cost: 80, upkeep: 45, range: 2, destroyPower: 3 },
};
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

function buildingDefense(type) { return (BUILDINGS[type] && BUILDINGS[type].defense) || 0; }
function buildingUpkeep(type) { return (BUILDINGS[type] && BUILDINGS[type].upkeep) || 0; }

class Game {
  constructor(players, opts = {}) {
    this.players = players.map((p, i) => ({
      index: i, name: p.name, color: p.color, alive: true,
      upgrades: { farmIncome: false },
    }));
    this.lastEvents = []; // transient fx (spells, eagle landings) for clients
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
      tree: false, gravestone: false, money: 0, fired: false, farmBoost: false,
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
      const nbs = this.neighbors(h).filter((n) => n.owner === null);
      // units can't stand on a castle, so the starting peasant goes on an owned neighbour
      if (nbs.length) {
        const spot = nbs[Math.floor(Math.random() * nbs.length)];
        spot.owner = i;
        spot.tree = false;
        spot.unit = { level: 1, kind: 'peasant', moved: false, owner: i };
      }
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

  // A unit only defends the tile if it belongs to the tile's owner. Infiltrators
  // (a unit whose owner differs from the tile owner) do NOT fortify the tile.
  hexSelfDefense(h) {
    let d = buildingDefense(h.building);
    if (h.unit && h.unit.owner === h.owner) d = Math.max(d, h.unit.level);
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

  // Combat resolution as pure power-vs-rating, no per-unit casing.
  // breaches: a melee attack of `power` overruns a `defense` rating. Strictly
  //   greater wins; a max-level attack also breaks an equal max-level defence
  //   (knight kills knight, knight smashes a ballista wall).
  breaches(power, defense) {
    return power > defense || (power >= MAX_LEVEL && defense >= MAX_LEVEL);
  }

  // destroys: a ranged strike (meteor, ballista) annihilates a unit when its
  //   power is at least the unit's level — so power 3 clears everything up to
  //   level 3 and a level-4 knight shrugs it off.
  destroys(power, level) {
    return power >= level;
  }

  mergeable(a, b) {
    const ca = UNIT_CATALOG[a.kind] || {};
    const cb = UNIT_CATALOG[b.kind] || {};
    if (ca.special || cb.special) return false;
    return a.level + b.level <= MAX_LEVEL;
  }

  adjacentToOwner(to, player) {
    return this.neighbors(to).some((n) => n.owner === player);
  }

  // Can unit `spec` (owner `player`) step onto a foreign tile `to`?
  // Returns { capture } if allowed (capture=true ⇒ takes the tile/color,
  // capture=false ⇒ infiltrates: stands there, no color, sabotages a farm),
  // or null if the move is impossible.
  canEnterForeign(spec, to, player) {
    const cat = UNIT_CATALOG[spec.kind] || {};
    const buildingBlocks = to.building && to.building !== 'farm';
    const capture = !cat.noCapture && this.adjacentToOwner(to, player);

    if (capture) {
      if (!this.breaches(spec.level, this.defenseOf(to))) return null;
      return { capture: true };
    }
    // infiltration (no ownership change)
    if (buildingBlocks) return null; // can't perch on a tower / castle
    if (cat.noCapture) {
      // saboteur (scout): stealthy, ignores defence but can't fight a unit
      if (to.unit) return null;
      return { capture: false };
    }
    // raider infiltrating deep: must still beat the defence (incl. any unit)
    if (!this.breaches(spec.level, this.defenseOf(to))) return null;
    return { capture: false };
  }

  // Reachable friendly tiles + actionable enemy tiles for an existing unit.
  moveOptions(from) {
    const unit = from.unit;
    const player = unit.owner;
    const cat = UNIT_CATALOG[unit.kind] || {};
    const reachable = new Set();
    const capturable = new Set();
    const moveRange = cat.moveRange || BASE_MOVE;
    const onOwn = from.owner === player;
    const bases = [from];

    const consider = (h) => {
      if (h === from) return;
      if (h.owner === player) {
        if (h.unit) {
          if (h.unit.owner === player) { if (this.mergeable(unit, h.unit)) reachable.add(key(h.q, h.r)); }
          else if (this.breaches(unit.level, h.unit.level)) capturable.add(key(h.q, h.r)); // kill infiltrator on own land
        } else if (!h.building || h.building === 'farm') {
          reachable.add(key(h.q, h.r));
        }
      }
    };

    if (onOwn) {
      // BFS across own connected land, limited by moveRange steps
      const dist = new Map([[key(from.q, from.r), 0]]);
      const queue = [from];
      while (queue.length) {
        const c = queue.shift();
        const d = dist.get(key(c.q, c.r));
        if (d >= moveRange) continue;
        for (const nb of this.neighbors(c)) {
          if (nb.owner !== player) continue;
          const nk = key(nb.q, nb.r);
          if (dist.has(nk)) continue;
          dist.set(nk, d + 1);
          queue.push(nb); bases.push(nb);
          consider(nb);
        }
      }
    } else {
      // infiltrator standing on foreign soil: roam within a radius
      for (const h of this.hexes.values()) {
        if (hexDistance(from, h) <= moveRange && h.owner === player) consider(h);
      }
    }

    // foreign targets (capture or infiltrate)
    const cr = cat.captureReach || 1;
    for (const h of this.hexes.values()) {
      if (h.owner === player) continue;
      let near;
      if (onOwn) near = bases.some((f) => hexDistance(f, h) <= cr);
      else near = hexDistance(from, h) <= moveRange;
      if (!near) continue;
      if (this.canEnterForeign(unit, h, player)) capturable.add(key(h.q, h.r));
    }
    return { reachable, capturable };
  }

  // Placement options for a freshly bought unit of a given kind.
  buyOptions(prov, kind) {
    const cat = UNIT_CATALOG[kind] || {};
    const spec = { level: cat.level, kind };
    const player = prov.capital.owner;
    const reachable = new Set();
    const capturable = new Set();

    const ownPlace = (h) => {
      if (h.owner !== player) return;
      if (h.unit) { if (h.unit.owner === player && this.mergeable(spec, h.unit)) reachable.add(key(h.q, h.r)); return; }
      if (!h.building || h.building === 'farm') reachable.add(key(h.q, h.r));
    };

    if (cat.landAnywhere) {
      for (const h of this.hexes.values()) {
        if (h.owner === player) ownPlace(h);
        else if (this.canEnterForeign(spec, h, player)) capturable.add(key(h.q, h.r));
      }
      return { reachable, capturable };
    }

    for (const m of prov.members) ownPlace(m);
    const cr = cat.captureReach || 1;
    for (const h of this.hexes.values()) {
      if (h.owner === player) continue;
      if (!prov.members.some((m) => hexDistance(m, h) <= cr)) continue;
      if (this.canEnterForeign(spec, h, player)) capturable.add(key(h.q, h.r));
    }
    return { reachable, capturable };
  }

  // ---- turn flow -----------------------------------------------------------

  playerHasHexes(idx) {
    for (const h of this.hexes.values()) if (h.owner === idx) return true;
    return false;
  }

  // A player is in the game only while they hold a capital (i.e. a province of
  // 2+ tiles). Down to scattered lone hexes with no capital ⇒ eliminated.
  ownsCapital(idx) {
    for (const h of this.hexes.values()) {
      if (h.owner === idx && h.building === 'castle') return true;
    }
    return false;
  }

  // Strip an eliminated player's leftover lone tiles back to neutral and remove
  // any of their units still deployed (incl. infiltrators on foreign soil).
  neutralizePlayer(idx) {
    for (const h of this.hexes.values()) {
      if (h.unit && h.unit.owner === idx) h.unit = null;
      if (h.owner !== idx) continue;
      h.owner = null; h.unit = null; h.building = null;
      h.fired = false; h.money = 0; h.gravestone = false; h.farmBoost = false;
    }
  }

  refreshAlive() {
    for (const p of this.players) {
      if (!p.alive) continue;
      if (!this.ownsCapital(p.index)) { p.alive = false; this.neutralizePlayer(p.index); }
    }
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
      let upkeep = 0;
      for (const h of prov.members) {
        if (h.tree) income -= 1; else income += 1;
        if (h.building === 'farm') income += h.farmBoost ? FARM_INCOME_UPGRADED : FARM_INCOME;
        upkeep += buildingUpkeep(h.building);
        if (h.unit && h.unit.owner === me) upkeep += unitUpkeep(h.unit);
      }
      income -= upkeep;
      prov.capital.money += income;
      if (prov.capital.money < 0) {
        prov.capital.money = 0;
        for (const h of prov.members) if (h.unit && h.unit.owner === me) { h.unit = null; h.gravestone = true; }
      } else {
        for (const h of prov.members) fundedHexes.add(key(h.q, h.r));
      }
    }

    // wolf TTL countdown (summoner-summoned wolves live WOLF_TTL turns then die)
    for (const h of this.hexes.values()) {
      if (!h.unit || h.unit.owner !== me || h.unit.kind !== 'wolf') continue;
      h.unit.ttl = (h.unit.ttl || 1) - 1;
      if (h.unit.ttl <= 0) { h.unit = null; h.gravestone = true; }
    }

    // time-to-live off home soil. A unit standing anywhere that isn't one of my
    // funded province tiles — raiding behind enemy lines, or cut off on an
    // unfunded lone hex — counts a turn; after STRANDED_LIMIT turns away it dies.
    // The counter is cleared only by standing back on funded home soil, so it
    // never resets while the unit lingers in enemy territory.
    for (const h of this.hexes.values()) {
      if (!h.unit || h.unit.owner !== me) continue;
      if (h.unit.kind === 'wolf') continue; // wolves run their own ttl instead
      if (fundedHexes.has(key(h.q, h.r))) {
        h.unit.stranded = 0;
      } else {
        h.unit.stranded = (h.unit.stranded || 0) + 1;
        if (h.unit.stranded > STRANDED_LIMIT) { h.unit = null; h.gravestone = true; }
      }
    }

    // refresh actions for all of my pieces (wherever they stand); consume stun
    for (const h of this.hexes.values()) {
      if (h.unit && h.unit.owner === me) {
        if (h.unit.stunned) { h.unit.stunned = false; h.unit.moved = true; }
        else h.unit.moved = false;
        h.unit.summoned = false;
      }
      if (h.owner === me && h.building === 'ballista') h.fired = false;
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
    this.recomputeProvinces();
    this.refreshAlive();
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
    this.refreshAlive();
    const stillAlive = this.players.filter((p) => p.alive);
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
        farmBoost: h.farmBoost,
      };
    }
    return { hexes: m, upgrades: this.players.map((p) => ({ ...p.upgrades })) };
  }

  restore(snap) {
    const m = snap.hexes;
    for (const [kk, h] of this.hexes) {
      const s = m[kk];
      if (!s) continue;
      h.owner = s.owner; h.building = s.building;
      h.unit = s.unit ? { ...s.unit } : null;
      h.tree = s.tree; h.gravestone = s.gravestone; h.money = s.money; h.fired = s.fired;
      h.farmBoost = s.farmBoost;
    }
    if (snap.upgrades) {
      snap.upgrades.forEach((u, i) => { if (this.players[i]) this.players[i].upgrades = { ...u }; });
    }
  }

  // ---- actions -------------------------------------------------------------

  fail(msg) { this.lastError = msg; return false; }

  applyAction(playerIndex, action) {
    this.lastError = null;
    this.lastEvents = [];
    if (this.status !== 'playing') return this.fail('Игра завершена');
    if (playerIndex !== this.current) return this.fail('Сейчас не ваш ход');
    if (!action || typeof action.type !== 'string') return this.fail('Некорректное действие');

    if (action.type === 'endTurn') { this.advanceTurn(); return true; }
    if (action.type === 'undo') return this.actUndo();

    const reversible = ['moveUnit', 'buyUnit', 'buildFarm', 'buildTower', 'buildStrongTower',
      'buildBallista', 'fireBallista', 'summon', 'castSpell', 'buyUpgrade'];
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
      case 'buyUpgrade': ok = this.actBuyUpgrade(playerIndex, action); break;
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
    const cat = UNIT_CATALOG[spec.kind] || {};
    const mk = (moved) => {
      const u = { level: spec.level, kind: spec.kind, moved, owner: player };
      if (spec.ttl) u.ttl = spec.ttl;
      return u;
    };

    if (to.owner === player) {
      // own tile: merge / reposition, or kill an enemy infiltrator squatting here
      if (to.unit && to.unit.owner !== player) {
        if (!this.breaches(spec.level, to.unit.level)) return this.fail('Здесь слишком сильный вражеский юнит');
        to.unit = mk(true);
        to.gravestone = false;
        if (from) from.unit = null;
        return true;
      }
      if (to.building && to.building !== 'farm') return this.fail('Юнита нельзя ставить на здание');
      if (to.unit) {
        if (!this.mergeable(spec, to.unit)) return this.fail('Эти юниты не объединяются');
        const combined = spec.level + to.unit.level;
        const mergedMoved = (from ? from.unit.moved : false) || to.unit.moved;
        to.unit = { level: combined, kind: deriveKind(combined), moved: mergedMoved, owner: player };
        to.gravestone = false;
        if (from) from.unit = null;
        return true;
      }
      if (to.tree) { to.tree = false; this.addMoney(prov, 3); }
      to.gravestone = false;
      to.unit = mk(fresh ? false : true);
      if (from) from.unit = null;
      return true;
    }

    // foreign tile: decide capture vs infiltration
    const res = this.canEnterForeign(spec, to, player);
    if (!res) return this.fail('Туда нельзя пойти');

    if (res.capture) {
      if (to.tree) this.addMoney(prov, 3);
      to.owner = player;
      to.tree = false; to.gravestone = false; to.building = null; to.fired = false; to.farmBoost = false;
      to.unit = mk(true);
      if (from) from.unit = null;
      this.recomputeProvinces();
      return true;
    }

    // infiltration: stand on the tile WITHOUT taking it; sabotage a farm
    if (to.building === 'farm') { to.building = null; to.farmBoost = false; }
    if (to.unit && to.unit.owner !== player) to.unit = null; // raider killed the defender
    if (to.tree) to.tree = false;
    to.gravestone = false;
    to.unit = mk(true);
    if (from) from.unit = null;
    return true;
  }

  actMoveUnit(player, action) {
    const from = this.resolveHex(action.from);
    const to = this.resolveHex(action.to);
    if (!from || !to) return this.fail('Нет такой клетки');
    if (!from.unit || from.unit.owner !== player) return this.fail('Здесь нет вашего юнита');
    if (from.unit.moved) return this.fail('Этот юнит уже ходил');
    if (from === to) return this.fail('Юнит уже здесь');

    const { reachable, capturable } = this.moveOptions(from);
    const tk = key(to.q, to.r);
    if (!reachable.has(tk) && !capturable.has(tk)) return this.fail('Туда нельзя пойти');

    // a griffon already on the board just walks like a baron — no landing fx
    const prov = from.owner === player ? this.provinceOf(from) : { capital: null, members: [from] };
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
    if (cat.summonOnly) return this.fail('Этот юнит нельзя купить');
    const spec = { level: cat.level, kind: action.kind };
    const cost = cat.cost;
    const prov = this.provinceOf(cap);
    if (cap.money < cost) return this.fail('Недостаточно монет');

    const { reachable, capturable } = this.buyOptions(prov, action.kind);
    const tk = key(to.q, to.r);
    if (!reachable.has(tk) && !capturable.has(tk)) return this.fail('Сюда нельзя поставить юнита');

    cap.money -= cost;
    const ok = this.placeUnit(player, prov, null, to, spec, true);
    if (!ok) { cap.money += cost; return ok; }
    if (action.kind === 'griffon') {
      this.lastEvents.push({ kind: 'land', unit: 'griffon', to: { q: to.q, r: to.r }, by: player });
    }
    return ok;
  }

  actBuild(player, action, type) {
    const cap = this.resolveHex(action.province);
    const to = this.resolveHex(action.to);
    if (!cap || cap.owner !== player || cap.building !== 'castle') {
      return this.fail('Не выбрана столица провинции');
    }
    if (!to) return this.fail('Нет такой клетки');
    const cfg = BUILDINGS[type];
    if (!cfg || cfg.cost == null) return this.fail('Неизвестная постройка');
    const prov = this.provinceOf(cap);
    if (!prov.members.includes(to)) return this.fail('Строить можно только на своей земле');
    if (to.building) return this.fail('Клетка уже занята постройкой');
    if (to.unit) return this.fail('На клетке стоит юнит');
    if (to.tree) return this.fail('Сначала уберите дерево');

    let cost = cfg.cost;
    if (type === 'farm') {
      const farms = prov.members.filter((m) => m.building === 'farm').length;
      cost = cfg.cost + cfg.costStep * farms;
      const adjOk = this.neighbors(to).some(
        (n) => n.owner === player && (n.building === 'castle' || n.building === 'farm'),
      );
      if (!adjOk) return this.fail('Ферма строится рядом со столицей или другой фермой');
    }

    if (cap.money < cost) return this.fail('Недостаточно монет');
    cap.money -= cost;
    to.building = type;
    if (type === 'ballista') to.fired = false;
    // agrarian reform doubles only farms built AFTER the upgrade was bought
    if (type === 'farm') to.farmBoost = !!(this.players[player] && this.players[player].upgrades.farmIncome);
    return true;
  }

  actFireBallista(player, action) {
    const from = this.resolveHex(action.from);
    const to = this.resolveHex(action.to);
    const cfg = BUILDINGS.ballista;
    if (!from || from.owner !== player || from.building !== 'ballista') return this.fail('Нет вашей баллисты');
    if (from.fired) return this.fail('Баллиста уже стреляла в этот ход');
    if (!to) return this.fail('Нет такой клетки');
    if (hexDistance(from, to) > cfg.range) return this.fail('Цель вне радиуса');
    if (!to.unit || to.unit.owner === player) return this.fail('В цели нет вражеского юнита');
    if (!this.destroys(cfg.destroyPower, to.unit.level)) return this.fail('Юнит слишком силён для баллисты');
    to.unit = null;
    to.gravestone = true;
    from.fired = true;
    this.recomputeProvinces();
    return true;
  }

  actSummon(player, action) {
    const from = this.resolveHex(action.from);
    const to = this.resolveHex(action.to);
    if (!from || !from.unit || from.unit.owner !== player || from.unit.kind !== 'summoner') {
      return this.fail('Нет вашего призывателя');
    }
    if (from.unit.summoned) return this.fail('Призыватель уже призывал в этот ход');
    if (!to || to.owner !== player) return this.fail('Призыв только на свою клетку');
    if (hexDistance(from, to) !== 1) return this.fail('Только на соседнюю клетку');
    if (to.unit) return this.fail('Клетка занята');
    if (to.building && to.building !== 'farm') return this.fail('Здесь нельзя призвать');
    if (to.tree) return this.fail('Сначала уберите дерево');
    to.unit = { level: 1, kind: 'wolf', moved: true, ttl: 3, owner: player };
    to.gravestone = false;
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

    // whose piece is being hit — captured before the effect mutates the tile
    // (meteor wipes the unit, so reading it afterwards would be too late)
    let target = null;
    if (to.unit) target = to.unit.owner;
    else if (to.owner != null && to.owner !== player) target = to.owner;

    // each spell returns true on success or a failure message string
    const result = this.applySpell(action.spell, spell, to, player);
    if (result !== true) return this.fail(result);

    cap.money -= spell.cost;
    this.lastEvents.push({
      kind: 'spell', spell: action.spell,
      from: { q: cap.q, r: cap.r }, to: { q: to.q, r: to.r }, by: player, target,
    });
    this.recomputeProvinces();
    return true;
  }

  // Spell effects, one method each. Returns true on success or a message string.
  applySpell(name, spell, to, player) {
    switch (name) {
      case 'meteor': return this.spellMeteor(to, spell);
      case 'thunder': return this.spellThunder(to, player);
      case 'earthquake': return this.spellEarthquake(to, spell);
      default: return 'Неизвестное заклинание';
    }
  }

  // Meteor: destroy any unit it outpowers (data-driven, no knight special case),
  // otherwise demolish a building (except a capital). No capture.
  spellMeteor(to, spell) {
    if (to.unit) {
      if (!this.destroys(spell.destroyPower, to.unit.level)) return 'Юнит слишком силён для метеора';
      to.unit = null; to.gravestone = true;
      return true;
    }
    if (to.building && to.building !== 'castle') {
      to.building = null; to.fired = false; to.farmBoost = false;
      return true;
    }
    return 'В цели нечего разрушать';
  }

  // Thunder: stun an enemy unit for its next turn.
  spellThunder(to, player) {
    if (!to.unit || to.unit.owner === player) return 'Цель — вражеский юнит';
    to.unit.stunned = true;
    to.unit.moved = true;
    return true;
  }

  // Earthquake: level every fortification in range.
  spellEarthquake(to, spell) {
    let any = false;
    for (const h of this.hexesWithin(to, spell.radius)) {
      if (FORTIFICATIONS.includes(h.building)) { h.building = null; h.fired = false; any = true; }
    }
    return any ? true : 'Поблизости нет укреплений';
  }

  actBuyUpgrade(player, action) {
    const cap = this.resolveHex(action.province);
    if (!cap || cap.owner !== player || cap.building !== 'castle') {
      return this.fail('Не выбрана столица провинции');
    }
    const up = UPGRADES[action.upgrade];
    if (!up) return this.fail('Неизвестное улучшение');
    const pl = this.players[player];
    if (pl.upgrades[action.upgrade]) return this.fail('Улучшение уже куплено');
    if (cap.money < up.cost) return this.fail('Недостаточно монет');
    cap.money -= up.cost;
    pl.upgrades[action.upgrade] = true;
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
      let upkeep = 0;
      for (const h of prov.members) {
        if (h.tree) income -= 1; else income += 1;
        if (h.building === 'farm') income += h.farmBoost ? FARM_INCOME_UPGRADED : FARM_INCOME;
        upkeep += buildingUpkeep(h.building);
        if (h.unit && h.unit.owner === prov.capital.owner) upkeep += unitUpkeep(h.unit);
        provByHex.set(key(h.q, h.r), key(prov.capital.q, prov.capital.r));
      }
      const owner = prov.capital.owner;
      income -= upkeep;
      // hide other players' treasury / income (fog over the economy)
      const mine = forPlayer == null || owner === forPlayer;
      provInfo.push({
        capital: { q: prov.capital.q, r: prov.capital.r },
        owner,
        money: mine ? prov.capital.money : null,
        income: mine ? income : null,
        size: prov.members.length,
      });
    }

    const hexes = [];
    for (const h of this.hexes.values()) {
      let unit = h.unit;
      // stealth: hide enemy scouts unless adjacent to the viewer's territory
      if (unit && UNIT_CATALOG[unit.kind] && UNIT_CATALOG[unit.kind].stealth
          && forPlayer != null && unit.owner !== forPlayer) {
        const revealed = this.neighbors(h).some((n) => n.owner === forPlayer);
        if (!revealed) unit = null;
      }
      hexes.push({
        q: h.q, r: h.r, owner: h.owner, building: h.building,
        unit: unit ? {
          level: unit.level, moved: unit.moved, kind: unit.kind, owner: unit.owner,
          stunned: !!unit.stunned, stranded: unit.stranded || 0,
          summoned: !!unit.summoned, ttl: unit.ttl || 0,
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
        upgrades: { ...p.upgrades },
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

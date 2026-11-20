import { CAP, CHANNELS, DT, FALLEN_CAP, GRID, HALF, INITIAL, SPECIES, WATER, clamp, rng } from './config.js';
import { GENES, NI, NeuralNetwork } from './neural.js';
import { brush, createTerrain, ground, tile } from './terrain.js';
import { EDGE, RiverNavigation, WADE_HEIGHT, onWaterSurface } from './river-navigation.js';
import { CollisionIndex } from './collisions.js';
import { BITE_WINDOW, FALL_DURATION, HUNT_DURATION, WINDUP, canBite } from './hunt.js';
import { biomeHour, darkness, hourOffset, visionFactor } from './day-cycle.js';
import { ALLY_SIGNAL_RANGE, FORWARD_SIGHT, NEAR_SIGHT } from './perception.js';

const CELLS = 20;
const CELL_WIDTH = HALF * 2 / CELLS;
const cell = value => clamp(Math.floor((value + HALF) / CELL_WIDTH), 0, CELLS - 1);
const SECTORS = [-1.24, -.62, 0, .62, 1.24, Math.PI];
const SCAN = [3, 7, 13, 21, 31, 43];
const RAYS = [-.78, 0, .78];

function targetSensor(input, at, a, x, z, proximity) {
  if (proximity <= 0) return;
  const angle = Math.atan2(x - a.x, z - a.z) - a.angle;
  input[at] = proximity;
  input[at + 1] = Math.sin(angle) * proximity;
  input[at + 2] = Math.cos(angle) * proximity;
}

export class Ecosystem {
  constructor(seed, { map = createTerrain(seed), props, population = INITIAL } = {}) {
    this.seed = seed;
    this.random = rng(seed);
    this.map = map;
    this.collisions = new CollisionIndex();
    this.collisions.setMap(this.map, props);
    this.river = new RiverNavigation(this.map, this.collisions);
    this.agents = [];
    this.fallen = [];
    this.byId = new Map();
    this.buckets = Array.from({ length: CELLS ** 2 }, () => []);
    this.archive = [[], []];
    this.events = [];
    this.history = [];
    this.nextId = 1;
    this.ticks = 0;
    this.time = 0;
    this.dayOffset = 0;
    this.night = darkness(this.hour);
    this.births = 0;
    this.mutations = 0;
    this.recoveries = 0;
    this.hunts = 0;
    this.cooperative = 0;
    this.shelter = 0;
    this.migrations = 0;
    this.generation = 1;
    this.counts = [...population];
    this.weather = 'clear';
    this.climate = { clear: [21, 1, 0], rain: [14, .78, .010], fog: [11, .52, .002], heat: [37, .91, -.009] };
    this.edited = true;
    for (const [species, count] of population.entries()) {
      for (let i = 0; i < count; i++) this.addAgent(species);
    }
    this.record();
  }

  get hour() {
    return biomeHour(this.time, this.dayOffset);
  }

  setHour(hour) {
    this.dayOffset = hourOffset(this.time, hour);
    this.night = darkness(this.hour);
  }

  addAgent(species, parent, mate, archived) {
    const random = this.random;
    let x, z;
    if (parent) {
      x = clamp(parent.x + (random() - .5) * 5, -EDGE, EDGE);
      z = clamp(parent.z + (random() - .5) * 5, -EDGE, EDGE);
      if (ground(this.map, x, z) < WADE_HEIGHT) { x = parent.x; z = parent.z; }
    } else {
      let best = -Infinity;
      for (let attempt = 0; attempt < 64; attempt++) {
        const px = (random() - .5) * HALF * 1.64;
        const pz = (random() - .5) * HALF * 1.68;
        const height = ground(this.map, px, pz);
        if (height <= best) continue;
        best = height;
        x = px;
        z = pz;
        if (height >= WATER + 1) break;
      }
    }
    const lineage = parent ? [parent.id, mate.id] : archived ? [archived.id] : [];
    const generation = 1 + Math.max(parent?.generation ?? 0, mate?.generation ?? 0, archived?.generation ?? 0);
    const inherited = parent || archived;
    const variation = inherited
      ? NeuralNetwork.breed(inherited.brain.genes, mate?.brain.genes ?? inherited.brain.genes, random)
      : { brain: NeuralNetwork.founder(species, random), mutations: 0 };
    const genes = variation.brain.genes;
    const coatTrait = Math.tanh(genes[23] * .86 + genes[55] * .73 + genes[324] * .54 - genes[411] * .72);
    const sizeTrait = Math.tanh(genes[26] * .71 + genes[103] * .65 - genes[340] * .51 + genes[477] * .6);
    const a = {
      coatTrait, sizeTrait, gait: 0, swimming: false, drinking: false,
      id: this.nextId++, species, x, z, angle: parent?.angle ?? random() * Math.PI * 2,
      hunger: .14 + random() * .25, thirst: .10 + random() * .2,
      energy: .88, health: 1, fear: 0, age: parent || archived ? 0 : random() * 22,
      cooldown: parent ? 30 : 7 + random() * 24, attackCD: 0, speed: 0, signal: 0, signalAt: -100, hidden: false,
      kills: 0, assists: 0, escapes: 0, moves: 0, drinks: 0,
      lastAttacker: 0, touched: -100, lastShelter: -100, lastMove: -100,
      huntStarted: -100, biteAt: -100, hitAt: -100, fallAt: -100, attackTarget: 0,
      terrainCell: tile(x, z), resourceX: x, resourceZ: z,
      generation, lineage, mutations: variation.mutations,
      brain: variation.brain, inputs: new Float32Array(NI), action: 'Explorando',
    };
    this.river.sync(a);
    if (this.collisions.separate(a)) this.river.sync(a);
    this.collisions.insert(a);
    this.agents.push(a);
    this.byId.set(a.id, a);
    if (inherited) {
      this.mutations += variation.mutations;
      this.generation = Math.max(this.generation, generation);
    }
    return a;
  }

  emit(text, kind = 'life') {
    this.events.unshift({ id: this.ticks + ':' + this.events.length + ':' + text, time: this.time, text, kind });
    if (this.events.length > 5) this.events.pop();
  }

  edit(mode, x, z, radius) {
    if (!['raise', 'lower', 'forest', 'meadow', 'fire', 'dry', 'river'].includes(mode)) return;
    if (![x, z, radius].every(Number.isFinite)) return;
    brush(this.map, mode, clamp(x, -HALF, HALF), clamp(z, -HALF, HALF), clamp(radius, 5, 55));
    if (mode === 'raise' || mode === 'lower' || mode === 'river') {
      this.river.invalidate();
      for (const agent of this.agents) this.river.sync(agent);
    }
    this.refreshColliders();
    this.edited = true;
  }

  refreshColliders() {
    this.collisions.setMap(this.map);
    this.collisions.rebuild(this.agents, this.fallen);
    for (const agent of this.agents) {
      if (this.collisions.separate(agent)) {
        this.river.sync(agent);
        this.collisions.move(agent);
      }
    }
  }

  record() {
    this.history.push([this.time, ...this.counts]);
    if (this.history.length > 92) this.history.shift();
  }

  rebuildIndex() {
    for (const bucket of this.buckets) bucket.length = 0;
    for (const a of this.agents) this.buckets[cell(a.z) * CELLS + cell(a.x)].push(a);
  }

  visible(a, b) {
    const map = this.map;
    const y = onWaterSurface(ground(map, a.x, a.z), a.swimming) + (a.swimming ? .65 : 1.7);
    const end = onWaterSurface(ground(map, b.x, b.z), b.swimming) + (b.swimming ? .55 : 1.4);
    for (const t of [.32, .64]) {
      const at = tile(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t);
      if (map[at] > y + (end - y) * t + .65 || map[at + 1] > .94) return false;
    }
    return true;
  }

  sense(a, visibility, temperature) {
    const { map } = this;
    const input = a.inputs;
    input.fill(0);
    const forwardX = Math.sin(a.angle);
    const forwardZ = Math.cos(a.angle);
    const vision = visionFactor(a.species, this.night);
    const sight = (a.species ? 48 : 43) * visibility * vision * (1 - map[a.terrainCell + 1] * .23);
    let prey, predator, ally, victim, signalSource, signaled = 0;
    let preyD = sight, predD = sight, allyD = sight + 4, victimD = 3.3;
    const fromZ = cell(a.z - sight - 4), toZ = cell(a.z + sight + 4);
    const fromX = cell(a.x - sight - 4), toX = cell(a.x + sight + 4);
    for (let iz = fromZ; iz <= toZ; iz++) {
      for (let ix = fromX; ix <= toX; ix++) {
        for (const b of this.buckets[iz * CELLS + ix]) {
          if (a === b || b.health <= 0) continue;
          const dx = b.x - a.x, dz = b.z - a.z;
          const dist = Math.hypot(dx, dz);
          if (dist >= sight + 4) continue;
          if (a.species === b.species) {
            if (dist < allyD) { ally = b; allyD = dist; }
            const received = b.signal * clamp(1 - dist / ALLY_SIGNAL_RANGE);
            if (received > signaled) { signaled = received; signalSource = b; }
            continue;
          }
          const facing = dx * forwardX + dz * forwardZ;
          if (a.species && dist < victimD && facing > -1 && (!b.hidden || dist < 1.7)) {
            victim = b;
            victimD = dist;
          }
          const range = sight * (b.hidden ? .27 : 1);
          if (dist >= range || (dist > NEAR_SIGHT && facing < FORWARD_SIGHT * dist)) continue;
          if (b.species && dist < predD && this.visible(a, b)) { predator = b; predD = dist; }
          if (!b.species && dist < preyD && this.visible(a, b)) { prey = b; preyD = dist; }
        }
      }
    }
    if (prey) targetSensor(input, 0, a, prey.x, prey.z, 1 - preyD / sight);
    if (predator) targetSensor(input, 3, a, predator.x, predator.z, 1 - predD / sight);
    if (ally) targetSensor(input, 6, a, ally.x, ally.z, 1 - allyD / (sight + 4));

    let food = 0, water = 0, cover = 0, coverX = 0, coverZ = 0;
    for (const sector of SECTORS) {
      const azimuth = a.angle + sector;
      const sx = Math.sin(azimuth), sz = Math.cos(azimuth);
      for (const sample of SCAN) {
        const distance = sample * vision;
        const x = a.x + sx * distance, z = a.z + sz * distance;
        if (Math.abs(x) > HALF || Math.abs(z) > HALF) break;
        const at = tile(x, z);
        const falloff = 1 - sample / 49;
        const canopy = map[at + 1] * falloff;
        const nutrient = map[at + 2] * falloff;
        if (map[at] < WATER) {
          if (falloff > water) {
            water = falloff;
            targetSensor(input, 12, a, x, z, water * (.28 + a.thirst * .72));
          }
          continue;
        }
        if (nutrient > food && !a.species) {
          food = nutrient;
          targetSensor(input, 9, a, x, z, food * (.44 + a.hunger * .56));
        }
        if (canopy > cover) {
          cover = canopy;
          coverX = x;
          coverZ = z;
          targetSensor(input, 15, a, x, z, cover * (.42 + a.fear * .58));
        }
      }
    }
    for (const [index, ray] of RAYS.entries()) {
      const angle = a.angle + ray;
      const near = tile(a.x + Math.sin(angle) * 5.8, a.z + Math.cos(angle) * 5.8);
      const blocked = !this.collisions.clearLine(a.x, a.z, a.x + Math.sin(angle) * 3.2, a.z + Math.cos(angle) * 3.2);
      input[18 + index] = clamp(Number(blocked) * .75 + Math.abs(map[near] - map[a.terrainCell]) / 10 +
        map[near + 4] + Math.max(0, map[near + 1] - .78));
    }
    a.fear = clamp(Math.max(input[3] * 1.22, a.fear - DT * .10) + map[a.terrainCell + 4] * .04);
    input[21] = a.hunger;
    input[22] = a.thirst;
    input[23] = a.energy;
    input[24] = a.fear;
    input[25] = (temperature - 19) / 24;
    input[26] = map[a.terrainCell + 3];
    input[27] = signaled;
    if (a.perception) {
      const rival = a.species ? prey : predator;
      a.perception.set([a.x, a.z, a.angle, sight,
        rival?.id ?? 0, rival?.x ?? 0, rival?.z ?? 0, ally?.id ?? 0, ally?.x ?? 0, ally?.z ?? 0,
        signalSource?.id ?? 0, signalSource?.x ?? 0, signalSource?.z ?? 0, coverX, coverZ]);
    }
    return { ally, allyD, victim };
  }

  updateAgent(a, temperature, visibility) {
    const { map } = this;
    const { ally, allyD, victim } = this.sense(a, visibility, temperature);
    const [throttle, turn, gait, signal, interact, breed] = a.brain.run(a.inputs);
    const species = SPECIES[a.species];
    a.gait = gait;
    const oldTerrain = a.terrainCell;
    a.age += DT;
    a.cooldown -= DT;
    a.attackCD -= DT;
    if (!a.signal && signal >= .60) a.signalAt = this.time;
    a.signal = signal >= .60 ? signal : 0;
    a.hidden = gait < .29 && map[oldTerrain + 1] > .54;
    const hurt = this.time - a.hitAt < .24;
    const rest = !a.species && !hurt && !a.swimming && a.fear < .30 && a.thirst < .46 &&
      a.hunger < .78 && map[oldTerrain + 4] < .08 ? this.night * clamp((.50 - a.energy) / .17) : 0;
    const sprint = gait > .68 && rest < .26;
    const pace = sprint ? 1.18 : a.hidden ? .32 : .73;
    let wanted = a.angle + turn * DT * 2.55;
    a.speed = throttle * species.baseSpeed * pace * (.52 + a.energy * .48);
    a.action = a.hidden ? 'Ocultándose' : sprint ? 'Corriendo' : a.signal ? 'Emitiendo señal' : 'Explorando';
    if (rest > .16) {
      const gathering = ally && !ally.swimming && allyD > 3.6 && allyD < 12;
      a.speed *= 1 - rest * (gathering ? .54 : .89);
      if (gathering) {
        const heading = Math.atan2(ally.x - a.x, ally.z - a.z) - a.angle;
        wanted += clamp(Math.atan2(Math.sin(heading), Math.cos(heading)), -.18, .18) * rest;
      }
      a.action = gathering ? 'Reuniéndose' : 'Descansando';
    }
    let target = this.byId.get(a.attackTarget);
    const huntAge = this.time - a.huntStarted;
    if (huntAge >= HUNT_DURATION) {
      a.attackTarget = 0;
      target = undefined;
      if (a.species && !a.swimming && !a.drinking && interact > .55 && a.attackCD <= 0 &&
          a.hunger > .25 && victim && !victim.swimming && victim.health > 0 &&
          this.collisions.clearLine(a.x, a.z, victim.x, victim.z)) {
        a.attackTarget = victim.id;
        a.huntStarted = this.time;
        a.attackCD = HUNT_DURATION + .12;
        target = victim;
      }
    }
    const hunting = Boolean(a.attackTarget) && this.time - a.huntStarted < HUNT_DURATION;
    if (hunting && !a.swimming) {
      const phase = this.time - a.huntStarted;
      const striking = phase >= WINDUP && phase <= BITE_WINDOW && a.biteAt < a.huntStarted;
      if (target?.health > 0 && (phase < WINDUP || striking)) {
        const heading = Math.atan2(target.x - a.x, target.z - a.z);
        wanted = a.angle + clamp(Math.atan2(Math.sin(heading - a.angle), Math.cos(heading - a.angle)), -.29, .29);
      }
      // Crouch in place and plant the forelegs once the target is within bite range.
      const contact = striking && canBite(this.collisions, a, target);
      if (phase < WINDUP || contact) a.speed = 0;
      else if (striking) a.speed = Math.max(a.speed, 7.4);
      else a.speed *= .50;
      a.action = phase < WINDUP ? 'Preparando ataque' : striking ? 'Cazando' : 'Recuperándose';
    }
    if (hurt) a.speed *= .46;
    const drank = this.river.step(a, wanted, this.random);
    this.collisions.move(a);
    const phase = this.time - a.huntStarted;
    if (hunting && phase >= WINDUP && phase <= BITE_WINDOW && a.biteAt < a.huntStarted && canBite(this.collisions, a, target)) {
      this.attack(a, target);
    }
    if (a.drinking) a.action = drank ? 'Bebiendo' : 'Buscando la orilla';

    const at = a.terrainCell;
    const heat = Math.abs(temperature - 19) / 19;
    a.hunger = clamp(a.hunger + DT * (species.drain + a.speed * .0010));
    a.thirst = clamp(a.thirst + DT * (.008 + .009 * heat + a.speed * .0010));
    a.energy = clamp(a.energy + DT * ((a.hunger < .74 && a.thirst < .70 ? .043 : .013) -
      a.speed * .0042 - Number(sprint) * .025 - heat * .014));
    if (drank) {
      a.thirst = Math.max(.03, a.thirst - DT * .34);
      a.drinks += DT;
    }
    const free = !a.swimming && !a.drinking && !hunting && !hurt;
    if (hurt && !a.swimming) a.action = 'Herido';
    if (free && !a.species && interact > .55 && map[at + 2] > .14 && a.hunger > .23) {
      const bite = Math.min(DT * .17, map[at + 2]);
      a.hunger = Math.max(.08, a.hunger - bite * 1.65);
      map[at + 2] -= bite;
      a.action = 'Alimentándose';
    }
    if (!a.species && a.hidden && a.fear > .16 && this.time - a.lastShelter > 9) {
      a.lastShelter = this.time;
      a.escapes++;
      this.shelter++;
    }
    if (Math.hypot(a.x - a.resourceX, a.z - a.resourceZ) > 35 && this.time - a.lastMove > 10 &&
        (drank || (!a.swimming && !a.species && map[at + 2] > .67))) {
      a.lastMove = this.time;
      a.resourceX = a.x;
      a.resourceZ = a.z;
      a.moves++;
      this.migrations++;
    }
    const damage = (a.hunger >= .998 ? .052 : 0) + (a.thirst >= .998 ? .075 : 0) +
      map[at + 4] * .23 + (a.age > 150 ? .05 : 0);
    a.health = clamp(a.health + DT * (damage ? -damage : a.energy > .67 ? .009 : 0));
    const index = a.species;
    if (free && breed > .50 && a.age > 12 && a.cooldown <= 0 && a.energy > .49 && a.health > .64 &&
        a.hunger < .62 && a.thirst < .61 && allyD < 9 && ally?.health > .64 && ally.age > 12 &&
        !ally.swimming && !ally.drinking && ally.cooldown <= 0 && ally.hunger < .7 && ally.thirst < .7 && ally.energy > .45 &&
        this.counts[index] < species.max && this.agents.length < CAP) {
      const room = 1 - this.counts[index] / species.max;
      const probability = DT * room * breed * (.30 + Math.min(.85, this.fitness(a) / 90));
      if (this.random() < probability) this.reproduce(a, ally);
    }
  }

  attack(a, victim) {
    const helper = this.time - victim.touched < 5 ? this.byId.get(victim.lastAttacker) : undefined;
    victim.lastAttacker = a.id;
    victim.touched = this.time;
    victim.health -= helper && helper !== a ? .57 : .37;
    a.biteAt = this.time;
    victim.hitAt = this.time;
    victim.fear = Math.max(victim.fear, .88);
    victim.action = 'Herido';
    a.action = 'Cazando';
    if (victim.health > 0) return;
    victim.fallAt = this.time;
    victim.speed = 0;
    this.hunts++;
    a.kills++;
    a.hunger = Math.max(.05, a.hunger - .76);
    a.energy = clamp(a.energy + .22);
    if (helper && helper !== a) {
      helper.assists++;
      helper.hunger = Math.max(.06, helper.hunger - .42);
      this.cooperative++;
      this.emit('Captura cooperativa', 'hunt');
    }
  }

  reproduce(a, ally) {
    const child = this.addAgent(a.species, a, ally);
    this.counts[a.species]++;
    a.cooldown = 17;
    ally.cooldown = 17;
    a.energy -= .19;
    ally.energy -= .16;
    this.births++;
    if (this.births < 4 || this.births % 7 === 0) {
      this.emit(`${SPECIES[a.species].name} #${child.id} nació · G${child.generation}`);
    }
  }

  fitness(a) {
    return a.age * .45 + a.kills * 13 + a.assists * 10 + a.escapes * 5 + a.moves * 4 + a.drinks * .6;
  }

  prune() {
    let alive = 0;
    for (const a of this.agents) {
      if (a.health > 0) {
        this.agents[alive++] = a;
        continue;
      }
      if (a.fallAt > -1) this.fallen.push(a);
      this.counts[a.species]--;
      const archive = this.archive[a.species];
      archive.push({ id: a.id, generation: a.generation, score: this.fitness(a), brain: { genes: a.brain.genes } });
      archive.sort((aRecord, bRecord) => bRecord.score - aRecord.score);
      if (archive.length > 12) archive.length = 12;
      this.byId.delete(a.id);
    }
    this.agents.length = alive;
    if (this.fallen.length > FALLEN_CAP) this.fallen.splice(0, this.fallen.length - FALLEN_CAP);
  }

  maintainTerrain(moisture) {
    const nextFire = [];
    for (let at = 0; at < this.map.length; at += CHANNELS) {
      const map = this.map;
      if (map[at] <= WATER) {
        map[at + 1] = 0;
        map[at + 2] = 0;
        map[at + 4] = 0;
        continue;
      }
      map[at + 3] = clamp(map[at + 3] + moisture + (.29 - map[at + 3]) * .001);
      const fire = map[at + 4];
      if (fire >= .018) {
        map[at + 1] = Math.max(0, map[at + 1] - fire * .19);
        map[at + 2] = Math.max(0, map[at + 2] - fire * .34);
        map[at + 4] = Math.max(0, fire - .037 - map[at + 3] * .04);
        if (fire > .28 && this.random() < .43) {
          const col = at / CHANNELS % GRID;
          const offset = this.random() < .5 ? -1 : 1;
          const horizontal = this.random() < .5;
          if (!horizontal || (col + offset >= 0 && col + offset < GRID)) {
            const next = at + offset * CHANNELS * (horizontal ? 1 : GRID);
            if (next >= 0 && next < map.length && map[next + 1] > .27 && map[next + 3] < .62) nextFire.push(next);
          }
        }
      } else {
        map[at + 2] = clamp(map[at + 2] + (.007 + map[at + 3] * .020) * (1 - map[at + 2]));
      }
    }
    for (const at of nextFire) this.map[at + 4] = Math.max(this.map[at + 4], .36);
    this.edited = true;
  }

  step() {
    this.ticks++;
    this.time = this.ticks * DT;
    this.night = darkness(this.hour);
    const [temperature, visibility, moisture] = this.climate[this.weather];
    this.advancePopulation(temperature, visibility);
    if (this.ticks % 40 === 0) {
      this.maintainTerrain(moisture);
      this.refreshColliders();
      this.record();
    }
    if (this.ticks % 100 === 0) {
      for (const [index, species] of SPECIES.entries()) {
        if (this.counts[index] >= species.min || this.agents.length >= CAP) continue;
        const options = this.archive[index];
        const next = this.addAgent(index, null, null, options[Math.floor(this.random() * Math.min(6, options.length))]);
        this.counts[index]++;
        this.recoveries++;
        this.emit(`Reserva · ${species.name} #${next.id}`, 'reserve');
      }
    }
  }

  advancePopulation(temperature, visibility) {
    this.rebuildIndex();
    this.fallen = this.fallen.filter(a => this.time - a.fallAt < FALL_DURATION);
    this.collisions.rebuild(this.agents, this.fallen);
    const length = this.agents.length;
    for (let i = 0; i < length; i++) {
      const a = this.agents[i];
      if (a.health > 0) this.updateAgent(a, temperature, visibility);
    }
    this.prune();
  }

  inspect(id) {
    const a = this.byId.get(id) ?? this.fallen.find(agent => agent.id === id);
    if (!a) return null;
    const { species, generation, lineage, mutations, age, hunger, thirst, energy, health, fear, action } = a;
    const { kills, assists, moves, escapes, speed } = a;
    return {
      id, species, generation, lineage, mutations, age, hunger, thirst, energy, health: Math.max(0, health), fear,
      action: a.fallAt > -1 ? 'Capturada' : action,
      kills, assists, moves, escapes, speed, fitness: this.fitness(a),
      inputs: Array.from(a.inputs), hidden: Array.from(a.brain.hidden), outputs: Array.from(a.brain.outputs),
      genes: Array.from(a.brain.genes.subarray(0, GENES)),
    };
  }
}

import { DT, rng } from '../sim/config.js';
import { Ecosystem } from '../sim/ecosystem.js';
import { NeuralNetwork, NI, NO } from '../sim/neural.js';
import { tile } from '../sim/terrain.js';

export const SECONDS = 16;
export const FPS = 10;
export const IDS = [1, 2, 3, 4, 5, 6];
export const ROW = 6 + NI + NO;
export const SENSORS = {
  none: { label: 'Red completa', inputs: [] },
  signal: { label: 'Señal de aliados', inputs: [27] },
  allies: { label: 'Posición de aliados', inputs: [6, 7, 8] },
  threat: { label: 'Visión del rival', inputs: [0, 1, 2, 3, 4, 5] },
  cover: { label: 'Percepción de cobertura', inputs: [15, 16, 17] },
};

class ArenaSimulation extends Ecosystem {
  constructor(arena) {
    super(arena.seed, { map: arena.map.slice(), props: [arena.props], population: [0, 0] });
    this.contacts = [];
    this.hits = 0;
  }

  attack(wolf, prey) {
    const previous = this.cooperative;
    super.attack(wolf, prey);
    this.hits++;
    this.contacts.push({ time: this.time, wolf: wolf.id, prey: prey.id, captured: prey.health <= 0, cooperative: this.cooperative > previous });
  }
}

export function playEpisode(arena, genomes, { record = false, disabled = 'none', focus = 5 } = {}) {
  const world = new ArenaSimulation(arena);
  const actors = arena.starts.map(start => {
    const agent = world.addAgent(start.species);
    Object.assign(agent, start, { age: 0, cooldown: Infinity, sizeTrait: 0, coatTrait: 0,
      terrainCell: tile(start.x, start.z), thirst: .13, hunger: .48 });
    agent.brain = new NeuralNetwork(genomes[agent.species]);
    if (agent.id === focus && disabled !== 'none') {
      const suppressed = SENSORS[disabled]?.inputs ?? [];
      agent.brain.run = function (inputs) {
        for (const index of suppressed) inputs[index] = 0;
        return NeuralNetwork.prototype.run.call(this, inputs);
      };
    }
    return agent;
  });
  world.collisions.rebuild([]);
  for (const agent of actors) {
    world.river.sync(agent);
    world.collisions.separate(agent);
    world.collisions.insert(agent);
    world.counts[agent.species]++;
  }
  // Same tie-breaking randomness in every matchup, irrespective of its genomes.
  world.random = rng(arena.seed ^ 0x2b9137e);
  const frames = record ? new Float32Array((SECONDS * FPS + 1) * ROW * actors.length) : null;
  const captures = [], seenShelter = new Set();
  let pressure = 0, timeAlive = 0, safeDistance = 0, signalTicks = 0;
  for (let tick = 0; tick <= SECONDS / DT; tick++) {
    world.time = tick * DT;
    world.ticks = tick;
    if (tick) world.advancePopulation(21, 1);
    const prey = actors.slice(0, 4), wolves = actors.slice(4);
    for (const deer of prey) {
      if (deer.health <= 0) continue;
      const distance = Math.min(...wolves.map(wolf => Math.hypot(wolf.x - deer.x, wolf.z - deer.z)));
      timeAlive += DT;
      safeDistance += Math.min(distance, 29) * DT;
      if (deer.hidden && distance < 19) seenShelter.add(deer.id);
    }
    for (const wolf of wolves) {
      if (wolf.signal > 0) signalTicks++;
      let distance = 46;
      for (const deer of prey) if (deer.health > 0) distance = Math.min(distance, Math.hypot(wolf.x - deer.x, wolf.z - deer.z));
      pressure += Math.max(0, 20 - distance) * DT;
    }
    if (!frames || tick % 2) continue;
    const at = tick / 2 * ROW * actors.length;
    for (const [i, agent] of actors.entries()) {
      const offset = at + i * ROW;
      const flags = Number(agent.hidden) | (Number(agent.signal > 0) << 1) | (Number(world.time - agent.huntStarted < .47) << 2) |
        (Number(agent.swimming) << 3) | (Number(world.time - agent.hitAt < .36) << 4);
      frames.set([agent.x, agent.z, agent.angle, agent.health, flags, agent.speed], offset);
      frames.set(agent.inputs, offset + 6);
      frames.set(agent.brain.outputs, offset + 6 + NI);
    }
  }
  for (const contact of world.contacts) if (contact.captured) captures.push(contact);
  const survivors = world.counts[0];
  const damage = actors.slice(0, 4).reduce((sum, a) => sum + (1 - Math.max(0, a.health)), 0);
  return {
    frames, contacts: world.contacts,
    metrics: { survivors, captures: captures.length, hits: world.hits, cooperative: world.cooperative,
      shelter: seenShelter.size, survival: timeAlive, signals: signalTicks * DT },
    score: [
      survivors * 8 + timeAlive * .29 - damage * 3 + safeDistance * .015 + seenShelter.size * .7,
      captures.length * 12 + world.cooperative * 5 + world.hits * 2.4 + damage * 4 + pressure * .027,
    ],
  };
}

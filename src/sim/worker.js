import { CAP, STRIDE } from './config.js';
import { Ecosystem } from './ecosystem.js';

let sim;
let selected = 0;
let speed = 1;
let since = 0;
let version = 0;
let pool = [];

function send() {
  const buffer = pool.pop() ?? new ArrayBuffer(CAP * STRIDE * Float32Array.BYTES_PER_ELEMENT);
  const agents = new Float32Array(buffer);
  for (const [index, a] of sim.agents.entries()) {
    const at = index * STRIDE;
    agents[at] = a.id;
    agents[at + 1] = a.species;
    agents[at + 2] = a.x;
    agents[at + 3] = a.z;
    agents[at + 4] = a.angle;
    agents[at + 5] = a.speed;
    agents[at + 6] = Number(a.hidden);
    agents[at + 7] = a.generation;
    agents[at + 8] = a.gait;
    agents[at + 9] = a.coatTrait;
    agents[at + 10] = a.sizeTrait;
    agents[at + 11] = Math.min(1, Math.max(0, (a.attackCD - .40) * 3.2));
    agents[at + 12] = a.fear;
    agents[at + 13] = a.signal;
    agents[at + 14] = a.action === 'Alimentándose' ? 1 : a.action === 'Bebiendo' ? .91 : 0;
  }
  const transfer = [buffer];
  const terrain = sim.edited ? sim.map.slice() : undefined;
  if (terrain) transfer.push(terrain.buffer);
  sim.edited = false;
  const { time, counts, generation, births, mutations, recoveries, hunts, cooperative, shelter, migrations, weather, events, history } = sim;
  postMessage({
    type: 'snapshot', version, agents, length: sim.agents.length, terrain, selected: sim.inspect(selected),
    stats: { time, counts, generation, births, mutations, recoveries, hunts, cooperative, shelter, migrations, weather, events, history },
  }, transfer);
}

self.onmessage = ({ data }) => {
  if (data.type === 'init') {
    sim = new Ecosystem(data.seed);
    selected = 0;
    since = 0;
    version = data.version;
    send();
    return;
  }
  if (data.type === 'recycle') {
    if (pool.length < 4) pool.push(data.buffer);
    return;
  }
  if (!sim) return;
  if (data.type === 'inspect') {
    selected = data.id;
    send();
  }
  if (data.type === 'speed') speed = data.speed;
  if (data.type === 'weather' && Object.hasOwn(sim.climate, data.weather)) {
    sim.weather = data.weather;
    send();
  }
  if (data.type === 'brush') {
    sim.edit(data.mode, data.x, data.z, data.radius);
    send();
  }
};

setInterval(() => {
  if (!sim || speed === 0) return;
  for (let i = 0; i < speed; i++) sim.step();
  since++;
  if (since % 2 === 0) send();
}, 50);

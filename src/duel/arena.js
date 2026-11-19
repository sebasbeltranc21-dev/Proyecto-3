import { CHANNELS, GRID, HALF, STEP, WATER, clamp, rng } from '../sim/config.js';
import { ground } from '../sim/terrain.js';

export const ARENAS = [
  { name: 'Corredor del río', seed: 74013 },
  { name: 'Bosque partido', seed: 88329 },
  { name: 'Paso de roca', seed: 118901 },
];

export const BOUNDS = 43;
export const SIDE = 22;

// The tactical view and simulation read the same terrain and solid props.
export function makeArena(seed) {
  const random = rng(seed);
  const quarter = Math.floor(random() * 4);
  const [cos, sin] = [[1, 0], [0, 1], [-1, 0], [0, -1]][quarter];
  const side = random() < .5 ? -1 : 1;
  const rotate = (x, z) => [x * cos - z * sin, x * sin + z * cos];
  const offset = random() * 6 - 3;
  const phase = random() * Math.PI * 2;
  const bend = 3.5 + random() * 4;
  const forests = [
    [-12 + offset, 11, 9 + random() * 6], [16, 13 + offset, 10 + random() * 7],
    [14, -13 + offset, 9 + random() * 5],
  ];
  const map = new Float32Array(GRID * GRID * CHANNELS);
  const colors = new Float32Array(SIDE * SIDE * 2);
  for (let row = 0; row < GRID; row++) {
    const z = (row + .5) * STEP - HALF;
    for (let col = 0; col < GRID; col++) {
      const x = (col + .5) * STEP - HALF;
      const [a, b] = [x * cos + z * sin, -x * sin + z * cos];
      const river = Math.abs(a - side * (25 + bend * Math.sin(b * .097 + phase)));
      const canopy = Math.max(...forests.map(([cx, cz, radius]) => 1 - Math.hypot(a - cx, b - cz) / radius));
      const at = (row * GRID + col) * CHANNELS;
      const rim = Math.max(Math.abs(x), Math.abs(z));
      map[at] = rim > BOUNDS + 4 ? 31 : -3.4 + clamp((river - 1.2) / 4) * (4.8 + .5 * Math.sin(a * .09 + b * .05));
      map[at + 1] = map[at] >= WATER ? clamp(.20 + canopy * 1.34) : 0;
      map[at + 2] = map[at] >= WATER ? .46 : 0;
      map[at + 3] = .42;
    }
  }
  const props = [], visible = [];
  const add = (x, z, radius, rock, show) => {
    const h = ground(map, x, z);
    const prop = { x, z, radius, rock, top: h + (rock ? 1.5 : 5) };
    props.push(prop);
    if (show) visible.push(prop);
  };
  for (let p = -BOUNDS; p <= BOUNDS; p += 3.5) {
    for (const [x, z] of [[-BOUNDS, p], [BOUNDS, p], [p, -BOUNDS], [p, BOUNDS]]) add(x, z, 2.4, true, false);
  }
  for (let i = 0; i < 46; i++) {
    const [x, z] = rotate((random() - .5) * 69, (random() - .5) * 69);
    const index = (Math.floor((z + HALF) / STEP) * GRID + Math.floor((x + HALF) / STEP)) * CHANNELS;
    if (map[index] < WATER || props.some(p => Math.hypot(p.x - x, p.z - z) < 2.4)) continue;
    const rock = i % 4 === 0;
    if (rock || map[index + 1] > .53) add(x, z, rock ? 1 + random() * 1.1 : .62, rock, true);
  }
  const starts = [[-6, -2], [0, 1.5], [6, -2], [10, 2], [-4, -15], [5, -17]].map(([x, z], i) => {
    const species = Number(i >= 4);
    const [px, pz] = rotate(x + (random() - .5) * 2.2 + offset, z + (random() - .5) * 3);
    return { species, x: px, z: pz, angle: -quarter * Math.PI / 2 + (species ? 0 : (i < 2 ? 1 : -1) * 1.6) + (random() - .5) * .8 };
  });
  for (let i = 0; i < colors.length / 2; i++) {
    const x = (i % SIDE + .5) * BOUNDS * 2 / SIDE - BOUNDS;
    const z = (Math.floor(i / SIDE) + .5) * BOUNDS * 2 / SIDE - BOUNDS;
    const at = (Math.floor((z + HALF) / STEP) * GRID + Math.floor((x + HALF) / STEP)) * CHANNELS;
    colors[i * 2] = ground(map, x, z);
    colors[i * 2 + 1] = map[at + 1];
  }
  return { seed, map, props, starts, visual: { colors, props: visible } };
}

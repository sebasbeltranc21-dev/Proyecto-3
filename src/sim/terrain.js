import { CHANNELS, GRID, HALF, STEP, WATER, clamp, rng } from './config.js';

const smooth = (a, b, value) => {
  const fraction = clamp((value - a) / (b - a));
  return fraction * fraction * (3 - 2 * fraction);
};

export function riverX(z) {
  return 13 * Math.sin(z * .026 + .85) + 12 * Math.sin(z * .012) - 6;
}

export const tile = (x, z) => (
  clamp(Math.floor((z + HALF) / STEP), 0, GRID - 1) * GRID + clamp(Math.floor((x + HALF) / STEP), 0, GRID - 1)
) * CHANNELS;

export function ground(data, x, z) {
  const px = clamp((x + HALF) / STEP - .5, 0, GRID - 1.001);
  const pz = clamp((z + HALF) / STEP - .5, 0, GRID - 1.001);
  const ix = Math.floor(px);
  const iz = Math.floor(pz);
  const tx = px - ix;
  const tz = pz - iz;
  const a = (iz * GRID + ix) * CHANNELS;
  const b = a + GRID * CHANNELS;
  return (data[a] * (1 - tx) + data[a + CHANNELS] * tx) * (1 - tz) +
    (data[b] * (1 - tx) + data[b + CHANNELS] * tx) * tz;
}

export function createTerrain(seed) {
  const random = rng(seed ^ 0x7182afe);
  const phase = random() * 3;
  const data = new Float32Array(GRID * GRID * CHANNELS);
  for (let iz = 0; iz < GRID; iz++) {
    for (let ix = 0; ix < GRID; ix++) {
      const x = (ix + .5) * STEP - HALF;
      const z = (iz + .5) * STEP - HALF;
      const riverDistance = Math.abs(x - riverX(z));
      const riverWidth = 8 + 2.7 * Math.sin(.036 * z + phase) + 9 * Math.exp(-(((z + 42) / 27) ** 2));
      const valley = smooth(riverWidth * .67, riverWidth + 12, riverDistance);
      const edge = smooth(57, 161, Math.abs(x));
      const back = smooth(60, 168, -z);
      const relief = 3.4 + 2.3 * Math.sin(x * .043 + z * .031) + 1.4 * Math.sin(z * .082) +
        edge * (20 + 9 * Math.sin(z * .051 + x * .039) + 6 * Math.cos(z * .100 - x * .076)) +
        back * smooth(18, 84, riverDistance) * (22 + 8 * Math.sin(x * .066));
      const height = -5.4 + valley * (relief + 5.4) + .52 * Math.sin(x * .154) * Math.sin(z * .157);
      const canopy = .48 + .23 * Math.sin(x * .074 + .4) + .24 * Math.cos(z * .057 + x * .056) +
        .12 * Math.sin((x + z) * .11);
      const index = (iz * GRID + ix) * CHANNELS;
      const moisture = clamp(1.26 - riverDistance / 55, .1, 1);
      data[index] = height;
      data[index + 1] = height > WATER + 1.55 ? clamp(canopy + edge * .27 - .13 + (random() - .5) * .25) : 0;
      data[index + 2] = height > WATER ? clamp(.35 + moisture * .46 - data[index + 1] * .25 + random() * .16) : 0;
      data[index + 3] = moisture;
    }
  }
  return data;
}

export function brush(data, mode, x, z, radius) {
  const startX = clamp(Math.floor((x - radius + HALF) / STEP), 0, GRID - 1);
  const endX = clamp(Math.floor((x + radius + HALF) / STEP), 0, GRID - 1);
  const startZ = clamp(Math.floor((z - radius + HALF) / STEP), 0, GRID - 1);
  const endZ = clamp(Math.floor((z + radius + HALF) / STEP), 0, GRID - 1);
  for (let iz = startZ; iz <= endZ; iz++) {
    for (let ix = startX; ix <= endX; ix++) {
      const distance = Math.hypot((ix + .5) * STEP - HALF - x, (iz + .5) * STEP - HALF - z);
      const force = (1 - smooth(0, radius, distance));
      if (force <= 0) continue;
      const index = (iz * GRID + ix) * CHANNELS;
      if (mode === 'raise') data[index] = Math.min(43, data[index] + 9 * force);
      if (mode === 'lower') data[index] = Math.max(-9, data[index] - 9 * force);
      if (mode === 'forest' && data[index] > WATER) data[index + 1] = clamp(data[index + 1] + .62 * force);
      if (mode === 'meadow' && data[index] > WATER) {
        data[index + 1] *= 1 - .84 * force;
        data[index + 2] = clamp(data[index + 2] + .85 * force);
        data[index + 4] *= 1 - force;
      }
      if (mode === 'fire' && data[index] > WATER) data[index + 4] = Math.max(data[index + 4], force);
      if (mode === 'dry') {
        data[index + 3] *= 1 - .94 * force;
        data[index + 2] *= 1 - .8 * force;
      }
      if (mode === 'river') {
        data[index] += (-5.7 - data[index]) * force;
        data[index + 3] = Math.max(data[index + 3], force);
      }
    }
  }
}

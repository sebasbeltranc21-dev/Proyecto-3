import { HALF, WATER, rng } from './config.js';
import { ground, tile } from './terrain.js';

const random = rng(185513);
export const propChunks = Array.from({ length: 25 }, (_, i) => {
  const centerX = (i % 5 + .5) * 64 - HALF, centerZ = (Math.floor(i / 5) + .5) * 64 - HALF;
  const candidates = Array.from({ length: 640 }, () => ({
    x: centerX + (random() - .5) * 64, z: centerZ + (random() - .5) * 64,
    density: random(), scale: random(), angle: random() * Math.PI * 2,
  }));
  return { centerX, centerZ, candidates };
});

// Placement and dimensions of solid props are shared by Three.js and the worker.
export function solidProps(map, chunk) {
  const props = [];
  let rocks = 0;
  for (let index = 0; index < 130; index++) {
    const { x, z, density, scale, angle } = chunk.candidates[index];
    const y = ground(map, x, z);
    const at = tile(x, z);
    const depth = WATER - y;
    const addRock = (sx, sy, sz, rx, rz, bank) => {
      props.push({ x, y: y + (bank ? .07 : 0), z, sx, sy, sz, angle, rx, rz, scale, density, at, bank,
        radius: Math.max(sx, sz) * 1.12, top: y + sy * .96, rock: true });
      rocks++;
    };
    if (index < 100 && depth >= -.26 && depth < 2.25 && density < .63 && rocks < 52) {
      addRock(.66 + scale * 1.72, .26 + scale * 1.50, .54 + scale * 1.90, .13 + density * .22, .19, true);
    }
    if (y < WATER + .28) continue;
    const canopy = map[at + 1], burning = map[at + 4];
    if (density < canopy * .84 && y > .35 && burning < .36) {
      const sy = .57 + 1.19 * scale;
      const sx = .76 + sy * .24;
      props.push({ x, y, z, sx, sy, sz: sx, angle, scale, density, at, rock: false,
        radius: sx * (.34 + Math.max(0, 1.1 - sy) * .29), top: y + sy * 6 });
    }
    if (index < 28 && density < .24 && (y > 9 || y < 1.8) && rocks < 52) {
      addRock(.8 + scale * 2.3, .58 + scale * 1.64, .8 + scale * 1.7, scale * .63, .35, false);
    }
  }
  return props;
}

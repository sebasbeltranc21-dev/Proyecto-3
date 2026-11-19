import { HALF, WATER, clamp } from './config.js';
import { ground, tile } from './terrain.js';
import { propChunks, solidProps } from './props.js';

const WIDTH = 5;
const COUNT = HALF * 2 / WIDTH;
const EDGE = HALF - 3;
const grid = a => clamp(Math.floor((a + HALF) / WIDTH), 0, COUNT - 1);
const key = (x, z) => grid(x) + grid(z) * COUNT;

function pointDistance(x, z, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const along = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1));
  return (x - ax - dx * along) ** 2 + (z - az - dz * along) ** 2;
}

function segmentDistance(a, b) {
  const ux = a.bx - a.ax, uz = a.bz - a.az, vx = b.bx - b.ax, vz = b.bz - b.az;
  const dx = b.ax - a.ax, dz = b.az - a.az;
  const cross = ux * vz - uz * vx;
  if (Math.abs(cross) > 1e-8) {
    const t = (dx * vz - dz * vx) / cross, s = (dx * uz - dz * ux) / cross;
    if (t >= 0 && t <= 1 && s >= 0 && s <= 1) return 0;
  }
  return Math.min(
    pointDistance(a.ax, a.az, b.ax, b.az, b.bx, b.bz),
    pointDistance(a.bx, a.bz, b.ax, b.az, b.bx, b.bz),
    pointDistance(b.ax, b.az, a.ax, a.az, a.bx, a.bz),
    pointDistance(b.bx, b.bz, a.ax, a.az, a.bx, a.bz),
  );
}

function capsule(a, x, z, angle, shape) {
  const size = 1 + (a.sizeTrait ?? 0) * .13;
  const sx = Math.sin(angle) * size, sz = Math.cos(angle) * size;
  const back = a.species ? .68 : .72, front = a.species ? .96 : .78;
  shape.ax = x - sx * back;
  shape.az = z - sz * back;
  shape.bx = x + sx * front;
  shape.bz = z + sz * front;
  shape.radius = (a.species ? .39 : .44) * size;
  return shape;
}

export class CollisionIndex {
  constructor() {
    this.props = new Map();
    this.animals = new Map();
    this.probe = {};
  }

  setMap(map, propGroups) {
    this.map = map;
    this.props.clear();
    const groups = propGroups ?? propChunks.map(chunk => solidProps(map, chunk));
    for (const group of groups) {
      for (const prop of group) {
        const bucket = key(prop.x, prop.z);
        if (!this.props.has(bucket)) this.props.set(bucket, []);
        this.props.get(bucket).push(prop);
      }
    }
  }

  rebuild(animals, fallen = []) {
    this.animals.clear();
    for (const a of animals) if (a.health === undefined || a.health > 0) this.insert(a);
    for (const a of fallen) this.insert(a);
  }

  insert(a) {
    const bucket = key(a.x, a.z);
    if (!this.animals.has(bucket)) this.animals.set(bucket, new Set());
    const entries = this.animals.get(bucket);
    entries.add(a);
    a.collisionBucket = entries;
    capsule(a, a.x, a.z, a.angle, a.collider ??= {});
  }

  move(a) {
    a.collisionBucket?.delete(a);
    this.insert(a);
  }

  hitsProp(shape, minTop = -Infinity) {
    const margin = shape.radius + 3.55;
    const endX = grid(Math.max(shape.ax, shape.bx) + margin);
    const endZ = grid(Math.max(shape.az, shape.bz) + margin);
    for (let iz = grid(Math.min(shape.az, shape.bz) - margin); iz <= endZ; iz++) {
      for (let ix = grid(Math.min(shape.ax, shape.bx) - margin); ix <= endX; ix++) {
        const bucket = this.props.get(ix + iz * COUNT);
        if (!bucket) continue;
        for (const p of bucket) {
          if (p.top < minTop) continue;
          const limit = shape.radius + p.radius;
          if (pointDistance(p.x, p.z, shape.ax, shape.az, shape.bx, shape.bz) < limit * limit) return true;
        }
      }
    }
    return false;
  }

  clearLine(x, z, vx, vz) {
    return !this.hitsProp({ ax: x, az: z, bx: vx, bz: vz, radius: .11 }, WATER - .32);
  }

  canPlace(a, x, z, angle) {
    const shape = capsule(a, x, z, angle, this.probe);
    const float = a.swimming && this.map && ground(this.map, x, z) < WATER + .035;
    if (this.hitsProp(shape, float ? WATER - .42 : -Infinity)) return false;

    const margin = 2.1;
    const endX = grid(Math.max(shape.ax, shape.bx) + margin);
    const endZ = grid(Math.max(shape.az, shape.bz) + margin);
    for (let iz = grid(Math.min(shape.az, shape.bz) - margin); iz <= endZ; iz++) {
      for (let ix = grid(Math.min(shape.ax, shape.bx) - margin); ix <= endX; ix++) {
        const bucket = this.animals.get(ix + iz * COUNT);
        if (!bucket) continue;
        for (const b of bucket) {
          if (a.id === b.id) continue;
          const safe = shape.radius + b.collider.radius;
          if (segmentDistance(shape, b.collider) < safe * safe) return false;
        }
      }
    }
    return true;
  }

  canMove(a, x, z, angle) {
    const dx = x - a.x, dz = z - a.z;
    const turn = Math.atan2(Math.sin(angle - a.angle), Math.cos(angle - a.angle));
    const steps = Math.max(1, Math.ceil(Math.max(Math.hypot(dx, dz), Math.abs(turn)) / .26));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      if (!this.canPlace(a, a.x + dx * t, a.z + dz * t, a.angle + turn * t)) return false;
    }
    return true;
  }

  separate(a) {
    if (this.canPlace(a, a.x, a.z, a.angle)) return false;
    const minimum = a.swimming ? -Infinity : WATER - .25;
    for (let distance = .65; distance <= 20; distance += .65) {
      const samples = Math.max(12, Math.ceil(distance * 4));
      for (let i = 0; i < samples; i++) {
        const angle = (i / samples + (a.id * .618 % 1)) * 2 * Math.PI;
        const x = a.x + Math.sin(angle) * distance, z = a.z + Math.cos(angle) * distance;
        if (Math.abs(x) > EDGE || Math.abs(z) > EDGE || ground(this.map, x, z) < minimum ||
            !this.canPlace(a, x, z, a.angle)) continue;
        a.x = x;
        a.z = z;
        a.terrainCell = tile(x, z);
        return true;
      }
    }
    return false;
  }
}

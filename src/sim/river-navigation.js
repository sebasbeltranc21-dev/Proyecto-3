import { DT, GRID, HALF, STEP, WATER, clamp } from './config.js';
import { ground, tile } from './terrain.js';

export const EDGE = HALF - 3;
export const WADE_HEIGHT = WATER - .25;
export const DRINK_HEIGHT = WATER - .10;
const EXIT_HEIGHT = WATER + .035;
const REACH = 1.35;
const PROBES = [.38, -.38, .72, -.72, 1.14, -1.14, 1.60, -1.60, 2.28, -2.28];
const ANGLE = Math.PI / 4;
const DIRECTIONS = Array.from({ length: 8 }, (_, index) => [
  Math.sin(index * ANGLE), Math.cos(index * ANGLE),
]);
const angleDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

function turnToward(a, heading, limit) {
  a.angle += clamp(angleDiff(heading, a.angle), -limit, limit);
}

function upright(map, collisions, a, yaw, length, minHeight) {
  const dx = Math.sin(yaw) * length;
  const dz = Math.cos(yaw) * length;
  const x = a.x + dx, z = a.z + dz;
  if (Math.abs(x) > EDGE || Math.abs(z) > EDGE) return false;
  const height = ground(map, x, z);
  return height >= minHeight &&
    ground(map, a.x + dx / 3, a.z + dz / 3) >= minHeight &&
    ground(map, a.x + dx * 2 / 3, a.z + dz * 2 / 3) >= minHeight &&
    Math.abs(map[tile(x, z)] - map[a.terrainCell]) < 11 &&
    (!collisions || collisions.canMove(a, x, z, yaw));
}

function bankDirection(map, a, height, range) {
  if (height < DRINK_HEIGHT || height > WATER + 1.95) return null;
  for (const distance of [.56, .96, REACH, 2.04, 2.76]) {
    if (distance > range) break;
    let best = null;
    let lowest = WATER + .018;
    for (const [sx, sz] of DIRECTIONS) {
      const x = a.x + sx * distance, z = a.z + sz * distance;
      if (Math.abs(x) > EDGE || Math.abs(z) > EDGE) continue;
      const sampled = ground(map, x, z);
      if (sampled >= lowest) continue;
      lowest = sampled;
      best = { heading: Math.atan2(sx, sz), distance };
    }
    if (best) return best;
  }
  return null;
}

export function onWaterSurface(height, swimming = false) {
  return swimming || height < WADE_HEIGHT ? WATER : height;
}

export class RiverNavigation {
  constructor(map, collisions) {
    this.map = map;
    this.collisions = collisions;
    this.revision = 0;
    this.dry = null;
    this.exits = new Map();
  }

  invalidate() {
    this.revision++;
    this.dry = null;
    this.exits.clear();
  }

  nearestExit(x, z) {
    if (!this.dry) {
      this.dry = [];
      for (let row = 0; row < GRID; row++) {
        for (let col = 0; col < GRID; col++) {
          const sx = (col + .5) * STEP - HALF;
          const sz = (row + .5) * STEP - HALF;
          if (Math.abs(sx) <= EDGE && Math.abs(sz) <= EDGE && ground(this.map, sx, sz) >= EXIT_HEIGHT) {
            this.dry.push({ x: sx, z: sz });
          }
        }
      }
    }
    // Cache by metre inside the 4 m height grid, then lock a target for the whole swim.
    const key = (Math.floor(x) + HALF) + (Math.floor(z) + HALF) * HALF * 2;
    if (this.exits.has(key)) return this.exits.get(key);
    let nearest = null;
    let closest = Infinity;
    for (const p of this.dry) {
      const distance = (x - p.x) ** 2 + (z - p.z) ** 2;
      if (distance < closest) {
        closest = distance;
        nearest = p;
      }
    }
    this.exits.set(key, nearest);
    return nearest;
  }

  sync(a) {
    const height = ground(this.map, a.x, a.z);
    a.swimming = height < (a.swimming ? EXIT_HEIGHT : WADE_HEIGHT);
    if (a.swimming) {
      a.drinking = false;
      a.hidden = false;
      a.action = 'Nadando';
    } else {
      a.swimTarget = null;
      if (height < DRINK_HEIGHT) a.drinking = false;
    }
    return height;
  }

  swim(a) {
    if (!a.swimTarget || a.swimRevision !== this.revision) {
      a.swimTarget = this.nearestExit(a.x, a.z);
      a.swimRevision = this.revision;
    }
    const goal = a.swimTarget;
    if (!goal) { a.speed = 0; return; }
    const dx = goal.x - a.x, dz = goal.z - a.z;
    const distance = Math.hypot(dx, dz);
    const target = Math.atan2(dx, dz);
    const length = Math.min(distance, DT * (1.62 + .67 * a.energy));
    let moved = false;
    for (const offset of [0, ...PROBES]) {
      const heading = target + offset * (a.shoreSide ?? 1);
      const angle = a.angle + clamp(angleDiff(heading, a.angle), -DT * 6.5, DT * 6.5);
      const x = a.x + Math.sin(heading) * length, z = a.z + Math.cos(heading) * length;
      if (Math.abs(x) > EDGE || Math.abs(z) > EDGE || this.collisions && !this.collisions.canMove(a, x, z, angle)) continue;
      a.x = x;
      a.z = z;
      a.angle = angle;
      if (offset) a.shoreSide = Math.sign(offset) * (a.shoreSide ?? 1);
      moved = true;
      break;
    }
    a.speed = moved ? length / DT : 0;
    a.terrainCell = tile(a.x, a.z);
    this.sync(a);
    if (!a.swimming) a.action = 'Saliendo del agua';
  }

  step(a, desired, random) {
    const height = this.sync(a);
    if (a.swimming) { this.swim(a); return false; }
    const { map, collisions } = this;
    const originalAngle = a.angle;
    const thirsty = a.thirst > (a.drinking ? .115 : .245) && a.fear < .86;
    const bank = thirsty ? bankDirection(map, a, height, a.thirst > .48 ? 2.76 : REACH) : null;
    if (bank && bank.distance <= REACH && height <= WATER + .83) {
      turnToward(a, bank.heading, DT * 4.5);
      const angle = a.angle;
      a.angle = originalAngle;
      if (!collisions || collisions.canMove(a, a.x, a.z, angle)) a.angle = angle;
      a.speed = 0;
      a.drinking = true;
      return Math.abs(angleDiff(bank.heading, a.angle)) < .52;
    }
    a.drinking = false;
    if (bank) {
      desired = a.angle + clamp(angleDiff(bank.heading, a.angle), -.19, .19);
      a.speed = Math.min(a.speed, 1.8);
    }

    const length = a.speed * DT;
    if (!length) {
      if (!collisions || collisions.canMove(a, a.x, a.z, desired)) a.angle = desired;
      return false;
    }
    const minHeight = bank ? DRINK_HEIGHT : WADE_HEIGHT;
    const wantedX = a.x + Math.sin(desired) * length;
    const wantedZ = a.z + Math.cos(desired) * length;
    if (Math.abs(wantedX) > EDGE || Math.abs(wantedZ) > EDGE) {
      turnToward(a, Math.atan2(-a.x, -a.z) + (random() - .5) * .8, DT * 6.3);
      const reflected = a.angle;
      a.angle = originalAngle;
      if (!collisions || collisions.canMove(a, a.x, a.z, reflected)) a.angle = reflected;
      a.speed = 0;
      return false;
    }
    // Anticipate the shoreline and favour the first safe heading on either side.
    const look = Math.max(length, bank ? length : .92);
    const canMove = upright(map, collisions, a, desired, length, minHeight);
    let heading = desired;
    if (!upright(map, collisions, a, desired, look, minHeight)) {
      const side = a.shoreSide ?? (a.id % 2 ? 1 : -1);
      let found = false;
      for (const offset of PROBES) {
        if (!upright(map, collisions, a, desired + offset * side, look, minHeight)) continue;
        heading = desired + offset * side;
        a.shoreSide = Math.sign(offset) * side;
        found = true;
        break;
      }
      if (!found && !canMove) heading = desired + side * 1.65;
      turnToward(a, heading, DT * (canMove ? 3.85 : 6.3));
    } else {
      a.angle = desired;
      a.shoreSide = null;
    }
    const turned = a.angle;
    a.angle = originalAngle;
    if (length > 0 && upright(map, collisions, a, turned, length, minHeight)) {
      a.angle = turned;
      a.x += Math.sin(a.angle) * length;
      a.z += Math.cos(a.angle) * length;
      a.terrainCell = tile(a.x, a.z);
    } else {
      if (!collisions || collisions.canMove(a, a.x, a.z, turned)) a.angle = turned;
      a.speed = 0;
      // Close objects can block a turn in place. Take a short sideways step to make room.
      if (collisions && length > 0 && !canMove) {
        for (const offset of PROBES) {
          const heading = originalAngle + offset;
          const stride = length * .66;
          const x = a.x + Math.sin(heading) * stride, z = a.z + Math.cos(heading) * stride;
          if (Math.abs(x) > EDGE || Math.abs(z) > EDGE || ground(map, x, z) < minHeight ||
              Math.abs(map[tile(x, z)] - map[a.terrainCell]) >= 11 || !collisions.canMove(a, x, z, a.angle)) continue;
          a.x = x;
          a.z = z;
          a.speed = stride / DT;
          a.terrainCell = tile(x, z);
          break;
        }
      }
    }
    return false;
  }
}

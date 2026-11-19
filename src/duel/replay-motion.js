import { clamp } from '../sim/config.js';
import { FALL_DURATION, HUNT_DURATION } from '../sim/hunt.js';
import { onWaterSurface } from '../sim/river-navigation.js';
import { ground } from '../sim/terrain.js';
import { advanceLocomotion, newLocomotion } from '../view/locomotion.js';
import { FPS, IDS, MOTION, ROW } from './episode.js';

const DT = 1 / FPS;
const TAU = 2 * Math.PI;
const blend = (a, b, t) => a + (b - a) * t;
const turn = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
const age = (time, value) => value < 0 ? -1 : Math.max(0, time - value);

export class ReplayMotion {
  constructor(result, map) {
    const data = result.frames;
    this.map = map;
    this.count = data.length / (ROW * IDS.length);
    this.tracks = IDS.map((id, index) => {
      const pose = newLocomotion(id);
      const actor = { id, species: Number(id >= 5), pose, sizeTrait: 0, coatTrait: 0 };
      const frames = [];
      for (let frame = 0; frame < this.count; frame++) {
        const at = (frame * IDS.length + index) * ROW;
        const time = frame * DT;
        const x = data[at], z = data[at + 1], angle = data[at + 2], health = data[at + 3], flags = data[at + 4];
        const huntStarted = data[at + MOTION];
        const huntAge = age(time, huntStarted);
        const biteAge = age(time, data[at + MOTION + 1]);
        const previous = frames.at(-1);
        Object.assign(actor, {
          x, z, angle, hidden: Boolean(flags & 1), swimming: Boolean(flags & 8),
          distance: previous ? Math.hypot(x - previous.x, z - previous.z) : 0,
          turnRate: previous ? turn(previous.angle, angle) / DT : 0,
          gait: data[at + MOTION - 4], fear: data[at + MOTION + 4], signaling: data[at + MOTION + 5],
          feeding: data[at + MOTION + 6], attacking: biteAge < 0 ? 0 : clamp(1 - biteAge * 6),
          huntStarted, huntAge: huntAge < HUNT_DURATION ? huntAge : -1,
          hurtAge: age(time, data[at + MOTION + 2]), fallAge: age(time, data[at + MOTION + 3]),
        });
        advanceLocomotion(actor, DT, map);
        frames.push({ x, z, angle, health, swimming: actor.swimming, fallAge: actor.fallAge, pose: { ...pose } });
      }
      return { actor, frames };
    });
  }

  sample(time) {
    const cursor = clamp(time * FPS, 0, this.count - 1);
    const frame = Math.floor(cursor + 1e-7), t = Math.max(0, cursor - frame);
    return this.tracks.map(({ actor, frames }) => {
      const a = frames[frame], b = frames[Math.min(frame + 1, frames.length - 1)];
      actor.x = blend(a.x, b.x, t);
      actor.z = blend(a.z, b.z, t);
      actor.angle = a.angle + turn(a.angle, b.angle) * t;
      actor.swimming = a.swimming;
      actor.y = onWaterSurface(ground(this.map, actor.x, actor.z), a.swimming);
      actor.health = a.health;
      actor.visible = a.health > 0 || (a.fallAge >= 0 && a.fallAge + t * DT < FALL_DURATION);
      for (const key in actor.pose) actor.pose[key] = blend(a.pose[key], b.pose[key], t);
      const phaseDelta = (b.pose.phase - a.pose.phase + TAU) % TAU;
      actor.pose.phase = (a.pose.phase + phaseDelta * t) % TAU;
      return actor;
    });
  }
}

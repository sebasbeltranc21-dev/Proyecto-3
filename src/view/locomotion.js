import { Matrix4, Quaternion, Vector3 } from 'three';
import { clamp } from '../sim/config.js';
import { ground } from '../sim/terrain.js';

const TAU = 2 * Math.PI;
const balance = new Matrix4();
const up = new Vector3(), right = new Vector3(), forward = new Vector3();
const bank = new Quaternion();
const zAxis = new Vector3(0, 0, 1);

function smooth(start, end, value) {
  const t = clamp((value - start) / (end - start));
  return t * t * (3 - 2 * t);
}

export function newLocomotion(id) {
  return {
    pace: 0, stride: 0, trot: 0, run: 0, crouch: 0, alert: 0, graze: 0, attack: 0,
    phase: (id * .397) % TAU, bank: 0, hop: 0, hopAge: 1, previousFear: 0,
    sx: 0, sz: 0, swim: 0,
  };
}

// Poses derive from interpolated positions and read-only simulation telemetry.
export function advanceLocomotion(a, dt, map) {
  const p = a.pose;
  if (dt <= 0) return p;
  const blend = 1 - Math.exp(-dt * 7);
  const actual = Math.min(a.distance / dt, 12);
  p.pace += (actual - p.pace) * blend;
  const speed = p.pace;
  p.swim += (Number(Boolean(a.swimming)) - p.swim) * blend;
  const motion = smooth(.11, .90, speed);
  const upper = smooth(3.95, 6.9, speed + smooth(.66, .92, a.gait) * .60);
  const middle = smooth(1.72, 4.05, speed);
  p.stride += (motion * (.58 + .42 * smooth(1, 5.3, speed)) - p.stride) * blend;
  p.run += (upper - p.run) * blend;
  p.trot += (middle * (1 - upper) - p.trot) * blend;
  p.crouch += ((a.hidden ? .91 : a.gait < .27 && actual > .16 ? .28 : 0) - p.crouch) * blend;
  const alert = smooth(.54, .91, a.signaling) * (1 - p.crouch * .65);
  p.alert += (alert - p.alert) * blend;
  p.graze += (a.feeding * (1 - p.run * .81) - p.graze) * (1 - Math.exp(-dt * 5));
  p.attack += (a.attacking - p.attack) * (1 - Math.exp(-dt * (a.attacking > p.attack ? 15 : 8)));
  const fear = a.fear;
  p.hopAge += dt;
  if (!a.swimming && fear > .42 && fear > p.previousFear + .055 && p.hopAge > .85 && !a.hidden) p.hopAge = 0;
  p.previousFear += (fear - p.previousFear) * (1 - Math.exp(-dt * 5.4));
  const air = clamp(p.hopAge / .46);
  p.hop = (air < 1 ? Math.sin(air * Math.PI) : 0) * (.13 + fear * .21);
  p.bank += (clamp(-a.turnRate * .115, -.25, .25) * motion - p.bank) * blend;

  // One full stride per distance travelled. Stride length changes across gaits.
  const length = .99 + .63 * p.trot + 1.14 * p.run;
  const travelled = Math.min(a.distance, dt * 11.5);
  p.phase = (p.phase + (travelled / length + dt * p.swim * .96) * TAU) % TAU;
  const slopeX = (ground(map, a.x + 1, a.z) - ground(map, a.x - 1, a.z)) * .5;
  const slopeZ = (ground(map, a.x, a.z + 1) - ground(map, a.x, a.z - 1)) * .5;
  const tilt = 1 - Math.exp(-dt * 8);
  p.sx += (clamp(slopeX, -.59, .59) - p.sx) * tilt;
  p.sz += (clamp(slopeZ, -.59, .59) - p.sz) * tilt;
  return p;
}

export function orientLocomotion(object, a, p) {
  up.set(-p.sx * (1 - p.swim), 1, -p.sz * (1 - p.swim)).normalize();
  forward.set(Math.sin(a.angle), 0, Math.cos(a.angle));
  right.crossVectors(up, forward).normalize();
  forward.crossVectors(right, up).normalize();
  balance.makeBasis(right, up, forward);
  bank.setFromAxisAngle(zAxis, p.bank * (1 - p.swim * .90));
  object.quaternion.setFromRotationMatrix(balance).multiply(bank);
  const buoyancy = a.swimming ? -.58 + .035 * Math.sin(p.phase) : 0;
  object.position.set(a.x, a.y + .025 + buoyancy + p.hop * (a.swimming ? 0 : 1), a.z);
}

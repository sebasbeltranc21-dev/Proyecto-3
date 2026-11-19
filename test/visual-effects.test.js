import assert from 'node:assert/strict';
import test from 'node:test';
import { Object3D, Vector3 } from 'three';
import { CHANNELS, GRID, HALF, STEP, WATER } from '../src/sim/config.js';
import { makeBurnScars } from '../src/view/fire.js';
import { advanceLocomotion, newLocomotion, orientLocomotion } from '../src/view/locomotion.js';

test('visual ash outlasts the active flame, fades, and clears on flood or reset', () => {
  const map = new Float32Array(GRID * GRID * CHANNELS);
  const scars = makeBurnScars();
  const cell = 85, at = cell * CHANNELS;
  const pixel = () => scars.texture.image.data[cell];
  map[at + 4] = .87;
  scars.update(map, 15);
  assert.ok(pixel() > 210);
  map[at + 4] = 0;
  const first = pixel();
  scars.update(map, 30);
  assert.ok(pixel() > 150 && pixel() < first);
  map[at] = WATER - 1;
  scars.update(map, 31);
  assert.equal(pixel(), 0);
  map[at] = 3;
  map[at + 4] = .6;
  scars.update(map, 32);
  assert.ok(pixel() > 120);
  scars.reset();
  assert.equal(pixel(), 0);
});

test('locomotion uses distance, pitches to the ground and responds to cues', () => {
  const map = new Float32Array(GRID * GRID * CHANNELS);
  for (let i = 0; i < GRID ** 2; i++) map[i * CHANNELS] = ((i % GRID + .5) * STEP - HALF) * .33;
  const a = { pose: newLocomotion(2), distance: 0, angle: 0, x: 0, y: 0, z: 0,
    turnRate: 0, gait: .5, signaling: 0, feeding: 0, attacking: 0, fear: 0, hidden: 0 };
  const { pose } = a, starting = pose.phase;
  for (let i = 0; i < 80; i++) advanceLocomotion(a, .016, map);
  assert.equal(pose.phase, starting);
  assert.equal(pose.stride, 0);
  const dummy = new Object3D();
  orientLocomotion(dummy, a, pose);
  const normal = new Vector3(0, 1, 0).applyQuaternion(dummy.quaternion);
  assert.ok(normal.x < -.29 && normal.y > .91);
  a.distance = .05;
  a.turnRate = 1.5;
  a.signaling = .96;
  for (let i = 0; i < 50; i++) advanceLocomotion(a, .016, map);
  assert.ok(pose.phase !== starting && pose.trot > .45 && pose.bank < -.10 && pose.alert > .8);
  a.distance = .12;
  a.fear = .88;
  a.attacking = 1;
  for (let i = 0; i < 12; i++) advanceLocomotion(a, .016, map);
  assert.ok(pose.hop > .17 && pose.attack > .8 && pose.run > .15);
});

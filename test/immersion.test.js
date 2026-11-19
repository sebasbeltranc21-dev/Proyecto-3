import assert from 'node:assert/strict';
import test from 'node:test';
import { PerspectiveCamera, Vector3 } from 'three';
import { terrainSounds } from '../src/audio/AudioEngine.js';
import { CHANNELS, GRID } from '../src/sim/config.js';
import { biomeHour, darkness, displayHour, visionFactor } from '../src/sim/day-cycle.js';
import { Ecosystem } from '../src/sim/ecosystem.js';
import { brush, tile } from '../src/sim/terrain.js';
import { DocumentaryCamera } from '../src/view/documentary.js';

function place(a, x, z) {
  Object.assign(a, { x, z, angle: 0, terrainCell: tile(x, z) });
}

test('the same biome clock drives the time control and vision ranges', () => {
  const sim = new Ecosystem(41021);
  sim.map.fill(0);
  const prey = sim.agents.find(a => a.species === 0);
  const wolf = sim.agents.find(a => a.species === 1);
  place(prey, 0, 0);
  place(wolf, 0, 34);
  sim.agents = [prey, wolf];
  sim.rebuildIndex();
  assert.equal(biomeHour(26), 9.5);
  sim.setHour(12);
  sim.sense(prey, 1, 21);
  assert.ok(prey.inputs[3] > 0);
  sim.setHour(0);
  assert.equal(sim.hour, 0);
  sim.sense(prey, 1, 21);
  assert.equal(prey.inputs[3], 0);
  assert.equal(visionFactor(0, darkness(0)), .6);
  assert.equal(visionFactor(1, darkness(0)), .9);
  assert.ok(displayHour(23.8, .2, .05) > 23.8);
});

test('tired prey slow down near allies at night and keep fleeing when frightened', () => {
  const sim = new Ecosystem(41021);
  sim.map.fill(0);
  sim.collisions.setMap(sim.map, []);
  const [a, ally] = sim.agents;
  place(a, 0, 0);
  place(ally, 0, 7);
  Object.assign(a, { energy: .27, hunger: .2, thirst: .1, fear: 0 });
  a.brain.run = () => [.85, 0, .84, 0, 0, 0];
  ally.brain.run = () => [0, 0, .42, 0, 0, 0];
  sim.agents = [a, ally];
  sim.setHour(12);
  sim.step();
  const dayPace = a.speed;
  sim.setHour(0);
  sim.step();
  assert.equal(a.action, 'Reuniéndose');
  assert.ok(a.speed < dayPace * .6);
  place(ally, 0, 3.25);
  sim.step();
  assert.equal(a.action, 'Descansando');
  a.fear = .68;
  sim.step();
  assert.equal(a.action, 'Corriendo');
});

test('spatial audio sources follow the edited water and fire cells', () => {
  const map = new Float32Array(GRID * GRID * CHANNELS);
  assert.deepEqual(terrainSounds(map), { water: [], fire: [] });
  brush(map, 'fire', 0, 0, 12);
  brush(map, 'river', 50, 0, 14);
  const { water, fire } = terrainSounds(map);
  assert.ok(water.some(p => Math.abs(p.x - 50) < 5));
  assert.ok(fire.some(p => Math.hypot(p.x, p.z) < 5));
  brush(map, 'river', 0, 0, 16);
  assert.ok(!terrainSounds(map).fire.some(p => Math.hypot(p.x, p.z) < 5));
});

test('the documentary camera approaches low and returns to its saved orbit on capture', () => {
  const camera = new PerspectiveCamera(46, 1, .64, 1180);
  camera.position.set(44, 26, 61);
  const origin = camera.position.clone();
  const controls = { target: new Vector3(2, 2, 5), enabled: true, update() {} };
  const target = controls.target.clone();
  const documentary = new DocumentaryCamera(camera, controls);
  const map = new Float32Array(GRID * GRID * CHANNELS);
  const a = { x: 4, y: 0, z: 2, angle: 0, fallAge: -1 };
  assert.ok(documentary.enter(a));
  assert.equal(controls.enabled, false);
  for (let i = 0; i < 120; i++) documentary.frame(1 / 60, a, map);
  assert.ok(camera.position.distanceTo(new Vector3(a.x, a.y, a.z)) < 8);
  assert.ok(camera.position.y >= 1 && camera.position.y < 2.1);
  a.fallAge = 0;
  documentary.frame(1 / 60, a, map);
  assert.ok(!documentary.active && documentary.busy);
  for (let i = 0; i < 120; i++) documentary.frame(1 / 60, a, map);
  assert.equal(documentary.busy, false);
  assert.equal(controls.enabled, true);
  assert.equal(camera.fov, 46);
  assert.deepEqual(camera.position, origin);
  assert.deepEqual(controls.target, target);
});

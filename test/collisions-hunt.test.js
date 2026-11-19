import assert from 'node:assert/strict';
import test from 'node:test';
import { CHANNELS, GRID } from '../src/sim/config.js';
import { CollisionIndex } from '../src/sim/collisions.js';
import { Ecosystem } from '../src/sim/ecosystem.js';
import { canBite, FALL_DURATION } from '../src/sim/hunt.js';
import { solidProps, propChunks } from '../src/sim/props.js';
import { createTerrain, tile } from '../src/sim/terrain.js';

function body(id, x, z, angle = 0) {
  return { id, species: id % 2, x, z, angle, health: 1, swimming: false, drinking: false };
}

test('a swept body cannot cross rocks or a perpendicular animal', () => {
  const map = new Float32Array(GRID * GRID * CHANNELS);
  const collisions = new CollisionIndex();
  const rock = { x: 0, z: 0, radius: 1.4, top: 2 };
  collisions.setMap(map, [[rock]]);
  const deer = body(2, -4, 0, Math.PI / 2);
  assert.equal(collisions.canMove(deer, 4, 0, Math.PI / 2), false);
  assert.equal(collisions.canMove(deer, -4, 3, 0), true);
  collisions.setMap(map, []);
  const other = body(4, 0, 0, 0);
  collisions.rebuild([deer, other]);
  assert.equal(collisions.canMove(deer, 4, 0, Math.PI / 2), false);
  other.z = 6;
  collisions.move(other);
  assert.equal(collisions.canMove(deer, 4, 0, Math.PI / 2), true);
});

test('the same deterministic trees and rocks define exclusion zones and safe spawns', () => {
  const map = createTerrain(41021);
  const collisions = new CollisionIndex();
  const groups = propChunks.map(chunk => solidProps(map, chunk));
  collisions.setMap(map, groups);
  const pine = groups.flat().find(p => !p.rock);
  const a = body(2, pine.x, pine.z);
  assert.ok(!collisions.canPlace(a, a.x, a.z, a.angle));
  assert.ok(collisions.separate(a));
  assert.ok(collisions.canPlace(a, a.x, a.z, a.angle));
  const world = new Ecosystem(41021);
  for (const b of world.agents) assert.ok(world.collisions.canPlace(b, b.x, b.z, b.angle));
});

test('a bite needs forward contact and an unobstructed route', () => {
  const map = new Float32Array(GRID * GRID * CHANNELS);
  const collisions = new CollisionIndex();
  const wolf = body(1, 0, 0);
  const prey = body(2, 0, 2);
  collisions.setMap(map, [[{ x: 0, z: .95, radius: .4, top: 2 }]]);
  assert.equal(canBite(collisions, wolf, prey), false);
  collisions.setMap(map, []);
  assert.ok(canBite(collisions, wolf, prey));
  prey.z = -2;
  assert.equal(canBite(collisions, wolf, prey), false);
  prey.z = 3;
  assert.equal(canBite(collisions, wolf, prey), false);
});

test('a hunt winds up, lands once, and keeps the capture visible briefly', () => {
  const world = new Ecosystem(41021);
  const prey = world.agents.find(a => a.species === 0);
  const wolf = world.agents.find(a => a.species === 1);
  world.map.fill(0);
  world.collisions.setMap(world.map, []);
  Object.assign(wolf, { x: 0, z: 0, angle: 0, terrainCell: tile(0, 0), hunger: .9, thirst: .08 });
  Object.assign(prey, { x: 0, z: 1.95, angle: Math.PI / 2, terrainCell: tile(0, 1.95), health: .29, thirst: .08 });
  wolf.brain.run = () => [.83, 0, .71, 0, 1, 0];
  prey.brain.run = () => [0, 0, .32, 0, 0, 0];
  world.agents = [prey, wolf];
  world.byId = new Map(world.agents.map(a => [a.id, a]));
  world.counts = [1, 1];
  for (let tick = 0; tick < 3; tick++) world.step();
  assert.equal(wolf.action, 'Preparando ataque');
  assert.equal(world.hunts, 0);
  for (let tick = 0; tick < 8; tick++) world.step();
  assert.equal(world.hunts, 1);
  assert.equal(world.inspect(prey.id).action, 'Capturada');
  assert.equal(world.fallen[0], prey);
  assert.equal(world.counts[0], 0);
  const fall = prey.fallAt;
  while (world.time - fall < FALL_DURATION + .06) world.step();
  assert.equal(world.inspect(prey.id), null);
  assert.equal(world.hunts, 1);
});

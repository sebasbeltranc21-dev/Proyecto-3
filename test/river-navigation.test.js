import assert from 'node:assert/strict';
import test from 'node:test';
import { CHANNELS, GRID, HALF, STEP, WATER } from '../src/sim/config.js';
import { Ecosystem } from '../src/sim/ecosystem.js';
import { RiverNavigation, WADE_HEIGHT, DRINK_HEIGHT, onWaterSurface } from '../src/sim/river-navigation.js';
import { ground, tile } from '../src/sim/terrain.js';

function terrain(height) {
  const map = new Float32Array(GRID * GRID * CHANNELS);
  for (let z = 0; z < GRID; z++) for (let x = 0; x < GRID; x++) {
    map[(z * GRID + x) * CHANNELS] = height((x + .5) * STEP - HALF, (z + .5) * STEP - HALF);
  }
  return map;
}

function animal(map, x, z) {
  return {
    id: 11, x, z, angle: -Math.PI / 2, terrainCell: tile(x, z), thirst: .1, fear: 0, speed: 7,
    energy: .9, action: 'Explorando', swimming: false, drinking: false,
  };
}

test('deep water blocks walking and deflects the animal down the shoreline', () => {
  const map = terrain(x => WATER + (x < 0 ? -3 : 1));
  const nav = new RiverNavigation(map);
  const a = animal(map, 3, 0);
  for (let attempt = 0; attempt < 110; attempt++) {
    a.speed = 7;
    nav.step(a, -Math.PI / 2, () => .5);
    assert.ok(ground(map, a.x, a.z) >= WADE_HEIGHT);
    assert.equal(a.swimming, false);
  }
  assert.ok(Math.abs(a.z) > 2);
});

test('thirsty animals turn, come to a stop, and drink from reachable shallows', () => {
  const map = terrain(x => WATER + Math.max(-3, Math.min(2.6, x * .59)));
  const nav = new RiverNavigation(map);
  const a = animal(map, .62, 0);
  a.angle = Math.PI * .5;
  a.thirst = .79;
  let drinking = false;
  for (let attempt = 0; attempt < 36; attempt++) {
    a.speed = 7;
    drinking = nav.step(a, a.angle, () => .5);
    assert.equal(a.speed, 0);
    assert.equal(a.x, .62);
    assert.ok(ground(map, a.x, a.z) >= DRINK_HEIGHT);
  }
  assert.ok(drinking && a.drinking && !a.swimming);
  a.thirst = .08;
  nav.step(a, a.angle + 1, () => .5);
  assert.equal(a.drinking, false);
});

test('terraforming immediately puts a trapped creature at the surface, then it returns to dry land', () => {
  const world = new Ecosystem(41021);
  const a = world.agents.find(agent => ground(world.map, agent.x, agent.z) > WATER + 2);
  world.edit('river', a.x, a.z, 16);
  assert.equal(a.swimming, true);
  assert.equal(world.inspect(a.id).action, 'Nadando');
  assert.equal(onWaterSurface(ground(world.map, a.x, a.z), a.swimming), WATER);
  for (let i = 0; i < 320 && a.swimming; i++) {
    const drank = world.river.step(a, a.angle, () => .5);
    assert.equal(drank, false);
  }
  assert.equal(a.swimming, false);
  assert.ok(ground(world.map, a.x, a.z) > WATER);
});

test('a completely flooded scene retains buoyancy until an edited bank is reachable', () => {
  const map = terrain(() => WATER - 4);
  const nav = new RiverNavigation(map);
  const a = animal(map, 0, 0);
  assert.equal(nav.step(a, 0, () => .5), false);
  assert.equal(a.speed, 0);
  assert.equal(onWaterSurface(ground(map, a.x, a.z), a.swimming), WATER);
  map[tile(6, 2)] = WATER + 1;
  nav.invalidate();
  for (let i = 0; i < 140 && a.swimming; i++) nav.step(a, 0, () => .5);
  assert.equal(a.swimming, false);
});

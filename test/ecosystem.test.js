import assert from 'node:assert/strict';
import test from 'node:test';
import { CAP, INPUTS, OUTPUTS, WATER, rng } from '../src/sim/config.js';
import { Ecosystem } from '../src/sim/ecosystem.js';
import { GENES, NeuralNetwork } from '../src/sim/neural.js';
import { brush, createTerrain, ground, tile } from '../src/sim/terrain.js';

test('feedforward consumes all layers and inherits independently of the parents', () => {
  const genes = new Float32Array(GENES);
  const outputOffset = 14 * 29;
  genes[0] = 1;
  genes[outputOffset] = 2;
  genes[outputOffset + 15] = -2;
  const net = new NeuralNetwork(genes);
  const input = new Float32Array(INPUTS.length);
  input[0] = 1;
  assert.equal(GENES, 496);
  const outputs = net.run(input);
  assert.equal(outputs.length, OUTPUTS.length);
  assert.ok(outputs[0] > .8 && outputs[1] < -.9);
  assert.equal(outputs[2], .5);

  const donor = new Float32Array(GENES).fill(3);
  const before = genes.slice();
  const { brain, mutations } = NeuralNetwork.breed(genes, donor, rng(174), .12);
  assert.ok(mutations > 0);
  assert.ok(brain.genes.includes(3));
  assert.ok(brain.genes.includes(0));
  assert.deepEqual(genes, before);
});

test('terrain brushes change shared ground, vegetation, nutrients, moisture and fire', () => {
  const map = createTerrain(41021);
  const [x, z] = [83, 24];
  const at = tile(x, z);
  const start = ground(map, x, z);
  brush(map, 'raise', x, z, 24);
  assert.ok(ground(map, x, z) > start);
  brush(map, 'lower', x, z, 24);
  assert.ok(Math.abs(ground(map, x, z) - start) < .001);
  brush(map, 'forest', x, z, 24);
  const coverage = map[at + 1];
  brush(map, 'meadow', x, z, 24);
  assert.ok(map[at + 1] < coverage && map[at + 2] > .8);
  brush(map, 'dry', x, z, 24);
  assert.ok(map[at + 3] < .2);
  brush(map, 'fire', x, z, 24);
  assert.ok(map[at + 4] > .9);
  brush(map, 'river', x, z, 24);
  assert.ok(map[at] < WATER);
});

test('seeded baseline produces inherited descendants and measurable ecology', () => {
  const world = new Ecosystem(41021);
  for (let step = 0; step < 1800; step++) world.step();
  const individual = world.agents.find(agent => agent.lineage.length === 2);
  assert.ok(individual && individual.generation > 1 && individual.mutations > 0);
  const telemetry = world.inspect(individual.id);
  assert.equal(telemetry.inputs.length, 28);
  assert.equal(telemetry.hidden.length, 14);
  assert.equal(telemetry.outputs.length, 6);
  assert.ok(telemetry.genes.every(Number.isFinite));
  assert.ok(world.hunts > 0 && world.cooperative > 0 && world.shelter > 0 && world.migrations > 0);
  assert.ok(world.agents.length <= CAP);
  assert.equal(world.agents.length, world.counts[0] + world.counts[1]);
});

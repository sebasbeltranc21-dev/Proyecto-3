import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { ARENAS, makeArena } from '../src/duel/arena.js';
import { FPS, IDS, ROW, SECONDS, playEpisode } from '../src/duel/episode.js';
import { GENES, NI } from '../src/sim/neural.js';
import { readAnimal } from '../src/duel/tactics.js';
import { ReplayMotion } from '../src/duel/replay-motion.js';
import { readPerception, sightPoint } from '../src/duel/perception.js';

const { generations } = JSON.parse(await readFile(new URL('../src/duel/checkpoints.json', import.meta.url)));
const materialize = index => generations[index].genes.map(bytes =>
  new Float32Array(Uint8Array.from(Buffer.from(bytes, 'base64')).buffer));

test('30 real checkpoints replay held-out evaluations against the same G1 rival', () => {
  assert.deepEqual(generations.map(g => g.number), Array.from({ length: 30 }, (_, i) => i + 1));
  const early = materialize(0), late = materialize(29);
  for (const genes of [...early, ...late]) assert.ok(genes.length === GENES && genes.every(Number.isFinite));
  assert.notDeepEqual(early[0], late[0]);
  assert.notDeepEqual(early[1], late[1]);
  const evaluation = ARENAS.map(({ seed }) => makeArena(seed));
  for (const [species, genomes] of [[late[0], early[1]], [early[0], late[1]]].entries()) {
    const current = evaluation.map(arena => playEpisode(arena, genomes).metrics);
    assert.deepEqual(current, generations[29].evaluation[species]);
  }
});

test('replays are deterministic and isolate sensor ablation to the selected network', () => {
  const map = makeArena(ARENAS[0].seed);
  const genome = materialize(29);
  const control = playEpisode(map, genome, { record: true });
  const repeated = playEpisode(map, genome, { record: true });
  assert.deepEqual(control.frames, repeated.frames);
  assert.equal(control.frames.length, (FPS * SECONDS + 1) * ROW * IDS.length);
  const blinded = playEpisode(map, genome, { record: true, disabled: 'allies', focus: 5 });
  for (const id of IDS) assert.deepEqual(readAnimal(control, 0, id), readAnimal(blinded, 0, id));
  assert.ok(readAnimal(control, .1, 5)[12] > 0);
  assert.deepEqual(Array.from(readAnimal(blinded, .1, 5).subarray(12, 15)), [0, 0, 0]);
  assert.notDeepEqual(readAnimal(control, .1, 5).slice(6 + NI), readAnimal(blinded, .1, 5).slice(6 + NI));
});

test('3D motion seeks to the recorded simulation tick and reconstructs the same pose after rewinding', () => {
  const arena = makeArena(ARENAS[0].seed);
  const result = playEpisode(arena, materialize(0), { record: true });
  const motion = new ReplayMotion(result, arena.map);
  const at = 4.15;
  const capture = result.contacts.find(contact => contact.captured);
  assert.ok(capture);
  const before = structuredClone(motion.sample(at));
  const row = readAnimal(result, at, 5);
  assert.equal(before[4].x, row[0]);
  assert.equal(before[4].z, row[1]);
  const after = motion.sample(capture.time + .75)[capture.prey - 1];
  assert.ok(after.visible && after.health <= 0 && after.pose.down > .7);
  assert.deepEqual(motion.sample(at), before);
});

test('the perception view records actual sensing and masks only the selected network input', () => {
  const map = makeArena(ARENAS[0].seed);
  const weights = materialize(29);
  const ordinary = playEpisode(map, weights, { record: true });
  const masked = playEpisode(map, weights, { record: true, disabled: 'allies', focus: 5 });
  const time = .1;
  const full = readPerception(ordinary, time, 5);
  const suppressed = readPerception(masked, time, 5, 'allies');
  assert.ok(full.range > 7 && full.targets[0].visible);
  assert.equal(full.targets[1].id, 6);
  assert.equal(full.targets[1].strength, readAnimal(ordinary, time, 5)[12]);
  assert.equal(suppressed.targets[1].visible, false);
  assert.equal(suppressed.targets[1].strength, 0);
  assert.equal(readPerception(masked, time, 6).targets[1].suppressed, false);
  assert.equal(readPerception(ordinary, 0, 5), null);
  assert.deepEqual(sightPoint({ x: 40, z: 0 }, Math.PI / 2, 12).map(Math.round), [43, 0]);
});

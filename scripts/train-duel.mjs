import { writeFile } from 'node:fs/promises';
import { ARENAS, makeArena } from '../src/duel/arena.js';
import { playEpisode } from '../src/duel/episode.js';
import { rng } from '../src/sim/config.js';
import { NeuralNetwork } from '../src/sim/neural.js';

const generations = 30;
const random = rng(67218);
const founder = [0, 1].map(species => NeuralNetwork.founder(species, random).genes);
const archive = [founder];
const parents = founder.map(genes => [genes]);
const training = Array.from({ length: 9 }, (_, i) => makeArena(2609 + i * 1771));
const evaluation = ARENAS.map(({ seed }) => makeArena(seed));
const pack = genes => Buffer.from(genes.buffer, genes.byteOffset, genes.byteLength).toString('base64');
const reports = [];

for (let generation = 1; generation <= generations; generation++) {
  const pair = archive.at(-1);
  const report = [0, 1].map(species => evaluation.map(arena => {
    const matchup = [...founder];
    matchup[species] = pair[species];
    return playEpisode(arena, matchup).metrics;
  }));
  reports.push(report);
  const captures = report[1].reduce((sum, m) => sum + m.captures, 0);
  const survivors = report[0].reduce((sum, m) => sum + m.survivors, 0);
  console.log(`G${generation} · evaluación: ${captures} capturas | ${survivors} presas vivas`);
  if (generation === generations) break;
  const next = [0, 1].map(species => {
    const squad = parents[species];
    const scenarios = [training[(generation * 2) % training.length], training[(generation * 2 + 3) % training.length],
      training[(generation * 2 + 7) % training.length]];
    const candidates = [...squad, ...Array.from({ length: 8 }, (_, i) =>
      NeuralNetwork.breed(squad[0], squad[i % squad.length], random, .11 + .06 * (i % 2)).brain.genes)];
    const scored = candidates.map(genes => {
      let fitness = 0;
      for (const [index, arena] of scenarios.entries()) {
        const opponent = index === 0 ? founder : index === 1 ? pair : archive[Math.floor((generation - 1) * .6)];
        const matchup = [...opponent];
        matchup[species] = genes;
        fitness += playEpisode(arena, matchup).score[species];
      }
      return { fitness, genes };
    }).sort((a, b) => b.fitness - a.fitness);
    parents[species] = scored.slice(0, 3).map(candidate => candidate.genes);
    return parents[species][0];
  });
  archive.push(next);
}

await writeFile(new URL('../src/duel/checkpoints.json', import.meta.url),
  JSON.stringify({ generations: archive.map((pair, i) => ({ number: i + 1, genes: pair.map(pack), evaluation: reports[i] })) }) + '\n');

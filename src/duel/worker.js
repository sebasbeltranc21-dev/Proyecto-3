import checkpoints from './checkpoints.json';
import { ARENAS, makeArena } from './arena.js';
import { playEpisode, SENSORS } from './episode.js';

const generations = checkpoints.generations;
const arenas = ARENAS.map(({ seed }) => makeArena(seed));
const archive = generations.map(({ genes }) => genes.map(encoded =>
  new Float32Array(Uint8Array.from(atob(encoded), char => char.charCodeAt(0)).buffer)));
let example = { generation: 1, arena: 0, cooperative: 0 };
for (const { number, evaluation } of generations) {
  for (const [arena, { cooperative }] of evaluation[1].entries()) {
    if (cooperative >= example.cooperative) example = { generation: number, arena, cooperative };
  }
}

self.postMessage({
  type: 'ready',
  total: archive.length,
  example,
  history: generations.map(generation => generation.evaluation.map(results => results.reduce((sum, m) => ({
    captures: sum.captures + m.captures, survivors: sum.survivors + m.survivors,
  }), { captures: 0, survivors: 0 }))),
});

function team(generation, mode) {
  const pair = archive[generation - 1];
  if (mode === 'wolves') return [archive[0][0], pair[1]];
  if (mode === 'prey') return [pair[0], archive[0][1]];
  return pair;
}

self.onmessage = ({ data }) => {
  const { id, arena, first, last, mode, sensor, focus } = data;
  if (!arenas[arena] || !archive[first - 1] || !archive[last - 1] || !Object.hasOwn(SENSORS, sensor)) return;
  try {
    const map = arenas[arena];
    const left = playEpisode(map, team(first, mode), { record: true });
    const right = playEpisode(map, team(last, mode), { record: true, disabled: sensor, focus });
    self.postMessage({ type: 'matches', id, left, right, visual: map.visual }, [left.frames.buffer, right.frames.buffer]);
  } catch (error) {
    self.postMessage({ type: 'error', id, message: error.message });
  }
};

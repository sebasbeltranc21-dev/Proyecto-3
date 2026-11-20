import { FORWARD_SIGHT, NEAR_SIGHT, PERCEPTION_SIZE } from '../sim/perception.js';
import { BOUNDS } from './arena.js';
import { FPS, IDS, ROW } from './episode.js';

export const HALF_ANGLE = Math.acos(FORWARD_SIGHT);
export const PERCEPTION_LAYERS = [
  { key: 'threat', label: 'Rival', color: '#70deff', offset: 4 },
  { key: 'allies', label: 'Aliado cercano', color: '#ffcf76', offset: 7 },
  { key: 'signal', label: 'Señal entrante', color: '#edabff', offset: 10 },
  { key: 'cover', label: 'Cobertura', color: '#a6f5a0', offset: 13 },
];

export function readPerception(result, time, id, disabled = 'none') {
  const slot = Math.floor(time * FPS + 1e-6) * IDS.length + id - 1;
  const offset = slot * PERCEPTION_SIZE;
  const row = slot * ROW;
  const data = result.sensors;
  if (!data?.[offset + 3] || result.frames[row + 3] <= 0) return null;
  const [x, z, heading, range] = data.subarray(offset, offset + 4);
  const input = result.frames.subarray(row + 6);
  const strength = [input[id >= 5 ? 0 : 3], input[6], input[27], input[15]];
  const targets = PERCEPTION_LAYERS.map(({ key, offset: at }, index) => {
    const suppressed = key === disabled;
    const base = offset + at;
    const id = key === 'cover' ? 0 : data[base];
    const position = key === 'cover' ? base : base + 1;
    return { id, strength: strength[index], x: data[position], z: data[position + 1],
      visible: !suppressed && strength[index] > 0 && (key === 'cover' || id > 0), suppressed };
  });
  return { x, z, heading, range: disabled === 'threat' ? 0 : range, near: Math.min(range, NEAR_SIGHT), targets };
}

export function sightPoint(view, bearing, distance) {
  const dx = Math.sin(bearing), dz = Math.cos(bearing);
  const borderX = dx > 0 ? BOUNDS : -BOUNDS;
  const borderZ = dz > 0 ? BOUNDS : -BOUNDS;
  const maxX = dx ? (borderX - view.x) / dx : Infinity;
  const maxZ = dz ? (borderZ - view.z) / dz : Infinity;
  const length = Math.max(0, Math.min(distance, maxX, maxZ));
  return [view.x + dx * length, view.z + dz * length];
}

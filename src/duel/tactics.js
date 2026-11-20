import { WATER } from '../sim/config.js';
import { BOUNDS, SIDE } from './arena.js';
import { FPS, IDS, ROW } from './episode.js';
import { HALF_ANGLE, PERCEPTION_LAYERS, sightPoint } from './perception.js';

const COLORS = ['#c4e8a1', '#f6ae79'];
const XY = (row, id) => (row * IDS.length + id - 1) * ROW;

export class Tactics {
  constructor(canvas, select) {
    this.canvas = canvas;
    this.context = canvas.getContext('2d');
    this.land = document.createElement('canvas');
    this.landContext = this.land.getContext('2d');
    this.points = [];
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas);
    canvas.addEventListener('click', event => {
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left, y = event.clientY - rect.top;
      const hit = this.points.find(point => Math.hypot(point.x - x, point.y - y) < 14);
      if (hit) select(hit.id);
    });
  }

  resize() {
    const { clientWidth: width, clientHeight: height } = this.canvas;
    if (!width || !height) return;
    const ratio = Math.min(devicePixelRatio || 1, 2);
    this.width = width;
    this.height = height;
    this.canvas.width = this.land.width = Math.round(width * ratio);
    this.canvas.height = this.land.height = Math.round(height * ratio);
    for (const context of [this.context, this.landContext]) context.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.size = Math.min(width, height) - 26;
    this.scale = this.size / (BOUNDS * 2);
    this.x = (width - this.size) / 2;
    this.y = (height - this.size) / 2;
    this.paintTerrain();
  }

  setTerrain(visual) {
    this.visual = visual;
    if (this.width) this.paintTerrain();
  }

  project(x, z) {
    return [this.x + (x + BOUNDS) * this.scale, this.y + (z + BOUNDS) * this.scale];
  }

  paintTerrain() {
    const { landContext: c, width, height, size, visual, x, y } = this;
    c.fillStyle = '#101d17';
    c.fillRect(0, 0, width, height);
    if (!visual) return;
    const tile = size / SIDE;
    for (let index = 0; index < SIDE * SIDE; index++) {
      const h = visual.colors[index * 2], tree = visual.colors[index * 2 + 1];
      c.fillStyle = h < WATER ? '#386968' : tree > .55 ? '#344936' : tree > .34 ? '#43543a' : '#536046';
      c.fillRect(x + (index % SIDE) * tile, y + Math.floor(index / SIDE) * tile, tile + .45, tile + .45);
    }
    c.strokeStyle = '#dce6b713';
    c.beginPath();
    for (let i = 0; i <= 8; i++) {
      const shift = i / 8 * size;
      c.moveTo(x + shift, y);
      c.lineTo(x + shift, y + size);
      c.moveTo(x, y + shift);
      c.lineTo(x + size, y + shift);
    }
    c.stroke();
    for (const prop of visual.props) {
      const [px, py] = this.project(prop.x, prop.z);
      c.beginPath();
      c.fillStyle = prop.rock ? '#a1a79a' : '#25382a';
      c.arc(px, py, Math.max(1.7, prop.radius * this.scale), 0, 2 * Math.PI);
      c.fill();
    }
    c.strokeStyle = '#b8c9ae54';
    c.strokeRect(x, y, size, size);
  }

  drawPerception(view) {
    if (!view) return;
    const c = this.context;
    const origin = this.project(view.x, view.z);
    c.save();
    c.lineWidth = 1.15;
    if (view.range > 0) {
      c.beginPath();
      c.moveTo(...origin);
      for (let i = 0; i <= 32; i++) {
        const bearing = view.heading + (i / 16 - 1) * HALF_ANGLE;
        c.lineTo(...this.project(...sightPoint(view, bearing, view.range)));
      }
      c.closePath();
      c.fillStyle = PERCEPTION_LAYERS[0].color + '35';
      c.strokeStyle = PERCEPTION_LAYERS[0].color + 'b0';
      c.fill();
      c.stroke();
      c.beginPath();
      for (let i = 0; i < 36; i++) {
        const point = this.project(...sightPoint(view, i / 36 * Math.PI * 2, view.near));
        if (i) c.lineTo(...point);
        else c.moveTo(...point);
      }
      c.closePath();
      c.stroke();
    }
    for (const [index, target] of view.targets.entries()) {
      if (!target.visible) continue;
      const point = this.project(target.x, target.z);
      c.strokeStyle = PERCEPTION_LAYERS[index].color;
      c.setLineDash(index === 2 ? [3, 2] : []);
      c.beginPath();
      c.moveTo(...origin);
      c.lineTo(...point);
      c.stroke();
      c.setLineDash([]);
      c.beginPath();
      c.arc(...point, 5.5, 0, Math.PI * 2);
      c.stroke();
    }
    c.restore();
  }

  draw(result, time, focus, perception) {
    if (!result || !this.width) return;
    const { context: c, width, height } = this;
    c.drawImage(this.land, 0, 0, width, height);
    this.drawPerception(perception);
    const frame = Math.floor(time * FPS + 1e-6);
    const next = Math.min(result.frames.length / (ROW * IDS.length) - 1, frame + 1);
    const blend = time * FPS - frame;
    this.points.length = 0;
    for (const id of IDS) {
      const at = XY(frame, id), following = XY(next, id), data = result.frames;
      const health = data[at + 3], flags = data[at + 4];
      const x = data[at] + (data[following] - data[at]) * blend;
      const z = data[at + 1] + (data[following + 1] - data[at + 1]) * blend;
      const [px, py] = this.project(x, z);
      const wolf = id >= 5;
      const color = COLORS[Number(wolf)];
      let drawing = false;
      if (frame) {
        c.lineWidth = id === focus ? 1.65 : 1.05;
        c.strokeStyle = color + (id === focus ? 'a8' : '65');
        c.beginPath();
        for (let f = Math.max(0, frame - FPS * 3); f <= frame; f += 4) {
          const offset = XY(f, id);
          if (data[offset + 3] <= 0) break;
          const [tx, ty] = this.project(data[offset], data[offset + 1]);
          if (drawing) c.lineTo(tx, ty);
          else { c.moveTo(tx, ty); drawing = true; }
        }
        if (drawing && health > 0) c.lineTo(px, py);
        c.stroke();
      }
      this.points.push({ x: px, y: py, id });
      c.save();
      c.translate(px, py);
      if (id === focus || flags & 2) {
        c.beginPath();
        c.strokeStyle = id === focus ? '#f3f3dfd9' : color + '83';
        c.arc(0, 0, id === focus ? 10 : 12, 0, Math.PI * 2);
        c.stroke();
      }
      c.beginPath();
      c.fillStyle = health <= 0 ? '#302b23' : color;
      c.strokeStyle = flags & 20 ? '#fff0db' : '#1a271f';
      c.lineWidth = 1.25;
      if (health <= 0) {
        c.strokeStyle = '#f3bc908f';
        c.moveTo(-3.5, -3.5); c.lineTo(3.5, 3.5);
        c.moveTo(-3.5, 3.5); c.lineTo(3.5, -3.5);
      } else if (wolf) {
        const yaw = data[at + 2], delta = data[following + 2] - yaw;
        c.rotate(Math.PI - yaw - Math.atan2(Math.sin(delta), Math.cos(delta)) * blend);
        c.moveTo(0, -7); c.lineTo(-5, 4); c.lineTo(0, 2); c.lineTo(5, 4); c.closePath();
      } else {
        c.arc(0, 0, flags & 1 ? 3.1 : 4.5, 0, 2 * Math.PI);
      }
      c.fill();
      c.stroke();
      c.restore();
    }
  }
}

export function readAnimal(result, time, id) {
  const offset = XY(Math.floor(time * FPS + 1e-6), id);
  return result.frames.subarray(offset, offset + ROW);
}

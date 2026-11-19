import { MOUSE, PerspectiveCamera, Raycaster, Vector2, Vector3 } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { HALF, WATER, clamp, rng } from '../sim/config.js';
import { ground, tile } from '../sim/terrain.js';
import { onWaterSurface } from '../sim/river-navigation.js';
import { SKY_PRESETS } from '../ui-data.js';
import { Fauna } from './fauna.js';
import { INITIAL_POSITION, INITIAL_TARGET } from './world.js';

const DIVISIONS = 50;
const STEP = HALF * 2 / DIVISIONS;
const BLEND = (a, b, t) => a.map((c, i) => Math.round(c + (b[i] - c) * t));
const rgb = c => `rgb(${c.join(',')})`;

export class CompatibilityWorld {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    if (!this.ctx) throw Error('Canvas 2D unavailable');
    this.background = document.createElement('canvas');
    this.backgroundCtx = this.background.getContext('2d', { alpha: false });
    this.camera = new PerspectiveCamera(46, 1, .64, 1180);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = .11;
    this.controls.maxPolarAngle = Math.PI * .428;
    this.controls.minPolarAngle = .39;
    this.controls.minDistance = 18;
    this.controls.maxDistance = 365;
    this.controls.mouseButtons = { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN };
    this.fauna = new Fauna();
    this.ring = { visible: false };
    this.pointer = new Vector3();
    this.offset = new Vector3();
    this.ray = new Raycaster();
    this.cursor = new Vector2();
    this.frames = 0;
    this.fps = 0;
    this.fpsStart = 0;
    this.markers = true;
    this.dayOffset = 0;
    this.time = 0;
    this.weather = 'clear';
    this.selectedId = 0;
    this.quality = 'balanced';
    this.patch = [];
    this.points = [];
    this.dirty = true;
    this.last = 0;
    this.key = '';
    this.resetView();
    const random = rng(99723);
    for (let z = 0; z <= DIVISIONS; z++) {
      for (let x = 0; x <= DIVISIONS; x++) {
        const px = x * STEP - HALF, pz = z * STEP - HALF;
        this.points.push({ x: px, z: pz });
        if (x < DIVISIONS && z < DIVISIONS) {
          this.patch.push({ x: px + (random() * .68 + .16) * STEP, z: pz + (random() * .68 + .16) * STEP,
            v: random(), shade: random(), h: .69 + random() * .88,
            index: z * (DIVISIONS + 1) + x,
          });
        }
      }
    }
    this.resize = this.resize.bind(this);
    this.draw = this.draw.bind(this);
    new ResizeObserver(this.resize).observe(canvas);
    this.resize();
    requestAnimationFrame(this.draw);
  }

  resize() {
    const ratio = Math.min(devicePixelRatio, 1.4);
    this.width = Math.max(1, this.canvas.clientWidth);
    this.height = Math.max(1, this.canvas.clientHeight);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    this.canvas.width = this.background.width = Math.ceil(this.width * ratio);
    this.canvas.height = this.background.height = Math.ceil(this.height * ratio);
    this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.backgroundCtx.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.dirty = true;
  }

  setQuality(quality) { this.quality = quality; this.dirty = true; }
  resetView() {
    this.following = false;
    this.camera.position.set(...INITIAL_POSITION);
    this.controls.target.set(...INITIAL_TARGET);
    this.controls.update();
  }

  setMap(map) {
    this.map = map;
    for (const point of this.points) point.y = ground(map, point.x, point.z);
    for (const patch of this.patch) {
      const at = tile(patch.x, patch.z);
      patch.y = ground(map, patch.x, patch.z);
      patch.canopy = map[at + 1];
      patch.food = map[at + 2];
      patch.wet = map[at + 3];
      patch.fire = map[at + 4];
    }
    this.dirty = true;
  }

  project(x, y, z, result = {}) {
    this.pointer.set(x, y, z).project(this.camera);
    result.sx = (1 + this.pointer.x) * this.width * .5;
    result.sy = (1 - this.pointer.y) * this.height * .5;
    result.depth = this.pointer.z;
    return result;
  }

  locate(x, y) {
    if (!this.map) return null;
    this.cursor.set(x / this.width * 2 - 1, 1 - y / this.height * 2);
    this.ray.setFromCamera(this.cursor, this.camera);
    const { ray } = this.ray;
    const point = new Vector3();
    let last = 0;
    for (let meters = 2.4; meters <= 880; meters += 2.4) {
      ray.at(meters, point);
      if (Math.abs(point.x) > HALF || Math.abs(point.z) > HALF || point.y > ground(this.map, point.x, point.z)) {
        last = meters;
        continue;
      }
      for (let i = 0; i < 5; i++) {
        const middle = (last + meters) * .5;
        ray.at(middle, point);
        if (point.y > ground(this.map, point.x, point.z)) last = middle;
        else meters = middle;
      }
      return ray.at(meters, point);
    }
    return null;
  }

  hover(x, y, radius) {
    this.ring.hit = this.locate(x, y);
    this.ring.visible = Boolean(this.ring.hit);
    this.ring.radius = radius;
  }

  pick(x, y) { return this.fauna.pick(x, y, this.camera, this.width, this.height); }

  focus(id, zoom = false) {
    const a = this.fauna.records.get(id);
    if (!a) return;
    if (zoom) {
      this.camera.position.set(a.x + 24, a.y + 20, a.z + 29);
      this.controls.target.set(a.x, a.y + 2, a.z);
      this.controls.update();
    }
    this.following = zoom;
  }

  mountains(ctx, night) {
    const colors = [[134, 155, 146], [99, 125, 116], [74, 101, 89]];
    const at = clamp(.32 + this.controls.getPolarAngle() * .16, .32, .59);
    const shift = this.controls.getAzimuthalAngle();
    for (let row = 0; row < colors.length; row++) {
      const baseline = this.height * (at + row * .065);
      const projectedWidth = Math.min(this.width, this.height * 2.2);
      ctx.fillStyle = rgb(BLEND(colors[row], [23, 39, 37], night * .90));
      ctx.beginPath();
      ctx.moveTo(-3, this.height);
      for (let x = -3; x < this.width + 9; x += 6) {
        const t = x / projectedWidth * 15 + shift * 1.6 + row * 2.6;
        const noise = Math.abs(Math.sin(t * .53) * .58 + Math.sin(t * .91 + row) * .42);
        const detail = Math.sin(t * 5.3) * .039 + Math.cos(t * 11) * .025;
        ctx.lineTo(x, baseline - (noise + detail) * this.height * (.29 - row * .040));
      }
      ctx.lineTo(this.width + 9, this.height);
      ctx.fill();
    }
  }

  polygon(ctx, coordinates, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    for (const [i, p] of coordinates.entries()) {
      if (i === 0) ctx.moveTo(p.sx, p.sy);
      else ctx.lineTo(p.sx, p.sy);
    }
    ctx.closePath();
    ctx.fill();
  }

  tree(ctx, patch, night) {
    const base = this.project(patch.x, patch.y, patch.z);
    const top = this.project(patch.x, patch.y + patch.h * 7.4, patch.z);
    const h = base.sy - top.sy;
    if (h < 1.5) return;
    const tints = [[36, 67, 45], [57, 86, 48], [78, 109, 56]];
    const w = h * (.23 + patch.shade * .08);
    ctx.fillStyle = rgb(BLEND([93, 80, 53], [36, 38, 35], night * .80));
    ctx.fillRect(base.sx - w * .11, base.sy - .54 * h, w * .19, .54 * h);
    for (let row = 0; row < 3; row++) {
      const hue = BLEND(tints[row], [22, 39, 32], night * .80);
      const y = top.sy + h * (.83 - .22 * row);
      const span = w * (1 - row * .22);
      this.polygon(ctx, [{ sx: base.sx, sy: y - h * .46 }, { sx: base.sx - span, sy: y },
        { sx: base.sx + span, sy: y }], rgb(hue));
      this.polygon(ctx, [{ sx: base.sx, sy: y - h * .46 }, { sx: base.sx + span * .18, sy: y },
        { sx: base.sx + span, sy: y }], rgb(BLEND(hue, [36, 51, 35], .37)));
    }
  }

  paintLand(night) {
    const ctx = this.backgroundCtx;
    const sky = ctx.createLinearGradient(0, 0, 0, this.height * .68);
    const preset = SKY_PRESETS[this.weather];
    const fog = [(preset.color >> 16) & 255, (preset.color >> 8) & 255, preset.color & 255];
    sky.addColorStop(0, rgb(BLEND([115, 159, 164], [20, 37, 46], night)));
    sky.addColorStop(.67, rgb(BLEND(fog, [55, 75, 71], night * .86)));
    sky.addColorStop(1, rgb(BLEND([82, 109, 83], [35, 54, 48], night)));
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, this.width, this.height);
    this.mountains(ctx, night);
    if (!this.map) return;

    for (const p of this.points) this.project(p.x, Math.max(p.y, WATER), p.z, p);
    const row = DIVISIONS + 1;
    const ordered = this.patch.map(p => {
      const corner = this.points[p.index];
      p.depth = corner.depth;
      return p;
    }).sort((a, b) => b.depth - a.depth);
    for (const patch of ordered) {
      const { index, shade, v, y, wet, food, canopy, fire } = patch;
      const vertices = [this.points[index], this.points[index + 1], this.points[index + row + 1], this.points[index + row]];
      const visible = vertices.some(p => p.depth < 1 && p.depth > -1 && p.sx > -175 && p.sx < this.width + 175 && p.sy > -125 && p.sy < this.height + 125);
      if (!visible) continue;
      const water = y <= WATER;
      const rock = clamp((Math.abs(vertices[0].y - vertices[2].y) / 12 + Math.max(0, y - 13) / 37) * .79);
      const vegetation = BLEND([129, 127, 72], [88, 118, 62], clamp(.17 + food * .70 + wet * .30 - canopy * .12));
      const stone = [127 + shade * 25, 130 + shade * 22, 104 + shade * 18];
      const land = water ? BLEND([53, 109, 103], [122, 164, 146], shade * .64) :
        BLEND(BLEND(vegetation, stone, rock), [65, 54, 40], fire * .84);
      const depth = Math.hypot(this.camera.position.x - patch.x, this.camera.position.z - patch.z);
      const mist = clamp(depth * preset.fog * .73, 0, .84) ** 1.85;
      const colored = BLEND(BLEND(land, fog, mist), [30, 51, 45], night * .78);
      const color = rgb(colored.map(c => Math.round(c * (.90 + shade * .18))));
      this.polygon(ctx, vertices, color);
      ctx.strokeStyle = color;
      ctx.lineWidth = .8;
      ctx.stroke();
      if (water && shade > .78 && this.quality !== 'eco') {
        const a = this.project(patch.x - 1, WATER + .05, patch.z);
        const b = this.project(patch.x + 2.1, WATER + .05, patch.z);
        ctx.strokeStyle = '#d6ead34a';
        ctx.beginPath();
        ctx.moveTo(a.sx, a.sy);
        ctx.lineTo(b.sx, b.sy);
        ctx.stroke();
      }
      if (!water && y > .26 && v < canopy * .85 && fire < .35) this.tree(ctx, patch, night);
    }
  }

  paintIndicators(ctx, now) {
    const rows = [];
    for (const a of this.fauna.records.values()) {
      const p = this.project(a.x, a.y + .65, a.z);
      if (p.depth < -1 || p.depth > 1 || p.sx < 0 || p.sx > this.width || p.sy < 0 || p.sy > this.height) continue;
      rows.push({ a, ...p });
    }
    rows.sort((a, b) => b.depth - a.depth);
    for (const { a, sx, sy, depth } of rows) {
      const close = clamp((1 - depth) * 125, .45, 4);
      const color = a.species ? '#ef9f70' : '#d4eea9';
      if (a.id === this.selectedId || this.markers || close > 1.6) {
        ctx.fillStyle = a.hidden ? '#1d3023' : color;
        ctx.strokeStyle = a.hidden ? color : '#26392e';
        ctx.lineWidth = 1.25;
        ctx.beginPath();
        ctx.arc(sx, sy, 1.5 + close * .62, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      if (a.id === this.selectedId) {
        ctx.strokeStyle = '#e7f4b9';
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.arc(sx, sy, 7.5 + Math.sin(now * 4), 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    if (this.ring.visible && this.ring.hit && this.map) {
      const { x, z } = this.ring.hit;
      ctx.strokeStyle = '#eef7c9';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i <= 42; i++) {
        const angle = i / 42 * Math.PI * 2;
        const px = x + Math.cos(angle) * this.ring.radius, pz = z + Math.sin(angle) * this.ring.radius;
        const y = Math.max(WATER, ground(this.map, px, pz));
        const p = this.project(px, y + .3, pz);
        if (i === 0) ctx.moveTo(p.sx, p.sy);
        else ctx.lineTo(p.sx, p.sy);
      }
      ctx.stroke();
    }
  }

  paintWeather(ctx, now) {
    if (this.weather === 'rain') {
      ctx.strokeStyle = '#d7e7ed43';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i < 200; i++) {
        const x = (i * 91.28 + now * 24) % this.width;
        const y = (i * 166.5 + now * 360) % this.height;
        ctx.moveTo(x, y);
        ctx.lineTo(x + 3, y + 12 + i % 8);
      }
      ctx.stroke();
    }
    for (const patch of this.patch) {
      if (patch.fire <= .16 || patch.y <= WATER) continue;
      const f = (now * (1.6 + patch.v) + patch.shade * 3) % 1;
      const p = this.project(patch.x + f * .68, patch.y + f * 3, patch.z);
      if (p.depth < -1 || p.depth > 1 || p.sy > this.height) continue;
      ctx.fillStyle = f > .58 ? '#ee7d3f55' : '#ffd27cbb';
      ctx.beginPath();
      ctx.arc(p.sx, p.sy, 2 + 5 * patch.fire * (1 - f), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  draw(timestamp) {
    requestAnimationFrame(this.draw);
    const now = timestamp / 1000;
    if (now - this.last < .032) return;
    const dt = Math.min(.1, now - this.last);
    this.last = now;
    this.controls.update(dt);
    const tracked = this.fauna.records.get(this.selectedId);
    if (this.following && tracked) {
      const target = this.controls.target;
      this.offset.set(tracked.x, tracked.y + 1.6, tracked.z).sub(target).multiplyScalar(dt * 4);
      target.add(this.offset);
      this.camera.position.add(this.offset);
    }
    this.camera.updateMatrixWorld();
    const altitude = Math.sin(((8.5 + this.time / 26 + this.dayOffset) % 24 - 6) / 24 * Math.PI * 2);
    const night = clamp((.18 - altitude) * 2.05);
    const key = [this.weather, night.toFixed(2), ...this.camera.position, ...this.controls.target]
      .map(x => typeof x === 'number' ? x.toFixed(1) : x).join('/');
    if (this.dirty || key !== this.key) {
      this.paintLand(night);
      this.key = key;
      this.dirty = false;
    }
    this.ctx.drawImage(this.background, 0, 0, this.width, this.height);
    if (this.map) {
      const blend = 1 - Math.exp(-dt * 13);
      for (const a of this.fauna.records.values()) {
        a.x += (a.tx - a.x) * blend;
        a.z += (a.tz - a.z) * blend;
        a.y = onWaterSurface(ground(this.map, a.x, a.z), a.targetSwimming);
      }
      this.paintWeather(this.ctx, now);
      this.paintIndicators(this.ctx, now);
    }
    this.frames++;
    if (now - this.fpsStart >= 1) {
      this.fps = Math.round(this.frames / (now - this.fpsStart));
      this.frames = 0;
      this.fpsStart = now;
    }
  }
}

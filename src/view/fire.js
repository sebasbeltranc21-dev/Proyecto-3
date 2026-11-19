import * as T from 'three';
import { CHANNELS, GRID, HALF, STEP, WATER, clamp } from '../sim/config.js';
import { ground } from '../sim/terrain.js';
import { fireMaterial } from './shaders/fire.js';

const CAPACITY = { flames: 660, smoke: 420, embers: 1250 };
const hash = x => {
  const n = Math.sin(x * 173.41 + 5.14) * 43758.5453;
  return n - Math.floor(n);
};

function layer(scene, name, uniforms, order) {
  const max = CAPACITY[name];
  const material = fireMaterial(name, uniforms);
  const dust = name === 'embers';
  const geometry = dust ? new T.BufferGeometry() : new T.InstancedBufferGeometry();
  if (dust) geometry.setAttribute('position', new T.BufferAttribute(new Float32Array(max * 3), 3));
  else {
    const plane = new T.PlaneGeometry(1, 1);
    geometry.copy(plane);
    plane.dispose();
  }
  const Attribute = dust ? T.BufferAttribute : T.InstancedBufferAttribute;
  const origins = new Attribute(new Float32Array(max * 3), 3).setUsage(T.DynamicDrawUsage);
  const details = new Attribute(new Float32Array(max * 4), 4).setUsage(T.DynamicDrawUsage);
  geometry.setAttribute('aOrigin', origins);
  geometry.setAttribute('aFire', details);
  const item = dust ? new T.Points(geometry, material) : new T.Mesh(geometry, material);
  item.name = name;
  item.frustumCulled = false;
  item.visible = false;
  item.renderOrder = order;
  item.userData.bloom = name === 'flames';
  item.userData.skipAO = true;
  scene.add(item);
  let count = 0;
  return {
    clear() { count = 0; },
    use(x, y, z, seed, heat, width, height) {
      if (count >= max) return;
      origins.setXYZ(count, x, y, z);
      details.setXYZW(count++, seed, heat, width, height);
    },
    commit() {
      item.visible = count > 0;
      if (dust) geometry.setDrawRange(0, count);
      else geometry.instanceCount = count;
      if (count === 0) return;
      origins.needsUpdate = details.needsUpdate = true;
    },
  };
}

export function makeBurnScars() {
  const history = new Float32Array(GRID * GRID);
  const pixels = new Uint8Array(GRID * GRID);
  const texture = new T.DataTexture(pixels, GRID, GRID, T.RedFormat);
  texture.magFilter = texture.minFilter = T.LinearFilter;
  texture.needsUpdate = true;
  let last = 0;
  return {
    texture,
    update(map, time) {
      const delta = Math.max(0, time - last);
      last = time;
      for (let i = 0, at = 0; i < history.length; i++, at += CHANNELS) {
        const heat = map[at + 4];
        const recovery = .0028 + map[at + 3] * .0013 + map[at + 2] * .0021;
        history[i] = map[at] <= WATER ? 0 :
          Math.max(heat * 1.04, history[i] * Math.exp(-delta * recovery));
        pixels[i] = Math.round(clamp(history[i]) * 255);
      }
      texture.needsUpdate = true;
    },
    reset() {
      last = 0;
      history.fill(0);
      pixels.fill(0);
      texture.needsUpdate = true;
    },
  };
}

export class Wildfire {
  constructor(scene) {
    this.uniforms = {
      clock: { value: 0 }, wind: { value: 0 },
      fogDensity: { value: scene.fog.density }, fogTint: { value: scene.fog.color },
    };
    this.flames = layer(scene, 'flames', this.uniforms, 3);
    this.smoke = layer(scene, 'smoke', this.uniforms, 4);
    this.embers = layer(scene, 'embers', this.uniforms, 5);
    this.layers = [this.flames, this.smoke, this.embers];
    this.glow = new T.PointLight(0xff6929, 0, 35, 2);
    scene.add(this.glow);
    this.burn = [];
    this.nearby = [];
    this.fog = scene.fog;
    this.glowPower = 0;
    this.dirty = true;
    this.nextRefresh = 0;
    this.lens = new T.Frustum();
    this.matrix = new T.Matrix4();
    this.box = new T.Sphere(new T.Vector3(), 15);
  }

  setMap(map) {
    this.map = map;
    this.burn.length = 0;
    for (let i = 0, at = 0; i < GRID * GRID; i++, at += CHANNELS) {
      const heat = map[at + 4];
      if (heat < .064 || map[at] <= WATER) continue;
      const x = ((i % GRID) + .5) * STEP - HALF, z = (Math.floor(i / GRID) + .5) * STEP - HALF;
      const seed = hash(i + 1);
      const fx = x + (hash(i * 2 + 41) - .5) * STEP * .58;
      const fz = z + (hash(i * 2 + 42) - .5) * STEP * .58;
      const y = ground(map, fx, fz);
      if (y > WATER + .05) this.burn.push({ x: fx, y, z: fz, heat, seed, distance: 0 });
    }
    this.dirty = true;
  }

  reset() {
    this.burn.length = this.nearby.length = 0;
    for (const effect of this.layers) { effect.clear(); effect.commit(); }
    this.glowPower = this.glow.intensity = 0;
    this.dirty = true;
  }

  rebuild(camera, capacity) {
    for (const effect of this.layers) effect.clear();
    this.matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.lens.setFromProjectionMatrix(this.matrix);
    this.nearby.length = 0;
    let core = null, heat = 0, lx = 0, ly = 0, lz = 0;
    let best = -Infinity;
    for (const cell of this.burn) {
      const dx = cell.x - camera.position.x, dz = cell.z - camera.position.z;
      cell.distance = dx * dx + dz * dz;
      const score = cell.heat * 2 - cell.distance / 28000;
      if (score > best) { best = score; core = cell; }
      this.box.center.set(cell.x, cell.y + 6, cell.z);
      if (this.lens.intersectsSphere(this.box)) this.nearby.push(cell);
    }
    if (core) {
      for (const cell of this.burn) {
        if ((cell.x - core.x) ** 2 + (cell.z - core.z) ** 2 > 17 ** 2) continue;
        heat += cell.heat;
        lx += cell.x * cell.heat;
        ly += cell.y * cell.heat;
        lz += cell.z * cell.heat;
      }
      this.glow.position.set(lx / heat, ly / heat + 2.7, lz / heat);
    }
    this.glowPower = core ? 43 * core.heat + Math.min(125, heat * 6.2) : 0;

    this.nearby.sort((a, b) => a.distance - b.distance);
    const count = Math.min(this.nearby.length, capacity);
    for (let i = 0; i < count; i++) {
      const { x, y, z, seed, heat } = this.nearby[i];
      const span = .47 + heat * 1.96;
      const height = 1.25 + heat * (3.45 + seed * 1.65);
      this.flames.use(x, y, z, seed * 12.049, heat, span, height);
      if (heat > .19) {
        const nextX = x + (seed - .5) * 1.21, nextZ = z + (hash(seed) - .5) * 1.32;
        const nextY = ground(this.map, nextX, nextZ);
        if (nextY > WATER) {
          this.flames.use(nextX, nextY, nextZ, seed * 4.2 + 2.1, heat * .87,
            span * .76, height * (.68 + seed * .19));
        }
      }
      if (heat > .18) {
        for (let j = 0; j < (heat > .62 ? 5 : 2); j++) {
          this.embers.use(x, y + .12, z, seed * 7.51 + j * .283, heat, 1, height * (1.12 + j * .16));
        }
      }
    }
    // Blend straight-alpha smoke back to front. Flames and embers are additive.
    for (let i = count - 1; i >= 0; i--) {
      const { x, y, z, seed, heat } = this.nearby[i];
      if (heat < .13 || (i % 2 && heat < .40)) continue;
      this.smoke.use(x, y, z, seed * 5.71, heat, 2.2 + heat * 3.55, 3.2 + heat * 6.96);
      if (heat > .60) this.smoke.use(x, y, z, seed * 5.71 + .47, heat * .90, 2.05 + heat * 4.2, 3.5 + heat * 7.7);
    }
    for (const effect of this.layers) effect.commit();
  }

  tick(time, weather, night, camera, profile) {
    this.uniforms.clock.value = time;
    this.uniforms.wind.value = weather === 'rain' ? 1.56 : weather === 'fog' ? .57 : .83;
    this.uniforms.fogDensity.value = this.fog.density;
    if (this.dirty || (this.burn.length && time >= this.nextRefresh)) {
      this.rebuild(camera, profile.fireCells);
      this.nextRefresh = time + .13;
      this.dirty = false;
    }
    const flicker = .86 + .09 * Math.sin(time * 15.1) + .07 * Math.sin(time * 22.7 + .8) + .05 * Math.sin(time * 8.5);
    this.glow.intensity = this.glowPower * flicker * (1 + night * 1.18);
  }
}

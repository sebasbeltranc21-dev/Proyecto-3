import { propChunks, solidProps } from '../sim/props.js';
import * as T from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { CHANNELS, GRID, HALF, SIZE, STEP, WATER, clamp, rng } from '../sim/config.js';
import { ground, tile } from '../sim/terrain.js';
import { terrainSurface } from './shaders/terrain.js';
import { makeTracks, sway } from './shaders/foliage.js';
import { makeRiverSurface } from './shaders/water.js';
import { makeBurnScars, Wildfire } from './fire.js';

const SUN = new T.Vector3(-.62, .58, -.52).normalize();
function makeTerrain(scene, field, scars, assets, register, onTextures) {
  const resolution = 148;
  const geometry = new T.PlaneGeometry(SIZE, SIZE, resolution, resolution).rotateX(-Math.PI / 2);
  const material = new T.MeshStandardMaterial({ color: 0xffffff, roughness: 1 });
  const uniforms = terrainSurface(material, field, scars, assets, register, onTextures);
  const mesh = new T.Mesh(geometry, material);
  mesh.receiveShadow = true;
  scene.add(mesh);
  const position = geometry.attributes.position;
  let previous = null;
  return {
    mesh, material, uniforms,
    update(map) {
      let changed = !previous;
      if (previous) {
        for (let i = 0; i < map.length; i += CHANNELS) {
          if (previous[i] !== map[i]) { changed = true; break; }
        }
      }
      if (!changed) return;
      previous = map;
      for (let i = 0; i < position.count; i++) position.setY(i, ground(map, position.getX(i), position.getZ(i)));
      position.needsUpdate = true;
      geometry.computeVertexNormals();
      geometry.computeBoundingSphere();
    },
  };
}

// The outer ridges share the editable map's perimeter to hide the seam at every camera angle.
function mountainRing(scene, material) {
  const segments = 280;
  const rings = Array.from({ length: 32 }, (_, index) => 360 * (index / 31) ** 1.45);
  const positions = [], indices = [], points = [];
  const blend = t => t * t * (3 - 2 * t);
  for (const [row, distance] of rings.entries()) {
    for (let index = 0; index <= segments; index++) {
      const angle = (index % segments) / segments * Math.PI * 2;
      const cos = Math.cos(angle), sin = Math.sin(angle);
      const edge = HALF / Math.max(Math.abs(cos), Math.abs(sin));
      const x = cos * (edge + distance), z = sin * (edge + distance);
      const shoulder = blend(clamp(distance / 72));
      const envelope = Math.sin(Math.min(1, distance / 325) * Math.PI) ** 1.5;
      const ridge = Math.abs(Math.sin(angle * 4 + .85) * .57 + Math.sin(angle * 7 + .4) * .43) ** 1.26;
      const fold = .79 + Math.cos(distance * .036 + angle * 6.2 + .8 * Math.sin(angle * 16)) * .20;
      const details = 3.1 * Math.sin(x * .065 + z * .083) + 1.7 * Math.sin(x * .153 - z * .124) +
        .74 * Math.sin(x * .301 + z * .092);
      const crag = Math.abs(Math.sin(angle * 18.0 + distance * .024)) ** 1.37;
      const mountain = 8.6 + envelope * (19 + ridge * 109 + crag * 12) * fold + details;
      points.push([cos * edge, sin * edge, shoulder, mountain]);
      positions.push(x, mountain, z);
      if (row + 1 < rings.length && index < segments) {
        const i = row * (segments + 1) + index, j = i + segments + 1;
        indices.push(i, i + 1, j, i + 1, j + 1, j);
      }
    }
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  const mesh = new T.Mesh(geometry, material);
  mesh.receiveShadow = true;
  scene.add(mesh);
  const position = geometry.attributes.position;
  const last = new Float32Array(points.length).fill(Infinity);
  const seam = new T.Vector3();
  return map => {
    let dirty = false;
    for (const [i, [x, z, mix, mountain]] of points.entries()) {
      const height = (1 - mix) * ground(map, x, z) + mountain * mix;
      if (last[i] === height) continue;
      last[i] = height;
      dirty = true;
      position.setY(i, height);
    }
    if (!dirty) return;
    position.needsUpdate = true;
    geometry.computeVertexNormals();
    const normals = geometry.attributes.normal;
    for (let row = 0; row < rings.length; row++) {
      const a = row * (segments + 1), b = a + segments;
      seam.set(normals.getX(a) + normals.getX(b), normals.getY(a) + normals.getY(b), normals.getZ(a) + normals.getZ(b)).normalize();
      normals.setXYZ(a, seam.x, seam.y, seam.z);
      normals.setXYZ(b, seam.x, seam.y, seam.z);
    }
    normals.needsUpdate = true;
    geometry.computeBoundingSphere();
  };
}

function tint(geometry, value, variation = .15) {
  const part = geometry.index ? geometry.toNonIndexed() : geometry;
  if (part !== geometry) geometry.dispose();
  const color = new T.Color(value);
  const position = part.attributes.position;
  const colors = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    const scale = 1 + Math.sin(position.getX(i) * 25 + position.getZ(i) * 12) * variation;
    colors.set([color.r * scale, color.g * scale, color.b * scale], i * 3);
  }
  part.setAttribute('color', new T.BufferAttribute(colors, 3));
  return part;
}

function pine(detail) {
  const bark = tint(new T.CylinderGeometry(.04, .24, 5.98, detail ? 8 : 5).translate(0, 2.99, 0),
    0x6c523d, .22);
  bark.deleteAttribute('uv');
  const random = rng(2466);
  const positions = [], colors = [], indices = [];
  const foliage = new T.BufferGeometry();
  const light = new T.Color(), shadow = new T.Color();
  const total = detail ? 10 : 7;
  for (let tier = 0; tier < total; tier++) {
    const fraction = tier / total;
    const y = 1.46 + fraction * 4.86;
    const length = (.23 + 1.82 * (1 - fraction) ** .84) * (.88 + random() * .22);
    const branches = detail ? 6 : 5;
    for (let branch = 0; branch < branches; branch++) {
      const a = branch / branches * 6.2831853 + tier * 1.83 + (random() - .5) * .47;
      const sweep = .85 + random() * .29;
      const lengthHere = length * sweep;
      const rise = (.155 + random() * .37) * (1 - fraction * .64);
      const palette = random();
      light.setHSL(.235 + palette * .076 + fraction * .012, .34 + palette * .12, .25 + fraction * .12 + palette * .08);
      shadow.copy(light).multiplyScalar(.57 + palette * .11);
      const spray = (axis, root, size, breadth, peak) => {
        const base = positions.length / 3;
        const sin = Math.sin(axis), cos = Math.cos(axis);
        const points = [
          [0, 0, 0], [.35, -.065, -breadth], [.67, -.12, -breadth * .75],
          [1.0, .075 + rise, 0], [.64, -.105, breadth * .84], [.28, -.045, breadth],
          [.39, peak, -.045], [.43, -.19, .021],
        ];
        for (const [i, [along, h, cross]] of points.entries()) {
          positions.push(cos * (root + along * size) - sin * cross * size, y + h * size,
            sin * (root + along * size) + cos * cross * size);
          const tint = i === 6 || i === 3 ? light : shadow;
          colors.push(tint.r, tint.g, tint.b);
        }
        for (let i = 0; i < 6; i++) {
          const j = (i + 1) % 6;
          indices.push(base + i, base + 6, base + j, base + i, base + j, base + 7);
        }
      };
      spray(a, .02, lengthHere, .26 + palette * .08, .225 + rise * .30);
      if (detail && tier < total - 2 && branch % 2 === 0) {
        spray(a + .28, lengthHere * .21, lengthHere * .68, .23, .21);
      }
    }
  }
  const tip = positions.length / 3;
  for (let side = 0; side < 5; side++) {
    const angle = side / 5 * Math.PI * 2;
    positions.push(Math.cos(angle) * .31, 5.73, Math.sin(angle) * .31);
    colors.push(light.r, light.g, light.b);
    indices.push(tip + side, tip + 5, tip + (side + 1) % 5);
  }
  positions.push(0, 6.38, 0);
  colors.push(light.r * 1.03, light.g * 1.06, light.b);
  foliage.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  foliage.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
  foliage.setIndex(indices);
  foliage.computeVertexNormals();
  const crown = foliage.toNonIndexed();
  const geometry = mergeGeometries([bark, crown]);
  for (const part of [bark, crown, foliage]) part.dispose();
  return geometry;
}

function grassGeometry() {
  const positions = [], colors = [], random = rng(3191);
  for (let i = 0; i < 6; i++) {
    const h = .36 + random() * .60, angle = random() * Math.PI * 2;
    const root = (random() - .5) * .56, wide = .017 + random() * .024;
    const bend = .13 + random() * .27;
    const sin = Math.sin(angle), cos = Math.cos(angle);
    const point = (span, y, offset) => [cos * (root + offset) + sin * span, y, sin * (root + offset) - cos * span];
    const baseL = point(-wide, 0, 0), baseR = point(wide, 0, 0);
    const midL = point(-wide * .53, h * .58, bend * .36), midR = point(wide * .53, h * .58, bend * .36);
    const tip = point(0, h, bend);
    for (const vertex of [baseL,baseR,midL,baseR,midR,midL,midL,midR,tip]) {
      positions.push(...vertex);
      const brightness = .46 + vertex[1] * .60;
      colors.push(brightness, brightness * (1.0 + vertex[1] * .10), brightness * .79);
    }
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function shrubGeometry() {
  const foliage = [];
  for (let i = 0; i < 7; i++) {
    const angle = i * 2.3999;
    foliage.push(tint(new T.IcosahedronGeometry(.49, 1).scale(1, .75, .62)
      .rotateY(angle).translate(Math.sin(angle) * .47, .46 + i % 3 * .15, Math.cos(angle) * .51),
    i % 3 === 0 ? 0x74884e : 0x506e39, .20));
  }
  const result = mergeGeometries(foliage);
  for (const leaf of foliage) leaf.dispose();
  return result;
}

function smoothRock() {
  const raw = new T.IcosahedronGeometry(1, 2);
  raw.deleteAttribute('normal');
  raw.deleteAttribute('uv');
  const geometry = mergeVertices(raw);
  raw.dispose();
  const points = geometry.attributes.position;
  for (let i = 0; i < points.count; i++) {
    const x = points.getX(i), y = points.getY(i), z = points.getZ(i);
    const relief = .91 + .17 * Math.sin(x * 8.5 + z * 4.8) * Math.sin(y * 6.1 - z * 5.0);
    points.setXYZ(i, x * relief + y * .16, y * relief + z * .12, z * relief);
  }
  geometry.computeVertexNormals();
  return geometry;
}

function cover(scene, register) {
  const time = { value: 0 };
  const gust = { value: .33 };
  const focus = { value: new T.Vector4() };
  const tracks = makeTracks();
  const nearPine = pine(true), farPine = pine(false);
  const treeMaterial = sway(new T.MeshStandardMaterial({ vertexColors: true, roughness: .95, side: T.DoubleSide }), time, gust, tracks, .021, false, focus);
  const grassMaterial = sway(new T.MeshStandardMaterial({ vertexColors: true, color: 0xc9dcb0, side: T.DoubleSide, roughness: .89 }), time, gust, tracks, .18, true);
  const shrubMaterial = sway(new T.MeshStandardMaterial({ vertexColors: true, roughness: .96 }), time, gust, tracks, .13, true, focus);
  const blade = grassGeometry(), shrub = shrubGeometry();
  const treeDepth = sway(new T.MeshDepthMaterial({ depthPacking: T.RGBADepthPacking }), time, gust, tracks, .021, false);
  const rockGeometry = smoothRock();
  const rockMaterial = new T.MeshStandardMaterial({ color: 0x9aa09e, roughness: .86 });
  for (const material of [treeMaterial, grassMaterial, shrubMaterial, rockMaterial]) register(material);
  const chunks = [];
  for (const placement of propChunks) {
    const trees = new T.InstancedMesh(nearPine, treeMaterial, 130);
    const grass = new T.InstancedMesh(blade, grassMaterial, 640);
    const shrubs = new T.InstancedMesh(shrub, shrubMaterial, 44);
    const rock = new T.InstancedMesh(rockGeometry, rockMaterial, 52);
    const { centerX, centerZ, candidates } = placement;
    trees.castShadow = true;
    trees.customDepthMaterial = treeDepth;
    trees.receiveShadow = true;
    grass.receiveShadow = true;
    shrubs.receiveShadow = true;
    rock.castShadow = true;
    rock.receiveShadow = true;
    for (const item of [trees, grass, rock, shrubs]) {
      item.count = 0;
      item.boundingSphere = new T.Sphere(new T.Vector3(centerX, 12, centerZ), 66);
      scene.add(item);
    }
    chunks.push({ trees, grass, rock, shrubs, centerX, centerZ, candidates, high: true, grassCount: 0 });
  }
  const object = new T.Object3D();
  const color = new T.Color();
  let lastMap;
  return {
    time, gust, tracks, focus,
    update(map, markRock) {
      const groups = [];
      lastMap = map;
      for (const chunk of chunks) {
        const { trees, grass, rock, shrubs, candidates } = chunk;
        trees.count = grass.count = rock.count = shrubs.count = 0;
        const solids = solidProps(map, chunk);
        groups.push(solids);
        for (const p of solids) {
          const mesh = p.rock ? rock : trees;
          object.position.set(p.x, p.y, p.z);
          object.scale.set(p.sx, p.sy, p.sz);
          object.rotation.set(p.rx ?? 0, p.angle, p.rz ?? 0);
          object.updateMatrix();
          mesh.setMatrixAt(mesh.count, object.matrix);
          if (!p.rock) {
            color.setHSL(.17 + map[p.at + 3] * .084 + p.density * .023, .18 + p.density * .18, .56 + p.scale * .27);
          } else if (p.bank) {
            color.setHSL(.22 + p.scale * .37, .08 + p.density * .12, .28 + p.scale * .27);
            if (WATER - p.y + .07 < p.sy * .77) markRock(p.at / CHANNELS, .58 + p.scale * .42);
          } else {
            color.setHSL(.19 + p.scale * .12, .07 + p.density * .12, .35 + p.scale * .29);
          }
          mesh.setColorAt(mesh.count++, color);
        }
        for (const [index, c] of candidates.entries()) {
          const { x, z, density, scale, angle } = c;
          const at = tile(x, z);
          const y = ground(map, x, z);
          if (y < WATER + .28) continue;
          object.position.set(x, y, z);
          object.rotation.set(0, angle, 0);
          const canopy = map[at + 1], food = map[at + 2], wet = map[at + 3], burning = map[at + 4];
          if (density * .69 < food && burning < .25) {
            object.scale.set(1 + scale * .85, .47 + scale * .76, 1 + scale * .85);
            object.updateMatrix();
            grass.setMatrixAt(grass.count, object.matrix);
            color.setHSL(.17 + wet * .097, .39 + food * .16, .32 + scale * .30);
            grass.setColorAt(grass.count++, color);
          }
          if (index >= 128 && index < 172 && wet > .18 && density < canopy && burning < .25) {
            object.scale.setScalar(.51 + scale * 1.23);
            object.updateMatrix();
            shrubs.setMatrixAt(shrubs.count++, object.matrix);
          }
        }
        chunk.grassCount = grass.count;
        for (const mesh of [trees, grass, rock, shrubs]) {
          mesh.instanceMatrix.needsUpdate = true;
          if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        }
      }
      return groups;
    },
    lod(camera, profile) {
      if (!lastMap) return;
      for (const chunk of chunks) {
        const distance = Math.hypot(camera.position.x - chunk.centerX, camera.position.z - chunk.centerZ, camera.position.y * .65);
        const high = distance < profile.treeLOD;
        if (high !== chunk.high) {
          chunk.high = high;
          chunk.trees.geometry = high ? nearPine : farPine;
          chunk.trees.castShadow = high;
        }
        chunk.grass.visible = distance < profile.grassRange;
        chunk.grass.count = Math.floor(chunk.grassCount * profile.grass);
        chunk.shrubs.visible = distance < profile.grassRange + 27;
      }
    },
  };
}

function makeRain(scene) {
  const random = rng(38261);
  const flakes = Array.from({ length: 900 }, () => [random() * SIZE - HALF, random() * 80, random() * SIZE - HALF]);
  const rainData = new Float32Array(flakes.length * 6);
  const rainGeom = new T.BufferGeometry();
  rainGeom.setAttribute('position', new T.BufferAttribute(rainData, 3).setUsage(T.DynamicDrawUsage));
  const rain = new T.LineSegments(rainGeom, new T.LineBasicMaterial({ color: 0xa5c5cc, transparent: true, opacity: .31, depthWrite: false }));
  rain.frustumCulled = false;
  scene.add(rain);
  rain.userData.skipAO = true;
  return function update(time, weather) {
    rain.visible = weather === 'rain';
    if (rain.visible) {
      for (const [i, [x, phase, z]] of flakes.entries()) {
        const h = ((phase - time * 30) % 80 + 80) % 80;
        rainData.set([x, h, z, x + .48, h - 2.7, z + .16], i * 6);
      }
      rainGeom.attributes.position.needsUpdate = true;
    }

  };
}

export function makeLand(scene, renderer, assets, register, onTextures, emitOnly) {
  const bytes = new Uint8Array(GRID * GRID * 4);
  const height = new Uint8Array(GRID * GRID * 4);
  const field = new T.DataTexture(bytes, GRID, GRID);
  const depth = new T.DataTexture(height, GRID, GRID);
  field.magFilter = field.minFilter = depth.magFilter = depth.minFilter = T.LinearFilter;
  const scars = makeBurnScars();
  const wildfire = new Wildfire(scene);
  const terrain = makeTerrain(scene, field, scars.texture, assets, register, onTextures);
  const riverSurface = makeRiverSurface(scene, renderer, depth, SUN, emitOnly);
  const water = riverSurface.uniforms;
  const rockFoam = (index, strength) => {
    height[index * 4 + 2] = Math.max(height[index * 4 + 2], Math.round(strength * 255));
  };
  const forest = cover(scene, register);
  const rain = makeRain(scene);
  const updateRidges = mountainRing(scene, terrain.material);
  return {
    mesh: terrain.mesh,
    sun: SUN,
    tracks: forest.tracks,
    resetEffects() {
      wildfire.reset();
      scars.reset();
    },
    resize: riverSurface.resize,
    get reflectionReady() { return water.mirrored.value > .5; },
    update(map, time) {
      wildfire.setMap(map);
      scars.update(map, time);
      for (let i = 0, j = 0; i < map.length; i += CHANNELS, j += 4) {
        bytes[j] = Math.round(map[i + 3] * 255);
        bytes[j + 1] = Math.round(map[i + 1] * 255);
        bytes[j + 2] = Math.round(map[i + 2] * 255);
        bytes[j + 3] = Math.round(map[i + 4] * 255);
        const packed = Math.round(clamp((WATER - map[i] + 64) / 80) * 65535);
        height[j] = packed >> 8;
        height[j + 1] = packed & 255;
        height[j + 2] = 0;
      }
      field.needsUpdate = depth.needsUpdate = true;
      terrain.update(map);
      updateRidges(map);
      return forest.update(map, rockFoam);
    },
    tick(time, night, weather, sun, camera, profile, focus) {
      water.elapsed.value = forest.time.value = time;
      water.precipitation.value = Number(weather === 'rain');
      water.night.value = night;
      water.fogStrength.value = scene.fog.density;
      water.waterSky.value.setHex(weather === 'fog' ? 0x769e94 : 0x79afb9).multiplyScalar(1 - night * .75);
      water.sunDirection.value.copy(sun);
      terrain.uniforms.snowLine.value = { clear: 33, rain: 31, fog: 26.5, heat: 45 }[weather];
      terrain.uniforms.rainfall.value = weather === 'rain' ? .90 : 0;
      forest.gust.value = weather === 'rain' ? 1.16 : weather === 'heat' ? .58 : .22;
      if (focus) forest.focus.value.set(focus.x, focus.y, focus.z, 1);
      else forest.focus.value.w = 0;
      forest.lod(camera, profile);
      wildfire.tick(time, weather, night, camera, profile);
      rain(time, weather);
    },
  };
}

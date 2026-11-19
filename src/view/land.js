import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CHANNELS, GRID, HALF, SIZE, STEP, WATER, clamp, rng } from '../sim/config.js';
import { ground, tile } from '../sim/terrain.js';
import { terrainSurface } from './shaders/terrain.js';
import { makeTracks, sway } from './shaders/foliage.js';
import { waterSurface } from './shaders/water.js';

const SUN = new T.Vector3(-.62, .58, -.52).normalize();
function makeTerrain(scene, field, assets, register, onTextures) {
  const resolution = 148;
  const geometry = new T.PlaneGeometry(SIZE, SIZE, resolution, resolution).rotateX(-Math.PI / 2);
  const material = new T.MeshStandardMaterial({ color: 0xffffff, roughness: 1 });
  const uniforms = terrainSurface(material, field, assets, register, onTextures);
  const mesh = new T.Mesh(geometry, material);
  mesh.receiveShadow = true;
  scene.add(mesh);
  const position = geometry.attributes.position;
  let previous = null;
  return {
    mesh, uniforms,
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

function makeWater(scene, depth) {
  const { material, uniforms } = waterSurface(scene, depth, SUN);
  const water = new T.Mesh(new T.PlaneGeometry(SIZE, SIZE).rotateX(-Math.PI / 2), material);
  water.position.y = WATER;
  water.renderOrder = 1;
  scene.add(water);
  return uniforms;
}

// The outer ridges share the editable map's perimeter to hide the seam at every camera angle.
function mountainRing(scene, register) {
  const segments = 224;
  const rings = [0, 5, 12, 21, 33, 47, 64, 82, 103, 126, 151, 177, 206, 237, 270, 312, 360];
  const positions = [], indices = [], colors = [], points = [];
  const meadow = new T.Color(0x6f8051), granite = new T.Color(0x656c61), frost = new T.Color(0xc1c9be);
  const shade = new T.Color();
  const blend = t => t * t * (3 - 2 * t);
  for (const [row, distance] of rings.entries()) {
    for (let index = 0; index <= segments; index++) {
      const angle = index / segments * Math.PI * 2;
      const cos = Math.cos(angle), sin = Math.sin(angle);
      const edge = HALF / Math.max(Math.abs(cos), Math.abs(sin));
      const x = cos * (edge + distance), z = sin * (edge + distance);
      const shoulder = blend(clamp(distance / 74));
      const envelope = Math.sin(Math.min(1, distance / 322) * Math.PI) ** 1.64;
      const ridge = Math.abs(Math.sin(angle * 4.0 + .85) * .62 + Math.sin(angle * 7.0 + .4) * .38) ** 1.36;
      const fold = .72 + Math.cos(distance * .038 + angle * 7.0) * .22;
      const details = 3.7 * Math.sin(x * .064 + z * .084) + 2.2 * Math.sin(x * .17 - z * .12) +
        .95 * Math.sin(x * .31 + z * .087);
      const mountain = 9 + envelope * (19 + ridge * 103 + Math.abs(Math.sin(angle * 22 + distance * .026)) * 14) * fold + details;
      points.push([cos * edge, sin * edge, shoulder, mountain]);
      positions.push(x, mountain, z);
      colors.push(0, 0, 0);
      if (row + 1 < rings.length && index < segments) {
        const i = row * (segments + 1) + index, j = i + segments + 1;
        indices.push(i, i + 1, j, i + 1, j + 1, j);
      }
    }
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  const material = new T.MeshStandardMaterial({ vertexColors: true, roughness: .97, side: T.DoubleSide });
  register(material);
  const mesh = new T.Mesh(geometry, material);
  mesh.receiveShadow = true;
  scene.add(mesh);
  const position = geometry.attributes.position, color = geometry.attributes.color;
  const last = new Float32Array(points.length).fill(Infinity);
  return map => {
    let dirty = false;
    for (const [i, [x, z, mix, mountain]] of points.entries()) {
      const height = (1 - mix) * ground(map, x, z) + mountain * mix;
      if (last[i] === height) continue;
      last[i] = height;
      dirty = true;
      position.setY(i, height);
      const broad = .5 + .5 * Math.sin(position.getX(i) * .080 - position.getZ(i) * .077);
      const talus = clamp((height - 13) / 42 + broad * .25);
      shade.copy(meadow).lerp(granite, talus).lerp(frost, clamp((height - 53 + broad * 10) / 23) * .92);
      shade.multiplyScalar(.82 + broad * .22);
      color.setXYZ(i, shade.r, shade.g, shade.b);
    }
    if (!dirty) return;
    position.needsUpdate = color.needsUpdate = true;
    geometry.computeVertexNormals();
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
  const branches = [tint(new T.CylinderGeometry(.12, .25, 2.4, detail ? 6 : 4).translate(0, 1.2, 0), 0x6d5136)];
  const shades = [0x344e26, 0x486137, 0x61713c, 0x6e8047];
  const tiers = detail ? [0, 1, 2, 3] : [0, 2, 3];
  for (const i of tiers) {
    const radius = 1.7 - .27 * i;
    const y = 1.61 + i * 1.01;
    const cone = new T.CylinderGeometry(.11, radius, 2.29 - i * .17, detail ? 9 : 5, 1);
    const positions = cone.attributes.position;
    for (let j = 0; j < positions.count; j++) {
      const x = positions.getX(j), z = positions.getZ(j);
      const spread = 1 + Math.sin(Math.atan2(z, x) * 5 + i) * .13;
      positions.setXYZ(j, x * spread, positions.getY(j) + Math.sin(x * 6 + z * 9 + i) * .23, z * spread);
    }
    cone.rotateY(i * 1.8).translate(0, y, 0);
    cone.computeVertexNormals();
    branches.push(tint(cone, shades[i], .23));
  }
  const geometry = mergeGeometries(branches);
  for (const branch of branches) branch.dispose();
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

function cover(scene, register) {
  const time = { value: 0 };
  const gust = { value: .33 };
  const tracks = makeTracks();
  const nearPine = pine(true), farPine = pine(false);
  const treeMaterial = sway(new T.MeshStandardMaterial({ vertexColors: true, roughness: .89, flatShading: true }), time, gust, tracks, .024, false);
  const grassMaterial = sway(new T.MeshStandardMaterial({ vertexColors: true, color: 0xc9dcb0, side: T.DoubleSide, roughness: .89 }), time, gust, tracks, .18, true);
  const shrubMaterial = sway(new T.MeshStandardMaterial({ vertexColors: true, roughness: .98, flatShading: true }), time, gust, tracks, .16, true);
  const blade = grassGeometry(), shrub = shrubGeometry();
  const rockGeometry = new T.DodecahedronGeometry(1, 0);
  const rockMaterial = new T.MeshStandardMaterial({ color: 0x9aa09e, roughness: .94, flatShading: true });
  for (const material of [treeMaterial, grassMaterial, shrubMaterial, rockMaterial]) register(material);
  const chunks = [];
  const random = rng(185513);
  for (let v = 0; v < 5; v++) {
    for (let u = 0; u < 5; u++) {
      const trees = new T.InstancedMesh(nearPine, treeMaterial, 130);
      const grass = new T.InstancedMesh(blade, grassMaterial, 640);
      const shrubs = new T.InstancedMesh(shrub, shrubMaterial, 44);
      const rock = new T.InstancedMesh(rockGeometry, rockMaterial, 28);
      const centerX = (u + .5) * 64 - HALF, centerZ = (v + .5) * 64 - HALF;
      trees.castShadow = true;
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
      const candidates = Array.from({ length: 640 }, () => ({
        x: centerX + (random() - .5) * 64, z: centerZ + (random() - .5) * 64,
        density: random(), scale: random(), angle: random() * Math.PI * 2,
      }));
      chunks.push({ trees, grass, rock, shrubs, centerX, centerZ, candidates, high: true, grassCount: 0 });
    }
  }
  const object = new T.Object3D();
  const color = new T.Color();
  let lastMap;
  const activeFire = [];
  return {
    time, gust, tracks, activeFire,
    update(map) {
      lastMap = map;
      activeFire.length = 0;
      for (const chunk of chunks) {
        const { trees, grass, rock, shrubs, candidates } = chunk;
        trees.count = grass.count = rock.count = shrubs.count = 0;
        for (const [index, c] of candidates.entries()) {
          const { x, z, density, scale, angle } = c;
          const at = tile(x, z);
          const y = ground(map, x, z);
          if (y < WATER + .28) continue;
          object.position.set(x, y, z);
          object.rotation.set(0, angle, 0);
          const canopy = map[at + 1], food = map[at + 2], wet = map[at + 3], burning = map[at + 4];
          if (burning > .12 && index % 2 === 0) activeFire.push([x, y, z, density]);
          if (index < 130 && density < canopy * .84 && y > .35 && burning < .36) {
            const h = .66 + 1.03 * scale;
            object.scale.set(.76 + h * .24, h, .76 + h * .24);
            object.updateMatrix();
            trees.setMatrixAt(trees.count, object.matrix);
            color.setHSL(.20 + wet * .056, .28, .55 + scale * .20);
            trees.setColorAt(trees.count++, color);
          }
          if (density * .69 < food && burning < .25) {
            object.scale.set(1 + scale * .85, .47 + scale * .76, 1 + scale * .85);
            object.updateMatrix();
            grass.setMatrixAt(grass.count, object.matrix);
            color.setHSL(.16 + wet * .10, .36 + food * .12, .29 + scale * .21);
            grass.setColorAt(grass.count++, color);
          }
          if (index >= 128 && index < 172 && wet > .18 && density < canopy && burning < .25) {
            object.scale.setScalar(.51 + scale * 1.23);
            object.updateMatrix();
            shrubs.setMatrixAt(shrubs.count++, object.matrix);
          }
          if (index < 28 && density < .24 && (y > 9 || y < 1.8)) {
            object.scale.set(.8 + scale * 2.3, .58 + scale * 1.64, .8 + scale * 1.7);
            object.rotation.set(scale * .63, angle, .35);
            object.updateMatrix();
            rock.setMatrixAt(rock.count++, object.matrix);
          }
        }
        chunk.grassCount = grass.count;
        for (const mesh of [trees, grass, rock, shrubs]) {
          mesh.instanceMatrix.needsUpdate = true;
          if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        }
      }
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

function weatherParticles(scene) {
  const random = rng(38261);
  const flakes = Array.from({ length: 900 }, () => [random() * SIZE - HALF, random() * 80, random() * SIZE - HALF]);
  const rainData = new Float32Array(flakes.length * 6);
  const rainGeom = new T.BufferGeometry();
  rainGeom.setAttribute('position', new T.BufferAttribute(rainData, 3).setUsage(T.DynamicDrawUsage));
  const rain = new T.LineSegments(rainGeom, new T.LineBasicMaterial({ color: 0xa5c5cc, transparent: true, opacity: .31, depthWrite: false }));
  rain.frustumCulled = false;
  scene.add(rain);
  const fireData = new Float32Array(950 * 3);
  const fireGeom = new T.BufferGeometry();
  fireGeom.setAttribute('position', new T.BufferAttribute(fireData, 3).setUsage(T.DynamicDrawUsage));
  const fire = new T.Points(fireGeom, new T.ShaderMaterial({
    transparent: true, depthWrite: false, blending: T.AdditiveBlending,
    vertexShader: 'void main(){ vec4 v=modelViewMatrix*vec4(position,1.); gl_Position=projectionMatrix*v; gl_PointSize=clamp(820./-v.z,3.,30.); }',
    fragmentShader: 'void main(){ float d=length(gl_PointCoord-.5); gl_FragColor=vec4(3.6,1.04+d*.59,.065,1.-smoothstep(.04,.5,d)); }',
  }));
  fire.userData.bloom = true;
  fire.frustumCulled = false;
  scene.add(fire);
  return function update(time, weather, active) {
    rain.visible = weather === 'rain';
    if (rain.visible) {
      for (const [i, [x, phase, z]] of flakes.entries()) {
        const h = ((phase - time * 30) % 80 + 80) % 80;
        rainData.set([x, h, z, x + .48, h - 2.7, z + .16], i * 6);
      }
      rainGeom.attributes.position.needsUpdate = true;
    }
    const count = Math.min(active.length * 4, 950);
    for (let i = 0; i < count; i++) {
      const [x, y, z, phase] = active[i >> 2];
      const pulse = (time * (1.3 + phase) + phase + (i % 4) * .25) % 1;
      fireData.set([x + Math.sin(i) * pulse, y + pulse * 4.6, z + Math.cos(i) * pulse], i * 3);
    }
    fireGeom.setDrawRange(0, count);
    fireGeom.attributes.position.needsUpdate = true;
  };
}

export function makeLand(scene, assets, register, onTextures) {
  const bytes = new Uint8Array(GRID * GRID * 4);
  const height = new Uint8Array(GRID * GRID * 4);
  const field = new T.DataTexture(bytes, GRID, GRID);
  const depth = new T.DataTexture(height, GRID, GRID);
  field.magFilter = field.minFilter = depth.magFilter = depth.minFilter = T.LinearFilter;
  const terrain = makeTerrain(scene, field, assets, register, onTextures);
  const water = makeWater(scene, depth);
  const forest = cover(scene, register);
  const particles = weatherParticles(scene);
  const updateRidges = mountainRing(scene, register);
  return {
    mesh: terrain.mesh,
    sun: SUN,
    tracks: forest.tracks,
    setReflection(map) {
      water.reflectionMap.value = map;
      water.reflectionReady.value = 1;
    },
    update(map) {
      for (let i = 0, j = 0; i < map.length; i += CHANNELS, j += 4) {
        bytes[j] = Math.round(map[i + 3] * 255);
        bytes[j + 1] = Math.round(map[i + 1] * 255);
        bytes[j + 2] = Math.round(map[i + 2] * 255);
        bytes[j + 3] = Math.round(map[i + 4] * 255);
        height[j] = Math.round(clamp((WATER - map[i]) / 20 + .5) * 255);
      }
      field.needsUpdate = depth.needsUpdate = true;
      terrain.update(map);
      updateRidges(map);
      forest.update(map);
    },
    tick(time, night, weather, sun, camera, profile) {
      water.elapsed.value = forest.time.value = time;
      water.precipitation.value = Number(weather === 'rain');
      water.night.value = night;
      water.fogStrength.value = scene.fog.density;
      water.waterSky.value.setHex(weather === 'fog' ? 0x769e94 : 0x79afb9).multiplyScalar(1 - night * .75);
      water.sunDirection.value.copy(sun);
      terrain.uniforms.snowLine.value = { clear: 33, rain: 31, fog: 26.5, heat: 45 }[weather];
      terrain.uniforms.rainfall.value = weather === 'rain' ? .90 : 0;
      forest.gust.value = weather === 'rain' ? 1.16 : weather === 'heat' ? .58 : .22;
      forest.lod(camera, profile);
      particles(time, weather, forest.activeFire);
    },
  };
}

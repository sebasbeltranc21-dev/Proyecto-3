import * as T from 'three';
import { CAP, STRIDE } from '../sim/config.js';
import { ground } from '../sim/terrain.js';
import { WADE_HEIGHT, onWaterSurface } from '../sim/river-navigation.js';
import { AnimalModels } from './models.js';
import { newLocomotion } from './locomotion.js';

const unit = new T.IcosahedronGeometry(1, 1);
const LEG = new T.BoxGeometry(1, 1, 1);
const TIP = new T.ConeGeometry(1, 1, 5);
const parts = [
  { shape: unit, offset: [0, .79, 0], scale: [.28, .27, .63], tones: [0xd0a16e, 0x53585c] },
  { shape: unit, offset: [0, 1.00, .49], scale: [.17, .33, .21], tones: [0xd9b58c, 0x747474] },
  { shape: unit, offset: [0, 1.22, .68], scale: [.19, .16, .28], tones: [0xc08b5d, 0x656567] },
  { shape: unit, offset: [0, 1.16, .91], scale: [.13, .09, .11], tones: [0x29241c, 0x23272a] },
  { shape: TIP, offset: [-.13, 1.40, .62], scale: [.07, .32, .065], tilt: .32, tones: [0xe1b781, 0x535455] },
  { shape: TIP, offset: [.13, 1.40, .62], scale: [.07, .32, .065], tilt: -.32, tones: [0xe1b781, 0x535455] },
  { shape: unit, offset: [0, .80, -.65], scale: [.12, .12, .26], tones: [0xe2c5a1, 0x626567], tail: true },
  ...[[-1,-1], [1,-1], [-1,1], [1,1]].map(([side, leg]) => ({
    shape: LEG, offset: [side * .18, .35, leg * .38], scale: [.105, .73, .12], tones: [0x765338, 0x494d50], stride: side * leg,
  })),
];

export class Fauna {
  constructor(scene, assets, register, onModels) {
    this.records = new Map();
    this.test = new T.Vector3();
    if (!scene) return;
    this.models = new AnimalModels(scene, assets, register, onModels);
    this.colors = [new T.Color(0xbfe98e), new T.Color(0xf0a266)];
    this.points = new T.InstancedMesh(
      new T.RingGeometry(.58, .85, 14).rotateX(-Math.PI / 2),
      new T.MeshBasicMaterial({ transparent: true, opacity: .72, depthWrite: false, toneMapped: false }),
      CAP,
    );
    this.points.count = 0;
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.meshes = parts.map(part => {
      const material = new T.MeshStandardMaterial({ roughness: .89 });
      register(material);
      const mesh = new T.InstancedMesh(part.shape, material, CAP);
      mesh.count = 0;
      mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      scene.add(mesh);
      return mesh;
    });
    this.object = new T.Object3D();
    this.color = new T.Color();
    this.selection = new T.Mesh(
      new T.RingGeometry(1.64, 1.82, 40).rotateX(-Math.PI / 2),
      new T.MeshBasicMaterial({ color: 0xe5f5ad, side: T.DoubleSide, toneMapped: false, transparent: true, opacity: .9 }),
    );
    this.selection.visible = false;
    scene.add(this.selection);
  }

  snapshot(items, length) {
    for (const record of this.records.values()) record.live = false;
    for (let i = 0; i < length; i++) {
      const at = i * STRIDE;
      const id = items[at];
      const x = items[at + 2], z = items[at + 3], angle = items[at + 4];
      const record = this.records.get(id) ?? {
        id, x, z, angle, species: items[at + 1], y: 0, pose: newLocomotion(id),
      };
      Object.assign(record, {
        tx: x, tz: z, ta: angle, pace: items[at + 5], hidden: items[at + 6], live: true,
        gait: items[at + 8], coatTrait: items[at + 9], sizeTrait: items[at + 10], attacking: items[at + 11],
        fear: items[at + 12], signaling: items[at + 13], feeding: items[at + 14],
        targetSwimming: Boolean(items[at + 15]),
      });
      this.records.set(id, record);
    }
    for (const [id, record] of this.records) if (!record.live) this.records.delete(id);
  }

  tick(dt, time, map, tracked, markers, profile, camera) {
    if (!map) return;
    let row = 0;
    const blend = 1 - Math.exp(-dt * 13);
    this.selection.visible = this.records.has(tracked);
    for (const a of this.records.values()) {
      const dx = (a.tx - a.x) * blend, dz = (a.tz - a.z) * blend;
      a.x += dx;
      a.z += dz;
      a.distance = Math.hypot(dx, dz);
      const height = ground(map, a.x, a.z);
      a.swimming = a.targetSwimming || height < WADE_HEIGHT;
      a.y = onWaterSurface(height, a.swimming);
      const delta = a.ta - a.angle;
      const yaw = Math.atan2(Math.sin(delta), Math.cos(delta)) * blend;
      a.angle += yaw;
      a.turnRate = yaw / Math.max(dt, .001);
      const sin = Math.sin(a.angle), cos = Math.cos(a.angle);
      const size = a.species ? 1.16 : 1.24;
      const crouch = a.hidden && !a.swimming ? .71 : 1;
      const step = Math.sin(time * (2.9 + a.pace * 1.8) + a.id) * Math.min(.68, a.pace * .15);
      const object = this.object;
      if (!this.models.ready) for (const [index, part] of parts.entries()) {
        const mesh = this.meshes[index];
        const [x, y, z] = part.offset;
        object.position.set(a.x + (x * cos + z * sin) * size, a.y + y * size * crouch - (a.swimming ? .56 : 0), a.z + (z * cos - x * sin) * size);
        object.rotation.set(part.stride ? step * part.stride : part.tail ? .28 : 0, a.angle, part.tilt || 0, 'YXZ');
        const wolf = a.species;
        object.scale.set(part.scale[0] * size, part.scale[1] * size * crouch * (wolf ? .82 : 1), part.scale[2] * size);
        object.updateMatrix();
        mesh.setMatrixAt(row, object.matrix);
        this.color.setHex(part.tones[wolf]).multiplyScalar(.77 + .25 * (a.id % 31) / 30);
        mesh.setColorAt(row, this.color);
        mesh.castShadow = profile.shadows > 0;
      }
      object.position.set(a.x, a.y + .12, a.z);
      object.scale.setScalar(a.species ? 1.37 : 1.08);
      object.rotation.set(0, 0, 0);
      object.updateMatrix();
      this.points.setMatrixAt(row, object.matrix);
      this.points.setColorAt(row, this.color.copy(this.colors[a.species]).multiplyScalar(a.hidden ? .56 : 1));
      if (a.id === tracked) {
        this.selection.position.set(a.x, a.y + .20, a.z);
        this.selection.scale.setScalar(1 + .08 * Math.sin(time * 4));
      }
      row++;
    }
    this.models.draw(this.records.values(), camera, dt, time, map, profile, tracked);
    for (const mesh of this.meshes) {
      mesh.visible = !this.models.ready;
      if (!mesh.visible) continue;
      mesh.count = row;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    this.points.count = row;
    this.points.visible = markers;
    this.points.instanceMatrix.needsUpdate = true;
    if (this.points.instanceColor) this.points.instanceColor.needsUpdate = true;
  }

  pick(x, y, camera, width, height) {
    let result = 0, distance = 21;
    for (const a of this.records.values()) {
      this.test.set(a.x, a.y + 1.4, a.z).project(camera);
      if (this.test.z > 1) continue;
      const dx = (this.test.x + 1) * .5 * width - x;
      const dy = (1 - this.test.y) * .5 * height - y;
      const range = Math.hypot(dx, dy);
      if (range < distance) { result = a.id; distance = range; }
    }
    return result;
  }

  nearest(target, species) {
    let candidate, best = Infinity;
    for (const a of this.records.values()) {
      if (species !== undefined && a.species !== species) continue;
      const score = (a.x - target.x) ** 2 + (a.z - target.z) ** 2;
      if (score < best) { best = score; candidate = a; }
    }
    return candidate;
  }
}

import * as T from 'three';
import { CAP, clamp } from '../sim/config.js';
import { animateCreature } from './shaders/creature.js';

const REGIONS = ['deer', 'wolf'];
const LODS = ['far', 'near'];
const sizes = [1.12, 1.06];

export class AnimalModels {
  constructor(scene, assets, register, onReady) {
    this.batches = [[], []];
    this.time = { value: 0 };
    this.frustum = new T.Frustum();
    this.viewProjection = new T.Matrix4();
    this.position = new T.Vector3();
    this.object = new T.Object3D();
    this.color = new T.Color();
    this.bounds = new T.Sphere(new T.Vector3(), 3.1);
    this.ready = false;
    Promise.all(REGIONS.map(name => Promise.all(LODS.map(lod => assets.model(name + '-' + lod)))))
      .then(models => {
        const batches = models.map(pair => pair.map(model => this.buildBatch(model, register)));
        for (const pair of batches) scene.add(...pair.map(batch => batch.mesh));
        this.batches = batches;
        this.ready = true;
        onReady?.(true);
      })
      .catch(error => {
        onReady?.(false);
        console.warn('Usando fauna de respaldo.', error);
      });
  }

  buildBatch(gltf, register) {
    gltf.scene.updateMatrixWorld(true);
    let source;
    gltf.scene.traverse(node => { if (node.isMesh && !source) source = node; });
    if (!source || source.isSkinnedMesh) throw Error('Se esperaba el modelo de animación de vértices.');
    const geometry = source.geometry.clone();
    for (const key of ['position', 'normal']) {
      const input = geometry.getAttribute(key);
      if (input.array instanceof Float32Array) continue;
      const values = new Float32Array(input.count * 3);
      for (let i = 0; i < input.count; i++) values.set([input.getX(i), input.getY(i), input.getZ(i)], i * 3);
      geometry.setAttribute(key, new T.BufferAttribute(values, 3));
    }
    geometry.applyMatrix4(source.matrixWorld);
    const motion = new T.InstancedBufferAttribute(new Float32Array(CAP * 4), 4).setUsage(T.DynamicDrawUsage);
    geometry.setAttribute('aMotion', motion);
    const material = source.material.clone();
    animateCreature(material, this.time);
    register(material);
    const mesh = new T.InstancedMesh(geometry, material, CAP);
    const depth = new T.MeshDepthMaterial({ depthPacking: T.RGBADepthPacking });
    animateCreature(depth, this.time, true);
    mesh.customDepthMaterial = depth;
    mesh.frustumCulled = false; // The batch contains only agents culled against the active camera.
    mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
    mesh.receiveShadow = true;
    mesh.count = 0;
    return { mesh, motion };
  }

  draw(records, camera, dt, time, profile, tracked) {
    if (!this.ready) return;
    this.time.value = time;
    this.viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.viewProjection);
    for (const pair of this.batches) for (const { mesh } of pair) mesh.count = 0;
    const object = this.object;
    for (const a of records) {
      this.bounds.center.set(a.x, a.y + .9, a.z);
      if (!this.frustum.intersectsSphere(this.bounds)) continue;
      const distance = this.position.copy(this.bounds.center).distanceToSquared(camera.position);
      if (distance > profile.faunaFar ** 2 || a.id === tracked && distance > 365 ** 2) continue;
      const level = distance < profile.faunaNear ** 2 || (a.id === tracked && distance < 82 ** 2) ? 1 : 0;
      const { mesh, motion } = this.batches[a.species][level];
      const row = mesh.count++;
      const scale = sizes[a.species] * (1 + a.sizeTrait * .13);
      object.position.set(a.x, a.y, a.z);
      object.rotation.set(0, a.angle, 0);
      object.scale.set(scale, scale * (1 + .075 * a.coatTrait), scale);
      object.updateMatrix();
      mesh.setMatrixAt(row, object.matrix);
      this.color.setRGB(1 + a.coatTrait * .21, 1 + a.coatTrait * .098, 1 - a.coatTrait * .115);
      mesh.setColorAt(row, this.color);
      const moving = a.pace > .16;
      const targetStride = moving ? clamp(a.pace / (a.gait > .63 ? 5.3 : 6.9), .14, 1) : 0;
      const mix = Math.min(1, dt * 7.0);
      a.stride += (targetStride - a.stride) * mix;
      a.crouch += ((a.hidden ? 1 : a.gait < .30 && moving ? .43 : 0) - a.crouch) * mix;
      a.attack += (a.attacking - a.attack) * mix;
      a.phase = (a.phase + dt * (moving ? 2.85 + a.pace * 2.04 : .76)) % (2 * Math.PI);
      motion.setXYZW(row, a.stride, a.crouch, a.attack, a.phase);
    }
    for (const pair of this.batches) {
      for (const [level, { mesh, motion }] of pair.entries()) {
        mesh.castShadow = profile.shadows > 0 && level === 1;
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        motion.needsUpdate = true;
      }
    }
  }
}

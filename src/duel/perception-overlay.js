import * as T from 'three';
import { WATER } from '../sim/config.js';
import { ground } from '../sim/terrain.js';
import { HALF_ANGLE, PERCEPTION_LAYERS, sightPoint } from './perception.js';

const SECTORS = 24;
const RINGS = 12;

function geometry(size) {
  return new T.BufferGeometry().setAttribute('position',
    new T.BufferAttribute(new Float32Array(size * 3), 3).setUsage(T.DynamicDrawUsage));
}

export class PerceptionOverlay {
  constructor(scene) {
    const surface = geometry((SECTORS + 1) * (RINGS + 1));
    const index = [];
    for (let row = 0; row < RINGS; row++) {
      for (let col = 0; col < SECTORS; col++) {
        const a = row * (SECTORS + 1) + col, b = a + SECTORS + 1;
        index.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
    surface.setIndex(index);
    const color = PERCEPTION_LAYERS[0].color;
    this.cone = new T.Mesh(surface, new T.MeshBasicMaterial({
      color, transparent: true, opacity: .20, side: T.DoubleSide, depthWrite: false, toneMapped: false,
    }));
    this.near = new T.LineLoop(geometry(SECTORS * 2),
      new T.LineBasicMaterial({ color, transparent: true, opacity: .67, depthWrite: false, toneMapped: false }));
    this.edges = new T.Line(geometry(SECTORS + 3),
      new T.LineBasicMaterial({ color, transparent: true, opacity: .8, depthWrite: false, toneMapped: false }));
    this.group = new T.Group();
    this.group.add(this.cone, this.near, this.edges);

    const ring = new T.RingGeometry(.62, .80, 24).rotateX(-Math.PI / 2);
    this.links = PERCEPTION_LAYERS.map(({ color }, index) => {
      const options = { color, transparent: true, opacity: .93, depthWrite: false, toneMapped: false };
      const line = new T.Line(geometry(2), index === 2
        ? new T.LineDashedMaterial({ ...options, dashSize: .56, gapSize: .36 })
        : new T.LineBasicMaterial(options));
      if (index === 2) line.geometry.setAttribute('lineDistance', new T.BufferAttribute(new Float32Array(2), 1));
      const marker = new T.Mesh(ring, new T.MeshBasicMaterial({ ...options, side: T.DoubleSide }));
      this.group.add(line, marker);
      return { line, marker };
    });
    for (const mesh of this.group.children) {
      mesh.frustumCulled = false;
      mesh.renderOrder = mesh === this.cone ? 4 : 5;
    }
    this.group.visible = false;
    scene.add(this.group);
  }

  draw(map, view, time) {
    this.group.visible = Boolean(view);
    if (!view) return;
    const height = (x, z) => Math.max(WATER, ground(map, x, z));
    const put = (target, index, bearing, radius) => {
      const [x, z] = sightPoint(view, bearing, radius);
      target.setXYZ(index, x, height(x, z) + .24, z);
    };
    this.cone.visible = this.near.visible = this.edges.visible = view.range > 0;
    if (view.range > 0) {
      const points = this.cone.geometry.attributes.position;
      const edges = this.edges.geometry.attributes.position;
      for (let col = 0; col <= SECTORS; col++) {
        const bearing = view.heading + (col / SECTORS * 2 - 1) * HALF_ANGLE;
        for (let row = 0; row <= RINGS; row++) put(points, row * (SECTORS + 1) + col, bearing, (row / RINGS) * view.range);
        put(edges, col + 1, bearing, view.range);
      }
      put(edges, 0, 0, 0);
      put(edges, SECTORS + 2, 0, 0);
      const near = this.near.geometry.attributes.position;
      for (let i = 0; i < near.count; i++) put(near, i, i / near.count * Math.PI * 2, view.near);
      points.needsUpdate = edges.needsUpdate = near.needsUpdate = true;
    }
    for (const [index, { line, marker }] of this.links.entries()) {
      const target = view.targets[index];
      line.visible = marker.visible = target.visible;
      if (!target.visible) continue;
      const y = height(view.x, view.z), end = height(target.x, target.z);
      const points = line.geometry.attributes.position;
      points.setXYZ(0, view.x, y + 1.25, view.z);
      points.setXYZ(1, target.x, end + (index === 3 ? .38 : 1.25), target.z);
      points.needsUpdate = true;
      if (index === 2) {
        const distance = line.geometry.attributes.lineDistance;
        distance.setX(1, Math.hypot(target.x - view.x, target.z - view.z, end - y));
        distance.needsUpdate = true;
      }
      marker.position.set(target.x, end + .28, target.z);
      marker.scale.setScalar(index === 2 ? 1.4 + .21 * Math.sin(time * 14) : 1.18);
    }
  }
}

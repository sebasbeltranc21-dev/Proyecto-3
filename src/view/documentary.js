import { Vector3 } from 'three';
import { WATER, clamp } from '../sim/config.js';
import { ground } from '../sim/terrain.js';

export class DocumentaryCamera {
  constructor(camera, controls) {
    this.camera = camera;
    this.controls = controls;
    this.position = new Vector3();
    this.target = new Vector3();
    this.origin = new Vector3();
    this.returnTarget = new Vector3();
    this.state = 'idle';
  }

  get active() { return this.state === 'tracking'; }
  get busy() { return this.state !== 'idle'; }

  enter(animal) {
    if (!animal || animal.fallAge >= 0) return false;
    const { camera, controls } = this;
    if (!this.busy) {
      this.origin.copy(camera.position);
      this.returnTarget.copy(controls.target);
      this.fov = camera.fov;
      this.orbitEnabled = controls.enabled;
    }
    this.heading = animal.angle;
    this.age = 0;
    this.state = 'tracking';
    controls.enabled = false;
    return true;
  }

  exit() {
    if (this.active) {
      this.state = 'returning';
      this.age = 0;
    }
  }

  reset() {
    if (!this.busy) return;
    this.camera.fov = this.fov;
    this.camera.updateProjectionMatrix();
    this.controls.enabled = this.orbitEnabled;
    this.state = 'idle';
  }

  frame(dt, animal, map) {
    if (!this.busy) {
      this.controls.update(dt);
      return;
    }
    if (this.active && (!animal || animal.fallAge >= 0)) this.exit();
    const { camera, controls } = this;
    this.age += dt;
    if (this.active) {
      const delta = animal.angle - this.heading;
      const turn = Math.atan2(Math.sin(delta), Math.cos(delta));
      this.heading += clamp(turn * (1 - Math.exp(-dt * 2.1)), -dt * .87, dt * .87);
      const forwardX = Math.sin(this.heading), forwardZ = Math.cos(this.heading);
      const side = 3.7;
      this.target.set(animal.x + forwardX * .64, animal.y + (animal.swimming ? .64 : 1.05), animal.z + forwardZ * .64);
      this.position.set(animal.x - forwardX * 5.45 + forwardZ * side, 0, animal.z - forwardZ * 5.45 - forwardX * side);
      this.position.y = Math.max(animal.y + 1.76, WATER + .72, ground(map, this.position.x, this.position.z) + 1.22);
      // Raise the shot just enough to retain a sightline on steep banks.
      for (const t of [.24, .46, .67, .85]) {
        const x = this.target.x + (this.position.x - this.target.x) * t;
        const z = this.target.z + (this.position.z - this.target.z) * t;
        this.position.y = Math.max(this.position.y, this.target.y + (ground(map, x, z) + .22 - this.target.y) / t);
      }
      camera.position.lerp(this.position, 1 - Math.exp(-dt * 3.0));
      controls.target.lerp(this.target, 1 - Math.exp(-dt * 4.4));
      camera.fov += (51 - camera.fov) * (1 - Math.exp(-dt * 3.0));
    } else {
      const weight = 1 - Math.exp(-dt * 5.6);
      camera.position.lerp(this.origin, weight);
      controls.target.lerp(this.returnTarget, weight);
      camera.fov += (this.fov - camera.fov) * weight;
      if (this.age > 1.55 || (this.age > .22 && camera.position.distanceToSquared(this.origin) < .008 &&
          controls.target.distanceToSquared(this.returnTarget) < .008)) {
        camera.position.copy(this.origin);
        controls.target.copy(this.returnTarget);
        this.reset();
      }
    }
    if (map && this.busy) camera.position.y = Math.max(camera.position.y, ground(map, camera.position.x, camera.position.z) + .95, WATER + .66);
    camera.lookAt(controls.target);
    camera.updateProjectionMatrix();
  }
}

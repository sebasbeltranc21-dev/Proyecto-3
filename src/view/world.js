import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SKY_PRESETS } from '../ui-data.js';
import { clamp } from '../sim/config.js';
import { ground } from '../sim/terrain.js';
import { makeLand } from './land.js';
import { Fauna } from './fauna.js';
import { createAssets } from './assets.js';
import { QUALITY } from './quality.js';
import { makeLighting } from './lighting.js';

export const INITIAL_POSITION = [125, 102, 176];
export const INITIAL_TARGET = [1, 8, -27];

export class World {
  constructor(canvas, context) {
    this.canvas = canvas;
    this.scene = new T.Scene();
    this.scene.fog = new T.FogExp2(0xb4c9b3, .0026);
    this.camera = new T.PerspectiveCamera(46, 1, .64, 1180);
    this.renderer = new T.WebGLRenderer({ canvas, context, antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = T.SRGBColorSpace;
    this.renderer.toneMapping = T.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    const assets = createAssets(this.renderer);
    this.lighting = makeLighting(this.scene, this.camera, this.renderer);
    const status = (key, ok) => { canvas.dataset[key] = ok ? 'ready' : 'fallback'; };
    canvas.dataset.renderer = 'webgl2';
    this.land = makeLand(this.scene, assets, this.lighting.register, ok => status('textures', ok));
    this.fauna = new Fauna(this.scene, assets, this.lighting.register, ok => status('models', ok));
    this.lighting.environment.then(map => {
      this.land.setReflection(map);
      status('environment', true);
    }).catch(error => {
      status('environment', false);
      console.warn('La iluminación usa el entorno procedural.', error);
    });
    this.sun = this.land.sun.clone();
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = .085;
    this.controls.minPolarAngle = .25;
    this.controls.maxPolarAngle = Math.PI * .472;
    this.controls.minDistance = 5.1;
    this.controls.maxDistance = 365;
    this.controls.zoomToCursor = true;
    this.controls.target.set(...INITIAL_TARGET);
    this.camera.position.set(...INITIAL_POSITION);
    this.controls.update();
    this.home = new T.Vector3();
    this.ray = new T.Raycaster();
    this.pointer = new T.Vector2();
    this.ring = new T.Mesh(
      new T.RingGeometry(.965, 1, 54).rotateX(-Math.PI / 2),
      new T.MeshBasicMaterial({ color: 0xdbedaf, side: T.DoubleSide, toneMapped: false, transparent: true, opacity: .85 }),
    );
    this.ring.visible = false;
    this.scene.add(this.ring);
    this.quality = 'balanced';
    this.weather = 'clear';
    this.markers = true;
    this.selectedId = 0;
    this.following = false;
    this.dayOffset = 0;
    this.time = 0;
    this.trackUpdate = 0;
    this.shadowUpdate = 0;
    this.last = 0;
    this.frames = 0;
    this.fps = 0;
    this.fpsStart = 0;
    this.resize = this.resize.bind(this);
    this.draw = this.draw.bind(this);
    new ResizeObserver(this.resize).observe(canvas);
    const initialQuality = new URLSearchParams(location.search).get('quality');
    this.setQuality(initialQuality || 'balanced');
    this.renderer.setAnimationLoop(this.draw);
  }

  resize() {
    const { clientWidth, clientHeight } = this.canvas;
    const width = Math.max(1, clientWidth), height = Math.max(1, clientHeight);
    const pixelRatio = Math.min(devicePixelRatio, this.profile.dpr);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.lighting.cascades.updateFrustums();
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height, false);
    if (this.profile.post) this.post?.resize(width, height, pixelRatio);
  }

  setQuality(quality) {
    this.quality = Object.hasOwn(QUALITY, quality) ? quality : 'balanced';
    const selected = QUALITY[this.quality];
    this.profile = selected.post && !this.renderer.extensions.has('EXT_color_buffer_float')
      ? { ...selected, post: false, ao: false }
      : selected;
    this.canvas.dataset.quality = this.quality;
    this.canvas.dataset.post = !this.profile.post ? 'off' : !this.post ? 'loading' : this.profile.ao ? 'ssao' : 'bloom';
    this.lighting.quality(this.profile);
    if (this.profile.post && !this.postRequest) {
      this.postRequest = import('./post.js').then(({ makePost }) => {
        this.post = makePost(this.renderer, this.scene, this.camera, this.lighting.skyUniforms);
        this.setQuality(this.quality);
      }).catch(error => {
        this.canvas.dataset.post = 'fallback';
        console.warn('Posprocesado avanzado deshabilitado.', error);
      });
    }
    this.resize();
  }

  setMap(map, time) {
    this.map = map;
    this.land.update(map, time);
  }

  resetEffects() {
    this.land.resetEffects();
  }

  locate(x, y) {
    if (!this.map) return null;
    this.pointer.set(x / this.canvas.clientWidth * 2 - 1, 1 - y / this.canvas.clientHeight * 2);
    this.ray.setFromCamera(this.pointer, this.camera);
    const [hit] = this.ray.intersectObject(this.land.mesh, false);
    return hit?.point ?? null;
  }

  hover(x, y, radius) {
    const hit = this.locate(x, y);
    this.ring.visible = Boolean(hit);
    if (!hit) return;
    this.ring.position.set(hit.x, hit.y + .43, hit.z);
    this.ring.scale.setScalar(radius);
  }

  pick(x, y) {
    const { clientWidth, clientHeight } = this.canvas;
    return this.fauna.pick(x, y, this.camera, clientWidth, clientHeight);
  }

  focus(id, zoom = false) {
    const a = this.fauna.records.get(id);
    if (!a) return;
    if (zoom) {
      this.camera.position.set(a.x + 5.6, a.y + 3.3, a.z + 8.1);
      this.controls.target.set(a.x, a.y + 1.05, a.z);
      this.controls.update();
    }
    this.following = zoom;
  }

  resetView() {
    this.following = false;
    this.camera.position.set(...INITIAL_POSITION);
    this.controls.target.set(...INITIAL_TARGET);
    this.controls.update();
  }

  draw(timestamp) {
    const elapsed = timestamp / 1000;
    const dt = Math.min(.10, elapsed - (this.last || elapsed));
    this.last = elapsed;
    this.frames++;
    if (elapsed - this.fpsStart >= 1) {
      this.fps = Math.round(this.frames / (elapsed - this.fpsStart));
      this.fpsStart = elapsed;
      this.frames = 0;
    }
    this.controls.update(dt);
    if (this.following && this.map) {
      const a = this.fauna.records.get(this.selectedId);
      if (a) {
        const target = this.controls.target;
        this.home.set(a.x, ground(this.map, a.x, a.z) + 1.05, a.z).sub(target).multiplyScalar(Math.min(1, dt * 4));
        target.add(this.home);
        this.camera.position.add(this.home);
        const base = ground(this.map, this.camera.position.x, this.camera.position.z);
        this.camera.position.y = Math.max(this.camera.position.y, base + 1.4, -.55);
      }
    }
    const hour = (8.5 + this.time / 26 + this.dayOffset) % 24;
    const angle = (hour - 6) / 24 * Math.PI * 2;
    const altitude = Math.sin(angle);
    const night = clamp((.18 - altitude) * 2.05);
    const preset = SKY_PRESETS[this.weather];
    this.sun.set(-Math.cos(angle) * .86, Math.max(.043, altitude), -.56).normalize();
    this.camera.updateMatrixWorld();
    this.lighting.update(elapsed, this.sun, night, this.weather, preset);
    this.renderer.toneMappingExposure = 1.06 - night * .085;
    if (elapsed - this.trackUpdate > .095) {
      this.land.tracks.update(this.fauna.records.values());
      this.trackUpdate = elapsed;
    }
    this.land.tick(elapsed, night, this.weather, this.sun, this.camera, this.profile);
    this.fauna.tick(dt, elapsed, this.map, this.selectedId, this.markers, this.profile, this.camera);
    if (this.profile.shadows && elapsed - this.shadowUpdate >= .051) {
      this.renderer.shadowMap.needsUpdate = true;
      this.shadowUpdate = elapsed;
    }
    if (this.profile.post && this.post) this.post.render(dt, this.weather, night, this.profile);
    else this.renderer.render(this.scene, this.camera);
  }
}

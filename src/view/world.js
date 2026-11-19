import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SKY_PRESETS } from '../ui-data.js';
import { START_HOUR, darkness, displayHour, solarAngle } from '../sim/day-cycle.js';
import { makeLand } from './land.js';
import { Fauna } from './fauna.js';
import { createAssets } from './assets.js';
import { QUALITY } from './quality.js';
import { makeLighting } from './lighting.js';
import { DocumentaryCamera } from './documentary.js';

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
    this.land = makeLand(this.scene, this.renderer, assets, this.lighting.register,
      ok => status('textures', ok), this.lighting.skyUniforms.emitOnly);
    this.fauna = new Fauna(this.scene, assets, this.lighting.register, ok => status('models', ok), this.lighting.skyUniforms.emitOnly);
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
    this.documentary = new DocumentaryCamera(this.camera, this.controls);
    this.ray = new T.Raycaster();
    this.pointer = new T.Vector2();
    this.ring = new T.Mesh(
      new T.RingGeometry(.965, 1, 54).rotateX(-Math.PI / 2),
      new T.MeshBasicMaterial({ color: 0xdbedaf, side: T.DoubleSide, toneMapped: false, transparent: true, opacity: .85 }),
    );
    this.ring.visible = false;
    this.scene.add(this.ring);
    this.quality = 'high';
    this.weather = 'clear';
    this.markers = true;
    this.selectedId = 0;
    this.hour = this.skyHour = START_HOUR;
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
    this.setQuality(initialQuality || 'high');
    this.renderer.setAnimationLoop(this.draw);
  }

  resize() {
    const { clientWidth, clientHeight } = this.canvas;
    const width = Math.max(1, clientWidth), height = Math.max(1, clientHeight);
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2, this.profile.dpr);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.lighting.cascades.updateFrustums();
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height, false);
    this.land.resize(width, height, this.profile);
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
    this.fauna.setMap(map, this.land.update(map, time));
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

  resetView() {
    this.documentary.reset();
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
    if (this.map) this.fauna.advance(dt, this.map);
    this.documentary.frame(dt, this.fauna.records.get(this.selectedId), this.map);
    this.skyHour = displayHour(this.skyHour, this.hour, dt);
    const angle = solarAngle(this.skyHour);
    const night = darkness(this.skyHour);
    const preset = SKY_PRESETS[this.weather];
    this.sun.set(-Math.cos(angle) * .94, Math.sin(angle) * .74, -.31).normalize();
    this.camera.updateMatrixWorld();
    this.audio?.update(this.camera, this.weather, this.fauna.records.values(), this.time);
    this.lighting.update(elapsed, this.sun, night, this.weather, preset, this.profile);
    this.canvas.dataset.environment = this.scene.environment ? 'ready' : 'fallback';
    this.renderer.toneMappingExposure = 1.06 - night * .085;
    if (elapsed - this.trackUpdate > .095) {
      this.land.tracks.update(this.fauna.records.values());
      this.trackUpdate = elapsed;
    }
    this.land.tick(elapsed, night, this.weather, this.sun, this.camera, this.profile,
      this.documentary.active ? this.controls.target : null);
    this.fauna.tick(dt, elapsed, this.map, this.selectedId, this.markers, this.profile, this.camera, night, this.documentary.active);
    if (this.profile.shadows && elapsed - this.shadowUpdate >= .051) {
      this.renderer.shadowMap.needsUpdate = true;
      this.shadowUpdate = elapsed;
    }
    if (this.profile.post && this.post) this.post.render(dt, this.weather, night, this.profile);
    else this.renderer.render(this.scene, this.camera);
    this.canvas.dataset.reflections = this.land.reflectionReady ? 'planar' : 'sky';
  }
}

import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SKY_PRESETS } from '../ui-data.js';
import { clamp } from '../sim/config.js';
import { ground } from '../sim/terrain.js';
import { makeLand } from './land.js';
import { Fauna } from './fauna.js';

const INITIAL_POSITION = [125, 102, 176];
const INITIAL_TARGET = [1, 8, -27];

export class World {
  constructor(canvas) {
    this.canvas = canvas;
    this.scene = new T.Scene();
    this.scene.fog = new T.FogExp2(0xb4c9b3, .0026);
    this.camera = new T.PerspectiveCamera(46, 1, .64, 1180);
    this.renderer = new T.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = T.SRGBColorSpace;
    this.renderer.toneMapping = T.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = T.PCFShadowMap;
    this.hemi = new T.HemisphereLight(0xcadfd6, 0x657852, 1.60);
    this.key = new T.DirectionalLight(0xffdeb0, 3.25);
    this.key.castShadow = true;
    this.key.target.position.set(4, 0, -13);
    Object.assign(this.key.shadow.camera, { left: -167, right: 167, top: 146, bottom: -146, near: 1, far: 470 });
    this.key.shadow.mapSize.set(1536, 1536);
    this.key.shadow.bias = -.0002;
    this.key.shadow.normalBias = .45;
    this.key.shadow.radius = 2;
    this.scene.add(this.hemi, this.key, this.key.target);
    this.land = makeLand(this.scene);
    this.fauna = new Fauna(this.scene);
    this.sun = this.land.sun.clone();
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = .085;
    this.controls.minPolarAngle = .25;
    this.controls.maxPolarAngle = Math.PI * .472;
    this.controls.minDistance = 13;
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
    this.refresh = 0;
    this.last = 0;
    this.frames = 0;
    this.fps = 0;
    this.fpsStart = 0;
    this.resize = this.resize.bind(this);
    this.draw = this.draw.bind(this);
    new ResizeObserver(this.resize).observe(canvas);
    this.setQuality('balanced');
    this.renderer.setAnimationLoop(this.draw);
  }

  resize() {
    const { clientWidth: width, clientHeight: height } = this.canvas;
    const pixelRatio = Math.min(devicePixelRatio, ({ eco: 1, balanced: 1.35, cinema: 1.7 })[this.quality]);
    this.camera.aspect = width / Math.max(height, 1);
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height, false);
    if (this.composer) {
      this.composer.setPixelRatio(pixelRatio);
      this.composer.setSize(width, height);
    }
  }

  setQuality(quality) {
    this.quality = quality;
    this.renderer.shadowMap.enabled = quality !== 'eco';
    if (quality === 'cinema' && !this.composer) {
      this.composer = new EffectComposer(this.renderer);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.composer.addPass(new UnrealBloomPass(new T.Vector2(1, 1), .19, .32, .88));
      this.composer.addPass(new OutputPass());
    }
    this.resize();
  }

  setMap(map) {
    this.map = map;
    this.land.update(map);
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
      this.camera.position.set(a.x + 24, a.y + 20, a.z + 29);
      this.controls.target.set(a.x, a.y + 2, a.z);
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
        this.home.set(a.x, ground(this.map, a.x, a.z) + 2, a.z).sub(target).multiplyScalar(Math.min(1, dt * 4));
        target.add(this.home);
        this.camera.position.add(this.home);
      }
    }
    const hour = (8.5 + this.time / 26 + this.dayOffset) % 24;
    const angle = (hour - 6) / 24 * Math.PI * 2;
    const altitude = Math.sin(angle);
    const night = clamp((.18 - altitude) * 2.05);
    const preset = SKY_PRESETS[this.weather];
    this.sun.set(-Math.cos(angle) * .86, Math.max(.043, altitude), -.56).normalize();
    this.key.position.copy(this.sun).multiplyScalar(215).add(this.key.target.position);
    this.key.intensity = (3.05 - night * 2.78) * preset.light;
    this.hemi.intensity = (1.61 - night * .76) * (this.weather === 'fog' ? 1.14 : 1);
    this.key.color.setHex(altitude < .60 ? 0xffd3a1 : 0xffead0);
    this.scene.fog.color.setHex(preset.color).lerp(new T.Color(0x1b343e), night * .87);
    this.scene.fog.density = preset.fog + night * .001;
    this.renderer.toneMappingExposure = 1.13 - night * .13;
    this.land.tick(elapsed, night, this.weather, this.sun, this.camera, this.quality);
    this.fauna.tick(dt, elapsed, this.map, this.selectedId, this.markers, this.quality);
    if (this.quality === 'cinema') this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }
}

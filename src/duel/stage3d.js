import * as T from 'three';
import { WATER, clamp } from '../sim/config.js';
import { ground } from '../sim/terrain.js';
import { createAssets } from '../view/assets.js';
import { AnimalModels } from '../view/models.js';
import { makeArena } from './arena.js';
import { PerceptionOverlay } from './perception-overlay.js';
import { ReplayMotion } from './replay-motion.js';
import { makeDuelTerrain } from './terrain3d.js';

const PROFILE = { faunaNear: 74, faunaFar: 270, shadows: 0 };
const COLORS = [0xbdea95, 0xf5a16b];

function contactShadow() {
  return new T.ShaderMaterial({
    vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: 'varying vec2 vUv; void main(){ float a=1.-smoothstep(.12,.5,length(vUv-.5)); gl_FragColor=vec4(.035,.053,.034,a*.26); }',
    transparent: true, depthWrite: false,
  });
}

export class DuelStage {
  constructor(canvas, panes, select, onReady) {
    this.canvas = canvas;
    this.panes = panes;
    this.onReady = onReady;
    const context = canvas.getContext('webgl2', { alpha: true, antialias: true });
    if (!context) throw Error('WebGL2 no disponible');
    this.renderer = new T.WebGLRenderer({ canvas, context, alpha: true, antialias: true });
    this.renderer.toneMapping = T.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.19;
    this.scene = new T.Scene();
    this.scene.background = new T.Color(0x96aca5);
    this.scene.fog = new T.Fog(this.scene.background, 70, 215);

    const sun = new T.DirectionalLight(0xffe5bf, 2.1);
    sun.position.set(-33, 54, 38);
    const sky = new T.HemisphereLight(0xd5edfa, 0x7a8352, 1.65);
    this.scene.add(sky, sun);
    const base = new T.Mesh(new T.PlaneGeometry(390, 390).rotateX(-Math.PI / 2),
      new T.MeshStandardMaterial({ color: 0x54644a, roughness: 1 }));
    base.position.y = -4.2;
    this.scene.add(base);
    this.perception = new PerceptionOverlay(this.scene);

    const shadow = contactShadow();
    const shadowShape = new T.PlaneGeometry(2.5, 3.6).rotateX(-Math.PI / 2);
    const rings = new T.RingGeometry(.64, .72, 26).rotateX(-Math.PI / 2);
    this.markers = Array.from({ length: 6 }, (_, i) => {
      const dot = new T.Mesh(rings, new T.MeshBasicMaterial({
        color: COLORS[+(i >= 4)], transparent: true, opacity: .55, depthWrite: false, toneMapped: false,
      }));
      const shade = new T.Mesh(shadowShape, shadow);
      this.scene.add(dot, shade);
      return { dot, shade };
    });
    this.cameras = panes.map(() => new T.PerspectiveCamera(43, 1, .16, 350));
    this.target = new T.Vector3();
    this.pickPoint = new T.Vector3();
    this.spin = 0;
    this.elevation = .45;
    this.zoom = 1;
    this.dirty = true;
    this.ready = false;
    this.rects = [];
    this.models = new AnimalModels(this.scene, createAssets(this.renderer), () => {}, ready => {
      this.ready = ready && !this.lost;
      this.dirty = true;
      onReady(this.ready);
    }, { value: 0 });
    canvas.addEventListener('webglcontextlost', () => {
      this.ready = false;
      this.lost = true;
      onReady(false);
    });

    const observer = new ResizeObserver(() => this.resize());
    observer.observe(canvas);
    panes.forEach((pane, index) => {
      observer.observe(pane);
      this.bindView(pane, index, select);
    });
  }

  bindView(pane, index, select) {
    let start, moved;
    pane.addEventListener('pointerdown', event => {
      if (event.button !== 0 || !event.isPrimary) return;
      start = { x: event.clientX, y: event.clientY, id: event.pointerId };
      moved = false;
      pane.setPointerCapture(event.pointerId);
    });
    pane.addEventListener('pointermove', event => {
      if (start?.id !== event.pointerId) return;
      const dx = event.clientX - start.x, dy = event.clientY - start.y;
      if (!moved && Math.hypot(dx, dy) < 5) return;
      moved = true;
      this.spin -= dx * .009;
      this.elevation = clamp(this.elevation + dy * .006, .20, 1.23);
      start.x = event.clientX;
      start.y = event.clientY;
      this.dirty = true;
    });
    pane.addEventListener('pointerup', event => {
      if (start?.id !== event.pointerId) return;
      if (!moved) this.pick(index, event, select);
      start = null;
    });
    pane.addEventListener('pointercancel', () => { start = null; });
  }

  pick(index, event, select) {
    const tracks = this.tracks?.[index]?.tracks;
    if (!tracks || !this.ready) return;
    const rect = this.panes[index].getBoundingClientRect();
    let nearest, distance = 21;
    for (const { actor } of tracks) {
      if (!actor.visible) continue;
      const p = this.pickPoint.set(actor.x, actor.y + .75, actor.z).project(this.cameras[index]);
      if (Math.abs(p.x) > 1 || Math.abs(p.y) > 1 || p.z > 1) continue;
      const dx = rect.left + (p.x * .5 + .5) * rect.width - event.clientX;
      const dy = rect.top + (.5 - p.y * .5) * rect.height - event.clientY;
      const pixelDistance = Math.hypot(dx, dy);
      if (pixelDistance >= distance) continue;
      distance = pixelDistance;
      nearest = actor.id;
    }
    if (nearest) select(nearest);
  }

  zoomBy(factor) {
    this.zoom = clamp(this.zoom * factor, .54, 1.85);
    this.dirty = true;
  }

  resize() {
    const bounds = this.canvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.35));
    this.renderer.setSize(bounds.width, bounds.height, false);
    this.rects = this.panes.map(pane => {
      const rect = pane.getBoundingClientRect();
      return { x: Math.round(rect.left - bounds.left), y: Math.round(bounds.bottom - rect.bottom),
        width: Math.round(rect.width), height: Math.round(rect.height) };
    });
    for (const [index, rect] of this.rects.entries()) {
      this.cameras[index].aspect = rect.width / Math.max(1, rect.height);
      this.cameras[index].updateProjectionMatrix();
    }
    this.dirty = true;
  }

  setMatch(match, seed) {
    if (this.match === match) return;
    if (this.arena?.seed !== seed) {
      if (this.terrain) {
        this.scene.remove(this.terrain.group);
        this.terrain.dispose();
      }
      this.arena = makeArena(seed);
      this.terrain = makeDuelTerrain(this.arena);
      this.scene.add(this.terrain.group);
      const [prey, , , , wolf] = this.arena.starts;
      this.bearing = Math.atan2(wolf.x - prey.x, wolf.z - prey.z) + .92;
    }
    this.match = match;
    this.tracks = [match.left, match.right].map(result => new ReplayMotion(result, this.arena.map));
    this.dirty = true;
  }

  frameCamera(camera, followed, view) {
    const near = view === 'follow' && followed?.visible;
    const aim = this.target.set(near ? followed.x : 0, near ? followed.y + .8 : .55, near ? followed.z : 0);
    const stretch = Math.max(1, .91 / camera.aspect);
    const distance = (near ? 14.2 : 120) * this.zoom * stretch;
    const lift = near ? this.elevation : Math.max(.74, this.elevation);
    const flat = Math.cos(lift) * distance;
    const theta = this.bearing + this.spin;
    camera.position.set(aim.x + Math.sin(theta) * flat, aim.y + Math.sin(lift) * distance, aim.z + Math.cos(theta) * flat);
    camera.position.y = Math.max(camera.position.y, ground(this.arena.map, camera.position.x, camera.position.z) + 1.35, WATER + 1.1);
    camera.lookAt(aim);
    camera.updateMatrixWorld();
  }

  draw(time, focus, view, readings) {
    if (!this.ready || !this.tracks || this.rects.length < 2) return;
    if (!this.dirty && this.time === time && this.focus === focus && this.view === view && this.readings === readings) return;
    this.dirty = false;
    this.time = time;
    this.focus = focus;
    this.view = view;
    this.readings = readings;
    this.terrain.moveWater(time);
    const { renderer, scene } = this;
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, this.canvas.clientWidth, this.canvas.clientHeight);
    renderer.setClearColor(0, 0);
    renderer.clear();
    renderer.setScissorTest(true);
    for (const [index, rect] of this.rects.entries()) {
      if (!rect.width || !rect.height) continue;
      const camera = this.cameras[index];
      const actors = this.tracks[index].sample(time);
      this.frameCamera(camera, actors[focus - 1], view);
      this.perception.draw(this.arena.map, readings?.[index], time);
      for (const [i, actor] of actors.entries()) {
        const { dot, shade } = this.markers[i];
        const selected = actor.id === focus;
        dot.visible = actor.visible && actor.health > 0;
        shade.visible = actor.visible && !actor.swimming;
        dot.position.set(actor.x, actor.y + (actor.swimming ? .06 : .13), actor.z);
        dot.material.opacity = selected ? .93 : .43;
        dot.scale.setScalar(selected ? 1.55 : 1);
        shade.position.set(actor.x, actor.y + .075, actor.z);
        shade.rotation.y = actor.angle;
      }
      this.models.draw(actors.filter(actor => actor.visible), camera, 0, time, this.arena.map, PROFILE, focus, 0);
      renderer.setViewport(rect.x, rect.y, rect.width, rect.height);
      renderer.setScissor(rect.x, rect.y, rect.width, rect.height);
      renderer.render(scene, camera);
    }
    renderer.setScissorTest(false);
  }
}

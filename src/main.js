import './style.css';

import { showAgent, showStats, shell } from './panels.js';
import { SKY_PRESETS, TOOLS, icon } from './ui-data.js';
import { World } from './view/world.js';
import { CompatibilityWorld } from './view/compat.js';
import { AudioEngine } from './audio/AudioEngine.js';
import { START_HOUR } from './sim/day-cycle.js';
import { SPECIES } from './sim/config.js';

const app = document.querySelector('#app');
app.innerHTML = shell();
const get = id => document.getElementById(id);
const banner = get('banner');
let toast;
function announce(text, persistent = false) {
  clearTimeout(toast);
  banner.textContent = text;
  banner.hidden = false;
  if (!persistent) toast = setTimeout(() => { banner.hidden = true; }, 3600);
}

const messages = {
  raise: 'Eleva el terreno', lower: 'Excava el terreno', river: 'Abre un cauce',
  forest: 'Planta cobertura', meadow: 'Siembra alimento', fire: 'Enciende la vegetación', dry: 'Reduce la humedad',
};

function start(world) {
  const worker = new Worker(new URL('./sim/worker.js', import.meta.url), { type: 'module' });
  const send = data => worker.postMessage(data);
  const params = new URLSearchParams(location.search);
  let seed = /^\d+$/.test(params.get('seed') ?? '') ? Number(params.get('seed')) >>> 0 : 41021;
  let version = 0;
  let speed = 1;
  let previous = 1;
  let tool = 'watch';
  let stats;
  let snapshot;
  let initialSelect = !matchMedia('(max-width: 850px)').matches;
  const followButton = get('follow');
  const inspector = get('inspector');
  const audioButton = get('audio');
  const dayControl = get('day');
  const documentary = get('documentary');
  const exitButton = get('exit-documentary');
  const audio = new AudioEngine();
  const duelButton = get('open-duel');
  let duel, resumeSpeed;
  world.audio = audio;
  audioButton.disabled = !audio.Context;

  function inspectVisible(visible) {
    inspector.hidden = !visible;
    get('show-inspector').hidden = visible;
  }

  function exitDocumentary(restoreFocus = true) {
    if (documentary.hidden) return;
    world.documentary.exit();
    documentary.hidden = true;
    app.classList.remove('documentary-mode');
    followButton.setAttribute('aria-pressed', false);
    if (restoreFocus) followButton.focus({ preventScroll: true });
  }

  function enterDocumentary() {
    const animal = world.fauna.records.get(world.selectedId);
    if (!world.documentary.enter(animal)) return;
    anchor = null;
    world.ring.visible = false;
    get('documentary-id').textContent = `${SPECIES[animal.species].name} #${animal.id}`;
    get('documentary-action').textContent = snapshot?.id === animal.id ? snapshot.action : 'Explorando';
    followButton.setAttribute('aria-pressed', true);
    app.classList.add('documentary-mode');
    documentary.hidden = false;
    exitButton.focus({ preventScroll: true });
  }

  async function toggleAudio() {
    audioButton.disabled = true;
    const enabled = await audio.setEnabled(!audio.enabled);
    audioButton.innerHTML = icon(enabled ? 'audio' : 'mute');
    audioButton.setAttribute('aria-pressed', enabled);
    audioButton.title = enabled ? 'Silenciar sonido' : 'Activar sonido';
    audioButton.setAttribute('aria-label', audioButton.title);
    audioButton.disabled = false;
  }

  function select(id) {
    if (!id) return;
    world.selectedId = id;
    inspectVisible(true);
    send({ type: 'inspect', id });
  }

  function reset() {
    exitDocumentary(false);
    world.fauna.records.clear();
    world.resetEffects?.();
    world.selectedId = 0;
    world.weather = 'clear';
    world.time = 0;
    world.hour = world.skyHour = START_HOUR;
    dayControl.value = START_HOUR;
    snapshot = null;
    world.resetView();
    showAgent(null);
    initialSelect = !inspector.hidden;
    setTool('watch', false);
    get('seed').value = seed;
    send({ type: 'init', seed, version: ++version });
  }

  function setTool(mode, alert = true) {
    const observe = mode === 'watch';
    tool = mode;
    for (const button of app.querySelectorAll('[data-tool]')) button.setAttribute('aria-pressed', button.dataset.tool === mode);
    get('brush-control').hidden = observe;
    get('tool-hint').textContent = messages[mode] ?? '';
    world.canvas.classList.toggle('brushing', !observe);
    world.controls.enableRotate = observe;
    if (observe) world.ring.visible = false;
    if (!observe && alert && matchMedia('(max-width: 850px)').matches) inspectVisible(false);
  }

  function setSpeed(next) {
    if (next) previous = next;
    speed = next;
    send({ type: 'speed', speed });
    const toggle = get('pause');
    toggle.innerHTML = icon(speed ? 'pause' : 'play', 19);
    toggle.setAttribute('aria-label', speed ? 'Pausar' : 'Reanudar');
    toggle.title = (speed ? 'Pausar' : 'Reanudar') + ' · Espacio';
    const live = get('live');
    live.classList.toggle('paused', !speed);
    live.lastElementChild.textContent = speed ? 'En vivo' : 'Pausa';
    for (const b of app.querySelectorAll('[data-speed]')) b.setAttribute('aria-pressed', Number(b.dataset.speed) === speed);
  }

  function setMarkers(visible) {
    world.markers = visible;
    get('markers').checked = visible;
    app.querySelector('[data-cmd="markers"]').setAttribute('aria-pressed', visible);
  }

  async function openDuel() {
    duelButton.disabled = true;
    try {
      if (!duel) {
        const { createDuel } = await import('./duel/panel.js');
        duel = createDuel(() => {
          world.duelOpen = false;
          if (resumeSpeed) setSpeed(resumeSpeed);
          duelButton.focus();
        });
      }
      resumeSpeed = speed;
      duel.open();
      world.duelOpen = true;
      if (resumeSpeed) setSpeed(0);
    } catch (error) {
      console.error(error);
      announce('No se pudo abrir el Duelo Evolutivo.');
    } finally {
      duelButton.disabled = false;
    }
  }

  const commands = {
    pause: () => setSpeed(speed ? 0 : previous),
    reset: () => { reset(); announce('Simulación reiniciada · semilla ' + seed); },
    camera: () => world.resetView(),
    audio: toggleAudio,
    duel: openDuel,
    markers: () => setMarkers(!world.markers),
    settings: () => {
      const panel = get('settings');
      panel.hidden = !panel.hidden;
      app.querySelector('[data-cmd="settings"]').setAttribute('aria-expanded', !panel.hidden);
    },
    'close-inspector': () => inspectVisible(false),
    'show-inspector': () => inspectVisible(true),
    follow: enterDocumentary,
    'exit-documentary': () => exitDocumentary(),
    'pick-prey': () => select(world.fauna.nearest(world.controls.target, 0)?.id),
    'pick-predator': () => select(world.fauna.nearest(world.controls.target, 1)?.id),
  };

  let lastHUD = 0;
  let lastInspect = 0;
  worker.onmessage = ({ data }) => {
    if (data.type !== 'snapshot') return;
    const recycle = buffer => worker.postMessage({ type: 'recycle', buffer }, [buffer]);
    if (data.version !== version) { recycle(data.agents.buffer); return; }
    if (data.terrain) {
      world.setMap(data.terrain, data.stats.time);
      audio.setTerrain(data.terrain);
    }
    world.fauna.snapshot(data.agents, data.length);
    recycle(data.agents.buffer);
    stats = data.stats;
    world.weather = stats.weather;
    world.time = stats.time;
    world.hour = stats.hour;
    if (initialSelect && data.length) {
      initialSelect = false;
      select(world.fauna.nearest(world.controls.target, 0)?.id);
    }
    const tracked = world.fauna.records.get(world.selectedId);
    if (!documentary.hidden && (!tracked || tracked.fallAge >= 0)) {
      exitDocumentary(Boolean(tracked));
      if (!tracked) app.querySelector('[data-cmd="pick-prey"]').focus({ preventScroll: true });
    }
    if (world.selectedId && !tracked) {
      world.selectedId = 0;
      showAgent(null);
    }
    for (const button of app.querySelectorAll('[data-weather]')) {
      const active = button.dataset.weather === stats.weather;
      button.setAttribute('aria-pressed', active);
    }
    const now = performance.now();
    if (now - lastHUD > 170 || data.terrain || data.clockChanged || !lastHUD) {
      lastHUD = now;
      showStats(stats, world.fps);
      if (document.activeElement !== dayControl) dayControl.value = stats.hour;
    }
    if (data.selected?.id === world.selectedId) {
      if (!documentary.hidden) get('documentary-action').textContent = data.selected.action;
      if (snapshot?.id !== data.selected.id || now - lastInspect > 160 || !speed) {
        lastInspect = now;
        showAgent(data.selected);
      }
      snapshot = data.selected;
    }
  };
  worker.addEventListener('error', () => announce('La simulación se detuvo. Recarga para reiniciarla.', true));

  app.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.cmd) commands[button.dataset.cmd]?.();
    if (button.dataset.tool) setTool(button.dataset.tool);
    if (button.dataset.speed) setSpeed(Number(button.dataset.speed));
    if (button.dataset.weather && SKY_PRESETS[button.dataset.weather]) send({ type: 'weather', weather: button.dataset.weather });
  });
  get('quality').value = world.quality;
  get('quality').addEventListener('change', event => world.setQuality(event.target.value));
  get('markers').addEventListener('change', event => setMarkers(event.target.checked));
  get('radius').addEventListener('input', event => { get('radius-value').textContent = event.target.value + ' m'; });
  dayControl.addEventListener('input', () => send({ type: 'day', hour: dayControl.valueAsNumber }));
  get('seed-form').addEventListener('submit', event => {
    event.preventDefault();
    seed = get('seed').valueAsNumber >>> 0;
    params.set('seed', seed);
    history.replaceState(null, '', '?' + params);
    reset();
    announce('Bioma regenerado · semilla ' + seed);
  });
  get('agent-detail').parentElement.addEventListener('toggle', () => {
    if (snapshot?.id === world.selectedId) showAgent(snapshot);
  });

  const c = world.canvas;
  let anchor;
  let lastPaint = 0;
  const radius = () => Number(get('radius').value);
  function paint(x, y) {
    const time = performance.now();
    if (time - lastPaint < 94) return;
    const hit = world.locate(x, y);
    if (!hit) return;
    lastPaint = time;
    send({ type: 'brush', mode: tool, x: hit.x, z: hit.z, radius: radius() });
  }

  c.addEventListener('pointerdown', event => {
    if (world.documentary.busy || event.button !== 0 || !event.isPrimary) return;
    anchor = { x: event.clientX, y: event.clientY };
    if (tool !== 'watch') {
      if (event.pointerType !== 'touch') paint(event.clientX, event.clientY);
      c.setPointerCapture(event.pointerId);
    }
  });
  c.addEventListener('pointermove', event => {
    if (world.documentary.busy || tool === 'watch') return;
    world.hover(event.clientX, event.clientY, radius());
    if (event.pointerType !== 'touch' && event.buttons === 1 && anchor) paint(event.clientX, event.clientY);
  });
  c.addEventListener('pointerup', event => {
    if (event.button !== 0 || !event.isPrimary || !anchor) return;
    if (Math.hypot(event.clientX - anchor.x, event.clientY - anchor.y) < 7) {
      if (tool === 'watch') select(world.pick(event.clientX, event.clientY));
      else if (event.pointerType === 'touch') paint(event.clientX, event.clientY);
    }
    anchor = null;
  });
  c.addEventListener('pointercancel', () => { anchor = null; world.ring.visible = false; });
  c.addEventListener('pointerleave', () => { world.ring.visible = false; });
  window.addEventListener('keydown', event => {
    if (world.duelOpen) return;
    if (!documentary.hidden) {
      if (event.key === 'Escape') { event.preventDefault(); exitDocumentary(); }
      return;
    }
    if (/^(INPUT|SELECT|TEXTAREA|BUTTON|SUMMARY)$/.test(event.target.tagName) || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.code === 'Space') { event.preventDefault(); commands.pause(); }
    if (event.key >= '1' && event.key <= '8') setTool(TOOLS[Number(event.key) - 1][0]);
    if (event.key === 'Escape') {
      setTool('watch');
      if (!get('settings').hidden) commands.settings();
    }
  });

  if (!initialSelect) inspectVisible(false);
  reset();
}

function boot() {
  const viewport = get('viewport');
  let world;
  if (typeof window.WebGL2RenderingContext !== 'undefined') {
    const options = { alpha: false, antialias: true, powerPreference: 'high-performance' };
    const context = viewport.getContext('webgl2', options);
    if (context) world = new World(viewport, context);
  }
  if (!world) {
    world = new CompatibilityWorld(viewport);
    viewport.dataset.renderer = 'canvas2d';
    get('view-mode').hidden = false;
  }
  start(world);
}

try {
  boot();
} catch (error) {
  console.error(error);
  app.classList.add('unavailable');
  announce('El navegador no pudo iniciar el lienzo del bioma.', true);
}

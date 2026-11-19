import './style.css';

import { showAgent, showStats, shell } from './panels.js';
import { SKY_PRESETS, TOOLS, icon } from './ui-data.js';
import { World } from './view/world.js';

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

  function inspectVisible(visible) {
    inspector.hidden = !visible;
    get('show-inspector').hidden = visible;
  }

  function followState() {
    followButton.setAttribute('aria-pressed', world.following);
    followButton.lastElementChild.textContent = world.following ? 'Dejar de seguir' : 'Seguir criatura';
  }

  function select(id) {
    if (!id) return;
    world.selectedId = id;
    world.following = false;
    inspectVisible(true);
    followState();
    send({ type: 'inspect', id });
  }

  function reset() {
    world.fauna.records.clear();
    world.selectedId = 0;
    world.weather = 'clear';
    world.time = 0;
    world.dayOffset = 0;
    get('day').value = 8.5;
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

  const commands = {
    pause: () => setSpeed(speed ? 0 : previous),
    reset: () => { reset(); announce('Simulación reiniciada · semilla ' + seed); },
    camera: () => { world.resetView(); followState(); },
    markers: () => setMarkers(!world.markers),
    settings: () => {
      const panel = get('settings');
      panel.hidden = !panel.hidden;
      app.querySelector('[data-cmd="settings"]').setAttribute('aria-expanded', !panel.hidden);
    },
    'close-inspector': () => inspectVisible(false),
    'show-inspector': () => inspectVisible(true),
    follow: () => {
      if (!world.selectedId) return;
      if (world.following) world.following = false;
      else world.focus(world.selectedId, true);
      followState();
    },
    'pick-prey': () => select(world.fauna.nearest(world.controls.target, 0)?.id),
    'pick-predator': () => select(world.fauna.nearest(world.controls.target, 1)?.id),
  };

  let lastHUD = 0;
  let lastInspect = 0;
  worker.onmessage = ({ data }) => {
    if (data.type !== 'snapshot') return;
    const recycle = buffer => worker.postMessage({ type: 'recycle', buffer }, [buffer]);
    if (data.version !== version) { recycle(data.agents.buffer); return; }
    if (data.terrain) world.setMap(data.terrain);
    world.fauna.snapshot(data.agents, data.length);
    recycle(data.agents.buffer);
    stats = data.stats;
    world.weather = stats.weather;
    world.time = stats.time;
    if (initialSelect && data.length) {
      initialSelect = false;
      select(world.fauna.nearest(world.controls.target, 0)?.id);
    }
    if (world.selectedId && !world.fauna.records.has(world.selectedId)) {
      world.selectedId = 0;
      world.following = false;
      followState();
      showAgent(null);
    }
    for (const button of app.querySelectorAll('[data-weather]')) {
      const active = button.dataset.weather === stats.weather;
      button.setAttribute('aria-pressed', active);
    }
    const now = performance.now();
    if (now - lastHUD > 170 || data.terrain || !lastHUD) {
      lastHUD = now;
      showStats(stats, world.dayOffset, world.fps);
    }
    if (data.selected?.id === world.selectedId) {
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
  get('quality').addEventListener('change', event => world.setQuality(event.target.value));
  get('markers').addEventListener('change', event => setMarkers(event.target.checked));
  get('radius').addEventListener('input', event => { get('radius-value').textContent = event.target.value + ' m'; });
  get('day').addEventListener('input', event => {
    world.dayOffset = (Number(event.target.value) - 8.5 - world.time / 26 + 48) % 24;
    if (stats) showStats(stats, world.dayOffset, world.fps);
  });
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
    if (event.button !== 0 || !event.isPrimary) return;
    anchor = { x: event.clientX, y: event.clientY };
    if (tool !== 'watch') {
      if (event.pointerType !== 'touch') paint(event.clientX, event.clientY);
      c.setPointerCapture(event.pointerId);
    }
  });
  c.addEventListener('pointermove', event => {
    if (tool === 'watch') return;
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

try {
  start(new World(get('viewport')));
} catch (error) {
  console.error(error);
  app.classList.add('unavailable');
  announce('El bioma necesita WebGL 2. Abre la página en un navegador con aceleración gráfica.', true);
}

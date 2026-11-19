import { INPUTS, OUTPUTS, SPECIES, clamp } from './sim/config.js';
import { NH, NI, NO } from './sim/neural.js';
import { SKY_PRESETS, TOOLS, icon } from './ui-data.js';

const format = new Intl.NumberFormat('es-EC');
const number = (val = 0) => format.format(val);
const zones = [['Hambre', 'hunger'], ['Sed', 'thirst'], ['Energía', 'energy'], ['Miedo', 'fear']];
const weatherButtons = Object.entries(SKY_PRESETS).map(([key, p]) =>
  `<button class="weather-btn" type="button" data-weather="${key}" title="${p.label} · ${p.degrees} °C" aria-label="${p.label}" aria-pressed="${key === 'clear'}">${icon(p.icon, 18)}<span>${p.label}</span></button>`,
).join('');

export function shell() {
  return `
    <canvas id="viewport" aria-label="Bioma 3D interactivo"></canvas>
    <div class="vignette"></div>
    <header class="topbar">
      <div class="brand"><span class="brand-icon">${icon('leaf', 24)}</span><div><h1>Ecosistema Vivo</h1><p>Laboratorio de neuroevolución</p></div></div>
      <div class="weather-bar" role="group" aria-label="Clima del bioma">${weatherButtons}</div>
      <div class="sim-top">
        <span class="weather-readout" id="weather-readout">21 °C</span>
        <button class="quiet icon-btn" data-cmd="settings" type="button" title="Ajustes" aria-label="Ajustes" aria-expanded="false">${icon('sliders')}</button>
      </div>
    </header>
    <aside class="left-stack" aria-label="Estadísticas del ecosistema">
      <section class="panel population">
        <div class="panel-heading"><div>${icon('history', 17)} <h2>Población</h2></div><span class="live" id="live"><i></i><span>En vivo</span></span></div>
        <div class="population-values">
          <div><span class="metric-label"><i class="prey-dot"></i>Presas</span><strong class="prey" id="prey">–</strong></div>
          <div><span class="metric-label"><i class="predator-dot"></i>Depredadores</span><strong class="predator" id="predators">–</strong></div>
        </div>
        <div class="plot-wrap"><canvas id="history" width="408" height="110" role="img" aria-label="Historial de población por especie"></canvas></div>
        <div class="chart-footer"><span id="history-start">00:00</span><span id="clock">00:00</span></div>
      </section>
      <section class="panel evolution">
        <div class="panel-heading"><div>${icon('brain', 17)}<h2>Evolución</h2></div></div>
        <div class="evolution-grid">
          <div><span>Generación</span><strong id="generation">–</strong></div>
          <div><span>Nacimientos</span><strong id="births">–</strong></div>
          <div><span>Mutaciones</span><strong id="mutations">–</strong></div>
          <div><span>Reserva</span><strong id="recoveries">–</strong></div>
        </div>
        <details class="behavior"><summary>Conductas observadas ${icon('chevron', 14)}</summary><dl>
          <div><dt>Capturas</dt><dd id="hunt">0</dd></div>
          <div><dt>Capturas cooperativas</dt><dd id="cooperative">0</dd></div>
          <div><dt>Uso de refugio</dt><dd id="shelter">0</dd></div>
          <div><dt>Migración a recursos</dt><dd id="migrations">0</dd></div>
        </dl></details>
      </section>
      <div id="event-log" class="event-log" hidden></div>
    </aside>
    <aside class="panel inspector" id="inspector" aria-label="Inspector neuronal">
      <div class="panel-heading">
        <div>${icon('cross', 18)}<h2>Inspector neuronal</h2></div>
        <button class="quiet icon-btn compact" data-cmd="close-inspector" type="button" title="Cerrar inspector" aria-label="Cerrar inspector">${icon('close', 16)}</button>
      </div>
      <div id="agent-empty" class="agent-empty"><span>${icon('brain', 31)}</span><p>Selecciona una criatura en el bioma para ver su red en tiempo real.</p></div>
      <div id="agent-panel" hidden>
        <div class="identity"><div><small id="species">–</small><strong id="agent-id">–</strong></div><span id="agent-generation"></span></div>
        <div id="agent-action" class="agent-action">Explorando</div>
        <div class="meters">${zones.map(([label, id]) => `<div><span>${label}</span><meter id="meter-${id}" min="0" max="1" value="0" aria-label="${label}"></meter><output id="value-${id}">0%</output></div>`).join('')}</div>
        <div class="network">
          <div class="network-head"><h3>Actividad neuronal</h3><span>28 · 14 · 6</span></div>
          <canvas id="network" width="510" height="244" role="img" aria-label="Activaciones y conexiones ponderadas de la red neuronal"></canvas>
          <div class="network-footer"><span>Sensor</span><span>Capa oculta</span><span>Acción</span></div>
        </div>
        <div class="lineage"><span>Linaje</span><strong id="lineage">–</strong></div>
        <div class="lineage"><span>Mutaciones al nacer</span><strong id="agent-mutations">–</strong></div>
        <div class="lineage"><span>Aptitud acumulada</span><strong id="fitness">–</strong></div>
        <details class="behavior agent-detail"><summary>Sensores y acciones ${icon('chevron', 14)}</summary><div id="agent-detail"></div></details>
        <button class="follow" data-cmd="follow" id="follow" type="button" aria-pressed="false">${icon('eye', 16)} <span>Seguir criatura</span></button>
      </div>
      <div class="pickers" role="group" aria-label="Elegir criatura cercana">
        <button type="button" data-cmd="pick-prey"><i class="prey-dot"></i>Presa</button>
        <button type="button" data-cmd="pick-predator"><i class="predator-dot"></i>Depredador</button>
      </div>
    </aside>
    <button class="panel show-inspector" id="show-inspector" type="button" data-cmd="show-inspector" title="Abrir inspector" aria-label="Abrir inspector" hidden>${icon('brain')}</button>
    <section class="panel settings" id="settings" aria-label="Ajustes" hidden>
      <h2>Ajustes</h2>
      <label>Calidad gráfica <select id="quality"><option value="eco">Rendimiento</option><option value="balanced" selected>Equilibrada</option><option value="cinema">Cinemática</option></select></label>
      <label>Marcadores <input id="markers" type="checkbox" checked></label>
      <label>Hora del bioma <input id="day" type="range" min="0" max="23.9" value="8.5" step=".1"></label>
      <form id="seed-form"><label>Semilla <input id="seed" type="number" min="0" max="4294967295" required></label><button type="submit">Aplicar</button></form>
      <output id="render-fps">– FPS</output>
    </section>
    <div class="scene-legend" aria-hidden="true"><span>${icon('compass', 15)} Cuenca del Pinar</span><i></i><span id="scene-time">08:30</span></div>
    <div class="camera-controls" role="group" aria-label="Cámara">
      <button class="panel camera-btn" type="button" data-cmd="camera" title="Vista inicial" aria-label="Vista inicial">${icon('compass', 19)}</button>
      <button class="panel camera-btn" type="button" data-cmd="markers" title="Alternar marcadores" aria-label="Alternar marcadores" aria-pressed="true">${icon('layers', 19)}</button>
    </div>
    <div class="bottom-dock">
      <div class="brush-control panel" id="brush-control" hidden>
        <span id="tool-hint"></span><label for="radius">Radio</label><input id="radius" type="range" min="6" max="48" value="24"><output for="radius" id="radius-value">24 m</output>
      </div>
      <div class="dock-line">
        <div class="panel tool-dock" role="group" aria-label="Herramientas del bioma">${TOOLS.map(([key, shape, label], i) =>
          `<button class="tool" type="button" data-tool="${key}" aria-label="${label}" aria-pressed="${i === 0}" title="${label} · ${i + 1}">${icon(shape, 22)}<span>${label}</span></button>`,
        ).join('')}</div>
        <div class="panel time-dock" role="group" aria-label="Velocidad de simulación">
          <button class="transport" data-cmd="pause" id="pause" type="button" title="Pausar · Espacio" aria-label="Pausar">${icon('pause', 19)}</button>
          <button class="speed" data-speed="1" type="button" aria-label="Velocidad ×1" aria-pressed="true">1×</button>
          <button class="speed" data-speed="2" type="button" aria-label="Velocidad ×2" aria-pressed="false">2×</button>
          <button class="speed" data-speed="4" type="button" aria-label="Velocidad ×4" aria-pressed="false">4×</button>
          <button class="transport restart" data-cmd="reset" type="button" title="Reiniciar simulación" aria-label="Reiniciar simulación">${icon('reset', 17)}</button>
        </div>
      </div>
      <p class="control-hint" id="control-hint">Arrastra para orbitar <b>·</b> Rueda o pellizca para acercarte <b>·</b> Toca una criatura para inspeccionarla</p>
    </div>
    <div id="banner" class="banner" role="status" hidden></div>
  `;
}

const byId = id => document.getElementById(id);
export function duration(time) {
  const mins = String(Math.floor(time / 60)).padStart(2, '0');
  return mins + ':' + String(Math.floor(time) % 60).padStart(2, '0');
}

function chart(history) {
  const c = byId('history');
  const ctx = c.getContext('2d');
  const { width: w, height: h } = c;
  ctx.clearRect(0, 0, w, h);
  for (const t of [.18, .51, .84]) {
    ctx.strokeStyle = '#71816c35';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, h * t);
    ctx.lineTo(w, h * t);
    ctx.stroke();
  }
  if (!history.length) return;
  const max = Math.max(30, ...history.flatMap(point => point.slice(1)));
  const draw = (index, line, top) => {
    const points = history.map((sample, i) => [
      history.length === 1 ? 3 : 3 + i / (history.length - 1) * (w - 6),
      h - 3 - sample[index] / max * (h * .83),
    ]);
    if (points.length === 1) points.push([w - 3, points[0][1]]);
    ctx.beginPath();
    for (const [i, [x, y]] of points.entries()) i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, top);
    gradient.addColorStop(1, 'transparent');
    ctx.lineTo(points.at(-1)[0], h);
    ctx.lineTo(points[0][0], h);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.beginPath();
    for (const [i, [x, y]] of points.entries()) i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    ctx.strokeStyle = line;
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.stroke();
  };
  draw(1, '#b6db91', '#b6db9140');
  draw(2, '#e5a36e', '#e5a36e2d');
}

let chartKey = '';
let eventKey = '';
export function showStats(stats, dayOffset, fps) {
  const metrics = { prey: stats.counts[0], predators: stats.counts[1], generation: stats.generation, births: stats.births,
    mutations: stats.mutations, recoveries: stats.recoveries, hunt: stats.hunts, cooperative: stats.cooperative,
    shelter: stats.shelter, migrations: stats.migrations };
  for (const [id, value] of Object.entries(metrics)) byId(id).textContent = number(value);
  byId('clock').textContent = duration(stats.time);
  byId('history-start').textContent = duration(stats.history[0]?.[0] ?? 0);
  byId('weather-readout').textContent = SKY_PRESETS[stats.weather].degrees + ' °C';
  const hour = (8.5 + stats.time / 26 + dayOffset) % 24;
  byId('scene-time').textContent = duration(hour * 60);
  byId('render-fps').textContent = fps ? fps + ' FPS' : '– FPS';
  const latest = stats.history.at(-1)?.join();
  if (chartKey !== latest) {
    chartKey = latest;
    chart(stats.history);
  }
  const event = stats.events[0];
  const log = byId('event-log');
  log.hidden = !event;
  if (event && event.id !== eventKey) {
    const time = document.createElement('time');
    time.textContent = duration(event.time);
    const text = document.createElement('span');
    text.textContent = event.text;
    log.replaceChildren(time, text);
    eventKey = event.id;
  }
}

function point(index, count, x, height) {
  return [x, 9 + (height - 18) * (index + .5) / count];
}

function neural(info) {
  const c = byId('network');
  const context = c.getContext('2d');
  const { width, height } = c;
  const layers = [info.inputs, info.hidden, info.outputs];
  const columns = [25, width * .50, width - 24];
  context.clearRect(0, 0, width, height);
  const points = layers.map((layer, j) => layer.map((_, i) => point(i, layer.length, columns[j], height)));
  const bases = [0, NH * (NI + 1)];
  for (let level = 0; level < 2; level++) {
    const source = layers[level], targets = layers[level + 1], base = bases[level];
    for (let j = 0; j < targets.length; j++) {
      const [bx, by] = points[level + 1][j];
      for (let i = 0; i < source.length; i++) {
        const w = info.genes[base + j * (source.length + 1) + i];
        const current = w * source[i];
        if (Math.abs(w) < .18 || (Math.abs(current) < .08 && Math.abs(w) < .78)) continue;
        const [ax, ay] = points[level][i];
        const opacity = clamp(.075 + Math.abs(current) * .39, .08, .74);
        context.strokeStyle = current >= 0 ? `rgba(176,216,129,${opacity})` : `rgba(235,152,92,${opacity})`;
        context.lineWidth = Math.abs(current) > .5 ? 2 : 1;
        context.beginPath();
        context.moveTo(ax, ay);
        context.bezierCurveTo(ax + (bx - ax) * .54, ay, bx - (bx - ax) * .54, by, bx, by);
        context.stroke();
      }
    }
  }
  for (const [layer, values] of layers.entries()) {
    for (const [i, value] of values.entries()) {
      const [x, y] = points[layer][i];
      const activity = clamp(Math.abs(value));
      context.fillStyle = value >= 0 ? `rgba(205,236,167,${.24 + activity * .76})` : `rgba(238,167,115,${.24 + activity * .76})`;
      context.beginPath();
      context.arc(x, y, [2.6, 4.4, 5.8][layer] + activity, 0, Math.PI * 2);
      context.fill();
    }
  }
}

export function showAgent(agent) {
  byId('agent-empty').hidden = Boolean(agent);
  byId('agent-panel').hidden = !agent;
  if (!agent) return;
  const species = byId('species');
  species.textContent = SPECIES[agent.species].name;
  species.className = agent.species ? 'predator' : 'prey';
  byId('agent-id').textContent = '#' + String(agent.id).padStart(3, '0');
  byId('agent-generation').textContent = 'G' + agent.generation;
  byId('agent-action').textContent = agent.action;
  for (const [, key] of zones) {
    byId('meter-' + key).value = agent[key];
    byId('value-' + key).textContent = Math.round(agent[key] * 100) + '%';
  }
  byId('lineage').textContent = agent.lineage.length ? agent.lineage.map(id => '#' + id).join(' / ') : 'Fundador';
  byId('agent-mutations').textContent = number(agent.mutations);
  byId('fitness').textContent = agent.fitness.toFixed(1);
  const detail = byId('agent-detail');
  if (detail.parentElement.open) {
    if (!detail.childElementCount) {
      for (const label of ['Edad', 'Salud', 'Capturas / asistencias', 'Refugios / migraciones', ...OUTPUTS, ...INPUTS]) {
        const row = document.createElement('div');
        const key = document.createElement('span');
        key.textContent = label;
        row.append(key, document.createElement('b'));
        detail.append(row);
      }
    }
    const values = [agent.age.toFixed(1) + ' s', Math.round(agent.health * 100) + '%',
      agent.kills + ' / ' + agent.assists, agent.escapes + ' / ' + agent.moves,
      ...agent.outputs.map(v => v.toFixed(2)), ...agent.inputs.map(v => v.toFixed(2))];
    for (const [i, value] of values.entries()) detail.children[i].lastElementChild.textContent = value;
  }
  neural(agent);
}

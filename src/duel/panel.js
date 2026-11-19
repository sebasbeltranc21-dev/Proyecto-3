import './panel.css';
import { OUTPUTS, clamp } from '../sim/config.js';
import { NI } from '../sim/neural.js';
import { ARENAS } from './arena.js';
import { IDS, SECONDS, SENSORS } from './episode.js';
import { Tactics, readAnimal } from './tactics.js';

const options = (items) => items.map(([id, label]) => `<option value="${id}">${label}</option>`).join('');
const metric = (value, label) => `<span><strong>${value}</strong> ${label}</span>`;
const animalName = id => (id >= 5 ? 'Lobo ' + (id - 4) : 'Presa ' + id);
const fmt = value => Number(value).toFixed(1).replace('.', ',');

function layout() {
  return `
    <header class="duel-head">
      <div><h1 id="duel-title">Duelo Evolutivo</h1><p>Compara técnicas de caza y escape en el mismo escenario.</p></div>
      <button type="button" data-duel="close" class="duel-close" aria-label="Cerrar Duelo Evolutivo">×</button>
    </header>
    <div class="duel-menu">
      <div class="duel-tabs" role="group" aria-label="Tipo de comparación">
        <button type="button" data-duel="compare" aria-pressed="true">Generaciones</button>
        <button type="button" data-duel="ablation" aria-pressed="false">Probar un sensor</button>
        <button type="button" data-duel="pack" hidden>Ver caza cooperativa</button>
      </div>
      <div class="duel-fields">
        <label>Escenario <select data-duel="arena">${options(ARENAS.map((arena, i) => [i, arena.name]))}</select></label>
        <label data-duel="team-label">Evolución de <select data-duel="team">${options([['wolves', 'Lobos'], ['prey', 'Presas'], ['both', 'Ambas especies']])}</select></label>
        <label data-duel="first-label">Generación A <select data-duel="first"></select></label>
        <label><span data-duel="last-label">Generación B</span> <select data-duel="last"></select></label>
        <label data-duel="sensor-label" hidden>Desactivar en B <select data-duel="sensor">${options(Object.entries(SENSORS).filter(([key]) => key !== 'none').map(([key, item]) => [key, item.label]))}</select></label>
      </div>
      <p class="duel-note" data-duel="note"></p>
    </div>
    <div class="duel-worlds">
      ${['left', 'right'].map((side, index) => `<article class="duel-world">
        <header><span class="duel-letter">${index ? 'B' : 'A'}</span><h2 data-duel="${side}-title">Cargando…</h2></header>
        <canvas data-duel="${side}-map" aria-label="Vista táctica ${index ? 'B' : 'A'}"></canvas>
        <div data-duel="${side}-metrics" class="duel-metrics"></div>
      </article>`).join('')}
    </div>
    <div class="duel-playback">
      <button type="button" data-duel="play">Reproducir</button>
      <input data-duel="time" type="range" min="0" max="${SECONDS}" value="0" step=".1" aria-label="Tiempo de la repetición">
      <output data-duel="clock">0,0 / ${SECONDS} s</output>
    </div>
    <div class="duel-legend">
      <span><i class="duel-prey"></i>Presas</span><span><i class="duel-wolf"></i>Lobos</span><span>× Captura</span>
      <p data-duel="status" role="status">Cargando generaciones…</p>
    </div>
    <div class="duel-moments" data-duel="moments" hidden></div>
    <div class="duel-analysis">
      <section class="duel-outputs">
        <header><h2>Decisiones de la red</h2><select data-duel="focus" aria-label="Criatura inspeccionada">${options(IDS.map(id => [id, animalName(id)]))}</select></header>
        <div class="duel-table-scroll"><table>
          <thead><tr><th scope="col">Salida</th><th scope="col">A</th><th scope="col">B</th></tr></thead>
          <tbody>${OUTPUTS.map((name, i) => `<tr><th scope="row">${name}</th><td data-duel="a${i}">–</td><td data-duel="b${i}">–</td></tr>`).join('')}</tbody>
        </table></div>
        <p class="duel-note" data-duel="sensor-value" hidden></p>
      </section>
      <section class="duel-history" data-duel="history-panel">
        <header><h2>Resultados por generación</h2></header>
        <p class="duel-note">3 escenarios de evaluación. Rival fijo de G1 para cada especie.</p>
        <canvas width="480" height="145" data-duel="history" role="img" aria-label="Capturas y supervivientes por generación"></canvas>
        <div class="duel-evaluation" data-duel="evaluation"></div>
      </section>
    </div>`;
}

export function createDuel(onClose) {
  const dialog = document.createElement('dialog');
  dialog.className = 'duel';
  dialog.setAttribute('aria-labelledby', 'duel-title');
  dialog.innerHTML = layout();
  document.body.append(dialog);
  const get = key => dialog.querySelector(`[data-duel="${key}"]`);
  const first = get('first'), last = get('last'), team = get('team'), focus = get('focus');
  const play = get('play'), status = get('status');
  const values = OUTPUTS.map((_, index) => [get('a' + index), get('b' + index)]);
  const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  const cache = new Map();
  let total = 0, history, example, current, match, jumpToCapture = false;
  let running = true, time = 0, prior = 0, raf = 0, request = 0, inspection = '';
  let ablation = false;
  focus.value = '5';
  const maps = ['left', 'right'].map(side => new Tactics(get(side + '-map'), id => {
    focus.value = id;
    if (ablation) compare(true);
  }));

  function togglePlay(next) {
    running = next;
    play.textContent = running ? 'Pausar' : 'Reproducir';
  }

  function compare(hold = false) {
    if (!total) return;
    const config = {
      arena: Number(get('arena').value), first: Number(ablation ? last.value : first.value),
      last: Number(last.value), mode: team.value, sensor: ablation ? get('sensor').value : 'none',
      focus: Number(focus.value),
    };
    if (!hold) {
      time = 0;
      togglePlay(true);
    }
    const key = [config.arena, config.first, config.last, config.mode, config.sensor, ablation ? config.focus : 0].join('/');
    current = { ...config, key, id: ++request };
    get('left-title').textContent = ablation ? `G${config.first} · red completa` : `Generación ${config.first}`;
    get('right-title').textContent = ablation ? `G${config.last} · sensor desactivado` : `Generación ${config.last}`;
    get('note').textContent = ablation
      ? `Misma generación y posición inicial. Solo se apaga el sensor de ${animalName(config.focus).toLowerCase()} en B.`
      : config.mode === 'both' ? 'Mismo mapa y posiciones iniciales. Evolucionan lobos y presas.'
        : `Mismo mapa y posiciones iniciales. ${config.mode === 'wolves' ? 'Las presas' : 'Los lobos'} usan G1 en ambos lados.`;
    get('sensor-value').hidden = !ablation;
    match = null;
    for (const side of ['left', 'right']) get(side + '-metrics').replaceChildren();
    get('moments').hidden = true;
    if (cache.has(key)) {
      load(cache.get(key));
    } else {
      status.textContent = 'Preparando las dos repeticiones…';
      dialog.classList.add('duel-loading');
      worker.postMessage(current);
    }
    plot();
  }

  function plot() {
    if (!history || !current) return;
    const canvas = get('history'), c = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    const mode = current.mode;
    c.clearRect(0, 0, w, h);
    const x = index => 23 + index * (w - 45) / (total - 1);
    const y = value => 12 + (12 - value) / 12 * (h - 38);
    c.strokeStyle = '#caddb728';
    c.fillStyle = '#a4b69f';
    c.font = '11px system-ui';
    for (const n of [0, 4, 8, 12]) {
      const py = y(n);
      c.fillText(String(n), 2, py + 4);
      c.beginPath();
      c.moveTo(22, py); c.lineTo(w - 16, py);
      c.stroke();
    }
    c.textAlign = 'center';
    for (const n of [1, Math.floor(total / 2), total]) c.fillText('G' + n, x(n - 1), h - 6);
    c.textAlign = 'start';
    const series = [
      { color: '#f3ad78', data: item => item[1].captures, label: 'Capturas' },
      { color: '#c4e8a1', data: item => item[0].survivors, label: 'Supervivientes' },
    ].filter((_, i) => mode === 'both' || i === Number(mode === 'prey'));
    for (const { color, data } of series) {
      c.strokeStyle = c.fillStyle = color;
      c.lineWidth = 2;
      c.beginPath();
      history.forEach((item, i) => { if (i === 0) c.moveTo(x(i), y(data(item))); else c.lineTo(x(i), y(data(item))); });
      c.stroke();
      for (const gen of [current.first, current.last]) {
        c.beginPath();
        c.arc(x(gen - 1), y(data(history[gen - 1])), 4, 0, Math.PI * 2);
        c.fill();
      }
    }
    get('evaluation').innerHTML = series.map(({ color, data, label }) => `<span style="color:${color}">${label} · A ${data(history[current.first - 1])}/12 · B ${data(history[current.last - 1])}/12</span>`).join('');
  }

  function load(data) {
    match = data;
    dialog.classList.remove('duel-loading');
    status.textContent = `Resultados al final de ${SECONDS} s`;
    for (const [index, side] of ['left', 'right'].entries()) {
      const m = data[side].metrics;
      maps[index].setTerrain(data.visual);
      get(side + '-metrics').innerHTML = [
        metric(m.captures, 'capturas'), metric(m.cooperative, 'en equipo'),
        metric(m.survivors + '/4', 'vivas'), metric(m.shelter, 'en cobertura'),
      ].join('');
    }
    const timeline = get('moments');
    timeline.replaceChildren();
    for (const side of ['left', 'right']) {
      const key = side === 'left' ? 'A' : 'B';
      const event = data[side].contacts.find(item => item.cooperative) ??
        data[side].contacts.find(item => item.captured) ?? data[side].contacts[0];
      if (!event) continue;
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = `${key} · ${event.cooperative ? 'Captura cooperativa' : event.captured ? 'Captura' : 'Primer ataque'} · ${fmt(event.time)} s`;
      button.addEventListener('click', () => {
        time = Math.max(0, event.time - 1.7);
        focus.value = event.wolf;
        togglePlay(true);
        if (ablation && event.wolf !== current.focus) focus.value = current.focus;
      });
      timeline.append(button);
    }
    timeline.hidden = timeline.childElementCount === 0;
    if (jumpToCapture) {
      jumpToCapture = false;
      const event = data.right.contacts.find(item => item.cooperative);
      if (event) {
        time = Math.max(0, event.time - 2.2);
        focus.value = event.wolf;
      }
    }
    inspection = '';
  }

  worker.onmessage = ({ data }) => {
    if (data.type === 'ready') {
      total = data.total;
      history = data.history;
      example = data.example;
      get('pack').hidden = !example.cooperative;
      const choices = options(history.map((_, index) => [index + 1, 'G' + (index + 1)]));
      first.innerHTML = last.innerHTML = choices;
      last.value = total;
      compare();
    } else if (data.id === current?.id && data.type === 'matches') {
      cache.set(current.key, data);
      if (cache.size > 10) cache.delete(cache.keys().next().value);
      load(data);
    } else if (data.id === current?.id) {
      dialog.classList.remove('duel-loading');
      status.textContent = 'No se pudo calcular la repetición. Cambia el escenario para reintentar.';
    }
  };
  worker.onerror = () => { status.textContent = 'No se pudieron cargar las generaciones.'; };

  function frame(now) {
    if (!dialog.open) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min((now - (prior || now)) / 1000, .1);
    prior = now;
    if (!match) return;
    if (running) time = Math.min(SECONDS, time + dt);
    if (time === SECONDS && running) togglePlay(false);
    const selected = Number(focus.value);
    maps[0].draw(match.left, time, selected);
    maps[1].draw(match.right, time, selected);
    const row = Math.floor(time * 10);
    const key = match.id + '/' + row + '/' + selected;
    if (key === inspection) return;
    inspection = key;
    const left = readAnimal(match.left, time, selected), right = readAnimal(match.right, time, selected);
    for (const [i, [a, b]] of values.entries()) {
      const at = 6 + NI + i;
      a.textContent = left[3] <= 0 ? '–' : left[at].toFixed(2);
      b.textContent = right[3] <= 0 ? '–' : right[at].toFixed(2);
      b.classList.toggle('duel-difference', Math.abs(left[at] - right[at]) > .08 && left[3] > 0 && right[3] > 0);
    }
    if (ablation) {
      const sensor = SENSORS[current.sensor];
      const input = row => Math.max(...sensor.inputs.map(index => Math.abs(row[6 + index]))).toFixed(2);
      get('sensor-value').textContent = `${sensor.label} · Entrada A ${input(left)} · Entrada B ${input(right)}`;
    }
    get('time').value = time;
    get('clock').textContent = `${fmt(time)} / ${SECONDS} s`;
  }

  function setMode(next) {
    ablation = next;
    for (const name of ['first-label', 'team-label', 'history-panel']) get(name).hidden = next;
    get('pack').hidden = next || !example?.cooperative;
    get('last-label').textContent = next ? 'Generación' : 'Generación B';
    get('sensor-label').hidden = !next;
    get('compare').setAttribute('aria-pressed', !next);
    get('ablation').setAttribute('aria-pressed', next);
    time = Math.max(0, time - 2.5);
    togglePlay(false);
    compare(true);
  }

  get('close').addEventListener('click', () => dialog.close());
  get('compare').addEventListener('click', () => { if (ablation) setMode(false); });
  get('ablation').addEventListener('click', () => { if (!ablation) setMode(true); });
  get('pack').addEventListener('click', () => {
    get('arena').value = example.arena;
    first.value = '1';
    last.value = example.generation;
    team.value = 'wolves';
    jumpToCapture = true;
    compare();
  });
  for (const name of ['first', 'last', 'arena', 'team']) get(name).addEventListener('change', () => {
    if (name === 'team') focus.value = team.value === 'prey' ? '1' : '5';
    compare();
  });
  get('sensor').addEventListener('change', () => { togglePlay(false); compare(true); });
  focus.addEventListener('change', () => { if (ablation) compare(true); });
  play.addEventListener('click', () => {
    if (time >= SECONDS) time = 0;
    togglePlay(!running);
  });
  get('time').addEventListener('input', event => {
    time = clamp(event.target.valueAsNumber, 0, SECONDS);
    togglePlay(false);
  });
  dialog.addEventListener('close', () => { cancelAnimationFrame(raf); prior = 0; onClose(); });
  return { open() { dialog.showModal(); togglePlay(true); raf = requestAnimationFrame(frame); } };
}

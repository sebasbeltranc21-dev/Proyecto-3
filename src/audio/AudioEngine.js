import { CHANNELS, GRID, HALF, STEP, WATER, clamp } from '../sim/config.js';
import { ground } from '../sim/terrain.js';

const UPDATE_INTERVAL = .085;
const WIND = { clear: .8, heat: 1, fog: 1.28, rain: 1.63 };

function gain(context, value, destination) {
  const node = context.createGain();
  node.gain.value = value;
  node.connect(destination);
  return node;
}

function filter(context, type, frequency, q, destination) {
  const node = context.createBiquadFilter();
  node.type = type;
  node.frequency.value = frequency;
  node.Q.value = q;
  node.connect(destination);
  return node;
}

function panner(context, destination) {
  const node = context.createPanner();
  node.panningModel = 'HRTF';
  node.rolloffFactor = 0;
  node.connect(destination);
  return node;
}

function position(node, x, y, z, now, lag) {
  if (!node.positionX) {
    node.setPosition(x, y, z);
    return;
  }
  node.positionX.setTargetAtTime(x, now, lag);
  node.positionY.setTargetAtTime(y, now, lag);
  node.positionZ.setTargetAtTime(z, now, lag);
}

function noise(context) {
  const buffer = context.createBuffer(1, context.sampleRate * 3, context.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
  return buffer;
}

export function terrainSounds(map) {
  const water = [], fire = [];
  for (let index = 0; index < GRID * GRID; index++) {
    const at = index * CHANNELS;
    if (map[at] >= WATER && map[at + 4] <= .12) continue;
    const x = (index % GRID + .5) * STEP - HALF;
    const z = (Math.floor(index / GRID) + .5) * STEP - HALF;
    if (map[at] < WATER) water.push({ x, y: WATER + .1, z, level: .68 + clamp((WATER - map[at]) / 3.5) * .32 });
    else if (map[at + 4] > .12) fire.push({ x, y: map[at] + .9, z, level: map[at + 4] });
  }
  return { water, fire };
}

function nearest(sources, ear, radius) {
  let closest, best = 0;
  for (const source of sources) {
    const distance = Math.hypot(source.x - ear.x, source.y - ear.y, source.z - ear.z);
    const level = source.level / (1 + (distance / radius) ** 2) * (1 - clamp((distance - radius) / (radius * 3)));
    if (level <= best) continue;
    best = level;
    closest = source;
  }
  return { source: closest, level: best };
}

export class AudioEngine {
  constructor() {
    this.Context = window.AudioContext ?? window.webkitAudioContext;
    this.enabled = false;
    this.last = -Infinity;
    this.calls = new WeakMap();
    this.nextCall = 0;
    this.nextCrackle = 0;
  }

  setTerrain(map) {
    this.map = map;
    if (this.context) this.sources = terrainSounds(map);
  }

  connect() {
    const context = new this.Context();
    this.context = context;
    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -15;
    limiter.ratio.value = 4;
    limiter.connect(context.destination);
    this.master = gain(context, 0, limiter);
    this.noise = noise(context);
    this.wind = this.layer('bandpass', 455, .7, false);
    this.water = this.layer('bandpass', 740, .53, true);
    this.fire = this.layer('lowpass', 245, .7, true);
    if (this.map) this.sources = terrainSounds(this.map);
  }

  layer(type, frequency, q, spatial) {
    const context = this.context;
    const pan = spatial ? panner(context, this.master) : null;
    const volume = gain(context, 0, pan ?? this.master);
    const tone = filter(context, type, frequency, q, volume);
    const source = context.createBufferSource();
    source.buffer = this.noise;
    source.loop = true;
    source.connect(tone);
    source.start(0, Math.random() * 2.8);
    return { volume: volume.gain, frequency: tone.frequency, pan, positioned: false };
  }

  async setEnabled(enabled) {
    if (!this.Context) return false;
    clearTimeout(this.suspendTimer);
    this.enabled = enabled;
    if (!enabled) {
      if (this.context) {
        this.master.gain.setTargetAtTime(0, this.context.currentTime, .055);
        this.suspendTimer = setTimeout(() => {
          if (!this.enabled) this.context.suspend().catch(() => {});
        }, 220);
      }
      return false;
    }
    try {
      if (!this.context) this.connect();
      if (this.context.state !== 'running') await this.context.resume();
      if (!this.enabled) return false;
      this.master.gain.setTargetAtTime(.72, this.context.currentTime, .08);
      return true;
    } catch {
      this.enabled = false;
      return false;
    }
  }

  emitter(layer, result, now, volume, frequency) {
    const { source, level } = result;
    if (source) {
      position(layer.pan, source.x, source.y, source.z, now, layer.positioned ? .24 : .016);
      layer.positioned = true;
    }
    layer.volume.setTargetAtTime(level * volume, now, .21);
    layer.frequency.setTargetAtTime(frequency, now, .32);
  }

  crackle(now, level) {
    const context = this.context;
    const source = context.createBufferSource();
    source.buffer = this.noise;
    const envelope = gain(context, 0, this.fire.pan);
    const tone = filter(context, 'bandpass', 530 + Math.random() * 1650, .95, envelope);
    const duration = .036 + Math.random() * .070;
    envelope.gain.setValueAtTime(0, now);
    envelope.gain.linearRampToValueAtTime(level * (.045 + Math.random() * .065), now + .004);
    envelope.gain.exponentialRampToValueAtTime(.0001, now + duration);
    source.connect(tone);
    source.start(now, Math.random() * 2.75, duration);
    source.onended = () => { source.disconnect(); tone.disconnect(); envelope.disconnect(); };
  }

  call(now, a, level, hunt) {
    const context = this.context;
    const pan = panner(context, this.master);
    position(pan, a.x, a.y + 1, a.z, now, .004);
    const source = context.createOscillator();
    const envelope = gain(context, 0, pan);
    const tone = filter(context, 'lowpass', hunt ? 590 : 1150, .9, envelope);
    const pitch = (a.species ? hunt ? 144 : 223 : 405) * (.86 + Math.random() * .30);
    const duration = hunt ? .24 : .19;
    source.type = a.species ? 'triangle' : 'sine';
    source.frequency.setValueAtTime(pitch, now);
    source.frequency.exponentialRampToValueAtTime(pitch * (hunt ? 1.32 : 1.19), now + .065);
    source.frequency.exponentialRampToValueAtTime(pitch * .71, now + duration);
    envelope.gain.setValueAtTime(0, now);
    envelope.gain.linearRampToValueAtTime(.052 * level, now + .024);
    envelope.gain.exponentialRampToValueAtTime(.0001, now + duration);
    source.connect(tone);
    source.start(now);
    source.stop(now + duration);
    source.onended = () => { source.disconnect(); tone.disconnect(); envelope.disconnect(); pan.disconnect(); };
  }

  listenForCalls(records, ear, time, now) {
    let candidate;
    for (const a of records) {
      if (a.fallAge >= 0) continue;
      const state = this.calls.get(a) ?? { signal: -100, hunt: -100, next: 0 };
      const hunt = a.huntStarted > state.hunt && a.huntAge >= 0;
      const signal = a.signalAt > state.signal && time - a.signalAt <= .58;
      state.hunt = a.huntStarted;
      state.signal = a.signalAt;
      this.calls.set(a, state);
      if ((!hunt && !signal) || now < state.next || now < this.nextCall) continue;
      const level = clamp(1 - Math.hypot(a.x - ear.x, a.y + 1 - ear.y, a.z - ear.z) / 38) ** 1.3;
      if (level > (candidate?.level ?? .065)) candidate = { a, level, hunt, state };
    }
    if (!candidate) return;
    const { a, level, hunt, state } = candidate;
    this.call(now, a, level, hunt);
    state.next = now + 2.2;
    this.nextCall = now + .66;
  }

  update(camera, weather, records, time) {
    if (!this.enabled || this.context?.state !== 'running') return;
    const now = this.context.currentTime;
    if (now - this.last < UPDATE_INTERVAL) return;
    this.last = now;
    const ear = camera.position;
    const matrix = camera.matrixWorld.elements;
    const listener = this.context.listener;
    position(listener, ear.x, ear.y, ear.z, now, .068);
    if (listener.forwardX) {
      listener.forwardX.setTargetAtTime(-matrix[8], now, .08);
      listener.forwardY.setTargetAtTime(-matrix[9], now, .08);
      listener.forwardZ.setTargetAtTime(-matrix[10], now, .08);
      listener.upX.setTargetAtTime(matrix[4], now, .08);
      listener.upY.setTargetAtTime(matrix[5], now, .08);
      listener.upZ.setTargetAtTime(matrix[6], now, .08);
    } else listener.setOrientation(-matrix[8], -matrix[9], -matrix[10], matrix[4], matrix[5], matrix[6]);
    if (!this.sources) return;

    const height = clamp((ear.y - ground(this.map, ear.x, ear.z)) / 85);
    const gust = .84 + .13 * Math.sin(now * .61) + .09 * Math.sin(now * 1.31 + 2);
    this.wind.volume.setTargetAtTime((.032 + height * .078) * WIND[weather] * gust, now, .42);
    this.wind.frequency.setTargetAtTime(290 + height * 375 + (WIND[weather] - 1) * 220, now, .52);
    this.emitter(this.water, nearest(this.sources.water, ear, 15), now, .25, 795 + 155 * Math.sin(now * .74));
    const fire = nearest(this.sources.fire, ear, 19);
    this.emitter(this.fire, fire, now, .29, 205 + 90 * gust);
    if (fire.level > .09 && now >= this.nextCrackle) {
      this.crackle(now + .012, fire.level);
      this.nextCrackle = now + .09 + Math.random() * (.20 + .42 * (1 - fire.level));
    }
    this.listenForCalls(records, ear, time, now + .012);
  }
}

import { clamp } from './config.js';

export const START_HOUR = 8.5;
const SECONDS_PER_HOUR = 26;
const wrapHour = hour => ((hour % 24) + 24) % 24;

export function biomeHour(time, offset = 0) {
  return wrapHour(START_HOUR + time / SECONDS_PER_HOUR + offset);
}

export function hourOffset(time, hour) {
  return wrapHour(hour - biomeHour(time));
}

export function solarAngle(hour) {
  return (hour - 6) * Math.PI / 12;
}

export function darkness(hour) {
  const t = clamp((.14 - Math.sin(solarAngle(hour))) / .34);
  return t * t * (3 - 2 * t);
}

export function visionFactor(species, night) {
  return 1 - night * (species ? .10 : .40);
}

export function displayHour(hour, target, dt) {
  const step = wrapHour(target - hour + 12) - 12;
  return wrapHour(hour + step * (1 - Math.exp(-dt * 6)));
}

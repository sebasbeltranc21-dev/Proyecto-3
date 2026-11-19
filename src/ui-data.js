export const ICONS = {
  leaf: '<path d="M20.3 3.6c-6.1 0-12.8 2.4-13.7 8.2-.6 3.5 1.8 5.8 4.9 5.3 5.9-.9 8.5-7.7 8.8-13.5ZM4 20l10.5-10.5"/>',
  sun: '<circle cx="12" cy="12" r="3.8"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.4 1.4m11.2 11.2L19 19M19 5l-1.4 1.4M6.4 17.6 5 19"/>',
  rain: '<path d="M5 15a4 4 0 0 1 0-8 6 6 0 0 1 11-2 5 5 0 0 1 2 10M8 17l-1 3m6-3-1 3m6-3-1 3"/>',
  fog: '<path d="M4 7h16M2 12h20M6 17h12"/>',
  heat: '<path d="M9 16a4 4 0 1 0 6 0V6a3 3 0 0 0-6 0Zm3 1V9"/><circle cx="12" cy="19" r="1"/>',
  cross: '<circle cx="12" cy="12" r="6"/><path d="M12 2v4m0 12v4M2 12h4m12 0h4"/>',
  cursor: '<path d="m5 3 14 10-7 1-3 7z"/>',
  mountain: '<path d="m2 19 7-13 4 7 2-4 7 10zM10 9l-2 3-2-1"/>',
  valley: '<path d="M3 7l6 10h6l6-10M3 20h18"/>',
  river: '<path d="M3 7c3.5 0 3.5-2 6-2s3 2 6 2 4-2 6-2M3 13c3.5 0 3.5-2 6-2s3 2 6 2 4-2 6-2M3 19c3.5 0 3.5-2 6-2s3 2 6 2 4-2 6-2"/>',
  trees: '<path d="m7 3-4 8h2l-3 5h10l-3-5h2zM7 16v4m10-14-4 7h2l-3 4h10l-3-4h2zM17 17v3"/>',
  grass: '<path d="M3 20h18M8 20c0-6-2-9-5-11m9 11C11 11 13 6 17 3m0 17c0-5 2-7 4-9"/>',
  fire: '<path d="M12 22c-4 0-7-3-7-7 0-3 2-5 4-7 0 3 1 4 2 4 2-2 3-6 2-9 4 3 6 8 6 12 0 4-3 7-7 7z"/><path d="M12 22c-2 0-3-2-3-3 0-2 2-3 3-5 2 2 3 4 3 5 0 1-1 3-3 3Z"/>',
  dry: '<path d="M12 3c3 5 7 9 7 13a7 7 0 0 1-14 0c0-4 4-8 7-13ZM3 3l18 18"/>',
  history: '<path d="M4 3v17h17M7 15l4-4 4 2 5-7"/>',
  brain: '<circle cx="5" cy="12" r="2.1"/><circle cx="12" cy="6" r="2.1"/><circle cx="12" cy="18" r="2.1"/><circle cx="19" cy="12" r="2.1"/><path d="m6.7 10.5 3.6-3m-3.6 6 3.6 3m3.4-9 3.6 3m-3.6 6 3.6-3M12 8v8"/>',
  pause: '<path d="M9 5v14M15 5v14"/>',
  play: '<path d="m8 5 11 7-11 7z"/>',
  reset: '<path d="M4 11a8 8 0 1 1 2 7M4 5v6h6"/>',
  layers: '<path d="m12 3 10 5-10 5-10-5zm-10 9 10 5 10-5M2 16l10 5 10-5"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  sliders: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="2" fill="currentColor"/><circle cx="15" cy="17" r="2" fill="currentColor"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  compass: '<path d="m8 8 11-3-3 11-11 3zM8 8l8 8"/>',
  eye: '<path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="2.6"/>',
  expand: '<path d="M8 4H4v4m12-4h4v4M4 16v4h4m12-4v4h-4"/>',
};
export function icon(name, size = 19) {
  return `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] ?? ''}</svg>`;
}

export const TOOLS = [
  ['watch', 'cursor', 'Observar'],
  ['raise', 'mountain', 'Elevar'],
  ['lower', 'valley', 'Excavar'],
  ['river', 'river', 'Río'],
  ['forest', 'trees', 'Bosque'],
  ['meadow', 'grass', 'Pradera'],
  ['fire', 'fire', 'Incendio'],
  ['dry', 'dry', 'Sequía'],
];

export const SKY_PRESETS = {
  clear: { label: 'Despejado', icon: 'sun', degrees: 21, light: 1, color: 0xb2c5af, fog: .00215 },
  rain: { label: 'Lluvia', icon: 'rain', degrees: 14, light: .52, color: 0x8faca8, fog: .0043 },
  fog: { label: 'Niebla', icon: 'fog', degrees: 11, light: .66, color: 0xb4c8bd, fog: .0079 },
  heat: { label: 'Calor', icon: 'heat', degrees: 37, light: 1.14, color: 0xc8b98e, fog: .00365 },
};

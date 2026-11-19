export const SIZE = 320;
export const HALF = SIZE / 2;
export const GRID = 80;
export const STEP = SIZE / GRID;
export const CAP = 240;
export const INITIAL = [136, 39];
export const STRIDE = 16;
export const DT = 1 / 20;
export const WATER = -1.8;
export const CHANNELS = 5;
export const SPECIES = [
  { name: 'Cérvido', plural: 'Presas', baseSpeed: 7.5, drain: .008, max: 180, min: 24 },
  { name: 'Lobo', plural: 'Depredadores', baseSpeed: 9.3, drain: .010, max: 60, min: 8 },
];

export const clamp = (x, min = 0, max = 1) => Math.max(min, Math.min(max, x));
export function rng(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6D2B79F5) >>> 0;
    let bits = Math.imul(value ^ (value >>> 15), value | 1);
    bits ^= bits + Math.imul(bits ^ (bits >>> 7), bits | 61);
    return ((bits ^ (bits >>> 14)) >>> 0) / 4294967296;
  };
}

export const INPUTS = [
  'Presa · proximidad', 'Presa · dirección', 'Presa · frente',
  'Depredador · proximidad', 'Depredador · dirección', 'Depredador · frente',
  'Aliado · proximidad', 'Aliado · dirección', 'Aliado · frente',
  'Alimento · proximidad', 'Alimento · dirección', 'Alimento · frente',
  'Agua · proximidad', 'Agua · dirección', 'Agua · frente',
  'Cobertura · proximidad', 'Cobertura · dirección', 'Cobertura · frente',
  'Obstáculo izq.', 'Obstáculo frente', 'Obstáculo der.',
  'Hambre', 'Sed', 'Energía', 'Miedo', 'Temperatura', 'Humedad', 'Señal aliada',
];
export const OUTPUTS = ['Avanzar', 'Girar', 'Marcha / sigilo', 'Señal', 'Comer / atacar', 'Reproducirse'];

export const QUALITY = {
  eco:      { dpr: 1, shadows: 0,    grass: .24, grassRange: 112, treeLOD: 88,  faunaNear: 30, faunaFar: 215, fireCells: 98, reflections: 384, reflectionDelay: .135, iblSize: 64, post: false, ao: false },
  balanced: { dpr: 1.2, shadows: 768,  grass: .48, grassRange: 155, treeLOD: 122, faunaNear: 44, faunaFar: 275, fireCells: 157, reflections: 720, reflectionDelay: .092, iblSize: 64, post: false, ao: false },
  high:     { dpr: 2, shadows: 2048, grass: .78, grassRange: 188, treeLOD: 151, faunaNear: 59, faunaFar: 335, fireCells: 226, reflections: 1080, reflectionDelay: .062, iblSize: 128, post: true, ao: true },
  cinema:   { dpr: 2, shadows: 2048, grass: 1,   grassRange: 224, treeLOD: 178, faunaNear: 72, faunaFar: 387, fireCells: 315, reflections: 1440, reflectionDelay: .047, iblSize: 128, post: true, ao: true },
};

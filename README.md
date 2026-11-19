# Ecosistema Vivo

Simulador 3D de neuroevolución. Presas y depredadores perciben el entorno, actúan con redes neuronales individuales y transmiten sus pesos a nuevas generaciones. El jugador modifica la cuenca en tiempo real y puede inspeccionar las activaciones, el linaje, la aptitud y las mutaciones de una criatura.

**Fase 2**. La versión actual incorpora fauna esculpida con GLB Draco y Meshopt, biomas PBR KTX2, vegetación reactiva y perfiles Bajo a Ultra. Consulta el [pipeline visual y guía de recursos](docs/fase-2.md), la [actualización de fuego, fauna y paisaje](docs/actualizacion-visual.md) y la [guía de navegación y río HD](docs/rio-hd.md).

## Desarrollo

Requiere Node.js 22.12 o posterior y un navegador. WebGL 2 habilita el pipeline gráfico completo. La vista de compatibilidad proyecta la cuenca en Canvas 2D y conserva el worker, los pinceles, el clima y el inspector.

```sh
npm ci
npm run dev
npm test
npm run build
npm run preview
```

Usa la rueda o un gesto de pinza para acercarte y arrastra el bioma para orbitar. Selecciona una criatura en el mapa o desde el inspector. Elige una herramienta, ajusta el radio y aplícala sobre el terreno. El teclado permite cambiar de herramienta con 1–8, pausar con Espacio y volver a observar con Esc. Ajustes incluye calidad gráfica, hora y semilla. Usa `?seed=41021` para repetir la cuenca de referencia.

## Arquitectura

```text
index.html
src/
  main.js             Controles, estado de vista y enlace con el worker
  panels.js           HUD, gráfico de población e inspector
  style.css           Diseño adaptable del HUD
  ui-data.js          Herramientas, iconos y perfiles visuales de clima
  sim/
    config.js         Constantes y catálogo de sensores y acciones
    neural.js         Feedforward, cruce y mutación
    ecosystem.js     Agentes, percepción, recursos y selección
    terrain.js        Altura, interpolación y pinceles
    worker.js         Bucle de paso fijo y transferencia de snapshots
  view/
    world.js          Cámara, luces, efectos, interacción y render
    land.js           Terreno PBR, cielo, agua, vegetación y partículas
    fauna.js          Mallas instanciadas, poses y selección de fauna
    compat.js         Proyección del bioma por CPU si WebGL 2 está deshabilitado
test/                 Pruebas del modelo y la simulación
vercel.json           Build, caché y cabeceras
```

Vite sirve una aplicación estática. Three.js WebGL 2 usa `requestAnimationFrame` y el worker simula en pasos fijos de 50 ms. Empieza con 136 presas y 39 depredadores, con un máximo de 240 individuos. El índice espacial 20 × 20 limita consultas de percepción; la posición se interpola para renderizarla. El worker envía snapshots cada 100 ms de reloj real a velocidad normal. Transfiere un `ArrayBuffer` de agentes y lo reutiliza cuando regresa desde el hilo principal. El terreno se envía al editarlo y cada 2 s de simulación mientras se actualizan los recursos. Solo la criatura seleccionada envía pesos y activaciones al HUD.

## Red y evolución

| Capa | Neuronas | Activación |
| --- | ---: | --- |
| Entrada | 28 | Sensores normalizados |
| Oculta, densa | 14 | `tanh` |
| Salida, densa | 6 | Sigmoide; `tanh` para el giro firmado |

Son 496 parámetros por individuo, incluidos los sesgos. Los primeros 18 canales representan cercanía, seno y coseno relativos ponderados para presa, depredador, aliado, alimento, agua y cobertura. Se suman tres rayos de terreno, hambre, sed, energía, miedo, temperatura, humedad del suelo y señal aliada. Los rayos se muestrean sobre la cuadrícula. La visión de otras especies combina cono frontal, proximidad y oclusión aproximada; ocultarse reduce el alcance de detección. Detectar aliados cercanos modela percepción social y las señales decaen con la distancia.

Cada paso, el agente observa, ejecuta inferencia, transforma las salidas en avance, giro, marcha o sigilo, señal, interacción y reproducción, y actualiza sus estados. Los fundadores parten de pesos aleatorios con sesgos de supervivencia que son mutables. Los descendientes mezclan pesos de dos padres con cruce uniforme. Cada gen tiene un 12 % de probabilidad de mutación aditiva centrada, acotada a ±0,9 antes de limitar el peso final a [−6, 6].

La aptitud valora edad, capturas, asistencias, refugios, desplazamientos a recursos y bebida. La reproducción también requiere energía, salud, recursos y proximidad de pareja. El HUD muestra los nacimientos por separado de las reintroducciones de reserva, que seleccionan genomas históricos cuando una población cae bajo el mínimo. Los contadores de cooperación, refugio y migración se derivan de eventos del modelo. Un mismo escenario puede repetirse con semilla y secuencia de acciones equivalentes. La formación de grupos estables requiere experimentos adicionales.

## Pipeline gráfico y rendimiento

El [pipeline visual de la Fase 2](docs/fase-2.md) documenta materiales, shaders, perfiles, compresión, licencias y reproducción del pipeline. La cámara usa perspectiva de 46°, planos 0,64–1180 m y órbita amortiguada. «Seguir criatura» acerca la cámara para ver la animación y el pelaje. El objetivo de 60 FPS se verifica por dispositivo.

## GitHub y Vercel

1. Abre el proyecto de Vercel e importa `sebasbeltranc21-dev/Proyecto-3` desde [Vercel New Project](https://vercel.com/new). Si GitHub pide acceso, autoriza el repositorio `Proyecto-3` para la integración.
2. Selecciona Vite y la raíz del repositorio. Usa Node.js 24.x o 22.x. La instalación ejecuta `npm ci`, el build ejecuta `npm test && npm run build` y la salida es `dist`. El proyecto no requiere variables de entorno.
3. Establece `main` como rama de producción. Trabaja en `dev` o en ramas derivadas para generar despliegues de vista previa y abre PRs hacia `main` para revisar la vista previa antes de integrar.
4. Para verificar la publicación, revisa el estado del despliegue y abre su dominio. Comprueba el lienzo 3D, el inspector y una acción de edición en el navegador.

Vercel negocia compresión en su CDN. `vercel.json` define la política de caché de los archivos versionados por Vite. El worker usa el mismo origen y buffers transferibles, por lo que no requiere CORS ni COOP/COEP. Si se adopta `SharedArrayBuffer`, configurar `Cross-Origin-Opener-Policy: same-origin` y `Cross-Origin-Embedder-Policy: require-corp` y revisar CORS/CORP para los recursos externos. La versión actual usa GLB y KTX2 optimizados y no necesita archivos fuente pesados en el checkout. Si se incorporan archivos fuente grandes, registrar en Git LFS solo los tipos que lo necesiten y habilitar LFS para el proyecto en Vercel antes del build.

## Hoja de ruta

| Fase | Entrega y criterio de avance |
| --- | --- |
| MVP | Bioma editable, evolución, HUD y build estático. Verificar una partida completa y el enlace de producción. |
| Validación ecológica | Ejecutar varias decenas de semillas por clima; contrastar fundadores con generaciones posteriores y medir población, fitness y conducta frente a una población con pesos congelados. Ajustar el mínimo de reserva y documentar cuándo hay extinciones. |
| Fase 2 visual | Fauna GLB con animación por vértices, LOD y genética visual, KTX2, HDRI, CSM y pasto reactivo. [Guía de implementación](docs/fase-2.md). |
| Arte y atmósfera avanzados | Refinar la fauna con mapas de pelaje, implementar reflejos planares de resolución reducida, volúmenes con marcha de rayos y profundidad de campo si el presupuesto de GPU lo permite. |
| Optimización | Perfilar CPU y GPU en escritorio y tablet, medir tiempo de frame p95 con 240 criaturas, ajustar sombras y resolución dinámica. Separar presupuestos de GPU y worker antes de migrar kernels a WASM o WebGPU. |

Referencias de plataforma: [Three.js WebGLRenderer](https://threejs.org/docs/pages/WebGLRenderer.html), [Vercel para GitHub](https://vercel.com/docs/git/vercel-for-github), [Vercel CDN](https://vercel.com/docs/how-vercel-cdn-works).

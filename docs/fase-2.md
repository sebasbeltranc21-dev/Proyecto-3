# Fase 2 · Pipeline visual web

La simulación mantiene su paso fijo en el worker. Three.js r183 renderiza los mismos agentes y la misma cuadrícula editable mediante WebGL 2. La vista Canvas 2D mantiene los controles y el inspector en navegadores sin WebGL 2.

## Modelos, animación y genética

- [Loader](../src/view/assets.js) configura GLTFLoader con DRACOLoader, MeshoptDecoder y KTX2Loader. Vite entrega los recursos con hash. `predev` y `prebuild` copian los decodificadores WASM de la versión fijada de Three.js.
- [Modelos y LOD](../src/view/models.js) prepara cuatro lotes `InstancedMesh`, uno por especie y nivel de detalle. Antes de llenar los lotes, prueba una esfera de cada agente contra el frustum. El límite de distancia depende del perfil.
- [Shader de animación](../src/view/shaders/creature.js) combina fase de paso, flexión, avance del hocico y balanceo de la cola. Interpola los pesos de caminar, correr, sigilo y ataque usando velocidad, salida de marcha, ocultamiento y temporizador real de ataque del worker. El mismo desplazamiento se usa en la pasada de profundidad para las sombras. El pelaje combina colores de vértice y fibras procedurales.
- Dos valores de fenotipo se calculan a partir de pesos neuronales heredables. Cruce y mutación pueden cambiar el tinte y el tamaño de los descendientes. El fenotipo se calcula al nacer y no consume números aleatorios de la simulación.
- Los ciervos y lobos son esculturas originales generadas por campos de distancia y simplificadas en dos LOD. El ciervo usa Meshopt y el lobo Draco. Cada primitiva usa un códec. Los GLB actuales llevan colores de vértice. El loader también admite GLB con texturas `KHR_texture_basisu`.

## Terreno, flora y agua

- [Terreno GLSL](../src/view/shaders/terrain.js) combina arena cerca del agua, pasto en llanuras, roca según pendiente y nieve según altura y clima. Las texturas se mantienen en coordenadas del mundo al terraformar. La roca mezcla tres proyecciones según la normal geométrica. Los mapas `surface` usan R y G para la normal, B para rugosidad y A para oclusión. El albedo usa espacio sRGB y las propiedades de superficie se leen en lineal.
- [Flora GLSL](../src/view/shaders/foliage.js) curva los vértices desde la raíz por viento y con un campo de paso de 80 × 80. Se sube la dirección y la intensidad de las pisadas en bloque, aproximadamente a 10 Hz. Los 25 sectores permiten descarte por frustum. Cada combinación visible de sector y tipo de flora usa un lote instanciado. Se priorizan los árboles cercanos para el LOD alto y el sombreado.
- [Agua GLSL](../src/view/shaders/water.js) combina tres ondas en la normal, Fresnel, aproximación de absorción por profundidad, reflejo del HDRI y espuma en puntos de agua somera. La profundidad proviene de la altura local bajo la cota de agua y se actualiza al editar terreno. El modelo de agua usa la cota global del proyecto.

## Iluminación y perfil gráfico

[Luces](../src/view/lighting.js) usa cielo Preetham con dispersión Rayleigh/Mie, luz hemisférica, tres cascadas CSM con división práctica y transición suave hasta 338 m, y un HDRI CC0 de **320 × 160** prefiltrado con PMREM para IBL. La exposición ACES, la niebla exponencial y la luz solar se vinculan al clima y al ciclo día/noche.

[Posprocesado](../src/view/post.js) carga bajo demanda. Una pasada en resolución reducida incluye solo el disco solar y el fuego, con oclusión por la geometría opaca. La mezcla final aplica bloom selectivo y un gradado lineal que cambia con clima y noche. Ultra habilita SSAO de 12 muestras cerca de dos tercios de la resolución. Los perfiles Alto y Ultra usan render directo si la GPU carece de `EXT_color_buffer_float`.

| Perfil | Límite de DPR | Sombra por cascada | Densidad relativa de pasto | LOD cercano | Posprocesado |
| --- | ---: | ---: | ---: | ---: | --- |
| Bajo | 1,0 | Desactivada | 24 % | 30 m | Directo |
| Medio | 1,2 | 768² | 48 % | 44 m | Directo |
| Alto | 1,45 | 1280² | 78 % | 59 m | Bloom y gradado |
| Ultra | 1,65 | 2048² | 100 % | 72 m | Bloom, gradado y SSAO |

La niebla es exponencial con color y densidad dinámicos. El agua refleja el entorno HDRI y cuenta con brillo solar, sin calcular reflejos de cada objeto. Los modelos de fauna usan esculturas procedurales con anatomía reconocible. El objetivo de 60 FPS requiere medir por dispositivo con una sesión de fauna visible, cámara de seguimiento, cambios de clima y terraformación. El selector de calidad permite ajustar el coste y el panel muestra los FPS de la sesión.

## Fuentes CC0

| Uso | Fuente |
| --- | --- |
| Pasto, roca, arena y nieve publicados | Poly Haven: [Leafy Grass](https://polyhaven.com/a/leafy_grass), [Rock Boulder Dry](https://polyhaven.com/a/rock_boulder_dry), [Damp Sand](https://polyhaven.com/a/damp_sand), [Snow 01](https://polyhaven.com/a/snow_01) |
| Iluminación publicada | [Forest Slope, Poly Haven](https://polyhaven.com/a/forest_slope) |
| Fauna externa para prototipos y pruebas de rigs | [Animated Animal Pack, Quaternius](https://poly.pizza/bundle/Animated-Animal-Pack-ILAPXeUYiS) |
| Otra fuente de materiales | [ambientCG](https://ambientcg.com/) |

Los recursos de Poly Haven de esta fase son CC0. La fauna publicada se genera desde [sculpt-fauna.py](../scripts/sculpt-fauna.py) y [pack-fauna.mjs](../scripts/pack-fauna.mjs). El paquete Quaternius es una alternativa estilizada con animaciones, disponible como descarga independiente.

## Preparar y publicar recursos propios

1. En Blender, aplica transformaciones, orienta el animal hacia +Z en coordenadas de glTF, sitúa los pies en Y=0 y revisa que el tamaño esté en metros. Exporta GLB con materiales PBR. Prepara LOD separado con simplificación y comprueba las normales. Los modelos rígidos del juego usan el shader de pose. Un GLB con esqueleto puede cargarse con el mismo loader, pero su control mediante `AnimationMixer` requiere un camino de dibujo específico para mallas con skinning.
2. Usa un solo códec de geometría por variante. glTF Transform incluye ambas opciones. KTX-Software es una dependencia de la CLI para generar KTX2. Para normal/roughness/AO usa UASTC. ETC1S sirve para el albedo cuando priorizas tamaño.

   ```sh
   gltf-transform uastc criatura.glb criatura-pbr.glb --slots "{normalTexture,occlusionTexture,metallicRoughnessTexture}"
   gltf-transform etc1s criatura-pbr.glb criatura-texturas.glb --slots "baseColorTexture"
   gltf-transform meshopt criatura-texturas.glb criatura-web.glb --level high
   # Variante con otro códec desde el mismo GLB de texturas.
   gltf-transform draco criatura-texturas.glb criatura-web-draco.glb
   gltf-transform inspect criatura-web.glb
   ```

3. Para reconstruir los mapas publicados, descarga JPG 1K de Diffuse, Normal GL, Roughness y AO. Nómbralos como `leafy_grass-albedo.jpg`, `leafy_grass-normal.jpg`, `leafy_grass-rough.jpg` y `leafy_grass-ao.jpg`, y repite con los otros tres identificadores. Ejecuta `python scripts/pack-terrain.py <fuentes> src/assets/terrain --basis <basisu>`.
4. Sube las versiones comprimidas que usa el navegador a `src/assets`. Esta fase incluye aproximadamente **655 KiB** de GLB, KTX2 y HDRI. Los decodificadores WASM están separados y los recursos hasheados se sirven con caché inmutable. GitHub limita los archivos de Git estándar a 100 MiB por archivo. Guarda las fuentes pesadas en Git LFS o en almacenamiento de objetos. Si agregas biomas o paquetes muy grandes, sirve los binarios optimizados desde un CDN con URLs versionadas, CORS explícito al dominio de la app y carga bajo demanda. La transferencia al dispositivo cuenta como Fast Data Transfer en Vercel.

Referencias: [glTF Transform](https://gltf-transform.dev/), [CSM](https://threejs.org/docs/pages/CSM.html), [licencia Poly Haven](https://polyhaven.com/license), [archivos grandes en GitHub](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github) y [uso de CDN en Vercel](https://vercel.com/docs/manage-cdn-usage).

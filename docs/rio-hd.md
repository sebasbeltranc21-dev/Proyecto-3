# Navegación de orillas y río HD

El nivel del agua se define en `src/sim/config.js`. La altura del suelo se interpola en `terrain.js`, con las mismas muestras que usa el render. Las redes conservan las 28 entradas, seis salidas, pesos y mecanismo de evolución. La navegación de orilla se aplica a la intención de movimiento después de consultar la red.

## Archivos de integración

| Operación | Archivos | Función |
| --- | --- | --- |
| Crear | [river-navigation.js](../src/sim/river-navigation.js) | Validar trayectorias, girar para bordear, detener y orientar para beber, buscar una salida y nadar |
| Modificar | [ecosystem.js](../src/sim/ecosystem.js), [config.js](../src/sim/config.js), [worker.js](../src/sim/worker.js) | Conectar la navegación antes de mover, detectar excavaciones y añadir el indicador de natación a cada snapshot |
| Modificar | [fauna.js](../src/view/fauna.js), [models.js](../src/view/models.js), [locomotion.js](../src/view/locomotion.js), [creature.js](../src/view/shaders/creature.js), [compat.js](../src/view/compat.js) | Flotación, brazadas, inclinación al beber y posición a cota de agua en el fallback |
| Reemplazar | [water.js](../src/view/shaders/water.js) | Vertex shader, fragment shader completo y pasada de reflejo planar |
| Modificar | [land.js](../src/view/land.js), [terrain.js](../src/view/shaders/terrain.js), [foliage.js](../src/view/shaders/foliage.js) | Profundidad a 16 bits, piedras instanciadas, espuma de obstrucciones, arena húmeda y micro-relieve |
| Modificar | [lighting.js](../src/view/lighting.js), [post.js](../src/view/post.js), [quality.js](../src/view/quality.js), [world.js](../src/view/world.js), [assets.js](../src/view/assets.js) | IBL de cielo dinámico, DPR, antialiasing, CSM, bloom selectivo y oclusión ambiental |
| Crear | [river-navigation.test.js](../test/river-navigation.test.js) | Regresión de bloqueo, bebida, terraformación y flotación con el mapa inundado |

## Movimiento

- Los pasos muestrean el trayecto y anticipan hasta 0,92 m. A partir de **0,25 m de profundidad**, se buscan rumbos transitables y se limita la velocidad de giro. Una trayectoria bloqueada se detiene antes de cruzar.
- El animal bebe con una profundidad máxima de **0,10 m** bajo las patas y agua al alcance. Se detiene, gira hacia el agua, baja la cabeza y reduce la sed cuando está orientado.
- Al excavar bajo un animal, el worker lo marca como `Nadando` en el mismo snapshot, incluso en pausa. El render toma la cota del agua como referencia, con un pequeño desplazamiento de malla para mantener el cuerpo flotando y la cabeza fuera. Retoma la marcha cuando alcanza terreno seco. Si toda la zona está inundada, conserva la flotación y vuelve a buscar una salida cuando cambia la altura del terreno.

## Agua e iluminación

El shader decodifica en RG una profundidad real relativa a la cota del agua, en el rango de −64 a +16 m. Los canales se interpolan linealmente y B indica dónde las piedras sobresalen o quedan cerca de la superficie. El fragment shader desplaza capas de normales y ruido fBm conforme a la tangente del río, aplica absorción Beer–Lambert y calcula Fresnel y brillo del sol. Una cámara reflejada captura las montañas, el cielo y la vegetación mediante una pasada con plano de recorte. La capa de agua usa transparencia sobre el lecho renderizado. La corriente es una aproximación visual del cauce, incluida cuando el pincel abre un estanque aislado.

Alto y Ultra admiten DPR hasta 2 y sombras de 2048 × 2048 por cascada. El tamaño máximo del reflejo es 1080 px en Alto y 1440 px en Ultra. El perfil Alto es el predeterminado en WebGL 2. El mapa ambiental PMREM toma muestras del cielo procedural al cambiar el clima, la orientación del sol o el perfil. La niebla comparte su color con la franja del horizonte. ACES Filmic y sRGB se mantienen en la salida. En r183, el filtro de sombras suaves para WebGL se llama `PCFShadowMap`. [Migración de Three.js](https://github.com/mrdoob/three.js/wiki/Migration-Guide#181--182)

## Validar y desplegar

Ejecuta `npm ci`, `npm test` y `npm run build`. En WebGL 2, sigue a una criatura y usa **Río** debajo de ella con pausa activa para comprobar la flotación inicial. Reanuda y verifica que alcance la orilla. Desde un ángulo bajo se ven los reflejos con mayor intensidad. El proyecto sigue desplegándose en Vercel mediante su integración con GitHub.

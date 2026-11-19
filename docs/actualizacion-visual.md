# Actualización visual · Fuego, fauna y paisaje

La actualización se integra en la escena Three.js r183 y usa WebGL 2. El worker sigue ejecutando las mismas redes, decisiones y reglas de incendios. Los efectos nuevos leen los datos que ya calcula la simulación.

## Archivos para integrar

| Operación | Archivos | Responsabilidad |
| --- | --- | --- |
| Crear | [fire.js](../src/view/fire.js), [shaders/fire.js](../src/view/shaders/fire.js) | Emisores instanciados, ruido Perlin, humo, brasas, luz parpadeante y memoria de ceniza |
| Crear | [locomotion.js](../src/view/locomotion.js) | Fase basada en distancia, interpolación de posturas, normal del suelo, balanceo y salto de sobresalto |
| Modificar | [shaders/creature.js](../src/view/shaders/creature.js), [models.js](../src/view/models.js), [fauna.js](../src/view/fauna.js) | Posturas de caminar, trotar, correr, pastar o beber, alertar y atacar en las mallas GLB existentes. Las sombras usan la misma deformación. |
| Modificar | [shaders/terrain.js](../src/view/shaders/terrain.js), [shaders/foliage.js](../src/view/shaders/foliage.js), [land.js](../src/view/land.js) | Ceniza en material PBR, arena mojada, roca triplanar con estratos, normales suaves en la cordillera y coníferas instanciadas con ramas irregulares |
| Modificar | [shaders/water.js](../src/view/shaders/water.js), [lighting.js](../src/view/lighting.js), [post.js](../src/view/post.js) | Olas cruzadas, reflejo solar, Fresnel, espuma, sombras suaves y bloom selectivo |
| Modificar | [world.js](../src/view/world.js), [quality.js](../src/view/quality.js), [main.js](../src/main.js) | Límite por perfil, lectura del tiempo de simulación y borrado de los efectos al reiniciar |
| Modificar | [sim/config.js](../src/sim/config.js), [sim/worker.js](../src/sim/worker.js) | Formato de 15 valores por agente. Se añaden miedo, intensidad de señal y estado de alimentación o bebida. |
| Crear | [visual-effects.test.js](../test/visual-effects.test.js) | Pruebas de ceniza, reinicio, fase de zancada, inclinación y señales de postura |

## Fuego

Las llamas usan billboards verticales orientados a cámara, anclados a la altura de la celda y combinados con `AdditiveBlending`. El fragment shader desplaza tres octavas de Perlin hacia arriba y mezcla un núcleo blanco-amarillo con bordes naranjas y rojos. El humo usa billboards que se ensanchan, ascienden, derivan con el viento y se mezclan con `NormalBlending`. Las brasas usan puntos pequeños con turbulencia. Solo las llamas y el cielo solar participan en la pasada de bloom.

La luz naranja sigue el foco cercano dominante y usa atenuación por distancia. La ceniza usa una textura lineal de 80 × 80 que guarda el máximo de intensidad reciente y pierde intensidad con el tiempo de simulación. El perfil limita el número de celdas visibles a 98, 157, 226 o 315 entre Bajo y Ultra. Toda la dinámica de partículas se aplica en los shaders a partir de semillas reproducibles por celda.

## Fauna y paisaje

La frecuencia de la pisada depende del desplazamiento interpolado de cada criatura. Los tres ciclos se mezclan con transiciones continuas. El giro y la pendiente se aplican al transform de la instancia. Las expresiones de cabeza y patas se aplican en el shader. El salto de miedo se activa ante una subida significativa de la señal y tiene un intervalo de recuperación visual.

La cordillera usa la misma superficie PBR que el terreno terraformable, con normales suavizadas y una transición entre ambas mallas. Los pinos usan dos LOD y sombras con deformación por viento. Al seguir una criatura, la vegetación abre un corredor visual entre la cámara y el animal. Permanece el pasto y el sotobosque instanciados que responden al campo de pisadas.

El agua combina ondas en dos direcciones, Fresnel, brillo del sol y orillas con espuma suavizada por profundidad. El render sigue bajo ACES Filmic. En Three.js r183 `PCFShadowMap` proporciona el filtro suave, y `PCFSoftShadowMap` es un alias obsoleto. [Guía de migración de Three.js](https://github.com/mrdoob/three.js/wiki/Migration-Guide#181--182)

## Validación

Ejecuta `npm ci`, `npm test` y `npm run build`. En la vista WebGL, enciende un área de bosque con el pincel Incendio y acércate a la orilla del área quemada. Selecciona una criatura y usa **Seguir criatura** para observar zancadas, cambios de pendiente y poses de estado. El bloom se activa en Alto y Ultra.

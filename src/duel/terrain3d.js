import * as T from 'three';
import { WATER, clamp, rng } from '../sim/config.js';
import { ground, tile } from '../sim/terrain.js';
import { grassGeometry, pine, smoothRock } from '../view/land.js';
import { BOUNDS } from './arena.js';

const SPAN = 2 * (BOUNDS + 1.7);

function terrain(map) {
  const geometry = new T.PlaneGeometry(SPAN, SPAN, 112, 112).rotateX(-Math.PI / 2);
  const pos = geometry.attributes.position;
  const tint = new T.Color();
  const grass = new T.Color(0x657943), woods = new T.Color(0x445236);
  const shore = new T.Color(0x9b9464), bed = new T.Color(0x537171);
  const colors = [];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), y = ground(map, x, z);
    pos.setY(i, y);
    const canopy = map[tile(x, z) + 1];
    tint.copy(grass).lerp(woods, clamp((canopy - .18) * 1.28))
      .lerp(shore, clamp(1 - (y - WATER) / 2.1))
      .lerp(bed, clamp((WATER - y) / 1.45));
    tint.multiplyScalar(.94 + .06 * Math.sin(x * .29 + z * .81) + .043 * Math.sin(z * 1.77 + x * .65));
    colors.push(tint.r, tint.g, tint.b);
  }
  geometry.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  const material = new T.MeshStandardMaterial({ vertexColors: true, roughness: .91 });
  material.onBeforeCompile = shader => {
    shader.vertexShader = 'varying vec2 vMeadow;\n' + shader.vertexShader.replace('#include <begin_vertex>',
      '#include <begin_vertex>\nvMeadow = position.xz;');
    shader.fragmentShader = 'varying vec2 vMeadow;\n' + shader.fragmentShader.replace('#include <color_fragment>', `
      #include <color_fragment>
      float attenuation=1.-smoothstep(.035,.14,length(fwidth(vMeadow)));
      float detail=sin(vMeadow.x*29.+sin(vMeadow.y*17.))*sin(vMeadow.y*31.13+vMeadow.x*9.);
      diffuseColor.rgb *= 1.+detail*.11*attenuation;
    `);
  };
  return new T.Mesh(geometry, material);
}

function river() {
  const material = new T.ShaderMaterial({
    uniforms: { time: { value: 0 } },
    vertexShader: `
      varying vec3 world;
      void main() {
        world=(modelMatrix*vec4(position,1.)).xyz;
        gl_Position=projectionMatrix*viewMatrix*vec4(world,1.);
      }
    `,
    fragmentShader: `
      uniform float time;
      varying vec3 world;
      void main() {
        vec3 view=normalize(cameraPosition-world);
        float waves=sin(world.x*2.65+world.z*3.5-time*1.85);
        float ripples=cos(world.z*1.87-world.x*2.83+time*1.32);
        vec3 normal=normalize(vec3(waves*.075,1.,ripples*.085));
        float fresnel=pow(1.-max(0.,dot(normal,view)),3.);
        vec3 sun=normalize(vec3(-.47,.72,.51));
        float shine=pow(max(0.,dot(normal,normalize(sun+view))),86.);
        vec3 tint=mix(vec3(.052,.195,.172),vec3(.28,.47,.48),fresnel);
        gl_FragColor=vec4(tint+vec3(1.,.8,.54)*shine*.64,.76+fresnel*.15);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    transparent: true, depthWrite: false,
  });
  const mesh = new T.Mesh(new T.PlaneGeometry(SPAN, SPAN).rotateX(-Math.PI / 2), material);
  mesh.position.y = WATER;
  return mesh;
}

function scenery(group, arena) {
  const random = rng(arena.seed ^ 149212);
  const { map, props } = arena;
  const trees = props.filter(p => !p.rock);
  const stones = props.filter(p => p.rock);
  const geometry = pine(true);
  const forest = new T.InstancedMesh(geometry,
    new T.MeshStandardMaterial({ vertexColors: true, roughness: .94, side: T.DoubleSide }), trees.length);
  const rocks = new T.InstancedMesh(smoothRock(),
    new T.MeshStandardMaterial({ color: 0x869280, roughness: .94 }), stones.length);
  const grass = new T.InstancedMesh(grassGeometry(),
    new T.MeshStandardMaterial({ color: 0x849757, vertexColors: true, side: T.DoubleSide, roughness: .98 }), 3200);
  const placed = new T.Object3D();
  for (const [items, mesh] of [[trees, forest], [stones, rocks]]) {
    for (const [i, p] of items.entries()) {
      const y = ground(map, p.x, p.z), height = p.top - y;
      placed.position.set(p.x, y + (p.rock ? height * .08 : 0), p.z);
      placed.rotation.set(p.rock ? random() * .3 : 0, random() * 2 * Math.PI, 0);
      placed.scale.set(p.rock ? p.radius : 1.05, p.rock ? height : height / 5.4, p.rock ? p.radius : 1.05);
      placed.updateMatrix();
      mesh.setMatrixAt(i, placed.matrix);
      mesh.setColorAt(i, new T.Color().setScalar(.70 + random() * .30));
    }
  }
  grass.count = 0;
  for (let i = 0; i < 3200; i++) {
    const x = (random() * 2 - 1) * (BOUNDS - 1), z = (random() * 2 - 1) * (BOUNDS - 1);
    const y = ground(map, x, z);
    if (y < WATER + .18) continue;
    placed.position.set(x, y, z);
    placed.rotation.set(0, random() * 2 * Math.PI, 0);
    const s = .38 + random() * .56;
    placed.scale.set(1.1 * s, .85 * s, 1.1 * s);
    placed.updateMatrix();
    grass.setMatrixAt(grass.count++, placed.matrix);
  }
  group.add(forest, rocks, grass);
}

export function makeDuelTerrain(arena) {
  const group = new T.Group();
  const water = river();
  group.add(terrain(arena.map), water);
  scenery(group, arena);
  return {
    group,
    moveWater(time) { water.material.uniforms.time.value = time; },
    dispose() {
      group.traverse(mesh => {
        if (!mesh.isMesh) return;
        mesh.geometry.dispose();
        mesh.material.dispose();
        if (mesh.isInstancedMesh) mesh.dispose();
      });
    },
  };
}

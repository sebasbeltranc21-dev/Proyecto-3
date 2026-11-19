import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CHANNELS, GRID, HALF, SIZE, STEP, WATER, clamp, rng } from '../sim/config.js';
import { ground, tile } from '../sim/terrain.js';

const SUN = new T.Vector3(-.62, .58, -.52).normalize();
const NOISE = `
float hash21(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float noise21(vec2 p) {
  vec2 i=floor(p), f=fract(p);
  f=f*f*(3.-2.*f);
  return mix(mix(hash21(i),hash21(i+vec2(1.,0.)),f.x),mix(hash21(i+vec2(0.,1.)),hash21(i+1.),f.x),f.y);
}
`;

function grainTexture() {
  const width = 128, random = rng(472);
  const pixels = new Uint8Array(width * width * 4);
  for (let z = 0; z < width; z++) {
    for (let x = 0; x < width; x++) {
      const at = (z * width + x) * 4;
      const waves = Math.sin(x * .77 + Math.sin(z * .70) * 2) * Math.cos(z * .68 + x * .31);
      const shade = Math.round(133 + 34 * waves + 77 * (random() - .5));
      pixels.set([shade, shade, shade, 255], at);
    }
  }
  const texture = new T.DataTexture(pixels, width, width);
  texture.wrapS = texture.wrapT = T.RepeatWrapping;
  texture.magFilter = T.LinearFilter;
  texture.minFilter = T.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

function makeTerrain(scene, field) {
  const resolution = 120;
  const geometry = new T.PlaneGeometry(SIZE, SIZE, resolution, resolution).rotateX(-Math.PI / 2);
  const detail = grainTexture();
  const material = new T.MeshStandardMaterial({ color: 0xd8dec5, roughness: .89 });
  material.onBeforeCompile = shader => {
    shader.uniforms.biomeField = { value: field };
    shader.uniforms.detailMap = { value: detail };
    shader.vertexShader = 'varying vec3 vLand;\n' + shader.vertexShader.replace(
      '#include <begin_vertex>', '#include <begin_vertex>\n vLand = position;',
    );
    shader.fragmentShader = `varying vec3 vLand; uniform sampler2D biomeField; uniform sampler2D detailMap; ${NOISE}\n` +
      shader.fragmentShader.replace('#include <color_fragment>', `
      #include <color_fragment>
      vec4 biome = texture2D(biomeField, vLand.xz / 320. + .5);
      vec3 n = normalize(cross(dFdx(vLand), dFdy(vLand)));
      vec3 blend = pow(abs(n),vec3(4.)); blend /= max(.001,blend.x+blend.y+blend.z);
      float grain = dot(blend, vec3(texture2D(detailMap,vLand.yz*.245).r,texture2D(detailMap,vLand.xz*.245).r,texture2D(detailMap,vLand.xy*.245).r));
      float broad = noise21(vLand.xz*.052)*.62 + noise21(vLand.xz*.19)*.28 + noise21(vLand.xz*.73)*.10;
      vec3 meadow = mix(vec3(.105,.159,.039),vec3(.248,.330,.076),smoothstep(.23,.83,broad));
      vec3 soil = mix(vec3(.142,.122,.055),vec3(.346,.300,.113),broad);
      vec3 pine = mix(meadow,vec3(.044,.094,.037),smoothstep(.23,.92,biome.g)*.72);
      vec3 hue = mix(soil,pine,smoothstep(.08,.42,biome.b)*(.67 + biome.r*.33));
      vec3 gravel = mix(vec3(.102,.109,.092),vec3(.245,.245,.198),broad);
      hue = mix(hue,gravel,smoothstep(.23,.65,1.-abs(n.y))*.86);
      hue = mix(vec3(.237,.194,.103)*(.72+broad*.51),hue,smoothstep(-2.4,.10,vLand.y));
      hue = mix(hue,vec3(.045,.028,.017)*(1.+grain*.55),biome.a*.87);
      diffuseColor.rgb *= hue*(.60+grain*.76);
      `);
  };
  const mesh = new T.Mesh(geometry, material);
  mesh.receiveShadow = true;
  scene.add(mesh);
  const position = geometry.attributes.position;
  let previous = null;
  return {
    mesh,
    update(map) {
      let changed = !previous;
      if (previous) {
        for (let i = 0; i < map.length; i += CHANNELS) {
          if (previous[i] !== map[i]) { changed = true; break; }
        }
      }
      if (!changed) return;
      previous = map;
      for (let i = 0; i < position.count; i++) position.setY(i, ground(map, position.getX(i), position.getZ(i)));
      position.needsUpdate = true;
      geometry.computeVertexNormals();
      geometry.computeBoundingSphere();
    },
  };
}

function makeWater(scene) {
  const uniforms = {
    elapsed: { value: 0 }, sunDirection: { value: SUN },
    waterSky: { value: new T.Color(0x5e9eab) }, precipitation: { value: 0 },
  };
  const material = new T.ShaderMaterial({
    uniforms, fog: false,
    vertexShader: `
      varying vec3 worldPoint;
      void main() {
        worldPoint = (modelMatrix*vec4(position,1.)).xyz;
        gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.);
      }`,
    fragmentShader: `
      varying vec3 worldPoint;
      uniform float elapsed, precipitation;
      uniform vec3 sunDirection, waterSky;
      ${NOISE}
      void main() {
        vec2 p = worldPoint.xz;
        float phase1 = p.x*.66+p.y*.93+elapsed*1.55;
        float phase2 = p.x*.29-p.y*1.83+elapsed*.92;
        float phase3 = p.x*3.31+p.y*.87-elapsed*2.2;
        vec3 n = normalize(vec3(cos(phase1)*.034+sin(phase2)*.019 + sin(phase3)*.018,1.,sin(phase1)*.027+cos(phase2)*.032));
        vec3 viewDir = normalize(cameraPosition-worldPoint);
        vec3 reflected = reflect(-viewDir,n);
        float fresnel = pow(1.-max(dot(viewDir,n),0.),3.0);
        float glint = pow(max(0.,dot(reflected,sunDirection)),76.)*.72;
        float ripple = .46+sin(phase1+sin(phase3)*.5)*.18+sin(phase2)*.10;
        vec3 deep = mix(vec3(.017,.093,.090),vec3(.054,.203,.185),ripple);
        vec3 color = mix(deep,waterSky*(.72+ripple*.48),fresnel*.73) + glint*vec3(1.,.64,.30);
        float drops = noise21(p*7.+elapsed*2.0)*precipitation*.035;
        color += drops;
        gl_FragColor = vec4(color,1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const water = new T.Mesh(new T.PlaneGeometry(SIZE, SIZE).rotateX(-Math.PI / 2), material);
  water.position.y = WATER;
  scene.add(water);
  return uniforms;
}

function makeSky(scene) {
  const uniforms = {
    sunDirection: { value: SUN },
    dusk: { value: 0 },
    cloudiness: { value: .25 },
    elapsed: { value: 0 },
  };
  const mesh = new T.Mesh(new T.SphereGeometry(600, 40, 22), new T.ShaderMaterial({
    side: T.BackSide, depthWrite: false, uniforms,
    vertexShader: `
      varying vec3 direction;
      void main() {
        direction=normalize(position);
        gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);
      }`,
    fragmentShader: `
      varying vec3 direction;
      uniform vec3 sunDirection;
      uniform float dusk, cloudiness, elapsed;
      ${NOISE}
      void main() {
        vec3 d=normalize(direction);
        float elevation=clamp(d.y,0.,1.);
        float sun=max(0.,dot(d,sunDirection));
        vec3 horizon=mix(vec3(.75,.75,.58),vec3(.066,.096,.104),dusk);
        vec3 zenith=mix(vec3(.10,.32,.42),vec3(.009,.026,.049),dusk);
        vec3 c=mix(horizon,zenith,pow(elevation,.48));
        c+=pow(sun,15.)*vec3(.58,.31,.10)*(1.-dusk);
        c+=pow(sun,1400.)*vec3(4.2,2.8,1.1)*(1.-dusk);
        vec2 p=d.xz/(max(.10,d.y)+.13)*3.2+vec2(elapsed*.012,0.);
        float noise=noise21(p)*.57+noise21(p*2.3)*.27+noise21(p*5.5)*.16;
        float cloud=smoothstep(.72-cloudiness*.34,.91-cloudiness*.21,noise)*smoothstep(.06,.35,d.y);
        c=mix(c,mix(vec3(.72,.76,.68),vec3(.051,.066,.084),dusk),cloud*.69);
        gl_FragColor=vec4(c,1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  }));
  mesh.renderOrder = -10;
  scene.add(mesh);
  return uniforms;
}

function mountainRing(scene) {
  const slopes = [
    { radius: 303, height: 113, color: 0x293e3a, offset: .35 },
    { radius: 389, height: 146, color: 0x486360, offset: 2.16 },
    { radius: 483, height: 175, color: 0x698581, offset: 4.9 },
  ];
  const positions = [], indices = [], colors = [];
  const shade = new T.Color();
  for (const layer of slopes) {
    const base = positions.length / 3;
    const steps = 164;
    const color = new T.Color(layer.color);
    for (let i = 0; i <= steps; i++) {
      const a = i / steps * Math.PI * 2;
      const ridge = Math.abs(Math.sin(a * 6 + layer.offset) * .72 + Math.sin(a * 13 + layer.offset) * .23);
      const crags = Math.abs(Math.sin(a * 29 + layer.offset) * Math.sin(a * 41 + .7));
      const height = 13 + layer.height * (.15 + Math.pow(ridge, 1.4) * .68 + crags * .20);
      for (let row = 0; row < 4; row++) {
        const r = layer.radius - (3 - row) * 21 + Math.sin(a * 18) * (row + 1) * 3.3;
        const y = [-13, height * .10, height * .48, height][row];
        positions.push(Math.cos(a) * r, y, Math.sin(a) * r);
        shade.copy(color).multiplyScalar(.66 + row * .17 + crags * .17);
        colors.push(shade.r, shade.g, shade.b);
      }
      if (i === steps) continue;
      const offset = base + i * 4;
      for (let row = 0; row < 3; row++) indices.push(offset + row, offset + row + 4, offset + row + 1, offset + row + 1, offset + row + 4, offset + row + 5);
    }
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  scene.add(new T.Mesh(geometry, new T.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: T.DoubleSide })));
}

function tint(geometry, value, variation = .15) {
  const part = geometry.index ? geometry.toNonIndexed() : geometry;
  if (part !== geometry) geometry.dispose();
  const color = new T.Color(value);
  const position = part.attributes.position;
  const colors = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    const scale = 1 + Math.sin(position.getX(i) * 25 + position.getZ(i) * 12) * variation;
    colors.set([color.r * scale, color.g * scale, color.b * scale], i * 3);
  }
  part.setAttribute('color', new T.BufferAttribute(colors, 3));
  return part;
}

function pine(detail) {
  const branches = [tint(new T.CylinderGeometry(.12, .25, 2.4, detail ? 6 : 4).translate(0, 1.2, 0), 0x6d5136)];
  const shades = [0x344e26, 0x486137, 0x61713c, 0x6e8047];
  const tiers = detail ? [0, 1, 2, 3] : [0, 2, 3];
  for (const i of tiers) {
    const radius = 1.7 - .27 * i;
    const y = 1.61 + i * 1.01;
    const cone = new T.CylinderGeometry(.11, radius, 2.29 - i * .17, detail ? 9 : 5, 1);
    const positions = cone.attributes.position;
    for (let j = 0; j < positions.count; j++) {
      const x = positions.getX(j), z = positions.getZ(j);
      const spread = 1 + Math.sin(Math.atan2(z, x) * 5 + i) * .13;
      positions.setXYZ(j, x * spread, positions.getY(j) + Math.sin(x * 6 + z * 9 + i) * .23, z * spread);
    }
    cone.rotateY(i * 1.8).translate(0, y, 0);
    cone.computeVertexNormals();
    branches.push(tint(cone, shades[i], .23));
  }
  const geometry = mergeGeometries(branches);
  for (const branch of branches) branch.dispose();
  return geometry;
}

function sway(material, uniform, strength) {
  material.onBeforeCompile = shader => {
    shader.uniforms.windTime = uniform;
    shader.vertexShader = 'uniform float windTime;\n' + shader.vertexShader.replace(
      '#include <begin_vertex>', `
      #include <begin_vertex>
      float phase = windTime * 1.55 + instanceMatrix[3].x*.08 + instanceMatrix[3].z*.087;
      transformed.x += sin(phase)*position.y*${strength};
      transformed.z += cos(phase*.76)*position.y*${strength * .55};
      `,
    );
  };
  material.customProgramCacheKey = () => 'wind-' + strength;
  return material;
}

function cover(scene) {
  const time = { value: 0 };
  const nearPine = pine(true), farPine = pine(false);
  const treeMaterial = sway(new T.MeshStandardMaterial({ vertexColors: true, roughness: .89, flatShading: true }), time, .024);
  const blade = new T.BufferGeometry();
  blade.setAttribute('position', new T.Float32BufferAttribute([
    -.10, 0, 0, .10, 0, 0, .14, .96, 0,
    0, 0, -.15, 0, 0, .10, 0, .79, -.19,
    -.22, 0, .08, -.08, 0, .08, -.38, .65, .08,
  ], 3));
  blade.computeVertexNormals();
  const grassMaterial = sway(new T.MeshStandardMaterial({ color: 0xd5dfa8, side: T.DoubleSide, roughness: .96 }), time, .19);
  const rockGeometry = new T.DodecahedronGeometry(1, 0);
  const rockMaterial = new T.MeshStandardMaterial({ color: 0xaeb1a1, roughness: .99, flatShading: true });
  const chunks = [];
  const random = rng(185513);
  for (let v = 0; v < 5; v++) {
    for (let u = 0; u < 5; u++) {
      const trees = new T.InstancedMesh(nearPine, treeMaterial, 130);
      const grass = new T.InstancedMesh(blade, grassMaterial, 320);
      const rock = new T.InstancedMesh(rockGeometry, rockMaterial, 28);
      const centerX = (u + .5) * 64 - HALF, centerZ = (v + .5) * 64 - HALF;
      trees.castShadow = true;
      trees.receiveShadow = true;
      grass.receiveShadow = true;
      rock.castShadow = true;
      rock.receiveShadow = true;
      for (const item of [trees, grass, rock]) {
        item.count = 0;
        item.boundingSphere = new T.Sphere(new T.Vector3(centerX, 12, centerZ), 66);
        scene.add(item);
      }
      const candidates = Array.from({ length: 320 }, () => ({
        x: centerX + (random() - .5) * 64, z: centerZ + (random() - .5) * 64,
        density: random(), scale: random(), angle: random() * Math.PI * 2,
      }));
      chunks.push({ trees, grass, rock, centerX, centerZ, candidates, high: true });
    }
  }
  const object = new T.Object3D();
  const color = new T.Color();
  let lastMap;
  const activeFire = [];
  return {
    time, activeFire,
    update(map) {
      lastMap = map;
      activeFire.length = 0;
      for (const { trees, grass, rock, candidates } of chunks) {
        trees.count = grass.count = rock.count = 0;
        for (const [index, c] of candidates.entries()) {
          const { x, z, density, scale, angle } = c;
          const at = tile(x, z);
          const y = ground(map, x, z);
          if (y < WATER + .28) continue;
          object.position.set(x, y, z);
          object.rotation.set(0, angle, 0);
          const canopy = map[at + 1], food = map[at + 2], wet = map[at + 3], burning = map[at + 4];
          if (burning > .12 && index % 2 === 0) activeFire.push([x, y, z, density]);
          if (index < 130 && density < canopy * .84 && y > .35 && burning < .36) {
            const h = .66 + 1.03 * scale;
            object.scale.set(.76 + h * .24, h, .76 + h * .24);
            object.updateMatrix();
            trees.setMatrixAt(trees.count, object.matrix);
            color.setHSL(.20 + wet * .056, .28, .55 + scale * .20);
            trees.setColorAt(trees.count++, color);
          }
          if (density * .69 < food && burning < .25) {
            object.scale.set(1 + scale * .85, .47 + scale * .76, 1 + scale * .85);
            object.updateMatrix();
            grass.setMatrixAt(grass.count, object.matrix);
            color.setHSL(.16 + wet * .10, .36 + food * .12, .29 + scale * .21);
            grass.setColorAt(grass.count++, color);
          }
          if (index < 28 && density < .24 && (y > 9 || y < 1.8)) {
            object.scale.set(.8 + scale * 2.3, .58 + scale * 1.64, .8 + scale * 1.7);
            object.rotation.set(scale * .63, angle, .35);
            object.updateMatrix();
            rock.setMatrixAt(rock.count++, object.matrix);
          }
        }
        for (const mesh of [trees, grass, rock]) {
          mesh.instanceMatrix.needsUpdate = true;
          if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        }
      }
    },
    lod(camera, low) {
      if (!lastMap) return;
      for (const chunk of chunks) {
        const distance = Math.hypot(camera.position.x - chunk.centerX, camera.position.z - chunk.centerZ, camera.position.y * .65);
        const high = distance < (low ? 119 : 175);
        if (high !== chunk.high) {
          chunk.high = high;
          chunk.trees.geometry = high ? nearPine : farPine;
          chunk.trees.castShadow = high;
        }
        chunk.grass.visible = distance < (low ? 146 : 215);
      }
    },
  };
}

function weatherParticles(scene) {
  const random = rng(38261);
  const flakes = Array.from({ length: 900 }, () => [random() * SIZE - HALF, random() * 80, random() * SIZE - HALF]);
  const rainData = new Float32Array(flakes.length * 6);
  const rainGeom = new T.BufferGeometry();
  rainGeom.setAttribute('position', new T.BufferAttribute(rainData, 3).setUsage(T.DynamicDrawUsage));
  const rain = new T.LineSegments(rainGeom, new T.LineBasicMaterial({ color: 0xa5c5cc, transparent: true, opacity: .31, depthWrite: false }));
  rain.frustumCulled = false;
  scene.add(rain);
  const fireData = new Float32Array(950 * 3);
  const fireGeom = new T.BufferGeometry();
  fireGeom.setAttribute('position', new T.BufferAttribute(fireData, 3).setUsage(T.DynamicDrawUsage));
  const fire = new T.Points(fireGeom, new T.ShaderMaterial({
    transparent: true, depthWrite: false, blending: T.AdditiveBlending,
    vertexShader: 'void main(){ vec4 v=modelViewMatrix*vec4(position,1.); gl_Position=projectionMatrix*v; gl_PointSize=clamp(820./-v.z,3.,30.); }',
    fragmentShader: 'void main(){ float d=length(gl_PointCoord-.5); gl_FragColor=vec4(1.,.27+d*.42,.035,1.-smoothstep(.04,.5,d)); }',
  }));
  fire.frustumCulled = false;
  scene.add(fire);
  return function update(time, weather, active) {
    rain.visible = weather === 'rain';
    if (rain.visible) {
      for (const [i, [x, phase, z]] of flakes.entries()) {
        const h = ((phase - time * 30) % 80 + 80) % 80;
        rainData.set([x, h, z, x + .48, h - 2.7, z + .16], i * 6);
      }
      rainGeom.attributes.position.needsUpdate = true;
    }
    const count = Math.min(active.length * 4, 950);
    for (let i = 0; i < count; i++) {
      const [x, y, z, phase] = active[i >> 2];
      const pulse = (time * (1.3 + phase) + phase + (i % 4) * .25) % 1;
      fireData.set([x + Math.sin(i) * pulse, y + pulse * 4.6, z + Math.cos(i) * pulse], i * 3);
    }
    fireGeom.setDrawRange(0, count);
    fireGeom.attributes.position.needsUpdate = true;
  };
}

export function makeLand(scene) {
  const bytes = new Uint8Array(GRID * GRID * 4);
  const field = new T.DataTexture(bytes, GRID, GRID);
  field.magFilter = field.minFilter = T.LinearFilter;
  const terrain = makeTerrain(scene, field);
  const sky = makeSky(scene);
  const water = makeWater(scene);
  const forest = cover(scene);
  const particles = weatherParticles(scene);
  mountainRing(scene);
  return {
    mesh: terrain.mesh,
    sun: SUN,
    update(map) {
      for (let i = 0, j = 0; i < map.length; i += CHANNELS, j += 4) {
        bytes[j] = Math.round(map[i + 3] * 255);
        bytes[j + 1] = Math.round(map[i + 1] * 255);
        bytes[j + 2] = Math.round(map[i + 2] * 255);
        bytes[j + 3] = Math.round(map[i + 4] * 255);
      }
      field.needsUpdate = true;
      terrain.update(map);
      forest.update(map);
    },
    tick(time, dusk, weather, sun, camera, quality) {
      sky.elapsed.value = water.elapsed.value = forest.time.value = time;
      sky.dusk.value = dusk;
      sky.cloudiness.value = weather === 'rain' ? .96 : weather === 'fog' ? .82 : .35;
      water.precipitation.value = Number(weather === 'rain');
      water.waterSky.value.setHex(weather === 'fog' ? 0x799c95 : 0x79afb9).multiplyScalar(1 - dusk * .75);
      sky.sunDirection.value.copy(sun);
      water.sunDirection.value.copy(sun);
      forest.lod(camera, quality === 'eco');
      particles(time, weather, forest.activeFire);
    },
  };
}

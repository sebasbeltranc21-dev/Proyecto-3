import { DataTexture, RepeatWrapping, SRGBColorSpace } from 'three';

const names = ['grass', 'sand', 'rock', 'snow'];
const colors = [[88, 113, 58], [140, 122, 92], [104, 111, 111], [217, 225, 229]];

function pixel(values, color) {
  const texture = new DataTexture(new Uint8Array(values), 1, 1);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  if (color) texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

const varying = 'varying vec3 vLand; varying vec3 vLandNormal;\n';
const samplers = names.map(name => `uniform sampler2D ${name}Color, ${name}Surface;`).join('\n');
const functions = `
uniform sampler2D biomeField;
uniform float snowLine, rainfall;
struct BiomeSample { vec3 color; vec4 surface; vec2 bump; };

float landHash(vec2 p) { return fract(sin(dot(p,vec2(143.7,255.1)))*43758.5453); }
float landNoise(vec2 p) {
  vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(landHash(i),landHash(i+vec2(1,0)),f.x),mix(landHash(i+vec2(0,1)),landHash(i+1.),f.x),f.y);
}
BiomeSample sampleTop(sampler2D albedo, sampler2D maps, vec2 uv) {
  vec4 surfaceData=texture2D(maps,uv);
  return BiomeSample(texture2D(albedo,uv).rgb,surfaceData,surfaceData.rg*2.-1.);
}
BiomeSample sampleRock(vec3 wp, vec3 norm) {
  vec3 w=pow(abs(norm),vec3(5.)); w/=max(dot(w,vec3(1.)),.0001);
  vec3 p=wp*.31;
  vec3 a=texture2D(rockColor,p.zy).rgb*w.x+texture2D(rockColor,p.xz).rgb*w.y+texture2D(rockColor,p.xy).rgb*w.z;
  vec4 x=texture2D(rockSurface,p.zy), y=texture2D(rockSurface,p.xz), z=texture2D(rockSurface,p.xy);
  return BiomeSample(a,x*w.x+y*w.y+z*w.z,(x.rg*w.x+y.rg*w.y+z.rg*w.z)*2.-1.);
}
BiomeSample interpolateBiome(BiomeSample a, BiomeSample b, float t) {
  return BiomeSample(mix(a.color,b.color,t),mix(a.surface,b.surface,t),mix(a.bump,b.bump,t));
}
BiomeSample shadeLand(vec3 wp, vec3 worldNormal) {
  vec4 ecology=texture2D(biomeField,wp.xz/320.+.5);
  float n=landNoise(wp.xz*.11);
  float slope=1.-max(0.,worldNormal.y);
  float shore=1.-smoothstep(-1.1,2.9+n*1.4,wp.y);
  float stone=smoothstep(.14,.48,slope+n*.13)+.41*smoothstep(20.,36.,wp.y);
  float frost=smoothstep(snowLine-2.4,snowLine+3.1,wp.y+n*2.2)*(1.-smoothstep(.12,.49,slope));
  vec2 warped=wp.xz*.40+.95*vec2(landNoise(wp.xz*.071+23.),landNoise(wp.xz*.087-19.));
  BiomeSample result=sampleTop(grassColor,grassSurface,warped);
  result.color*=mix(vec3(.36,.64,.32),vec3(.66,1.03,.49),clamp(ecology.b*.57+n*.57,0.,1.));
  if(shore>.006) result=interpolateBiome(result,sampleTop(sandColor,sandSurface,wp.xz*.61),shore);
  if(stone>.006) result=interpolateBiome(result,sampleRock(wp,worldNormal),min(stone,1.));
  if(frost>.006) result=interpolateBiome(result,sampleTop(snowColor,snowSurface,wp.xz*.54),frost*.95);
  result.color=mix(result.color,result.color*vec3(.18,.122,.083),ecology.a*.89);
  result.color*=1.-rainfall*(.10+ecology.r*.20);
  result.surface.b=mix(result.surface.b,.34,rainfall*.46);
  return result;
}
`;

export function terrainSurface(material, field, assets, register, onReady) {
  const neutral = pixel([128, 128, 224, 255], false);
  const uniforms = { biomeField: { value: field }, snowLine: { value: 35 }, rainfall: { value: 0 } };
  names.forEach((name, index) => {
    uniforms[name + 'Color'] = { value: pixel([...colors[index], 255], true) };
    uniforms[name + 'Surface'] = { value: neutral };
  });
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = varying + shader.vertexShader.replace('#include <begin_vertex>',
      '#include <begin_vertex>\n vLand = position; vLandNormal = normalize(normal);');
    shader.fragmentShader = varying + samplers + '\n' + functions + shader.fragmentShader
      .replace('#include <color_fragment>', `
        #include <color_fragment>
        vec3 biomeNormal=normalize(vLandNormal);
        BiomeSample terrain=shadeLand(vLand,biomeNormal);
        diffuseColor.rgb *= terrain.color;
      `)
      .replace('#include <roughnessmap_fragment>', `
        #include <roughnessmap_fragment>
        roughnessFactor *= clamp(terrain.surface.b,.15,1.);
      `)
      .replace('#include <normal_fragment_maps>', `
        #include <normal_fragment_maps>
        vec3 tangentX=normalize(vec3(1.,0.,0.)-biomeNormal*biomeNormal.x+vec3(0.,0.,.0001));
        vec3 tangentZ=normalize(cross(tangentX,biomeNormal));
        vec3 bumpWorld=terrain.bump.x*tangentX + terrain.bump.y*tangentZ;
        normal = normalize(normal + (viewMatrix * vec4(bumpWorld,0.)).xyz*.44);
      `)
      .replace('#include <aomap_fragment>', `
        #include <aomap_fragment>
        reflectedLight.indirectDiffuse *= mix(.37,1.,terrain.surface.a);
        reflectedLight.indirectSpecular *= mix(.66,1.,terrain.surface.a);
      `);
  };
  material.customProgramCacheKey = () => 'biome-pbr-v2';
  register(material);
  Promise.all(names.map(async name => {
    const [color, surface] = await Promise.all([assets.texture(name + '-color', true), assets.texture(name + '-surface')]);
    uniforms[name + 'Color'].value.dispose();
    uniforms[name + 'Color'].value = color;
    uniforms[name + 'Surface'].value = surface;
  })).then(() => { neutral.dispose(); onReady?.(true); }).catch(error => {
    onReady?.(false);
    console.warn('Alguna textura de terreno usa el material de respaldo.', error);
  });
  return uniforms;
}

import { DataTexture, RepeatWrapping, SRGBColorSpace } from 'three';
import { WATER } from '../../sim/config.js';

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
uniform sampler2D biomeField, burnField;
uniform float snowLine, rainfall, waterLevel;
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
  vec2 field=wp.xz/320.+.5;
  float outside=smoothstep(159.5,178.,max(abs(wp.x),abs(wp.z)));
  vec4 ecology=mix(texture2D(biomeField,field),vec4(.27,.34,.53,0.),outside);
  float n=landNoise(wp.xz*.079+21.);
  float broad=landNoise(wp.xz*.041);
  float grains=landNoise(wp.xz*1.66+5.3);
  float slope=1.-max(0.,worldNormal.y);
  float bankHeight=wp.y-waterLevel;
  float shore=(1.-smoothstep(.84,3.05+n*1.02,bankHeight))*(1.-outside);
  float stone=smoothstep(.11,.43,slope+n*.127)+.48*smoothstep(18.,39.,wp.y);
  float frostline=snowLine+outside*16.+(broad-.5)*3.4;
  float frost=smoothstep(frostline-2.3,frostline+3.8,wp.y+n*2.8)*(1.-smoothstep(.15,.57,slope));
  vec2 warped=wp.xz*.48+.91*vec2(landNoise(wp.xz*.071+23.),landNoise(wp.xz*.087-19.));
  BiomeSample result=sampleTop(grassColor,grassSurface,warped);
  vec3 lush=mix(vec3(.33,.64,.295),vec3(.63,1.07,.455),clamp(ecology.b*.50+n*.65,0.,1.));
  result.color*=lush*(.80+broad*.26+grains*.18)*(1.-ecology.g*.16);
  if(shore>.006) {
    BiomeSample sand=sampleTop(sandColor,sandSurface,wp.xz*.69+vec2(n*.38,broad*.33));
    float bankFilm=1.-smoothstep(.04,.79+n*.21,abs(bankHeight));
    float wet=max(bankFilm*.84,smoothstep(0.,1.75,-bankHeight)*.54)+rainfall*.15;
    sand.color*=mix(vec3(1.04,1.015,.93),vec3(.48,.54,.47),wet);
    sand.surface.b=mix(sand.surface.b,.236,wet*.78);
    result=interpolateBiome(result,sand,shore);
  }
  if(stone>.006) {
    BiomeSample rock=sampleRock(wp+vec3(n,broad,grains*.18)*.56,worldNormal);
    float stratum=sin(wp.y*.71+n*2.35+wp.x*.051)*.5+.5;
    rock.color*=mix(vec3(.68,.75,.74),vec3(1.15,1.09,.98),broad*.57+stratum*.32+grains*.11);
    result=interpolateBiome(result,rock,min(stone,1.));
  }
  if(frost>.006) result=interpolateBiome(result,sampleTop(snowColor,snowSurface,wp.xz*.54),frost*.96);
  float history=texture2D(burnField,field).r*(1.-outside);
  float ash=smoothstep(.085,.79,max(history,ecology.a)*(.74+broad*.26+grains*.25));
  vec3 charred=mix(vec3(.012,.007,.004),vec3(.069,.061,.048),n*.55+grains*.35);
  result.color=mix(result.color,charred,ash*.94);
  result.color*=1.-rainfall*(.075+ecology.r*.16);
  result.surface.b=mix(result.surface.b,.36,rainfall*.40);
  result.surface.b=mix(result.surface.b,.94,ash*.83);
  result.bump*=1.-ash*.35;
  return result;
}
`;

export function terrainSurface(material, field, scars, assets, register, onReady) {
  const neutral = pixel([128, 128, 224, 255], false);
  const uniforms = { biomeField: { value: field }, burnField: { value: scars }, snowLine: { value: 35 }, rainfall: { value: 0 }, waterLevel: { value: WATER } };
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
        float grit=landNoise(vLand.xz*3.83+vLand.y*1.57);
        float shimmer=1.-smoothstep(.40,1.50,length(fwidth(vLand))*4.);
        roughnessFactor*=clamp(terrain.surface.b+(grit-.5)*.14*shimmer,.16,1.);
      `)
      .replace('#include <normal_fragment_maps>', `
        #include <normal_fragment_maps>
        vec3 tangentX=normalize(vec3(1.,0.,0.)-biomeNormal*biomeNormal.x+vec3(0.,0.,.0001));
        vec3 tangentZ=normalize(cross(tangentX,biomeNormal));
        vec3 bumpWorld=terrain.bump.x*tangentX + terrain.bump.y*tangentZ;
        normal=normalize(normal+(viewMatrix*vec4(bumpWorld,0.)).xyz*.51);
        float fidelity=1.-smoothstep(.25,1.05,length(fwidth(vLand))*7.8);
        float micro=.033*landNoise(vLand.xz*7.3+vLand.y*.67)+.015*landNoise(vLand.xz*15.1+vLand.y*1.94);
        vec3 adjacentX=dFdx(-vViewPosition), adjacentY=dFdy(-vViewPosition);
        vec3 crossX=cross(adjacentY,normal), crossY=cross(normal,adjacentX);
        float det=dot(adjacentX,crossX);
        vec3 perturbation=sign(det)*(dFdx(micro)*crossX+dFdy(micro)*crossY);
        normal=normalize(max(abs(det),1.e-7)*normal - fidelity*perturbation);
      `)
      .replace('#include <aomap_fragment>', `
        #include <aomap_fragment>
        reflectedLight.indirectDiffuse *= mix(.37,1.,terrain.surface.a);
        reflectedLight.indirectSpecular *= mix(.66,1.,terrain.surface.a);
      `);
  };
  material.customProgramCacheKey = () => 'biome-pbr-v4';
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

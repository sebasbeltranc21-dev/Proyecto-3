import { DataTexture, FloatType, NearestFilter, RGBAFormat } from 'three';
import { GRID, HALF } from '../../sim/config.js';

const sweep = `
uniform float windTime;
uniform float windGust;
uniform sampler2D tracks;
vec3 foliageBend(vec3 p, mat4 placement) {
  vec3 root=placement[3].xyz;
  vec2 broad=root.xz*.062;
  float phase=windTime*1.59+broad.x+broad.y;
  vec2 breeze=vec2(sin(phase)+.40*sin(phase*2.33),cos(phase*.83));
  float flexibility=pow(clamp(p.y,0.,1.),1.7);
  vec4 passing=texture2D(tracks,root.xz/320.+.5);
  vec2 pushed=passing.xy;
  vec3 displaced=vec3(breeze.x,0.,breeze.y)*p.y*WIND_STRENGTH*(.7+windGust);
  displaced+=vec3(pushed.x,-passing.z*.19,pushed.y)*flexibility*REACTIVE;
  vec3 u=normalize(placement[0].xyz), v=normalize(placement[1].xyz), w=normalize(placement[2].xyz);
  return p+vec3(dot(displaced,u),dot(displaced,v),dot(displaced,w));
}
`;

export function makeTracks() {
  const data = new Float32Array(GRID * GRID * 4);
  const texture = new DataTexture(data, GRID, GRID, RGBAFormat, FloatType);
  texture.minFilter = texture.magFilter = NearestFilter;
  texture.needsUpdate = true;
  return {
    texture,
    update(records) {
      data.fill(0);
      for (const a of records) {
        if (a.pace < .4) continue;
        const ix = Math.floor((a.x + HALF) / (HALF * 2) * GRID);
        const iz = Math.floor((a.z + HALF) / (HALF * 2) * GRID);
        const strength = Math.min(.75, a.pace * .145);
        for (let z = Math.max(0, iz - 1); z < Math.min(GRID, iz + 2); z++) {
          for (let x = Math.max(0, ix - 1); x < Math.min(GRID, ix + 2); x++) {
            const index = (z * GRID + x) * 4;
            const power = x === ix && z === iz ? strength : strength * .41;
            if (power < data[index + 2]) continue;
            data[index] = Math.sin(a.angle) * power;
            data[index + 1] = Math.cos(a.angle) * power;
            data[index + 2] = power;
          }
        }
      }
      texture.needsUpdate = true;
    },
  };
}

export function sway(material, time, gust, trackMap, strength, reactive, focus) {
  material.onBeforeCompile = shader => {
    shader.uniforms.windTime = time;
    shader.uniforms.windGust = gust;
    shader.uniforms.tracks = { value: trackMap.texture };
    shader.vertexShader = sweep.replace('WIND_STRENGTH', String(strength)).replace('REACTIVE', reactive ? '.96' : '0.') +
      shader.vertexShader.replace('#include <begin_vertex>', `
        #include <begin_vertex>
        transformed=foliageBend(transformed,instanceMatrix);
      `);
    if (focus) {
      shader.uniforms.followFocus = focus;
      shader.vertexShader = 'varying vec3 vFoliageWorld;\n' + shader.vertexShader.replace(
        '#include <project_vertex>', 'vFoliageWorld=(modelMatrix*instanceMatrix*vec4(transformed,1.)).xyz;\n#include <project_vertex>',
      );
      shader.fragmentShader = 'uniform vec4 followFocus; varying vec3 vFoliageWorld;\n' + shader.fragmentShader.replace(
        '#include <alphatest_fragment>', `
        #include <alphatest_fragment>
        if (followFocus.w > .5) {
          vec3 ray=followFocus.xyz-cameraPosition;
          vec3 toLeaf=vFoliageWorld-cameraPosition;
          float t=dot(toLeaf,ray)/max(dot(ray,ray),.001);
          float lineDistance=length(toLeaf-clamp(t,0.,1.)*ray);
          float gap=(1.-smoothstep(.83,1.89,lineDistance))*(1.-smoothstep(.93,1.04,t));
          float hash=fract(52.9829189*fract(dot(gl_FragCoord.xy,vec2(.06711056,.00583715))));
          if (hash < gap) discard;
        }
        `,
      );
    }
  };
  material.customProgramCacheKey = () => 'foliage-v3-' + strength + '-' + reactive + '-' + Boolean(focus);
  return material;
}

import * as T from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { SIZE, WATER } from '../../sim/config.js';

const waterVertex = `
uniform mat4 textureMatrix;
varying vec3 worldPoint;
varying vec4 mirrorPoint;
void main(){
  worldPoint=(modelMatrix*vec4(position,1.)).xyz;
  mirrorPoint=textureMatrix*vec4(position,1.);
  gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);
}
`;

export const waterFragment = `
varying vec3 worldPoint;
varying vec4 mirrorPoint;
uniform float elapsed, precipitation, night, fogStrength, mirrored, emitOnly;
uniform vec3 sunDirection, waterSky, horizon;
uniform sampler2D riverBed, tDiffuse;

vec2 waterHash(vec2 p){
  vec2 q=vec2(dot(p,vec2(127.1,311.7)),dot(p,vec2(269.5,183.3)));
  return fract(sin(q)*43758.5453);
}
float noise(vec2 p){
  vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(waterHash(i).x,waterHash(i+vec2(1,0)).x,f.x),
    mix(waterHash(i+vec2(0,1)).x,waterHash(i+1.).x,f.x),f.y);
}
float rippleNoise(vec2 p){
  return noise(p)*.50+noise(mat2(.83,-.55,.55,.83)*p*2.07+19.4)*.32+noise(p*4.11-7.1)*.18;
}
float bedDepth(vec2 uv){
  vec2 packedDepth=texture2D(riverBed,uv).rg;
  return dot(packedDepth,vec2(65280.,255.))/65535.*80.-64.;
}
void main(){
  vec2 p=worldPoint.xz;
  vec2 bedUV=p/320.+.5;
  float depth=bedDepth(bedUV);
  if(depth<-.028) discard;
  depth=max(depth,0.);

  // The tangent comes from the procedural river centreline in terrain.js.
  float tangent=13.*.026*cos(p.y*.026+.85)+12.*.012*cos(p.y*.012);
  vec2 flow=normalize(vec2(-tangent,-1.));
  vec2 flank=vec2(-flow.y,flow.x);
  float current=.49+.34*smoothstep(.25,2.7,depth);
  vec2 coords=vec2(dot(p,flank),dot(p,flow));
  vec2 advect=coords*vec2(.81,1.10)-vec2(elapsed*.037,elapsed*current);
  float eddy=rippleNoise(advect*.64+6.3)-.5;
  float a=coords.y*1.92-elapsed*current*3.62+eddy*3.85;
  float crossEddy=rippleNoise(advect*vec2(.59,.81)-13.8)-.5;
  float b=(coords.x*.78+coords.y*.62)*3.37-elapsed*current*4.31+crossEddy*4.2;
  vec2 micro=advect*2.62+vec2(17.2,eddy*.87);
  float nx=rippleNoise(micro+vec2(.15,0.))-rippleNoise(micro-vec2(.15,0.));
  float nz=rippleNoise(micro+vec2(0.,.15))-rippleNoise(micro-vec2(0.,.15));
  float strength=(.50+.50*smoothstep(.08,1.30,depth))*(1.+precipitation*.43);
  float gust=.76+rippleNoise(advect*.38+1.97)*.37;
  vec2 slope=gust*(flow*(cos(a)*.027+cos(b)*.010+nz*.131)+flank*(cos(b)*.024+nx*.142));
  vec3 normal=normalize(vec3(-slope.x*strength,1.,-slope.y*strength));
  vec3 eye=normalize(cameraPosition-worldPoint);
  float facing=max(.055,dot(eye,normal));
  vec3 bounce=reflect(-eye,normal);
  float fresnel=.02037+.97963*pow(1.-facing,5.);

  float cosSun=max(dot(bounce,sunDirection),0.);
  float sunPower=(pow(cosSun,mix(446.,188.,precipitation))*3.40+pow(cosSun,72.)*.169)*(1.-night*.985);
  float mist=1.-exp(-pow(length(cameraPosition-worldPoint)*fogStrength,2.));
  if(emitOnly>.5){
    if(sunPower<.78) discard;
    gl_FragColor=vec4(vec3(1.,.79,.50)*sunPower*(1.-mist),smoothstep(.78,1.77,sunPower));
    return;
  }

  vec3 softSky=mix(horizon,waterSky,smoothstep(.14,.84,bounce.y));
  vec3 reflection=softSky;
  if(mirrored>.5 && mirrorPoint.w>0.){
    vec2 uv=mirrorPoint.xy/mirrorPoint.w;
    vec2 distortion=slope*(.14+.036*smoothstep(1.,4.5,depth));
    vec2 reflectedUV=uv+distortion;
    float edge=min(min(reflectedUV.x,reflectedUV.y),min(1.-reflectedUV.x,1.-reflectedUV.y));
    vec3 liveReflection=texture2D(tDiffuse,clamp(reflectedUV,vec2(.002),vec2(.998))).rgb;
    reflection=mix(softSky,liveReflection,smoothstep(.003,.064,edge)*.97);
  }

  // Beer–Lambert extinction over an oblique path. Blend over the actual visible riverbed.
  float path=depth/(.45+facing*.55);
  vec3 travel=exp(-path*vec3(1.02,.34,.235));
  float mud=1.-exp(-path*.58);
  float caustic=(1.-smoothstep(.28,1.95,depth))*(.60+.40*sin(a*1.46+b*.72)*sin(b*1.63-a*.52));
  vec3 turquoise=vec3(.052,.292,.238)*(1.+caustic*.19);
  vec3 deep=vec3(.0085,.080,.088)*(1.-night*.66);
  vec3 body=mix(deep,turquoise,travel.g*.85);
  vec3 color=mix(body,reflection,fresnel*.94);
  color+=sunPower*vec3(1.,.77,.46);

  vec2 stonePixel=texture2D(riverBed,bedUV).ba;
  float disturbance=rippleNoise(advect*vec2(1.60,.74)+27.6);
  float lap=.024*sin(a*.84+b*.56)+.014*eddy;
  float bankFoam=exp(-pow((depth-.072-lap)*10.6,2.))*smoothstep(.42,.75,disturbance);
  float stoneFoam=stonePixel.x*(1.-smoothstep(.27,1.8,depth))*smoothstep(.50,.83,disturbance+eddy*.085);
  float white=clamp(bankFoam*.61+stoneFoam*.57,0.,.72);
  color=mix(color,vec3(.79,.86,.80)*(1.-night*.64),white);
  color=mix(color,horizon,mist);
  float opacity=clamp(.078+mud*.902+fresnel*.59+white*.49,.07,1.);
  gl_FragColor=vec4(color,opacity);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function makeRiverSurface(scene, renderer, bed, sunlight, emitOnly) {
  const source = {
    name: 'WaterHD',
    uniforms: {
      tDiffuse: { value: null }, color: { value: new T.Color() }, textureMatrix: { value: new T.Matrix4() },
      elapsed: { value: 0 }, precipitation: { value: 0 }, night: { value: 0 },
      fogStrength: { value: 0 }, mirrored: { value: 0 }, emitOnly: { value: 0 },
      sunDirection: { value: new T.Vector3() }, waterSky: { value: new T.Color(0x6d9fb7) },
      horizon: { value: new T.Color() }, riverBed: { value: null },
    },
    vertexShader: waterVertex,
    fragmentShader: waterFragment,
  };
  const surface = new Reflector(new T.PlaneGeometry(SIZE, SIZE), {
    textureWidth: 384, textureHeight: 256, clipBias: .0006, multisample: 0, shader: source,
  });
  surface.name = 'Río · reflejo planar';
  surface.rotation.x = -Math.PI / 2;
  surface.position.y = WATER;
  surface.renderOrder = 1;
  surface.material.transparent = true;
  surface.material.depthWrite = false;
  surface.userData.skipAO = true;
  surface.userData.bloom = true;
  const uniforms = surface.material.uniforms;
  uniforms.emitOnly = emitOnly;
  uniforms.sunDirection.value = sunlight;
  uniforms.horizon.value = scene.fog.color;
  uniforms.riverBed.value = bed;
  const capture = surface.onBeforeRender;
  const target = surface.getRenderTarget();
  if (!renderer.extensions.has('EXT_color_buffer_float')) target.texture.type = T.UnsignedByteType;
  let last = -Infinity, delay = .085;
  surface.onBeforeRender = function (driver, world, camera, ...args) {
    if (emitOnly.value > .5 || camera.position.y <= WATER + .01 || uniforms.elapsed.value - last < delay) return;
    const shadow = driver.shadowMap.needsUpdate;
    driver.shadowMap.needsUpdate = false;
    try {
      capture.call(this, driver, world, camera, ...args);
      uniforms.mirrored.value = 1;
      last = uniforms.elapsed.value;
    } finally {
      driver.shadowMap.needsUpdate = shadow;
    }
  };
  scene.add(surface);

  return {
    uniforms,
    resize(width, height, profile) {
      const aspect = width / Math.max(1, height);
      const x = Math.round(Math.min(profile.reflections, profile.reflections * aspect));
      const y = Math.round(Math.min(profile.reflections, profile.reflections / aspect));
      target.setSize(Math.max(64, x), Math.max(64, y));
      uniforms.mirrored.value = 0;
      last = -Infinity;
      delay = profile.reflectionDelay;
    },
  };
}

import * as T from 'three';

const waterFragment = `
varying vec3 worldPoint;
uniform float elapsed, precipitation, night, fogStrength;
uniform vec3 sunDirection, waterSky, horizon;
uniform sampler2D waterDepth, reflectionMap;
uniform float reflectionReady;

float waveHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float waveNoise(vec2 p){
  vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(waveHash(i),waveHash(i+vec2(1.,0.)),f.x),
    mix(waveHash(i+vec2(0.,1.)),waveHash(i+1.),f.x),f.y);
}
vec2 environmentUV(vec3 direction){
  return vec2(atan(direction.z,direction.x)*.159154943+.5,asin(clamp(direction.y,-1.,1.))*.318309886+.5);
}
void main() {
  vec2 p=worldPoint.xz;
  float depth=(texture2D(waterDepth,p/320.+.5).r-.5)*20.;
  if(depth < -.10) discard;
  depth=max(0.,depth);
  float a=dot(p,vec2(.86,.51)) + elapsed*1.31;
  float b=dot(p,vec2(-.24,1.58)) - elapsed*1.1;
  float c=dot(p,vec2(2.27,-3.18)) + elapsed*2.86;
  float wind=1.+precipitation*.57;
  vec3 normal=normalize(vec3(wind*(cos(a)*.038+cos(b)*.036+sin(c)*.015), 1.,
    wind*(sin(a)*.035+sin(b)*.041+cos(c)*.017)));
  vec3 viewDir=normalize(cameraPosition-worldPoint);
  vec3 reflected=reflect(-viewDir,normal);
  float cosView=max(dot(viewDir,normal),0.);
  float fresnel=.0204+.9796*pow(1.-cosView,5.);
  float roughGlint=mix(171.,72.,precipitation);
  float glint=pow(max(0.,dot(reflected,sunDirection)),roughGlint)*(1.-night)*1.36;
  vec3 env=waterSky*mix(.81,1.22,max(0.,reflected.y));
  if(reflectionReady>.5){
    vec3 hdr=texture2D(reflectionMap,environmentUV(normalize(reflected+vec3(0.,.14,0.)))).rgb;
    env=mix(env, min(vec3(1.8),hdr)*(.59-night*.41),.36);
  }
  float waterPath=depth/(.44+.56*cosView);
  vec3 transmittance=exp(-waterPath*vec3(.68,.28,.22));
  vec3 shallow=vec3(.14,.29,.20)*(.94+.10*cos(a+b));
  vec3 deep=vec3(.024,.141,.138)*(1.-night*.66);
  vec3 water=mix(deep,shallow,transmittance);
  vec3 color=mix(water,env,fresnel)+glint*vec3(1.,.78,.47);
  float edge=1.-smoothstep(.18,.86,depth);
  float swash=waveNoise(p*1.16+vec2(elapsed*.39,-elapsed*.29));
  float foam=edge*smoothstep(.60,.81,swash+.12*sin(a+b));
  foam+=edge*.23*(1.-smoothstep(.04,.23,depth))*(.65+.35*sin(a-c));
  color=mix(color,vec3(.69,.77,.68)*(1.-night*.63),clamp(foam,0.,.79));
  float distanceToEye=length(cameraPosition-worldPoint);
  float fog=1.-exp(-pow(distanceToEye*fogStrength,2.));
  color=mix(color,horizon,fog);
  float opacity=clamp(.22+.72*(1.-exp(-waterPath*.78))+fresnel*.33+foam*.56,.16,1.);
  gl_FragColor=vec4(color,opacity);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function waterSurface(scene, depthTexture, sun) {
  const uniforms = {
    elapsed: { value: 0 }, waterDepth: { value: depthTexture }, sunDirection: { value: sun },
    precipitation: { value: 0 }, night: { value: 0 }, waterSky: { value: new T.Color(0x79a6b7) },
    horizon: { value: scene.fog.color }, fogStrength: { value: .002 }, reflectionMap: { value: depthTexture },
    reflectionReady: { value: 0 },
  };
  const material = new T.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false,
    vertexShader: `
      varying vec3 worldPoint;
      void main() {
        worldPoint=(modelMatrix*vec4(position,1.)).xyz;
        gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);
      }`,
    fragmentShader: waterFragment,
  });
  return { material, uniforms };
}

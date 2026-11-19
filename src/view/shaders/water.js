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
  vec2 along=normalize(vec2(.84,.53)), crosswind=normalize(vec2(-.36,.93));
  float shear=waveNoise(p*.31+vec2(-elapsed*.25,elapsed*.16))-.5;
  float a=dot(p,along)*1.10+elapsed*1.10+shear*.79;
  float b=dot(p,crosswind)*1.70-elapsed*.82+shear*.46;
  float c=dot(p,along*.62+crosswind*.71)*4.25+elapsed*2.76;
  float wind=1.+precipitation*.46;
  vec2 ripple=along*(cos(a)*.044+sin(c)*.012)+crosswind*(cos(b)*.039+cos(c)*.011);
  vec3 normal=normalize(vec3(wind*ripple.x,1.,wind*ripple.y));
  vec3 viewDir=normalize(cameraPosition-worldPoint);
  vec3 reflected=reflect(-viewDir,normal);
  float cosView=max(dot(viewDir,normal),0.);
  float fresnel=.0204+.9796*pow(1.-cosView,5.);
  float solidAngle=max(0.,dot(reflected,sunDirection));
  float glint=(pow(solidAngle,mix(290.,119.,precipitation))*1.27+pow(solidAngle,35.)*.081)*(1.-night*.97);
  vec3 env=waterSky*mix(.81,1.22,max(0.,reflected.y));
  if(reflectionReady>.5){
    vec3 hdr=texture2D(reflectionMap,environmentUV(normalize(reflected+vec3(0.,.14,0.)))).rgb;
    env=mix(env, min(vec3(1.5),hdr)*(.60-night*.41),.28);
  }
  float waterPath=depth/(.44+.56*cosView);
  vec3 transmittance=exp(-waterPath*vec3(.68,.28,.22));
  vec3 shallow=vec3(.14,.29,.20)*(.94+.10*cos(a+b));
  vec3 deep=vec3(.024,.141,.138)*(1.-night*.66);
  vec3 water=mix(deep,shallow,transmittance);
  vec3 color=mix(water,env,fresnel)+glint*vec3(1.,.78,.47);
  float edge=1.-smoothstep(.13,.93,depth);
  float swirl=waveNoise(p*.64+along*elapsed*.19)+.33*waveNoise(p*1.47-crosswind*elapsed*.13);
  float surge=.10*sin(a*.48+b*.44);
  float seam=exp(-pow((depth-.115-surge)*8.1,2.));
  float foam=seam*smoothstep(.44,.83,swirl)*.67+edge*smoothstep(.73,1.09,swirl+surge)*.38;
  color=mix(color,vec3(.69,.74,.65)*(1.-night*.72),clamp(foam,0.,.72));
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

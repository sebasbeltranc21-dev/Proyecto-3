import * as T from 'three';

// 2D gradient Perlin with three decorrelated octaves for advected density.
const density = `
vec2 ghash(vec2 p){
  return -1.+2.*fract(sin(vec2(dot(p,vec2(127.1,311.7)),dot(p,vec2(269.5,183.3))))*43758.5453);
}
float perlin(vec2 p){
  vec2 i=floor(p),f=fract(p),u=f*f*f*(f*(f*6.-15.)+10.);
  return mix(mix(dot(ghash(i),f),dot(ghash(i+vec2(1,0)),f-vec2(1,0)),u.x),
    mix(dot(ghash(i+vec2(0,1)),f-vec2(0,1)),dot(ghash(i+1.),f-1.),u.x),u.y);
}
float fbm(vec2 p){
  return perlin(p)*.59+perlin(mat2(.83,-.56,.56,.83)*p*2.07+4.7)*.27+perlin(p*4.14-8.3)*.14;
}
`;

const spriteVertex = `
attribute vec3 aOrigin;
attribute vec4 aFire;
uniform float clock, wind;
varying vec2 vUV;
varying vec3 vFire;
varying float vDepth;
void main(){
  vUV=uv;
  float seed=aFire.x, power=aFire.y, width=aFire.z, height=aFire.w;
  vec3 root=aOrigin;
  vec3 up=(viewMatrix*vec4(0.,1.,0.,0.)).xyz;
  vec3 local;
  #ifdef SMOKE
    float age=fract(clock*(.095+fract(seed*.41)*.071)+seed);
    float lift=age*height*(.99+age*.69);
    root+=vec3(age*age*wind*10.+sin(age*4.+seed*9.)*age*1.8,height*.34+lift,
      age*wind*2.9+cos(age*3.8+seed*4.)*age*1.6);
    float span=width*(.48+age*1.85);
    float angle=seed*7.8+age*.52;
    vec2 offset=mat2(cos(angle),-sin(angle),sin(angle),cos(angle))*(position.xy*span);
    local=vec3(offset.x,offset.y*1.19,0.);
    vFire=vec3(seed,power,age);
  #else
    float twitch=.87+.13*sin(clock*7.9+seed*11.)+.07*sin(clock*14.7+seed*17.);
    float skew=sin(clock*2.4+seed*8.)*.29+wind*(.49+fract(seed*.71)*.27);
    local=vec3(position.x*width+uv.y*uv.y*skew*width,0.,0.)+up*uv.y*height*twitch;
    vFire=vec3(seed,power,twitch);
  #endif
  vec4 eye=viewMatrix*vec4(root,1.);
  eye.xyz+=local;
  vDepth=-eye.z;
  gl_Position=projectionMatrix*eye;
}
`;

const flameFragment = `
uniform float clock, fogDensity;
varying vec2 vUV;
varying vec3 vFire;
varying float vDepth;
${density}
void main(){
  float y=vUV.y;
  float seed=vFire.x;
  vec2 p=vec2((vUV.x-.5)*3.05,y*3.37-clock*(2.48+fract(seed*.39)));
  p+=vec2(seed*4.9,seed*7.1);
  float coarse=fbm(p);
  float filament=fbm(p*vec2(1.20,1.70)+vec2(coarse*.72,-clock*.29));
  float center=abs(vUV.x-.5+(coarse*.38+filament*.115)*(.21+y));
  float taper=.385*pow(max(0.,1.-y),.63);
  float tongue=taper-center+coarse*(.18+y*.47)+filament*.18;
  float tip=y+coarse*.47+filament*.27;
  float shape=smoothstep(-.043,.128,tongue)*(1.-smoothstep(.67,1.004,tip));
  float baseHeight=.034+fbm(vec2(vUV.x*8.1+seed,clock*.91))*.13+center*.15;
  float base=smoothstep(-.028,.158,y-baseHeight);
  float rim=smoothstep(0.,.125,vUV.x)*smoothstep(0.,.125,1.-vUV.x);
  float opacity=shape*rim*base*mix(.47,.81,vFire.y);
  if(opacity<.012) discard;
  float warmth=clamp(.16+tongue*1.85-y*.42+filament*.42,0.,1.);
  vec3 color=mix(vec3(.31,.005,.001),vec3(2.26,.158,.009),smoothstep(.04,.55,warmth));
  color=mix(color,vec3(3.8,1.21,.055),smoothstep(.38,.83,warmth));
  float hot=exp(-pow(center/max(.047,.11-y*.10),2.))*pow(max(0.,1.-y),2.55);
  hot*=smoothstep(-.21,.24,coarse+filament*.66+.105);
  color=mix(color,vec3(5.08,4.05,2.02),hot*.89);
  float fog=exp(-pow(vDepth*fogDensity,2.));
  gl_FragColor=vec4(color*(.56+.32*vFire.y),opacity*fog);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const smokeFragment = `
uniform float clock, fogDensity;
uniform vec3 fogTint;
varying vec2 vUV;
varying vec3 vFire;
varying float vDepth;
${density}
void main(){
  vec2 circle=vUV*2.-1.;
  float age=vFire.z;
  vec2 noiseUV=vUV*4.25+vFire.x*4.3-vec2(clock*.096,clock*.18);
  float textureCloud=fbm(noiseUV+vec2(fbm(noiseUV+.8),fbm(noiseUV-3.7))*.92);
  float outline=1.-smoothstep(.24,.985,length(circle)+textureCloud*.42);
  float pockets=smoothstep(-.29,.16,textureCloud);
  float life=smoothstep(0.,.125,age)*(1.-smoothstep(.43,1.,age));
  float opacity=outline*pockets*life*(.40+.31*vFire.y);
  if(opacity<.012) discard;
  vec3 soot=mix(vec3(.021,.017,.015),vec3(.125,.122,.116),age+textureCloud*.16);
  soot+=vec3(.092,.023,.003)*max(0.,.54-age)*vFire.y;
  float fog=1.-exp(-pow(vDepth*fogDensity,2.));
  gl_FragColor=vec4(mix(soot,fogTint,fog*.78),opacity*(1.-fog*.43));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const emberVertex = `
attribute vec3 aOrigin;
attribute vec4 aFire;
uniform float clock, wind;
varying vec2 vSpark;
void main(){
  float seed=aFire.x;
  float phase=fract(clock*(.38+fract(seed*1.71)*.58)+seed);
  float bend=phase*phase;
  float beat=clock*(3.+fract(seed*8.)*4.)+seed*31.;
  vec3 rise=vec3(bend*(wind*3.8+sin(seed*18.)*2.)+sin(beat)*phase*.65,
    .16+phase*aFire.w*(1.46-.36*phase), bend*cos(seed*12.)*3.+cos(beat*.7)*phase*.43);
  vec4 eye=viewMatrix*vec4(aOrigin+rise,1.);
  vSpark=vec2(phase,aFire.y);
  gl_Position=projectionMatrix*eye;
  gl_PointSize=clamp((106.+fract(seed*2.6)*76.)/max(1.,-eye.z),1.0,4.2);
}
`;

const emberFragment = `
varying vec2 vSpark;
void main(){
  vec2 p=(gl_PointCoord-.5)*vec2(1.38,1.);
  float core=1.-smoothstep(.07,.49,length(p));
  float fade=smoothstep(0.,.13,vSpark.x)*(1.-smoothstep(.50,1.,vSpark.x));
  vec3 color=mix(vec3(3.7,2.44,.34),vec3(1.65,.092,.005),vSpark.x);
  gl_FragColor=vec4(color,core*fade*(.69+vSpark.y*.28));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function fireMaterial(kind, uniforms) {
  const smoke = kind === 'smoke', spark = kind === 'embers';
  return new T.ShaderMaterial({
    defines: smoke ? { SMOKE: 1 } : {},
    uniforms,
    vertexShader: spark ? emberVertex : spriteVertex,
    fragmentShader: spark ? emberFragment : smoke ? smokeFragment : flameFragment,
    depthWrite: false, transparent: true,
    blending: smoke ? T.NormalBlending : T.AdditiveBlending,
  });
}

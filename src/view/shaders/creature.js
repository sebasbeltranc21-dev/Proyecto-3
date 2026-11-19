const form = `
attribute vec4 aMotion;
attribute vec4 aExpression;
attribute vec4 aCombat;
uniform float bodyTime, kind;

float neckWeight(vec3 p){
  float throat=mix(.40,.48,kind);
  float shoulder=mix(.86,.63,kind);
  return smoothstep(throat,throat+.22,p.z)*smoothstep(shoulder,shoulder+.27,p.y);
}
float neckPitch(vec3 p){
  float pace=aMotion.x, phase=aMotion.w;
  return neckWeight(p)*(mix(1.49,1.19,kind)*aExpression.z-.55*aExpression.w+.32*aMotion.z+
    sin(phase*2.+.7)*pace*mix(.025,.13,aExpression.y) + .24*aCombat.x - .36*aCombat.y - .23*aCombat.z + .44*aCombat.w);
}
vec2 rotatePitch(vec2 point,float angle){
  float c=cos(angle),s=sin(angle);
  return mat2(c,s,-s,c)*point;
}
vec2 hoofPath(float phase,float offset,float stance){
  float t=fract(phase+offset);
  if(t<stance) return vec2(.50-t/stance,0.);
  float swing=(t-stance)/(1.-stance);
  return vec2(mix(-.50,.50,swing*swing*(3.-2.*swing)),pow(max(0.,sin(swing*3.14159265)),1.25));
}
vec3 poseAnimal(vec3 p){
  float limb=1.-smoothstep(.19,mix(.83,.68,kind),p.y);
  bool left=p.x<0.;
  bool fore=p.z>.02;
  float walkOffset=fore ? (left ? .00 : .50) : (left ? .75 : .25);
  float trotOffset=(left==fore) ? 0. : .50;
  float runOffset=fore ? (left ? .00 : .13) : (left ? .55 : .66);
  float cycle=aMotion.w, phase=cycle/6.2831853;
  float stride=aMotion.x, crouch=aMotion.y, strike=aMotion.z;
  float run=aExpression.y, trot=aExpression.x;
  vec2 walk=hoofPath(phase,walkOffset,.65)*vec2(.39,.105);
  vec2 diagonal=hoofPath(phase,trotOffset,.53)*vec2(.54,.18);
  vec2 gallop=hoofPath(phase,runOffset,.40)*vec2(.73,.30);
  vec2 steps=walk*(1.-run-trot)+diagonal*trot+gallop*run;
  float head=neckWeight(p);
  vec2 neckAnchor=vec2(mix(1.02,.82,kind),mix(.36,.48,kind));
  p.yz=neckAnchor+rotatePitch(p.yz-neckAnchor,neckPitch(p));
  p.y-=head*aExpression.z*mix(.22,.16,kind);
  p.z+=steps.x*limb*stride*(1.-crouch*.42);
  p.y+=steps.y*limb*stride*(1.-crouch*.40);
  p.y-=crouch*.21*smoothstep(.04,.87,p.y);
  float torso=1.-limb;
  float breath=sin(bodyTime*2.8+cycle*.07)*.011*(1.-stride*.82);
  p.y+=(sin(cycle*2.)*.028+sin(cycle)*run*.061)*torso*stride+breath*torso;
  p.z+=head*strike*.27;
  p.y-=head*strike*.12;
  float tail=1.-smoothstep(mix(-.88,-1.32,kind),mix(-.69,-.68,kind),p.z);
  p.x+=sin(cycle*.69+bodyTime*1.7)*tail*(.027+stride*.082)*(1.-aCombat.w);
  float prep=aCombat.x, lunge=aCombat.y, flinch=aCombat.z, down=aCombat.w;
  float frontChest=smoothstep(-.22,.54,p.z);
  p.y-=prep*(.12*frontChest+.05)*(1.-limb*.58);
  p.y+=lunge*(.14*frontChest+.04)*smoothstep(.04,.61,p.y);
  p.z+=limb*lunge*(fore ? .23 : -.20);
  p.y+=limb*(flinch*(fore ? .20 : .13)+down*.37);
  p.z+=limb*down*(fore ? -.19 : .23);
  p.x+=flinch*(fore ? .10 : -.047)*(1.-limb);
  p.z+=head*lunge*.12;
  p.y-=head*down*.20;
  return p;
}
`;

export function animateCreature(material, time, species, eyes, depth = false) {
  material.onBeforeCompile = shader => {
    shader.uniforms.bodyTime = time;
    shader.uniforms.kind = species;
    shader.vertexShader = form + (depth ? '' : 'varying vec3 vCoat;\n') + shader.vertexShader
      .replace('#include <begin_vertex>',
        'vec3 transformed = poseAnimal(position);' + (depth ? '' : ' vCoat = position;'))
      .replace('#include <beginnormal_vertex>', depth ? '#include <beginnormal_vertex>' : `
        #include <beginnormal_vertex>
        objectNormal.yz=rotatePitch(objectNormal.yz,neckPitch(position));
      `);
    if (depth) return;
    shader.uniforms.eyesNight = eyes.night;
    shader.uniforms.eyesMask = eyes.mask;
    shader.fragmentShader = 'varying vec3 vCoat; uniform float kind, eyesNight, eyesMask;\n' + shader.fragmentShader.replace('#include <color_fragment>', `
      #include <color_fragment>
      float flow=sin(vCoat.z*13.+sin(vCoat.y*10.))*3.8;
      float fibres=sin(vCoat.x*197.+vCoat.y*98.+vCoat.z*37.+flow);
      float grain=sin(vCoat.x*111.+vCoat.y*157.+vCoat.z*198.);
      float filtered=1.-smoothstep(.18,1.05,length(fwidth(vCoat))*90.);
      diffuseColor.rgb *= 1.+(.14*fibres+.075*grain)*filtered;
    `).replace('#include <emissivemap_fragment>', `
      #include <emissivemap_fragment>
      vec3 eyePoint=(vec3(abs(vCoat.x),vCoat.yz)-vec3(.152,1.171,.905))/vec3(.042,.034,.054);
      float iris=(1.-smoothstep(.52,1.26,length(eyePoint)))*kind*smoothstep(.63,.96,eyesNight);
      vec3 eyeGlow=vec3(2.8,1.31,.28)*iris;
      totalEmissiveRadiance+=eyeGlow;
    `).replace('#include <tonemapping_fragment>', `
      if (eyesMask>.5) gl_FragColor=vec4(eyeGlow,1.);
      #include <tonemapping_fragment>
    `);
  };
  material.customProgramCacheKey = () => depth ? 'animal-depth-5' : 'animal-coat-6';
}

const form = `
attribute vec4 aMotion;
uniform float bodyTime;
vec3 poseCoat(vec3 p){
  float leg=(1.-smoothstep(.17,.81,p.y));
  float front=smoothstep(-.08,.20,p.z);
  float diagonal=(p.x<0. ? -1. : 1.)*(front>.5 ? 1. : -1.);
  float stride=aMotion.x;
  float crouch=aMotion.y;
  float attack=aMotion.z;
  float cycle=aMotion.w;
  float swing=sin(cycle+diagonal*1.5708);
  float lift=max(0.,cos(cycle+diagonal*1.5708));
  float head=smoothstep(.40,.90,p.z)*smoothstep(.54,.97,p.y);
  p.z+=swing*stride*leg*.28;
  p.y+=lift*leg*stride*.105;
  p.y-=crouch*.29*smoothstep(.03,.82,p.y);
  p.y+=sin(cycle*2.)*stride*.031*(1.-leg);
  p.y+=sin(bodyTime*2.+cycle)*.013*(1.-leg)*(1.-stride*.62);
  p.z+=head*attack*.19;
  p.y-=head*attack*.17;
  p.x+=sin(cycle*.62)*(1.-smoothstep(-1.28,-.66,p.z))*.092;
  return p;
}
`;

export function animateCreature(material, time, depth = false) {
  material.onBeforeCompile = shader => {
    shader.uniforms.bodyTime = time;
    shader.vertexShader = form + (depth ? '' : 'varying vec3 vCoat;\n') +
      shader.vertexShader.replace('#include <begin_vertex>',
        'vec3 transformed = poseCoat(position);' + (depth ? '' : ' vCoat = position;'));
    if (depth) return;
    shader.fragmentShader = 'varying vec3 vCoat;\n' + shader.fragmentShader.replace('#include <color_fragment>', `
      #include <color_fragment>
      float fibres=sin(vCoat.x*224.+vCoat.z*44.+sin(vCoat.y*38.)*3.);
      float grain=sin(vCoat.x*107.+vCoat.y*157.+vCoat.z*198.);
      float filtered=1.-smoothstep(.2,1.15,length(fwidth(vCoat))*90.);
      diffuseColor.rgb *= 1. + (.17*fibres+.061*grain)*filtered;
    `);
  };
  material.customProgramCacheKey = () => depth ? 'animal-depth-2' : 'animal-coat-2';
}

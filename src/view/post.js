import * as T from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const colorGrade = {
  uniforms: {
    tDiffuse: { value: null }, glow: { value: null }, mood: { value: new T.Color() },
    saturation: { value: 1 }, contrast: { value: 1 }, lift: { value: .0 },
  },
  vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
  fragmentShader: `
    varying vec2 vUv;
    uniform sampler2D tDiffuse, glow;
    uniform vec3 mood;
    uniform float saturation, contrast, lift;
    void main(){
      vec3 col=texture2D(tDiffuse,vUv).rgb + texture2D(glow,vUv).rgb*.27;
      float luma=dot(col,vec3(.2126,.7152,.0722));
      col=mix(vec3(luma),col,saturation);
      col=max(vec3(0.),(col-.18)*contrast+.18);
      col*=mood;
      col+=lift*(1.-smoothstep(.02,.45,luma));
      gl_FragColor=vec4(col,1.);
    }`,
};

const grading = {
  clear: [1.04, 1.012, .976, 1.025, 1.022, .003],
  rain: [.91, 1.01, 1.075, .83, .99, .012],
  fog: [.95, 1.028, 1.026, .72, .94, .017],
  heat: [1.12, 1.001, .842, 1.04, 1.053, .003],
};

export function makePost(renderer, scene, camera, skyUniforms) {
  const bloom = new EffectComposer(renderer);
  bloom.renderToScreen = false;
  bloom.addPass(new RenderPass(scene, camera, null, 0x000000, 1));
  bloom.addPass(new UnrealBloomPass(new T.Vector2(1, 1), .44, .40, .89));
  const beauty = new EffectComposer(renderer);
  const render = new RenderPass(scene, camera);
  const ao = new SSAOPass(scene, camera, 1, 1, 12);
  ao.kernelRadius = 7;
  ao.minDistance = .0015;
  ao.maxDistance = .026;
  const gradingPass = new ShaderPass(colorGrade);
  beauty.addPass(render);
  beauty.addPass(ao);
  beauty.addPass(gradingPass);
  beauty.addPass(new OutputPass());
  const mask = new T.MeshBasicMaterial({ color: 0, side: T.DoubleSide, toneMapped: false });
  const touched = [];
  const rgba = gradingPass.uniforms;
  function bloomMask(object) {
    if (!object.visible || object.userData.bloom) return;
    if (object.isMesh && !object.material.transparent) {
      touched.push([object, object.material]);
      object.material = mask;
    } else if (object.isMesh || object.isLine || object.isPoints) {
      touched.push([object, null]);
      object.visible = false;
    }
  }
  return {
    resize(width, height, ratio) {
      beauty.setPixelRatio(ratio);
      beauty.setSize(width, height);
      bloom.setPixelRatio(Math.min(.69, ratio * .45));
      bloom.setSize(width, height);
      ao.setSize(Math.max(1, Math.floor(width * ratio * .67)), Math.max(1, Math.floor(height * ratio * .67)));
    },
    render(dt, weather, night, profile) {
      const shadow = renderer.shadowMap.needsUpdate;
      renderer.shadowMap.needsUpdate = false;
      skyUniforms.emitOnly.value = 1;
      scene.traverse(bloomMask);
      try {
        bloom.render(dt);
      } finally {
        for (const [object, material] of touched) {
          if (material) object.material = material;
          else object.visible = true;
        }
        touched.length = 0;
        renderer.shadowMap.needsUpdate = shadow;
        skyUniforms.emitOnly.value = 0;
      }
      const [r, g, b, saturation, contrast, lift] = grading[weather];
      rgba.mood.value.setRGB(r * (1 - night * .17), g * (1 - night * .07), b * (1 + night * .11));
      rgba.saturation.value = saturation * (1 - night * .16);
      rgba.contrast.value = contrast;
      rgba.lift.value = lift + night * .004;
      rgba.glow.value = bloom.readBuffer.texture;
      ao.enabled = profile.ao;
      beauty.render(dt);
    },
  };
}

import * as T from 'three';
import { CSM } from 'three/addons/csm/CSM.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { asset } from './assets.js';

export function makeLighting(scene, camera, renderer) {
  const sky = new Sky();
  sky.scale.setScalar(850);
  sky.frustumCulled = false;
  sky.renderOrder = -100;
  const skyUniforms = sky.material.uniforms;
  skyUniforms.rayleigh.value = 2.25;
  skyUniforms.mieDirectionalG.value = .82;
  skyUniforms.cloudElevation.value = .59;
  skyUniforms.cloudScale.value = .00079;
  skyUniforms.cloudSpeed.value = .000010;
  skyUniforms.skyNight = { value: 0 };
  skyUniforms.emitOnly = { value: 0 };
  sky.material.fragmentShader = 'uniform float skyNight, emitOnly;\n' + sky.material.fragmentShader.replace(
    '#include <tonemapping_fragment>',
    `
    float star=step(.99975,hash(floor(direction.xz*660.)))*smoothstep(.29,.69,direction.y);
    vec3 nocturne=mix(vec3(.019,.033,.048),vec3(.003,.010,.029),max(0.,direction.y));
    vec3 aerial=mix(vec3(.57,.67,.68),vec3(.08,.231,.37),smoothstep(0.,.54,max(0.,direction.y)));
    vec3 scattered=gl_FragColor.rgb/(1.+gl_FragColor.rgb*2.25);
    vec3 daylight=aerial*.56+scattered*.59+vec3(1.8,1.23,.68)*sundisk;
    gl_FragColor.rgb=mix(daylight,nocturne+star*.24,skyNight);
    if(emitOnly>.5) gl_FragColor=vec4(vec3(4.2,2.51,1.22)*sundisk*(1.-skyNight),1.);
    #include <tonemapping_fragment>
    `);
  sky.userData.bloom = true;
  const fill = new T.HemisphereLight(0xcbe5f2, 0x62714a, .98);
  const single = new T.DirectionalLight(0xffe1bd, 2.17);
  scene.add(sky, fill, single, single.target);
  const cascades = new CSM({
    parent: scene, camera, cascades: 3, mode: 'practical', maxFar: 338,
    shadowMapSize: 768, shadowBias: -.00021, lightNear: .1, lightFar: 760, lightMargin: 160,
  });
  cascades.fade = true;
  const materials = new WeakSet();
  const nightFog = new T.Color(0x152633);
  const normalSun = new T.Color();
  renderer.shadowMap.type = T.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  function register(material) {
    if (materials.has(material)) return;
    materials.add(material);
    const previous = material.onBeforeCompile;
    cascades.setupMaterial(material);
    const setup = material.onBeforeCompile;
    material.onBeforeCompile = function (shader, driver) {
      setup.call(this, shader, driver);
      previous.call(this, shader, driver);
    };
  }
  function quality(profile) {
    renderer.shadowMap.enabled = profile.shadows > 0;
    renderer.shadowMap.needsUpdate = Boolean(profile.shadows);
    single.visible = !profile.shadows;
    for (const light of cascades.lights) {
      light.visible = profile.shadows > 0;
      const shadow = light.shadow;
      if (profile.shadows && shadow.mapSize.x !== profile.shadows) {
        shadow.map?.dispose();
        shadow.map = null;
        shadow.mapSize.setScalar(profile.shadows);
      }
      shadow.normalBias = .31;
      shadow.radius = 2;
    }
  }
  const environment = new HDRLoader().loadAsync(asset('terrain/forest.hdr')).then(source => {
    source.mapping = T.EquirectangularReflectionMapping;
    const pmrem = new T.PMREMGenerator(renderer);
    const map = pmrem.fromEquirectangular(source);
    pmrem.dispose();
    scene.environment = map.texture;
    return source;
  });
  return {
    sky, skyUniforms, cascades, register, quality, environment,
    update(elapsed, sun, night, weather, preset) {
      skyUniforms.sunPosition.value.copy(sun).multiplyScalar(1000);
      skyUniforms.skyNight.value = night;
      skyUniforms.time.value = elapsed;
      skyUniforms.turbidity.value = weather === 'clear' ? 2.9 : weather === 'heat' ? 6.0 : 9.4;
      skyUniforms.mieCoefficient.value = weather === 'clear' ? .0042 : .009;
      skyUniforms.cloudDensity.value = weather === 'rain' ? .80 : weather === 'fog' ? .62 : .32;
      skyUniforms.cloudCoverage.value = weather === 'rain' ? .86 : weather === 'fog' ? .71 : .40;
      const power = (2.95 - night * 2.76) * preset.light;
      normalSun.setHex(sun.y < .42 ? 0xffd0a0 : 0xffebd7);
      single.position.copy(sun).multiplyScalar(215);
      single.intensity = power;
      single.color.copy(normalSun);
      cascades.lightDirection.copy(sun).negate();
      for (const light of cascades.lights) {
        light.intensity = power;
        light.color.copy(normalSun);
      }
      if (renderer.shadowMap.enabled) cascades.update();
      fill.intensity = (.85 - night * .38) * (weather === 'fog' ? 1.25 : 1);
      scene.environmentIntensity = (.46 - night * .34) * (weather === 'rain' ? .71 : 1);
      scene.fog.color.setHex(preset.color).lerp(nightFog, night * .88);
      scene.fog.density = preset.fog + night * .001;
    },
  };
}

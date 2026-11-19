import * as T from 'three';
import { CSM } from 'three/addons/csm/CSM.js';
import { Sky } from 'three/addons/objects/Sky.js';

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
  skyUniforms.horizonTint = { value: scene.fog.color };
  sky.material.fragmentShader = 'uniform float skyNight, emitOnly; uniform vec3 horizonTint;\n' + sky.material.fragmentShader.replace(
    '#include <tonemapping_fragment>',
    `
    float star=step(.99975,hash(floor(direction.xz*660.)))*smoothstep(.29,.69,direction.y);
    vec3 nocturne=mix(vec3(.019,.033,.048),vec3(.003,.010,.029),max(0.,direction.y));
    vec3 aerial=mix(vec3(.57,.67,.68),vec3(.08,.231,.37),smoothstep(0.,.54,max(0.,direction.y)));
    vec3 scattered=gl_FragColor.rgb/(1.+gl_FragColor.rgb*2.25);
    vec3 daylight=aerial*.56+scattered*.59+vec3(1.8,1.23,.68)*sundisk;
    vec3 skyLight=mix(daylight,nocturne+star*.24,skyNight);
    float horizonBand=(1.-smoothstep(.01,.43,max(0.,direction.y)))*.80;
    gl_FragColor.rgb=mix(skyLight,horizonTint,horizonBand);
    gl_FragColor.rgb+=vec3(.60,.38,.17)*sundisk*(1.-skyNight);
    if(emitOnly>.5) gl_FragColor=vec4(vec3(4.2,2.51,1.22)*sundisk*(1.-skyNight),1.);
    #include <tonemapping_fragment>
    `);
  sky.userData.bloom = true;
  const fill = new T.HemisphereLight(0xcbe5f2, 0x62714a, .98);
  const single = new T.DirectionalLight(0xffe1bd, 2.17);
  scene.add(sky, fill, single, single.target);
  const cascades = new CSM({
    parent: scene, camera, cascades: 3, mode: 'practical', maxFar: 338,
    shadowMapSize: 2048, shadowBias: -.00012, lightNear: .1, lightFar: 760, lightMargin: 160,
  });
  cascades.fade = true;
  const materials = new WeakSet();
  const nightFog = new T.Color(0x152633);
  const lowSunHaze = new T.Color(0xbba383);
  const normalSun = new T.Color();
  // r183 applies soft filtering through PCFShadowMap.
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
      shadow.normalBias = .22;
      shadow.radius = profile.shadows >= 2048 ? 2.38 : 1.95;
    }
  }
  const pmrem = renderer.extensions.has('EXT_color_buffer_float') ? new T.PMREMGenerator(renderer) : null;
  const enclosure = new T.Scene();
  const iblSky = new T.Mesh(sky.geometry, sky.material);
  iblSky.scale.copy(sky.scale);
  iblSky.frustumCulled = false;
  enclosure.add(iblSky);
  let environment;
  let lastWeather, lastChrono, lastAltitude, lastSize, lastSample = -Infinity;
  const lastSun = new T.Vector3();
  function sampleSky(elapsed, sun, night, weather, profile) {
    if (!pmrem) return;
    const changed = !environment || lastWeather !== weather || lastSize !== profile.iblSize ||
      lastSun.dot(sun) < .9985 || Math.abs(lastChrono - night) > .075 || Math.abs(lastAltitude - sun.y) > .041;
    if (!changed || elapsed - lastSample < .9) return;
    const next = pmrem.fromScene(enclosure, .035, .5, 1800, { size: profile.iblSize });
    const previous = environment;
    environment = next;
    scene.environment = next.texture;
    previous?.dispose();
    lastWeather = weather;
    lastChrono = night;
    lastAltitude = sun.y;
    lastSize = profile.iblSize;
    lastSun.copy(sun);
    lastSample = elapsed;
  }
  return {
    sky, skyUniforms, cascades, register, quality,
    update(elapsed, sun, night, weather, preset, profile) {
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
      scene.environmentIntensity = (.63 - night * .47) * (weather === 'rain' ? .71 : 1);
      const sunHaze = weather === 'clear' ? Math.max(0, .37 - sun.y) * (1 - night) : 0;
      scene.fog.color.setHex(preset.color).lerp(lowSunHaze, sunHaze).lerp(nightFog, night * .88);
      scene.fog.density = preset.fog + night * .001;
      sampleSky(elapsed, sun, night, weather, profile);
    },
  };
}

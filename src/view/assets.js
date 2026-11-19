import { LinearFilter, LinearMipmapLinearFilter, RepeatWrapping, SRGBColorSpace } from 'three';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const files = import.meta.glob('../assets/**/*.{glb,ktx2,hdr}', {
  eager: true, query: '?url', import: 'default',
});

export function asset(path) {
  const url = files['../assets/' + path];
  if (!url) throw Error('Missing asset ' + path);
  return url;
}

export function createAssets(renderer) {
  const base = import.meta.env.BASE_URL + 'codecs/';
  const draco = new DRACOLoader().setDecoderPath(base + 'draco/').setDecoderConfig({ type: 'wasm' }).setWorkerLimit(2);
  const ktx2 = new KTX2Loader().setTranscoderPath(base + 'basis/').setWorkerLimit(2).detectSupport(renderer);
  const gltf = new GLTFLoader().setDRACOLoader(draco).setMeshoptDecoder(MeshoptDecoder).setKTX2Loader(ktx2);
  const limit = renderer.capabilities.getMaxAnisotropy();
  return {
    async model(path) {
      return gltf.loadAsync(asset('fauna/' + path + '.glb'));
    },
    async texture(path, color = false) {
      const map = await ktx2.loadAsync(asset('terrain/' + path + '.ktx2'));
      map.wrapS = map.wrapT = RepeatWrapping;
      map.magFilter = LinearFilter;
      map.minFilter = map.mipmaps.length > 1 ? LinearMipmapLinearFilter : LinearFilter;
      if (color) map.colorSpace = SRGBColorSpace;
      map.anisotropy = Math.min(4, limit);
      map.needsUpdate = true;
      return map;
    },
  };
}

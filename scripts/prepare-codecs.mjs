import { cp, mkdir } from 'node:fs/promises';

const copies = {
  draco: ['draco_wasm_wrapper.js', 'draco_decoder.wasm'],
  basis: ['basis_transcoder.js', 'basis_transcoder.wasm'],
};

for (const [codec, files] of Object.entries(copies)) {
  const base = codec === 'draco' ? 'draco/gltf' : codec;
  const target = new URL('../public/codecs/' + codec + '/', import.meta.url);
  await mkdir(target, { recursive: true });
  for (const name of files) {
    await cp(new URL('../node_modules/three/examples/jsm/libs/' + base + '/' + name, import.meta.url), new URL(name, target));
  }
}

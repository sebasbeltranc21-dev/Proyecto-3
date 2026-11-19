/**
 * Packs the original sculpts into indexed glTF meshes.
 * Install @gltf-transform/core, @gltf-transform/extensions, @gltf-transform/functions,
 * draco3dgltf and meshoptimizer in an isolated tooling directory.
 */
import { readFile } from 'node:fs/promises';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [source, destination, dependencies = '.'] = process.argv.slice(2);
if (!source || !destination) throw Error('Usage: node pack-fauna.mjs <raw-directory> <glb-directory> [npm-tooling-directory]');

const require = createRequire(resolve(dependencies, 'package.json'));
const load = name => import(pathToFileURL(require.resolve(name)));
const [{ Document, NodeIO }, { ALL_EXTENSIONS }, { draco, meshopt, simplify }, dracoModule, { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier }] =
  await Promise.all(['@gltf-transform/core', '@gltf-transform/extensions', '@gltf-transform/functions', 'draco3dgltf', 'meshoptimizer'].map(load));
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.encoder': await dracoModule.default.createEncoderModule(),
  'draco3d.decoder': await dracoModule.default.createDecoderModule(),
  'meshopt.encoder': MeshoptEncoder,
  'meshopt.decoder': MeshoptDecoder,
});
await Promise.all([MeshoptEncoder.ready, MeshoptSimplifier.ready]);
await mkdir(destination, { recursive: true });

async function readArray(stem, key, Constructor) {
  const bytes = await readFile(resolve(source, stem + '.' + key));
  return new Constructor(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}

for (const name of ['deer', 'wolf']) {
  for (const lod of ['near', 'far']) {
    const stem = name + '-' + lod;
    const doc = new Document();
    const buffer = doc.createBuffer();
    const accessor = async (key, C, type) => doc.createAccessor(key).setBuffer(buffer).setType(type).setArray(await readArray(stem, key, C));
    const primitive = doc.createPrimitive()
      .setAttribute('POSITION', await accessor('positions', Float32Array, 'VEC3'))
      .setAttribute('NORMAL', await accessor('normals', Float32Array, 'VEC3'))
      .setAttribute('COLOR_0', await accessor('colors', Float32Array, 'VEC3'))
      .setIndices(await accessor('indices', Uint32Array, 'SCALAR'));
    primitive.setMaterial(doc.createMaterial('Coat').setRoughnessFactor(.92).setMetallicFactor(0));
    const model = doc.createMesh(stem).addPrimitive(primitive);
    doc.createScene().addChild(doc.createNode(stem).setMesh(model));
    await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: lod === 'near' ? .30 : .26, error: lod === 'near' ? .012 : .043 }));
    await doc.transform(name === 'wolf'
      ? draco({ method: 'edgebreaker', quantizePosition: 13, quantizeNormal: 10, quantizeColor: 8 })
      : meshopt({ encoder: MeshoptEncoder, level: 'high', quantizePosition: 14, quantizeNormal: 10, quantizeColor: 8 }));
    await io.write(resolve(destination, stem + '.glb'), doc);
  }
}

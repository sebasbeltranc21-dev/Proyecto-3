import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const asset = path => readFile(new URL('../src/assets/' + path, import.meta.url));

function manifest(glb) {
  assert.equal(glb.toString('utf8', 0, 4), 'glTF');
  assert.equal(glb.readUInt32LE(4), 2);
  const size = glb.readUInt32LE(12);
  return JSON.parse(glb.toString('utf8', 20, 20 + size));
}

test('published models have distinct codecs and cheaper distant LODs', async () => {
  for (const [name, expected] of [['deer', 'EXT_meshopt_compression'], ['wolf', 'KHR_draco_mesh_compression']]) {
    const [near, far] = await Promise.all(['near', 'far'].map(level => asset('fauna/' + name + '-' + level + '.glb')));
    const vertexCount = glb => glb.accessors[glb.meshes[0].primitives[0].attributes.POSITION].count;
    const nearManifest = manifest(near), farManifest = manifest(far);
    for (const model of [nearManifest, farManifest]) assert.ok(model.extensionsUsed.includes(expected));
    assert.ok(vertexCount(farManifest) < vertexCount(nearManifest) / 2);
    assert.ok(near.byteLength < 65_536);
  }
});

test('the four biomes ship both mipmapped KTX2 channel packs', async () => {
  const magic = Buffer.from('ab4b5458203230bb0d0a1a0a', 'hex');
  for (const color of ['grass', 'sand', 'rock', 'snow']) {
    for (const layer of ['color', 'surface']) {
      const texture = await asset('terrain/' + color + '-' + layer + '.ktx2');
      assert.deepEqual(texture.subarray(0, 12), magic);
      assert.equal(texture.readUInt32LE(20), 256);
      assert.equal(texture.readUInt32LE(24), 256);
      assert.equal(texture.readUInt32LE(40), 9);
      assert.equal(texture.readUInt32LE(44), layer === 'color' ? 1 : 2);
    }
  }
});

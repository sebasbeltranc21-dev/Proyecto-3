"""Resize Poly Haven source images and encode albedo and packed surface KTX2 maps.

Inputs use filenames <asset>-albedo.jpg, -normal.jpg, -rough.jpg and -ao.jpg.
"""
import argparse
from pathlib import Path
import subprocess
import tempfile

from PIL import Image

BIOMES = {'grass': 'leafy_grass', 'rock': 'rock_boulder_dry', 'sand': 'damp_sand', 'snow': 'snow_01'}

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('images', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--basis', default='basisu')
    parser.add_argument('--size', type=int, default=256)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)

    def encode(image, destination, options):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'input.png'
            image.save(path)
            subprocess.run([args.basis, '-file', str(path), '-output_file', str(destination), '-ktx2',
                            '-mipmap', '-no_multithreading', *options], check=True)

    for name, asset in BIOMES.items():
        def texture(kind, mode):
            return Image.open(args.images / f'{asset}-{kind}.jpg').convert(mode).resize(
                (args.size, args.size), Image.Resampling.LANCZOS)

        x, y, _ = texture('normal', 'RGB').split()
        packed = Image.merge('RGBA', (x, y, texture('rough', 'L'), texture('ao', 'L')))
        encode(texture('albedo', 'RGB'), args.output / f'{name}-color.ktx2', ['-q', '161'])
        encode(packed, args.output / f'{name}-surface.ktx2', ['-linear', '-uastc', '-uastc_level', '2', '-uastc_rdo_l', '1.7'])

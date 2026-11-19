"""Bake original, smooth quadruped sculpts into indexed, colored meshes.

Requires numpy and scikit-image. Output feeds the glTF Transform exporter.
"""
import argparse
from pathlib import Path

import numpy as np
from skimage.measure import marching_cubes


def sculpt(wolf, step):
    limit = 1.45 if wolf else 1.76
    axes = [np.arange(a, b, step, dtype=np.float32) for a, b in
            [(-.88, .88), (-.10, limit + .66), (-1.60, 1.49)]]
    x, y, z = np.meshgrid(*axes, indexing='ij', sparse=True)
    field = np.full(tuple(len(axis) for axis in axes), 20, dtype=np.float32)
    closest = field.copy()
    regions = np.zeros(field.shape, dtype=np.uint8)

    def add(distance, blend, region):
        nonlocal field
        nearest = distance < closest
        regions[nearest] = region
        np.minimum(closest, distance, out=closest)
        h = np.maximum(blend - np.abs(field - distance), 0) / blend
        field = np.minimum(field, distance) - h * h * blend * .25

    def ellipsoid(center, radius, slant=0, region=0, blend=.063):
        dx, dy, dz = x - center[0], y - center[1], z - center[2]
        s, c = np.sin(slant), np.cos(slant)
        u, v, w = dx / radius[0], (dy * c - dz * s) / radius[1], (dy * s + dz * c) / radius[2]
        add((np.sqrt(u * u + v * v + w * w) - 1) * min(radius), blend, region)

    def limb(start, end, start_radius, end_radius, region=0, blend=.036):
        a, b = np.array(start), np.array(end)
        axis = b - a
        dx, dy, dz = x - a[0], y - a[1], z - a[2]
        t = np.clip((dx * axis[0] + dy * axis[1] + dz * axis[2]) / (axis @ axis), 0, 1)
        radius = start_radius + (end_radius - start_radius) * t
        add(np.sqrt((dx - t * axis[0]) ** 2 + (dy - t * axis[1]) ** 2 +
                    (dz - t * axis[2]) ** 2) - radius, blend, region)

    if wolf:
        ellipsoid((0, .76, .00), (.246, .267, .647))
        ellipsoid((0, .78, .35), (.26, .306, .39), -.12)
        ellipsoid((0, .76, -.47), (.226, .245, .314), .13)
        ellipsoid((0, .95, .48), (.214, .235, .37), .50, 1)
        ellipsoid((0, 1.12, .77), (.175, .179, .229), .13)
        ellipsoid((0, 1.018, .985), (.112, .091, .224), -.20, 1)
        ellipsoid((0, 1.084, .981), (.115, .093, .225), -.15)
        ellipsoid((0, 1.062, 1.18), (.085, .055, .058), 0, 2, .015)
        limb((0, .76, -.64), (0, .55, -.93), .104, .093)
        limb((0, .55, -.93), (0, .36, -1.31), .093, .027, 1)
    else:
        ellipsoid((0, .96, -.08), (.231, .294, .60))
        ellipsoid((0, 1.00, .34), (.217, .286, .325), .23)
        ellipsoid((0, 1.01, -.50), (.234, .239, .268), -.14)
        ellipsoid((0, 1.22, .432), (.133, .331, .170), -.48, 1)
        ellipsoid((0, 1.48, .58), (.127, .131, .206), .13)
        ellipsoid((0, 1.425, .741), (.091, .075, .170), -.28, 1)
        ellipsoid((0, 1.439, .866), (.076, .049, .053), 0, 2, .014)
        limb((0, 1.075, -.68), (0, .947, -.865), .070, .030, 1)

    for side in (-1, 1):
        if wolf:
            rear = [(side * .155, .72, -.45), (side * .17, .43, -.33),
                    (side * .16, .23, -.59), (side * .16, .09, -.49)]
            front = [(side * .159, .76, .37), (side * .154, .45, .39),
                     (side * .158, .20, .43), (side * .158, .077, .45)]
            thickness = [.133, .077, .041, .036]
            limb((side * .112, 1.223, .747), (side * .144, 1.470, .689), .079, .011, 0, .029)
            ellipsoid((side * .151, 1.171, .902), (.026, .019, .034), 0, 3, .008)
        else:
            rear = [(side * .156, .961, -.48), (side * .164, .626, -.36),
                    (side * .141, .298, -.606), (side * .137, .077, -.518)]
            front = [(side * .159, .898, .374), (side * .139, .529, .356),
                     (side * .125, .22, .38), (side * .119, .071, .416)]
            thickness = [.125, .058, .031, .024]
            limb((side * .089, 1.554, .529), (side * .255, 1.685, .474), .060, .014, 1, .027)
            ellipsoid((side * .109, 1.501, .679), (.022, .018, .031), 0, 3, .009)
            base = (side * .071, 1.576, .543)
            joint = (side * .173, 1.858, .513)
            crown = (side * .278, 2.123, .369)
            limb(base, joint, .039, .030, 4, .022)
            limb(joint, crown, .033, .022, 4, .019)
            limb(crown, (side * .313, 2.20, .236), .024, .009, 4, .018)
            limb((side * .14, 1.795, .539), (side * .159, 1.970, .684), .026, .009, 4, .018)
            limb((side * .233, 2.01, .43), (side * .292, 2.174, .487), .022, .009, 4, .018)
        for leg in (rear, front):
            for i in range(3):
                limb(leg[i], leg[i + 1], thickness[i], thickness[i + 1], int(i != 0), .037 if i == 0 else .019)
            px, _, pz = leg[-1]
            ellipsoid((px, .056 if wolf else .052, pz + .039),
                      (.057 if wolf else .040, .052, .087 if wolf else .064), 0, 2, .018)

    xyz, faces, _, _ = marching_cubes(field, 0, allow_degenerate=False)
    ids = np.rint(xyz).astype(int)
    zone = regions[ids[:, 0], ids[:, 1], ids[:, 2]]
    xyz = np.ascontiguousarray(xyz * step + np.array([a[0] for a in axes], dtype=np.float32))
    p, q, r = xyz[faces[:, 0]], xyz[faces[:, 1]], xyz[faces[:, 2]]
    if (p * np.cross(q, r)).sum() < 0:
        faces = faces[:, ::-1]
    normal = np.zeros_like(xyz)
    face_normal = np.cross(xyz[faces[:, 1]] - xyz[faces[:, 0]], xyz[faces[:, 2]] - xyz[faces[:, 0]])
    for axis in range(3):
        np.add.at(normal, faces[:, axis], face_normal)
    normal /= np.maximum(np.linalg.norm(normal, axis=1, keepdims=True), 1e-8)

    # Coat is baked in linear RGB. Large variations follow anatomy; GLSL provides fibre detail.
    height = (xyz[:, 1] - (.68 if wolf else .83)) / .70
    dorsal = np.clip((height + .02) * .92, 0, 1)
    belly = np.clip(-height * 1.2 + .08, 0, .8)
    markings = np.clip(np.sin(xyz[:, 2] * 8 + np.sin(xyz[:, 1] * 11)) * .12 + .53, 0, 1)
    base = np.array([.245, .211, .163] if wolf else [.305, .164, .075])
    bright = np.array([.46, .391, .29] if wolf else [.61, .384, .195])
    dark = np.array([.066, .065, .06] if wolf else [.157, .073, .027])
    coat = base + (bright - base) * (belly * markings)[:, None]
    coat += (dark - base) * (dorsal * .68)[:, None]
    coat[zone == 1] = coat[zone == 1] * .59 + bright * .34
    coat[zone == 2] = [.031, .023, .017]
    coat[zone == 3] = [.42, .18, .033]
    coat[zone == 4] = [.35, .26, .157]
    return xyz, np.ascontiguousarray(faces, dtype=np.uint32), normal, np.asarray(coat, dtype=np.float32)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path)
    folder = parser.parse_args().output
    folder.mkdir(parents=True, exist_ok=True)
    for name in ['deer', 'wolf']:
        for lod, step in [('near', .020), ('far', .045)]:
            attributes = sculpt(name == 'wolf', step)
            for suffix, data in zip(['positions', 'indices', 'normals', 'colors'], attributes):
                data.tofile(folder / f'{name}-{lod}.{suffix}')
            print(name, lod, len(attributes[1]), 'triangles', flush=True)

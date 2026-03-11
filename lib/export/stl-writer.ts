import type { IndexedMesh, PrintPlate } from './types';

/**
 * Convert an IndexedMesh to binary STL format.
 *
 * Binary STL layout:
 *   80 bytes  — header (ASCII, padded with zeros)
 *   4 bytes   — uint32 triangle count
 *   per triangle (50 bytes each):
 *     12 bytes — normal vector (3x float32)
 *     36 bytes — 3 vertices (3x 3x float32)
 *     2 bytes  — attribute byte count (unused, 0)
 */

/** Write a single triangle (normal + 3 vertices + attr) into view at offset. Returns next offset. */
function writeTriangle(
  view: DataView,
  offset: number,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number,
): number {
  // Face normal via cross product (CCW winding = outward)
  const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
  const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
  let nx = e1y * e2z - e1z * e2y;
  let ny = e1z * e2x - e1x * e2z;
  let nz = e1x * e2y - e1y * e2x;
  const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (len > 0) { nx /= len; ny /= len; nz /= len; }

  view.setFloat32(offset, nx, true); offset += 4;
  view.setFloat32(offset, ny, true); offset += 4;
  view.setFloat32(offset, nz, true); offset += 4;
  view.setFloat32(offset, ax, true); offset += 4;
  view.setFloat32(offset, ay, true); offset += 4;
  view.setFloat32(offset, az, true); offset += 4;
  view.setFloat32(offset, bx, true); offset += 4;
  view.setFloat32(offset, by, true); offset += 4;
  view.setFloat32(offset, bz, true); offset += 4;
  view.setFloat32(offset, cx, true); offset += 4;
  view.setFloat32(offset, cy, true); offset += 4;
  view.setFloat32(offset, cz, true); offset += 4;
  view.setUint16(offset, 0, true); offset += 2;

  return offset;
}

/** Write an 80-byte ASCII header into view, zero-padded. */
function writeHeader(view: DataView, header: string): void {
  const str = header.slice(0, 80);
  for (let i = 0; i < str.length; i++) {
    view.setUint8(i, str.charCodeAt(i));
  }
}

export function meshToSTL(mesh: IndexedMesh, header?: string): ArrayBuffer {
  const triCount = mesh.indices.length / 3;
  const buffer = new ArrayBuffer(80 + 4 + triCount * 50);
  const view = new DataView(buffer);

  writeHeader(view, header ?? 'BrickForge STL Export');
  view.setUint32(80, triCount, true);

  const verts = mesh.vertices;
  const idx = mesh.indices;
  let offset = 84;

  for (let t = 0; t < triCount; t++) {
    const i0 = idx[t * 3], i1 = idx[t * 3 + 1], i2 = idx[t * 3 + 2];
    offset = writeTriangle(
      view, offset,
      verts[i0 * 3], verts[i0 * 3 + 1], verts[i0 * 3 + 2],
      verts[i1 * 3], verts[i1 * 3 + 1], verts[i1 * 3 + 2],
      verts[i2 * 3], verts[i2 * 3 + 1], verts[i2 * 3 + 2],
    );
  }

  return buffer;
}

/**
 * Convert all bricks on a PrintPlate to a single binary STL.
 * Each brick's vertices are translated by its bedPosition (x, z offsets).
 */
export function plateToSTL(plate: PrintPlate): ArrayBuffer {
  let totalTris = 0;
  for (const brick of plate.bricks) {
    totalTris += brick.mesh.indices.length / 3;
  }

  const buffer = new ArrayBuffer(80 + 4 + totalTris * 50);
  const view = new DataView(buffer);

  writeHeader(view, `BrickForge ${plate.colorName} plate`);
  view.setUint32(80, totalTris, true);

  let offset = 84;

  for (const brick of plate.bricks) {
    const [bedX, bedZ] = brick.bedPosition;
    const verts = brick.mesh.vertices;
    const idx = brick.mesh.indices;
    const triCount = idx.length / 3;

    for (let t = 0; t < triCount; t++) {
      const i0 = idx[t * 3], i1 = idx[t * 3 + 1], i2 = idx[t * 3 + 2];
      offset = writeTriangle(
        view, offset,
        verts[i0 * 3] + bedX, verts[i0 * 3 + 1], verts[i0 * 3 + 2] + bedZ,
        verts[i1 * 3] + bedX, verts[i1 * 3 + 1], verts[i1 * 3 + 2] + bedZ,
        verts[i2 * 3] + bedX, verts[i2 * 3 + 1], verts[i2 * 3 + 2] + bedZ,
      );
    }
  }

  return buffer;
}

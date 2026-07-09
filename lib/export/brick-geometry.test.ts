import { describe, expect, it } from 'vitest';
import { generateBrickMesh } from './brick-geometry';
import type { IndexedMesh } from './types';

const STUD_PITCH = 8.0;
const TOLERANCE = 0.1;
const WALL_THICKNESS = 1.2;
const TUBE_OUTER_R = 6.51 / 2;

function verticesForTriangle(mesh: IndexedMesh, tri: number): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let i = 0; i < 3; i++) {
    const vertexIndex = mesh.indices[tri * 3 + i];
    out.push([
      mesh.vertices[vertexIndex * 3],
      mesh.vertices[vertexIndex * 3 + 1],
      mesh.vertices[vertexIndex * 3 + 2],
    ]);
  }
  return out;
}

function bottomInteriorSheetTriangles(mesh: IndexedMesh, studW: number, studD: number): number {
  const bodyW = studW * STUD_PITCH - 2 * TOLERANCE;
  const bodyD = studD * STUD_PITCH - 2 * TOLERANCE;
  const tubeCenters: [number, number][] = [];

  if (studW >= 2 && studD >= 2) {
    for (let tz = 0; tz < studD - 1; tz++) {
      for (let tx = 0; tx < studW - 1; tx++) {
        tubeCenters.push([
          bodyW / 2 + (tx - (studW - 2) / 2) * STUD_PITCH,
          bodyD / 2 + (tz - (studD - 2) / 2) * STUD_PITCH,
        ]);
      }
    }
  }

  let count = 0;
  for (let tri = 0; tri < mesh.indices.length / 3; tri++) {
    const verts = verticesForTriangle(mesh, tri);
    if (!verts.every(([, y]) => Math.abs(y) < 1e-5)) continue;

    const cx = verts.reduce((sum, [x]) => sum + x, 0) / 3;
    const cz = verts.reduce((sum, [, , z]) => sum + z, 0) / 3;
    const insideRim = cx > WALL_THICKNESS && cx < bodyW - WALL_THICKNESS &&
      cz > WALL_THICKNESS && cz < bodyD - WALL_THICKNESS;
    if (!insideRim) continue;

    const onTube = tubeCenters.some(([tx, tz]) => Math.hypot(cx - tx, cz - tz) <= TUBE_OUTER_R + 0.2);
    if (!onTube) count++;
  }
  return count;
}

function largestInteriorBottomTriangleSpan(mesh: IndexedMesh, studW: number, studD: number): number {
  const bodyW = studW * STUD_PITCH - 2 * TOLERANCE;
  const bodyD = studD * STUD_PITCH - 2 * TOLERANCE;
  let largest = 0;

  for (let tri = 0; tri < mesh.indices.length / 3; tri++) {
    const verts = verticesForTriangle(mesh, tri);
    if (!verts.every(([, y]) => Math.abs(y) < 1e-5)) continue;

    const cx = verts.reduce((sum, [x]) => sum + x, 0) / 3;
    const cz = verts.reduce((sum, [, , z]) => sum + z, 0) / 3;
    const insideRim = cx > WALL_THICKNESS && cx < bodyW - WALL_THICKNESS &&
      cz > WALL_THICKNESS && cz < bodyD - WALL_THICKNESS;
    if (!insideRim) continue;

    const xs = verts.map(([x]) => x);
    const zs = verts.map(([, , z]) => z);
    const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs));
    largest = Math.max(largest, span);
  }

  return largest;
}

describe('generateBrickMesh', () => {
  it('leaves standard brick undersides open instead of adding a flat bottom sheet', () => {
    const mesh = generateBrickMesh('b_2x4', { tolerance: TOLERANCE, cylinderSegments: 16 });
    expect(bottomInteriorSheetTriangles(mesh, 4, 2)).toBe(0);
  });

  it('leaves plate undersides open as well', () => {
    const mesh = generateBrickMesh('p_2x4', { tolerance: TOLERANCE, cylinderSegments: 16 });
    expect(bottomInteriorSheetTriangles(mesh, 4, 2)).toBe(0);
  });

  it('keeps anti-stud tube geometry on 2-wide bricks', () => {
    const mesh = generateBrickMesh('b_2x4', { tolerance: TOLERANCE, cylinderSegments: 16 });
    const bottomInteriorTriangles = Array.from({ length: mesh.indices.length / 3 }, (_, tri) => verticesForTriangle(mesh, tri))
      .filter((verts) => verts.every(([, y]) => Math.abs(y) < 1e-5))
      .filter((verts) => {
        const cx = verts.reduce((sum, [x]) => sum + x, 0) / 3;
        const cz = verts.reduce((sum, [, , z]) => sum + z, 0) / 3;
        return cx > WALL_THICKNESS && cz > WALL_THICKNESS;
      });

    expect(bottomInteriorTriangles.length).toBeGreaterThan(0);
  });

  it('uses discrete narrow tubes on 1-wide bricks instead of a long rectangular underside rail', () => {
    const mesh = generateBrickMesh('b_1x4', { tolerance: TOLERANCE, cylinderSegments: 16 });
    expect(largestInteriorBottomTriangleSpan(mesh, 1, 4)).toBeLessThan(5);
  });

  it('uses discrete narrow tubes on 1-wide plates as well', () => {
    const mesh = generateBrickMesh('p_1x4', { tolerance: TOLERANCE, cylinderSegments: 16 });
    expect(largestInteriorBottomTriangleSpan(mesh, 1, 4)).toBeLessThan(5);
  });

  it('leaves the 2x2 slope underside open', () => {
    const mesh = generateBrickMesh('s_2x2_45', { tolerance: TOLERANCE, cylinderSegments: 16 });
    expect(bottomInteriorSheetTriangles(mesh, 2, 2)).toBe(0);
  });
});

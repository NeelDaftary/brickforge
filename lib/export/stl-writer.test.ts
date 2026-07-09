import { describe, expect, it } from 'vitest';
import type { IndexedMesh, PrintPlate } from './types';
import { meshToSTL, plateToSTL } from './stl-writer';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeMesh(verts: number[], indices: number[]): IndexedMesh {
  return { vertices: new Float32Array(verts), indices: new Uint32Array(indices) };
}

function readTriCount(buf: ArrayBuffer): number {
  return new DataView(buf).getUint32(80, true);
}

function readHeader(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf, 0, 80);
  let end = 80;
  while (end > 0 && bytes[end - 1] === 0) end--;
  return new TextDecoder('ascii').decode(bytes.slice(0, end));
}

function expectedSize(n: number): number {
  return 80 + 4 + n * 50;
}

function stlBounds(buf: ArrayBuffer): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const view = new DataView(buf);
  const triCount = readTriCount(buf);
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  for (let tri = 0; tri < triCount; tri++) {
    const triStart = 84 + tri * 50 + 12;
    for (let vertex = 0; vertex < 3; vertex++) {
      const offset = triStart + vertex * 12;
      const x = view.getFloat32(offset, true);
      const z = view.getFloat32(offset + 8, true);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }
  }

  return { minX, maxX, minZ, maxZ };
}

const SINGLE_TRI = makeMesh([0, 0, 0, 1, 0, 0, 0, 1, 0], [0, 1, 2]);
const TWO_TRI = makeMesh([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], [0, 1, 2, 0, 2, 3]);
const RECT_2X1 = makeMesh([0, 0, 0, 2, 0, 0, 2, 0, 1, 0, 0, 1], [0, 1, 2, 0, 2, 3]);

// ─── meshToSTL ────────────────────────────────────────────────────────────────

describe('meshToSTL', () => {
  it('produces correct binary STL format with header, tri count, and size', () => {
    const buf1 = meshToSTL(SINGLE_TRI);
    expect(buf1).toBeInstanceOf(ArrayBuffer);
    expect(buf1.byteLength).toBe(expectedSize(1));
    expect(readTriCount(buf1)).toBe(1);
    expect(readHeader(buf1)).toBe('BrickForge STL Export');

    const buf2 = meshToSTL(TWO_TRI);
    expect(buf2.byteLength).toBe(expectedSize(2));
    expect(readTriCount(buf2)).toBe(2);
  });

  it('supports custom and truncated headers', () => {
    expect(readHeader(meshToSTL(SINGLE_TRI, 'My Custom Header'))).toBe('My Custom Header');
    expect(readHeader(meshToSTL(SINGLE_TRI, 'A'.repeat(120)))).toBe('A'.repeat(80));
  });

  it('writes correct vertex data and face normal for a single triangle', () => {
    const buf = meshToSTL(SINGLE_TRI);
    const view = new DataView(buf);
    const vertexStart = 84 + 12;

    // Vertex A (0,0,0), B (1,0,0), C (0,1,0)
    expect(view.getFloat32(vertexStart, true)).toBe(0);
    expect(view.getFloat32(vertexStart + 12, true)).toBe(1);
    expect(view.getFloat32(vertexStart + 24, true)).toBe(0);
    expect(view.getFloat32(vertexStart + 28, true)).toBe(1);

    // Normal should be (0,0,1) for CCW triangle in XY plane
    expect(view.getFloat32(84, true)).toBeCloseTo(0);
    expect(view.getFloat32(88, true)).toBeCloseTo(0);
    expect(view.getFloat32(92, true)).toBeCloseTo(1);
  });

  it('handles empty mesh', () => {
    const buf = meshToSTL(makeMesh([], []));
    expect(buf.byteLength).toBe(expectedSize(0));
    expect(readTriCount(buf)).toBe(0);
  });
});

// ─── plateToSTL ───────────────────────────────────────────────────────────────

describe('plateToSTL', () => {
  const singleBrickPlate: PrintPlate = {
    color: '#ff0000', colorName: 'Red',
    bricks: [{ brickId: 'b1', bedPosition: [0, 0], mesh: SINGLE_TRI }],
    bounds: [10, 10, 10],
  };

  it('produces correct STL for single-brick plate with header', () => {
    const buf = plateToSTL(singleBrickPlate);
    expect(buf).toBeInstanceOf(ArrayBuffer);
    expect(buf.byteLength).toBe(expectedSize(1));
    expect(readTriCount(buf)).toBe(1);
    expect(readHeader(buf)).toBe('BrickForge Red plate');
  });

  it('combines triangles from multiple bricks', () => {
    const plate: PrintPlate = {
      color: '#0000ff', colorName: 'Blue',
      bricks: [
        { brickId: 'b1', bedPosition: [0, 0], mesh: SINGLE_TRI },
        { brickId: 'b2', bedPosition: [10, 0], mesh: TWO_TRI },
      ],
      bounds: [20, 10, 10],
    };
    const buf = plateToSTL(plate);
    expect(readTriCount(buf)).toBe(3);
    expect(buf.byteLength).toBe(expectedSize(3));
  });

  it('applies bedPosition x/z offsets but not Y', () => {
    const plate: PrintPlate = {
      color: '#00ff00', colorName: 'Green',
      bricks: [{ brickId: 'b1', bedPosition: [5, 7], mesh: SINGLE_TRI }],
      bounds: [10, 10, 10],
    };
    const buf = plateToSTL(plate);
    const view = new DataView(buf);
    const v = 84 + 12;

    // Vertex A: (0+5, 0, 0+7) = (5, 0, 7)
    expect(view.getFloat32(v, true)).toBeCloseTo(5);
    expect(view.getFloat32(v + 4, true)).toBeCloseTo(0);
    expect(view.getFloat32(v + 8, true)).toBeCloseTo(7);

    // Y coordinate should be unaffected by bedPosition
    const yPlate: PrintPlate = {
      color: '#ff0000', colorName: 'Red',
      bricks: [{ brickId: 'b1', bedPosition: [100, 200], mesh: makeMesh([0, 5, 0, 1, 5, 0, 0, 5, 1], [0, 1, 2]) }],
      bounds: [200, 10, 200],
    };
    const yBuf = plateToSTL(yPlate);
    const yView = new DataView(yBuf);
    const yV = 84 + 12;
    expect(yView.getFloat32(yV + 4, true)).toBeCloseTo(5);
  });

  it('rotates packed brick meshes into their reserved bed footprint', () => {
    const plate: PrintPlate = {
      color: '#ff0000',
      colorName: 'Red',
      bricks: [{ brickId: 'b1', bedPosition: [10, 20], mesh: RECT_2X1, rotated: true }],
      bounds: [11, 1, 22],
    };

    const bounds = stlBounds(plateToSTL(plate));
    expect(bounds.minX).toBeCloseTo(10);
    expect(bounds.maxX).toBeCloseTo(11);
    expect(bounds.minZ).toBeCloseTo(20);
    expect(bounds.maxZ).toBeCloseTo(22);
  });

  it('handles empty plate', () => {
    const buf = plateToSTL({ color: '#000', colorName: 'Black', bricks: [], bounds: [0, 0, 0] });
    expect(buf.byteLength).toBe(expectedSize(0));
    expect(readTriCount(buf)).toBe(0);
  });
});

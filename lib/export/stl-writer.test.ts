import { describe, expect, it } from 'vitest';
import type { IndexedMesh, PrintPlate } from './types';
import { meshToSTL, plateToSTL } from './stl-writer';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build an IndexedMesh from raw arrays. */
function makeMesh(verts: number[], indices: number[]): IndexedMesh {
  return {
    vertices: new Float32Array(verts),
    indices: new Uint32Array(indices),
  };
}

/** Read the triangle count stored at bytes 80–83 (uint32 LE). */
function readTriCount(buf: ArrayBuffer): number {
  return new DataView(buf).getUint32(80, true);
}

/** Decode the 80-byte ASCII header from a binary STL buffer. */
function readHeader(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf, 0, 80);
  let end = 80;
  while (end > 0 && bytes[end - 1] === 0) end--;
  return new TextDecoder('ascii').decode(bytes.slice(0, end));
}

/** Expected byte length of a binary STL with `n` triangles. */
function expectedSize(n: number): number {
  return 80 + 4 + n * 50;
}

// ---------------------------------------------------------------------------
// Single-triangle mesh: a right triangle in the XY plane
// vertices: (0,0,0), (1,0,0), (0,1,0)
// ---------------------------------------------------------------------------
const SINGLE_TRI = makeMesh(
  [0, 0, 0, 1, 0, 0, 0, 1, 0],
  [0, 1, 2],
);

// ---------------------------------------------------------------------------
// Two-triangle mesh (a quad split into two tris)
// vertices: (0,0,0), (1,0,0), (1,1,0), (0,1,0)
// ---------------------------------------------------------------------------
const TWO_TRI = makeMesh(
  [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0],
  [0, 1, 2, 0, 2, 3],
);

// ---------------------------------------------------------------------------
// Tests — meshToSTL
// ---------------------------------------------------------------------------
describe('meshToSTL', () => {
  it('returns an ArrayBuffer', () => {
    const buf = meshToSTL(SINGLE_TRI);
    expect(buf).toBeInstanceOf(ArrayBuffer);
  });

  it('produces the correct buffer size for a single triangle', () => {
    const buf = meshToSTL(SINGLE_TRI);
    expect(buf.byteLength).toBe(expectedSize(1));
  });

  it('produces the correct buffer size for multiple triangles', () => {
    const buf = meshToSTL(TWO_TRI);
    expect(buf.byteLength).toBe(expectedSize(2));
  });

  it('starts with an 80-byte header', () => {
    const buf = meshToSTL(SINGLE_TRI);
    // Buffer must be at least 84 bytes (header + tri-count)
    expect(buf.byteLength).toBeGreaterThanOrEqual(84);
  });

  it('stores the triangle count at bytes 80–83', () => {
    expect(readTriCount(meshToSTL(SINGLE_TRI))).toBe(1);
    expect(readTriCount(meshToSTL(TWO_TRI))).toBe(2);
  });

  it('uses the default header when none is provided', () => {
    const buf = meshToSTL(SINGLE_TRI);
    expect(readHeader(buf)).toBe('BrickForge STL Export');
  });

  it('uses a custom header when supplied', () => {
    const buf = meshToSTL(SINGLE_TRI, 'My Custom Header');
    expect(readHeader(buf)).toBe('My Custom Header');
  });

  it('truncates headers longer than 80 characters', () => {
    const long = 'A'.repeat(120);
    const buf = meshToSTL(SINGLE_TRI, long);
    expect(readHeader(buf)).toBe('A'.repeat(80));
  });

  it('writes correct vertex data for a single triangle', () => {
    const buf = meshToSTL(SINGLE_TRI);
    const view = new DataView(buf);

    // After header (80) + triCount (4) + normal (12), vertex A starts at 96
    const vertexStart = 84 + 12;
    // Vertex A (0,0,0)
    expect(view.getFloat32(vertexStart, true)).toBe(0);
    expect(view.getFloat32(vertexStart + 4, true)).toBe(0);
    expect(view.getFloat32(vertexStart + 8, true)).toBe(0);
    // Vertex B (1,0,0)
    expect(view.getFloat32(vertexStart + 12, true)).toBe(1);
    expect(view.getFloat32(vertexStart + 16, true)).toBe(0);
    expect(view.getFloat32(vertexStart + 20, true)).toBe(0);
    // Vertex C (0,1,0)
    expect(view.getFloat32(vertexStart + 24, true)).toBe(0);
    expect(view.getFloat32(vertexStart + 28, true)).toBe(1);
    expect(view.getFloat32(vertexStart + 32, true)).toBe(0);
  });

  it('computes the correct face normal via cross product', () => {
    // For a CCW triangle in XY plane the outward normal should be (0,0,1)
    const buf = meshToSTL(SINGLE_TRI);
    const view = new DataView(buf);

    const nx = view.getFloat32(84, true);
    const ny = view.getFloat32(88, true);
    const nz = view.getFloat32(92, true);

    expect(nx).toBeCloseTo(0);
    expect(ny).toBeCloseTo(0);
    expect(nz).toBeCloseTo(1);
  });

  it('sets the attribute byte count to zero for every triangle', () => {
    const buf = meshToSTL(TWO_TRI);
    const view = new DataView(buf);
    // Attribute bytes sit at the end of each 50-byte triangle record
    // Triangle 0: offset 84 + 48 = 132
    // Triangle 1: offset 84 + 50 + 48 = 182
    expect(view.getUint16(132, true)).toBe(0);
    expect(view.getUint16(182, true)).toBe(0);
  });

  it('handles a mesh with zero triangles', () => {
    const empty = makeMesh([], []);
    const buf = meshToSTL(empty);
    expect(buf.byteLength).toBe(expectedSize(0)); // 84 bytes
    expect(readTriCount(buf)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Tests — plateToSTL
// ---------------------------------------------------------------------------
describe('plateToSTL', () => {
  const singleBrickPlate: PrintPlate = {
    color: '#ff0000',
    colorName: 'Red',
    bricks: [
      {
        brickId: 'b1',
        bedPosition: [0, 0],
        mesh: SINGLE_TRI,
      },
    ],
    bounds: [10, 10, 10],
  };

  it('returns an ArrayBuffer', () => {
    const buf = plateToSTL(singleBrickPlate);
    expect(buf).toBeInstanceOf(ArrayBuffer);
  });

  it('produces the correct buffer size for a single-brick plate', () => {
    const buf = plateToSTL(singleBrickPlate);
    expect(buf.byteLength).toBe(expectedSize(1));
  });

  it('stores the correct triangle count for a single-brick plate', () => {
    const buf = plateToSTL(singleBrickPlate);
    expect(readTriCount(buf)).toBe(1);
  });

  it('writes the plate header with color name', () => {
    const buf = plateToSTL(singleBrickPlate);
    expect(readHeader(buf)).toBe('BrickForge Red plate');
  });

  it('combines triangles from multiple bricks', () => {
    const plate: PrintPlate = {
      color: '#0000ff',
      colorName: 'Blue',
      bricks: [
        { brickId: 'b1', bedPosition: [0, 0], mesh: SINGLE_TRI },
        { brickId: 'b2', bedPosition: [10, 0], mesh: TWO_TRI },
      ],
      bounds: [20, 10, 10],
    };
    const buf = plateToSTL(plate);
    // 1 tri from first brick + 2 tris from second = 3
    expect(readTriCount(buf)).toBe(3);
    expect(buf.byteLength).toBe(expectedSize(3));
  });

  it('applies bedPosition x/z offsets to vertex data', () => {
    const plate: PrintPlate = {
      color: '#00ff00',
      colorName: 'Green',
      bricks: [
        {
          brickId: 'b1',
          bedPosition: [5, 7],
          mesh: SINGLE_TRI,
        },
      ],
      bounds: [10, 10, 10],
    };

    const buf = plateToSTL(plate);
    const view = new DataView(buf);

    // Vertex A should be (0+5, 0, 0+7) = (5, 0, 7)
    const vertexStart = 84 + 12;
    expect(view.getFloat32(vertexStart, true)).toBeCloseTo(5);
    expect(view.getFloat32(vertexStart + 4, true)).toBeCloseTo(0);
    expect(view.getFloat32(vertexStart + 8, true)).toBeCloseTo(7);

    // Vertex B should be (1+5, 0, 0+7) = (6, 0, 7)
    expect(view.getFloat32(vertexStart + 12, true)).toBeCloseTo(6);
    expect(view.getFloat32(vertexStart + 16, true)).toBeCloseTo(0);
    expect(view.getFloat32(vertexStart + 20, true)).toBeCloseTo(7);

    // Vertex C should be (0+5, 1, 0+7) = (5, 1, 7)
    expect(view.getFloat32(vertexStart + 24, true)).toBeCloseTo(5);
    expect(view.getFloat32(vertexStart + 28, true)).toBeCloseTo(1);
    expect(view.getFloat32(vertexStart + 32, true)).toBeCloseTo(7);
  });

  it('does not apply bedPosition offset to the Y coordinate', () => {
    const plate: PrintPlate = {
      color: '#ff0000',
      colorName: 'Red',
      bricks: [
        {
          brickId: 'b1',
          bedPosition: [100, 200],
          mesh: makeMesh([0, 5, 0, 1, 5, 0, 0, 5, 1], [0, 1, 2]),
        },
      ],
      bounds: [200, 10, 200],
    };

    const buf = plateToSTL(plate);
    const view = new DataView(buf);

    // All Y values should remain 5, untouched by bedPosition
    const vertexStart = 84 + 12;
    expect(view.getFloat32(vertexStart + 4, true)).toBeCloseTo(5);
    expect(view.getFloat32(vertexStart + 16, true)).toBeCloseTo(5);
    expect(view.getFloat32(vertexStart + 28, true)).toBeCloseTo(5);
  });

  it('handles a plate with zero bricks', () => {
    const emptyPlate: PrintPlate = {
      color: '#000000',
      colorName: 'Black',
      bricks: [],
      bounds: [0, 0, 0],
    };
    const buf = plateToSTL(emptyPlate);
    expect(buf.byteLength).toBe(expectedSize(0));
    expect(readTriCount(buf)).toBe(0);
  });
});

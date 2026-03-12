import { describe, expect, it } from 'vitest';
import { voxelGridToBrickModel, type VoxelGrid } from './voxel-to-bricks';
import type { BrickInstance } from '@/lib/engine/types';

// ─── Test Helpers ──────────────────────────────────────────────────────────────

function makeGrid(sizeX: number, sizeY: number, sizeZ: number, fill: string): string[][][] {
  return Array.from({ length: sizeX }, () =>
    Array.from({ length: sizeY }, () => new Array(sizeZ).fill(fill)),
  );
}

function makeEmptyGrid(sizeX: number, sizeY: number, sizeZ: number): string[][][] {
  return makeGrid(sizeX, sizeY, sizeZ, '0');
}

function totalBrickVolume(bricks: BrickInstance[]): number {
  return bricks.reduce((sum, b) => sum + (b.studWidth ?? 1) * (b.studDepth ?? 1), 0);
}

function countFilledVoxels(grid: string[][][]): number {
  let count = 0;
  for (const plane of grid)
    for (const col of plane)
      for (const cell of col)
        if (cell !== '0') count++;
  return count;
}

function buildVoxelGrid(grid: string[][][], colorLegend: Record<string, string>): VoxelGrid {
  return { grid, colorLegend, gridSize: Math.max(grid.length, grid[0]?.length ?? 0, grid[0]?.[0]?.length ?? 0) };
}

const SUPPORTED_IDS = new Set([
  'b_1x1', 'b_1x2', 'b_1x3', 'b_1x4', 'b_1x6', 'b_1x8',
  'b_2x2', 'b_2x3', 'b_2x4', 'b_2x6', 'b_2x8', 'b_4x4',
]);

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('voxelGridToBrickModel', () => {
  it('converts a 1x1x1 grid into one 1x1 brick with correct fields', () => {
    const grid = makeGrid(1, 1, 1, 'R');
    const result = voxelGridToBrickModel(buildVoxelGrid(grid, { R: '#FF0000' }), 'test', 'desc');

    expect(result.bricks).toHaveLength(1);
    const brick = result.bricks[0];
    expect(brick.brickId).toBe('b_1x1');
    expect(brick.color).toBe('#FF0000');
    expect(brick.step).toBe(1);
    expect(brick.rotation).toBe(0);
    expect(brick.position).toHaveLength(3);
    expect(brick.position.every(Number.isFinite)).toBe(true);
  });

  it('empty grids (3x3x3 empty, 0x0x0) produce no bricks', () => {
    const r1 = voxelGridToBrickModel(buildVoxelGrid(makeEmptyGrid(3, 3, 3), {}), 'test', 'desc');
    expect(r1.bricks).toHaveLength(0);

    const r2 = voxelGridToBrickModel(buildVoxelGrid([], {}), 'test', 'desc');
    expect(r2.bricks).toHaveLength(0);
  });

  it('covers all voxels with no gaps across grid shapes', () => {
    for (const [sx, sy, sz] of [[3, 3, 1], [4, 4, 2]] as [number, number, number][]) {
      const grid = makeGrid(sx, sy, sz, 'B');
      const result = voxelGridToBrickModel(buildVoxelGrid(grid, { B: '#0000FF' }), 'test', 'desc');
      expect(totalBrickVolume(result.bricks)).toBe(sx * sy * sz);
    }

    // Irregular grid with holes
    const holed = makeGrid(4, 4, 1, 'R');
    holed[0][0][0] = '0';
    holed[2][3][0] = '0';
    holed[3][3][0] = '0';
    const result = voxelGridToBrickModel(buildVoxelGrid(holed, { R: '#FF0000' }), 'test', 'desc');
    expect(totalBrickVolume(result.bricks)).toBe(countFilledVoxels(holed));
  });

  it('greedy combiner produces optimal single bricks for standard sizes', () => {
    for (const [sx, sy, expectedId] of [
      [2, 4, 'b_2x4'], [2, 2, 'b_2x2'], [1, 4, 'b_1x4'], [1, 8, 'b_1x8'],
    ] as [number, number, string][]) {
      const grid = makeGrid(sx, sy, 1, 'R');
      const result = voxelGridToBrickModel(buildVoxelGrid(grid, { R: '#FF0000' }), 'test', 'desc');
      expect(result.bricks).toHaveLength(1);
      expect(result.bricks[0].brickId).toBe(expectedId);
      expect(totalBrickVolume(result.bricks)).toBe(sx * sy);
    }
  });

  it('produces fewer bricks than voxels via greedy combining', () => {
    const grid = makeGrid(4, 4, 1, 'R');
    const result = voxelGridToBrickModel(buildVoxelGrid(grid, { R: '#FF0000' }), 'test', 'desc');
    expect(result.bricks.length).toBeLessThan(16);
    expect(totalBrickVolume(result.bricks)).toBe(16);
  });

  it('all output bricks have valid brickId, unique IDs', () => {
    const grid = makeGrid(6, 6, 3, 'R');
    const result = voxelGridToBrickModel(buildVoxelGrid(grid, { R: '#FF0000' }), 'test', 'desc');

    const ids = new Set<string>();
    for (const brick of result.bricks) {
      expect(SUPPORTED_IDS.has(brick.brickId)).toBe(true);
      expect(ids.has(brick.id)).toBe(false);
      ids.add(brick.id);
    }
  });

  it('sets step number based on z-layer (1-indexed)', () => {
    const grid = makeGrid(1, 1, 3, 'R');
    const result = voxelGridToBrickModel(buildVoxelGrid(grid, { R: '#FF0000' }), 'test', 'desc');
    const steps = result.bricks.map((b) => b.step).sort((a, b) => a - b);
    expect(steps).toEqual([1, 2, 3]);
  });

  it('never merges across color boundaries', () => {
    // 4x1x1: RR BB
    const grid = makeGrid(4, 1, 1, '0');
    grid[0][0][0] = 'R'; grid[1][0][0] = 'R';
    grid[2][0][0] = 'B'; grid[3][0][0] = 'B';
    const result = voxelGridToBrickModel(buildVoxelGrid(grid, { R: '#FF0000', B: '#0000FF' }), 'test', 'desc');

    expect(totalBrickVolume(result.bricks)).toBe(4);
    for (const brick of result.bricks) {
      const gx = brick.metadata?.gx ?? 0;
      const gw = brick.metadata?.gw ?? 1;
      if (gx < 2) expect(gx + gw).toBeLessThanOrEqual(2);
    }

    // Checkerboard forces all 1x1s
    const checker = makeGrid(2, 2, 1, '0');
    checker[0][0][0] = 'R'; checker[0][1][0] = 'B';
    checker[1][0][0] = 'B'; checker[1][1][0] = 'R';
    const cr = voxelGridToBrickModel(buildVoxelGrid(checker, { R: '#FF0000', B: '#0000FF' }), 'test', 'desc');
    expect(cr.bricks).toHaveLength(4);
  });

  it('shell: false preserves all voxels, small grids unaffected by shell', () => {
    const grid = makeGrid(4, 4, 4, 'R');
    const input = buildVoxelGrid(grid, { R: '#FF0000' });
    const noShell = voxelGridToBrickModel(input, 'test', 'desc', { shell: false });
    expect(totalBrickVolume(noShell.bricks)).toBe(64);

    // Small grid: shell has no effect
    const small = makeGrid(5, 5, 5, 'R');
    const smallInput = buildVoxelGrid(small, { R: '#FF0000' });
    const withShell = voxelGridToBrickModel(smallInput, 'test', 'desc', { shell: true });
    const withoutShell = voxelGridToBrickModel(smallInput, 'test', 'desc', { shell: false });
    expect(totalBrickVolume(withShell.bricks)).toBe(totalBrickVolume(withoutShell.bricks));
  });

  it('returns correct BrickModelData structure', () => {
    const grid = makeGrid(2, 2, 1, 'R');
    const result = voxelGridToBrickModel(buildVoxelGrid(grid, { R: '#FF0000' }), 'MyModel', 'A test model');
    expect(result.name).toBe('MyModel');
    expect(result.description).toBe('A test model');
    expect(result.totalBricks).toBe(result.bricks.length);
    expect(result.voxelData?.grid).toBe(grid);
  });

  it('handles multiple layers with correct viewer Y heights', () => {
    const grid = makeGrid(1, 1, 3, 'R');
    const result = voxelGridToBrickModel(buildVoxelGrid(grid, { R: '#FF0000' }), 'test', 'desc');
    expect(totalBrickVolume(result.bricks)).toBe(3);
    const yPositions = result.bricks.map((b) => b.position[1]).sort((a, b) => a - b);
    expect(yPositions).toEqual([0, 3, 6]);
  });

  it('includes grid metadata on every brick', () => {
    const grid = makeGrid(2, 2, 1, 'R');
    const result = voxelGridToBrickModel(buildVoxelGrid(grid, { R: '#FF0000' }), 'test', 'desc');
    for (const brick of result.bricks) {
      expect(brick.metadata).toBeDefined();
      for (const key of ['gx', 'gy', 'gz', 'gw', 'gd'] as const) {
        expect(typeof brick.metadata?.[key]).toBe('number');
      }
    }
  });

  it('falls back to grey for unknown color symbols', () => {
    const grid = makeGrid(1, 1, 1, 'X');
    const result = voxelGridToBrickModel(buildVoxelGrid(grid, {}), 'test', 'desc');
    expect(result.bricks[0].color).toBe('#A0A5A9');
  });

  it('handles sparse grid with isolated voxels', () => {
    const grid = makeEmptyGrid(5, 5, 1);
    grid[0][0][0] = 'R'; grid[2][2][0] = 'R'; grid[4][4][0] = 'R';
    const result = voxelGridToBrickModel(buildVoxelGrid(grid, { R: '#FF0000' }), 'test', 'desc');
    expect(result.bricks).toHaveLength(3);
    for (const brick of result.bricks) expect(brick.brickId).toBe('b_1x1');
  });

  it('centers brick positions around grid midpoint', () => {
    const grid = makeGrid(2, 2, 1, '0');
    grid[0][0][0] = 'R';
    const result = voxelGridToBrickModel(buildVoxelGrid(grid, { R: '#FF0000' }), 'test', 'desc');
    expect(result.bricks[0].position[0]).toBe(-1);
    expect(result.bricks[0].position[2]).toBe(-1);
  });

  it('handles interior wildcards and sealed cavities', () => {
    // 3x3x3 solid — interior becomes wildcard, volume preserved
    const solid = makeGrid(3, 3, 3, 'R');
    const r1 = voxelGridToBrickModel(buildVoxelGrid(solid, { R: '#FF0000' }), 'test', 'desc');
    expect(totalBrickVolume(r1.bricks)).toBe(27);

    // 5x5x5 with sealed cavity at center
    const cube = makeGrid(5, 5, 5, 'R');
    cube[2][2][2] = '0';
    const r2 = voxelGridToBrickModel(buildVoxelGrid(cube, { R: '#FF0000' }), 'test', 'desc');
    expect(totalBrickVolume(r2.bricks)).toBe(124);
    for (const brick of r2.bricks) expect(brick.color).toBe('#FF0000');
  });

  it('applies structural staggering across layers', () => {
    const grid = makeGrid(4, 4, 2, 'R');
    const result = voxelGridToBrickModel(buildVoxelGrid(grid, { R: '#FF0000' }), 'test', 'desc');
    expect(totalBrickVolume(result.bricks)).toBe(32);
    for (const brick of result.bricks) {
      expect(brick.studWidth).toBeGreaterThanOrEqual(1);
      expect(brick.studDepth).toBeGreaterThanOrEqual(1);
    }
  });

  it('handles layers with differing fill patterns', () => {
    const grid = makeGrid(3, 3, 2, '0');
    for (let x = 0; x < 3; x++)
      for (let y = 0; y < 3; y++)
        grid[x][y][0] = 'R';
    grid[1][1][1] = 'R';
    const result = voxelGridToBrickModel(buildVoxelGrid(grid, { R: '#FF0000' }), 'test', 'desc');
    expect(totalBrickVolume(result.bricks)).toBe(10);
    const layer2 = result.bricks.filter((b) => b.step === 2);
    expect(layer2).toHaveLength(1);
    expect(layer2[0].brickId).toBe('b_1x1');
  });

  it('never produces overlapping bricks on the same layer', () => {
    const grid = makeGrid(6, 6, 2, 'R');
    const result = voxelGridToBrickModel(buildVoxelGrid(grid, { R: '#FF0000' }), 'test', 'desc');

    const byStep = new Map<number, BrickInstance[]>();
    for (const brick of result.bricks) {
      if (!byStep.has(brick.step)) byStep.set(brick.step, []);
      byStep.get(brick.step)!.push(brick);
    }

    for (const [, layerBricks] of byStep) {
      const occupied = new Set<string>();
      for (const brick of layerBricks) {
        const gx = brick.metadata?.gx ?? 0;
        const gz = brick.metadata?.gz ?? 0;
        const gw = brick.metadata?.gw ?? 1;
        const gd = brick.metadata?.gd ?? 1;
        for (let dx = 0; dx < gw; dx++) {
          for (let dz = 0; dz < gd; dz++) {
            const key = `${gx + dx},${gz + dz}`;
            expect(occupied.has(key)).toBe(false);
            occupied.add(key);
          }
        }
      }
    }
  });
});

import { describe, expect, it } from 'vitest';
import { analyzeBrickGraph } from './brick-graph';
import { voxelGridToBrickModelV2 } from './stability-bricker';
import type { BrickInstance } from '@/lib/engine/types';
import type { VoxelGrid } from '@/lib/pipeline/voxel-to-bricks';

function makeGrid(sx: number, sy: number, sz: number, fill: (x: number, y: number, z: number) => string): string[][][] {
  return Array.from({ length: sx }, (_, x) =>
    Array.from({ length: sy }, (_, y) =>
      Array.from({ length: sz }, (_, z) => fill(x, y, z)),
    ),
  );
}

function occupiedCells(bricks: BrickInstance[]): Set<string> {
  const cells = new Set<string>();
  for (const brick of bricks) {
    const gx = brick.metadata?.gx ?? 0;
    const gy = brick.metadata?.gy ?? 0;
    const gz = brick.metadata?.gz ?? 0;
    const gw = brick.metadata?.gw ?? 1;
    const gd = brick.metadata?.gd ?? 1;
    for (let dx = 0; dx < gw; dx++) {
      for (let dz = 0; dz < gd; dz++) {
        const key = `${gx + dx},${gz + dz},${gy}`;
        expect(cells.has(key)).toBe(false);
        cells.add(key);
      }
    }
  }
  return cells;
}

describe('voxelGridToBrickModelV2', () => {
  it('covers every filled voxel exactly once on small solid grids', () => {
    const voxelGrid: VoxelGrid = {
      grid: makeGrid(4, 2, 2, () => 'R'),
      colorLegend: { R: '#DB0000' },
      gridSize: 4,
    };

    const model = voxelGridToBrickModelV2(voxelGrid, 'test', 'test', { shell: false, refine: false });
    const cells = occupiedCells(model.bricks);

    expect(cells.size).toBe(16);
    expect(model.totalBricks).toBe(model.bricks.length);
    expect(model.stabilityV2Stats?.layersSolved).toBe(2);
  });

  it('represents partial overhangs as supported cantilevers in graph diagnostics', () => {
    const voxelGrid: VoxelGrid = {
      grid: makeGrid(4, 1, 2, (x, _y, z) => (z === 0 && x < 2 ? 'R' : '0')),
      colorLegend: { R: '#DB0000' },
      gridSize: 4,
    };
    voxelGrid.grid[0][0][1] = 'R';
    voxelGrid.grid[1][0][1] = 'R';
    voxelGrid.grid[2][0][1] = 'R';
    voxelGrid.grid[3][0][1] = 'R';

    const model = voxelGridToBrickModelV2(voxelGrid, 'overhang', 'overhang', { shell: false, refine: false });
    const diagnostics = analyzeBrickGraph(model.bricks);

    expect(diagnostics.unsupportedBrickIds.size).toBe(0);
    expect(diagnostics.cantileveredBrickIds.size + diagnostics.weakCantileverBrickIds.size).toBeGreaterThan(0);
  });
});

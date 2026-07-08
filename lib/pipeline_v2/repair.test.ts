import { describe, expect, it } from 'vitest';
import { analyzeBrickGraph, summarizeGraphDiagnostics } from './brick-graph';
import { repairStabilityV2 } from './repair';
import type { SolvedBrick } from './layer-solver';

function toInstances(layers: SolvedBrick[][]) {
  return layers.flat().map((brick, index) => ({
    id: `b${index}`,
    brickId: `b_${Math.min(brick.w, brick.d)}x${Math.max(brick.w, brick.d)}`,
    position: [0, 0, 0] as [number, number, number],
    rotation: 0 as const,
    studWidth: brick.w,
    studDepth: brick.d,
    color: brick.color,
    step: brick.z + 1,
    metadata: { gx: brick.x, gy: brick.z, gz: brick.y, gw: brick.w, gd: brick.d },
  }));
}

function emptyGrid(sx: number, sy: number, sz: number): string[][][] {
  return Array.from({ length: sx }, () =>
    Array.from({ length: sy }, () => new Array(sz).fill('0')),
  );
}

describe('repairStabilityV2', () => {
  it('accepts an internal support patch when it improves unsupported defects', () => {
    const layers: SolvedBrick[][] = [
      [],
      [{ x: 0, y: 0, z: 1, w: 2, d: 1, color: '#DB0000' }],
    ];
    const grid = emptyGrid(2, 1, 2);
    grid[0][0][1] = 'R';
    grid[1][0][1] = 'R';

    const result = repairStabilityV2(layers, {
      grid,
      colorLegend: { R: '#DB0000', G: '#A0A5A9' },
      wildcardColors: new Map(),
      surfaceCells: new Set(['0,0,1', '1,0,1']),
      supportOptionalCells: new Set(['0,0,0', '1,0,0']),
    });

    expect(result.repair.acceptedPatches).toBeGreaterThan(0);
    expect(result.internalSupport.internalSupportVoxels).toBeGreaterThan(0);
    const summary = summarizeGraphDiagnostics(analyzeBrickGraph(toInstances(result.layers)));
    expect(summary.unsupportedBricks).toBe(0);
    expect(summary.floatingBricks).toBe(0);
  });

  it('does not add supports outside supportOptionalCells', () => {
    const layers: SolvedBrick[][] = [
      [],
      [{ x: 0, y: 0, z: 1, w: 2, d: 1, color: '#DB0000' }],
    ];
    const grid = emptyGrid(2, 1, 2);
    grid[0][0][1] = 'R';
    grid[1][0][1] = 'R';

    const result = repairStabilityV2(layers, {
      grid,
      colorLegend: { R: '#DB0000' },
      wildcardColors: new Map(),
      surfaceCells: new Set(['0,0,1', '1,0,1']),
      supportOptionalCells: new Set(),
    });

    expect(result.internalSupport.internalSupportVoxels).toBe(0);
    expect(result.repair.acceptedPatches).toBe(0);
  });

  it('can add a multi-layer hidden support column to reconnect floating bricks', () => {
    const layers: SolvedBrick[][] = [
      [],
      [],
      [{ x: 0, y: 0, z: 2, w: 1, d: 1, color: '#DB0000' }],
    ];
    const grid = emptyGrid(1, 1, 3);
    grid[0][0][2] = 'R';

    const result = repairStabilityV2(layers, {
      grid,
      colorLegend: { R: '#DB0000', G: '#A0A5A9' },
      wildcardColors: new Map([
        ['0,0,0', 'G'],
        ['0,0,1', 'G'],
      ]),
      surfaceCells: new Set(['0,0,2']),
      supportOptionalCells: new Set(['0,0,0', '0,0,1']),
    });

    expect(result.internalSupport.internalSupportVoxels).toBe(2);
    const summary = summarizeGraphDiagnostics(analyzeBrickGraph(toInstances(result.layers)));
    expect(summary.floatingBricks).toBe(0);
    expect(summary.unsupportedBricks).toBe(0);
  });
});

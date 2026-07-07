import { describe, expect, it } from 'vitest';
import { solveLayer } from './layer-solver';

function gridFromLayer(layer: string[][]): string[][][] {
  const sx = layer[0]?.length ?? 0;
  const sy = layer.length;
  return Array.from({ length: sx }, (_, x) =>
    Array.from({ length: sy }, (_, y) => [layer[y][x]]),
  );
}

describe('solveLayer', () => {
  it('covers a simple row with a larger candidate instead of 1x1 bricks', () => {
    const grid = gridFromLayer([['R', 'R', 'R', 'R']]);
    const result = solveLayer({
      grid,
      z: 0,
      colorLegend: { R: '#DB0000' },
      wildcardColors: new Map(),
      surfaceCells: new Set(['0,0,0', '1,0,0', '2,0,0', '3,0,0']),
      belowOwners: new Map(),
    });

    expect(result.bricks).toHaveLength(1);
    expect(result.bricks[0]).toMatchObject({ x: 0, y: 0, z: 0, w: 4, d: 1, color: '#DB0000' });
  });

  it('allows a supported cantilever rather than forcing unsupported 1x1 bricks', () => {
    const grid = gridFromLayer([['R', 'R', 'R', 'R']]);
    const belowOwners = new Map([
      ['0,0', 'base'],
      ['1,0', 'base'],
    ]);

    const result = solveLayer({
      grid,
      z: 1,
      colorLegend: { R: '#DB0000' },
      wildcardColors: new Map(),
      surfaceCells: new Set(['0,0,1', '1,0,1', '2,0,1', '3,0,1']),
      belowOwners,
    });

    expect(result.bricks).toHaveLength(1);
    expect(result.bricks[0]).toMatchObject({ x: 0, y: 0, z: 1, w: 4, d: 1 });
  });

  it('permits mixed-color candidates with a color penalty when structurally useful', () => {
    const grid = gridFromLayer([['R', 'B']]);
    const result = solveLayer({
      grid,
      z: 0,
      colorLegend: { R: '#DB0000', B: '#0059CF' },
      wildcardColors: new Map(),
      surfaceCells: new Set(['0,0,0', '1,0,0']),
      belowOwners: new Map(),
    });

    const coveredStuds = result.bricks.reduce((sum, brick) => sum + brick.w * brick.d, 0);
    expect(coveredStuds).toBe(2);
    expect(result.bricks.length).toBeGreaterThanOrEqual(1);
  });
});

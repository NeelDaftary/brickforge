import { describe, expect, it } from 'vitest';
import { normalizeGridZ } from './grid-utils';

describe('grid utils', () => {
  it('shifts filled voxels down when lower layers are empty', () => {
    const grid = [
      [['0', '0', 'R'], ['0', '0', '0']],
      [['0', '0', 'B'], ['0', '0', '0']],
    ];

    const result = normalizeGridZ(grid);

    expect(result.offsetZ).toBe(2);
    expect(result.grid[0][0]).toEqual(['R']);
    expect(result.grid[1][0]).toEqual(['B']);
  });

  it('leaves already-grounded grids unchanged', () => {
    const grid = [[['R', '0']]];
    const result = normalizeGridZ(grid);

    expect(result.offsetZ).toBe(0);
    expect(result.grid).toBe(grid);
  });

  it('leaves empty grids unchanged', () => {
    const grid = [[['0', '0']]];
    const result = normalizeGridZ(grid);

    expect(result.offsetZ).toBe(0);
    expect(result.grid).toBe(grid);
  });
});

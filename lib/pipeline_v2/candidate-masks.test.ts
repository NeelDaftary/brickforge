import { describe, expect, it } from 'vitest';
import { buildCandidateMaskIndex } from './candidate-masks';

function gridFromLayer(layer: string[][], z = 0): string[][][] {
  const sx = layer[0]?.length ?? 0;
  const sy = layer.length;
  return Array.from({ length: sx }, (_, x) =>
    Array.from({ length: sy }, (_, y) => Array.from({ length: z + 1 }, (__, zi) => (zi === z ? layer[y][x] : '0'))),
  );
}

describe('candidate masks', () => {
  it('precomputes placements that match direct coverage validity', () => {
    const grid = gridFromLayer([['R', 'R', '0']]);
    const masks = buildCandidateMaskIndex({
      grid,
      z: 0,
      belowOwners: new Map(),
      surfaceCells: new Set(['0,0,0', '1,0,0']),
    });

    const anchorPlacements = masks.placementsByCell.get('0,0') ?? [];

    expect(anchorPlacements.some((placement) => placement.x === 0 && placement.y === 0 && placement.w === 2 && placement.d === 1)).toBe(true);
    expect(anchorPlacements.some((placement) => placement.x === 0 && placement.y === 0 && placement.w === 3 && placement.d === 1)).toBe(false);
  });

  it('marks unsupported and color-incompatible placements before candidate instantiation', () => {
    const grid = gridFromLayer([['R', 'B']], 1);
    const masks = buildCandidateMaskIndex({
      grid,
      z: 1,
      belowOwners: new Map(),
      surfaceCells: new Set(['0,0,1', '1,0,1']),
    });

    const mixedPlacement = (masks.placementsByCell.get('0,0') ?? []).find((placement) => placement.w === 2 && placement.d === 1);

    expect(mixedPlacement).toMatchObject({
      supportedStuds: 0,
      supportRatio: 0,
      colorCompatible: false,
    });
  });
});

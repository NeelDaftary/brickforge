import { describe, expect, it } from 'vitest';
import type { BrickInstance } from '@/lib/engine/types';
import { checkBrickStability, checkGridStability } from './brick-stability';

// ─── Helpers ──────────────────────────────────────────────────────────────────

let _nextId = 0;

/** Create a minimal BrickInstance with grid metadata. */
function brick(opts: {
  gx: number;
  gy: number;
  gz: number;
  gw?: number;
  gd?: number;
}): BrickInstance {
  const id = `brick_${_nextId++}`;
  return {
    id,
    brickId: 'b_1x1',
    position: [opts.gx, opts.gy, opts.gz],
    rotation: 0,
    studWidth: opts.gw ?? 1,
    studDepth: opts.gd ?? 1,
    color: '#ff0000',
    step: 0,
    metadata: {
      gx: opts.gx,
      gy: opts.gy,
      gz: opts.gz,
      gw: opts.gw ?? 1,
      gd: opts.gd ?? 1,
    },
  };
}

/**
 * Build a 3D grid filled with '0' of the given dimensions,
 * then fill specified cells with 'B'.
 */
function makeGrid(
  sizeX: number,
  sizeY: number,
  sizeZ: number,
  filled: [number, number, number][],
): string[][][] {
  const grid: string[][][] = [];
  for (let x = 0; x < sizeX; x++) {
    grid[x] = [];
    for (let y = 0; y < sizeY; y++) {
      grid[x][y] = [];
      for (let z = 0; z < sizeZ; z++) {
        grid[x][y][z] = '0';
      }
    }
  }
  for (const [x, y, z] of filled) {
    grid[x][y][z] = 'B';
  }
  return grid;
}

// ─── checkBrickStability ──────────────────────────────────────────────────────

describe('checkBrickStability', () => {
  it('returns zeroed result for empty input', () => {
    const result = checkBrickStability([]);
    expect(result.unstableCount).toBe(0);
    expect(result.marginalCount).toBe(0);
    expect(result.warnings).toHaveLength(0);
  });

  it('treats a single brick on the ground layer as stable', () => {
    const result = checkBrickStability([brick({ gx: 0, gy: 0, gz: 0 })]);
    expect(result.unstableCount).toBe(0);
    expect(result.marginalCount).toBe(0);
    expect(result.warnings).toHaveLength(0);
  });

  it('treats all ground-layer bricks as stable regardless of size', () => {
    const bricks = [
      brick({ gx: 0, gy: 0, gz: 0, gw: 4, gd: 2 }),
      brick({ gx: 4, gy: 0, gz: 0, gw: 2, gd: 2 }),
    ];
    const result = checkBrickStability(bricks);
    expect(result.unstableCount).toBe(0);
    expect(result.marginalCount).toBe(0);
  });

  it('marks a floating brick (not on ground, nothing below) as unstable', () => {
    const bricks = [
      brick({ gx: 0, gy: 0, gz: 0 }),  // ground brick
      brick({ gx: 5, gy: 2, gz: 0 }),   // floating — nothing at (5,1,0)
    ];
    const result = checkBrickStability(bricks);
    expect(result.unstableCount).toBe(1);
    expect(result.marginalCount).toBe(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('1 brick may be unstable');
  });

  it('considers a vertical stack fully supported and stable', () => {
    const bricks = [
      brick({ gx: 0, gy: 0, gz: 0 }),
      brick({ gx: 0, gy: 1, gz: 0 }),
      brick({ gx: 0, gy: 2, gz: 0 }),
      brick({ gx: 0, gy: 3, gz: 0 }),
    ];
    const result = checkBrickStability(bricks);
    expect(result.unstableCount).toBe(0);
    expect(result.marginalCount).toBe(0);
    expect(result.warnings).toHaveLength(0);
  });

  it('considers a 2x1 brick with 1 of 2 studs supported (50%) as stable', () => {
    // Ground: 1x1 at (0,0,0)
    // Layer 1: 2x1 at (0,1,0) — stud at (0,1,0) supported, stud at (1,1,0) unsupported
    // support_ratio = 1/2 = 0.5  →  NOT < 0.5, so stable
    const bricks = [
      brick({ gx: 0, gy: 0, gz: 0, gw: 1, gd: 1 }),
      brick({ gx: 0, gy: 1, gz: 0, gw: 2, gd: 1 }),
    ];
    const result = checkBrickStability(bricks);
    expect(result.unstableCount).toBe(0);
    expect(result.marginalCount).toBe(0);
  });

  it('marks a brick with partial overlap below 50% as unstable', () => {
    // Ground: 1x1 at (0,0,0)
    // Layer 1: 4x1 at (0,1,0) — 1 of 4 studs supported → ratio = 0.25 < 0.5
    const bricks = [
      brick({ gx: 0, gy: 0, gz: 0, gw: 1, gd: 1 }),
      brick({ gx: 0, gy: 1, gz: 0, gw: 4, gd: 1 }),
    ];
    const result = checkBrickStability(bricks);
    expect(result.unstableCount).toBe(1);
    expect(result.marginalCount).toBe(0);
  });

  it('downgrades to marginal when a weak brick is locked from above', () => {
    // Ground: 1x1 at (0,0,0)
    // Layer 1: 4x1 at (0,1,0) — 1/4 support → weak
    // Layer 2: 1x1 at (0,2,0) — locks layer 1 from above
    const bricks = [
      brick({ gx: 0, gy: 0, gz: 0, gw: 1, gd: 1 }),
      brick({ gx: 0, gy: 1, gz: 0, gw: 4, gd: 1 }),
      brick({ gx: 0, gy: 2, gz: 0, gw: 1, gd: 1 }),
    ];
    const result = checkBrickStability(bricks);
    expect(result.unstableCount).toBe(0);
    expect(result.marginalCount).toBe(1);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('marginal support');
  });

  it('reports both unstable and marginal counts when both exist', () => {
    const bricks = [
      brick({ gx: 0, gy: 0, gz: 0, gw: 1, gd: 1 }),
      // Marginal: weak support but locked from above
      brick({ gx: 0, gy: 1, gz: 0, gw: 4, gd: 1 }),  // 1/4 support, locked
      brick({ gx: 0, gy: 2, gz: 0, gw: 1, gd: 1 }),   // locks the above, itself fully supported
      // Unstable: floating with no support
      brick({ gx: 10, gy: 3, gz: 0, gw: 1, gd: 1 }),  // no support, not locked
    ];
    const result = checkBrickStability(bricks);
    expect(result.unstableCount).toBe(1);
    expect(result.marginalCount).toBe(1);
    expect(result.warnings).toHaveLength(2);
  });

  it('pluralizes warning messages for multiple unstable bricks', () => {
    const bricks = [
      brick({ gx: 0, gy: 0, gz: 0 }),
      brick({ gx: 10, gy: 5, gz: 0 }),
      brick({ gx: 20, gy: 5, gz: 0 }),
    ];
    const result = checkBrickStability(bricks);
    expect(result.unstableCount).toBe(2);
    expect(result.warnings[0]).toContain('2 bricks may be unstable');
  });

  it('uses position fallback when metadata grid coords are absent', () => {
    const floating: BrickInstance = {
      id: 'no-meta',
      brickId: 'b_1x1',
      position: [5, 3, 0],
      rotation: 0,
      studWidth: 1,
      studDepth: 1,
      color: '#ff0000',
      step: 0,
      // no metadata
    };
    const ground: BrickInstance = {
      id: 'ground',
      brickId: 'b_1x1',
      position: [0, 0, 0],
      rotation: 0,
      studWidth: 1,
      studDepth: 1,
      color: '#ff0000',
      step: 0,
    };
    const result = checkBrickStability([ground, floating]);
    expect(result.unstableCount).toBe(1);
  });

  it('handles a single non-ground layer (single layer above ground is floating)', () => {
    // Only one brick, not on ground
    const bricks = [brick({ gx: 0, gy: 1, gz: 0 })];
    const result = checkBrickStability(bricks);
    expect(result.unstableCount).toBe(1);
  });

  it('handles multi-stud bricks with full overlap as stable', () => {
    // 2x2 ground brick, 2x2 brick directly above — 100% support
    const bricks = [
      brick({ gx: 0, gy: 0, gz: 0, gw: 2, gd: 2 }),
      brick({ gx: 0, gy: 1, gz: 0, gw: 2, gd: 2 }),
    ];
    const result = checkBrickStability(bricks);
    expect(result.unstableCount).toBe(0);
    expect(result.marginalCount).toBe(0);
  });

  it('supports a brick resting on two separate bricks below', () => {
    // Two 1x1 bricks on ground at x=0 and x=1
    // One 2x1 brick on layer 1 spanning both — 100% support
    const bricks = [
      brick({ gx: 0, gy: 0, gz: 0, gw: 1, gd: 1 }),
      brick({ gx: 1, gy: 0, gz: 0, gw: 1, gd: 1 }),
      brick({ gx: 0, gy: 1, gz: 0, gw: 2, gd: 1 }),
    ];
    const result = checkBrickStability(bricks);
    expect(result.unstableCount).toBe(0);
    expect(result.marginalCount).toBe(0);
  });
});

// ─── checkGridStability ───────────────────────────────────────────────────────

describe('checkGridStability', () => {
  it('returns empty sets for an empty grid', () => {
    const result = checkGridStability([]);
    expect(result.unstable.size).toBe(0);
    expect(result.marginal.size).toBe(0);
  });

  it('treats ground-layer voxels as stable', () => {
    const grid = makeGrid(2, 2, 1, [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
      [1, 1, 0],
    ]);
    const result = checkGridStability(grid);
    expect(result.unstable.size).toBe(0);
    expect(result.marginal.size).toBe(0);
  });

  it('marks a completely floating voxel as unstable', () => {
    // Single voxel at z=1 with nothing below or adjacent
    const grid = makeGrid(3, 3, 3, [[1, 1, 1]]);
    const result = checkGridStability(grid);
    expect(result.unstable.has('1,1,1')).toBe(true);
    expect(result.marginal.size).toBe(0);
  });

  it('treats a voxel with direct support below as stable', () => {
    const grid = makeGrid(1, 1, 2, [
      [0, 0, 0],
      [0, 0, 1],
    ]);
    const result = checkGridStability(grid);
    expect(result.unstable.size).toBe(0);
    expect(result.marginal.size).toBe(0);
  });

  it('treats a voxel with two adjacent supports below as stable', () => {
    // Voxel at (1,0,1) has no direct support below (1,0,0 is empty)
    // but two adjacent neighbors at z-1: (0,0,0) and (1,1,0) → 2*0.5 = 1.0, not < 1.0
    // Note: actually need to be careful — adjacent means x+-1 or y+-1 at z-1
    const grid = makeGrid(3, 3, 2, [
      [0, 0, 0], // neighbor at x-1
      [2, 0, 0], // neighbor at x+1
      [1, 0, 1], // the voxel to check
    ]);
    const result = checkGridStability(grid);
    // support = 0 (no direct) + 2*0.5 = 1.0, NOT < 1.0 → stable
    expect(result.unstable.has('1,0,1')).toBe(false);
    expect(result.marginal.has('1,0,1')).toBe(false);
  });

  it('marks a voxel with only one adjacent support as unstable', () => {
    // Voxel at (1,0,1), only one adjacent neighbor at z-1
    // support = 0 + 1*0.5 = 0.5 < 1.0 → weak, and no lock above → unstable
    const grid = makeGrid(3, 1, 2, [
      [0, 0, 0], // one neighbor at x-1
      [1, 0, 1], // the voxel to check
    ]);
    const result = checkGridStability(grid);
    expect(result.unstable.has('1,0,1')).toBe(true);
  });

  it('downgrades weak voxel to marginal when locked from above', () => {
    // Voxel at (1,0,1) has only one adjacent support → weak
    // But locked from above by voxel at (1,0,2)
    const grid = makeGrid(3, 1, 3, [
      [0, 0, 0], // one neighbor at z-1 (adjacent)
      [1, 0, 1], // weak voxel
      [1, 0, 2], // lock from above
    ]);
    const result = checkGridStability(grid);
    expect(result.marginal.has('1,0,1')).toBe(true);
    expect(result.unstable.has('1,0,1')).toBe(false);
  });

  it('skips cells marked as empty ("0") or wildcard ("*")', () => {
    const grid = makeGrid(1, 1, 2, []);
    grid[0][0][1] = '*'; // wildcard at z=1 — should be skipped
    const result = checkGridStability(grid);
    expect(result.unstable.size).toBe(0);
    expect(result.marginal.size).toBe(0);
  });

  it('handles a vertical column as fully stable', () => {
    const grid = makeGrid(1, 1, 5, [
      [0, 0, 0],
      [0, 0, 1],
      [0, 0, 2],
      [0, 0, 3],
      [0, 0, 4],
    ]);
    const result = checkGridStability(grid);
    expect(result.unstable.size).toBe(0);
    expect(result.marginal.size).toBe(0);
  });

  it('identifies multiple unstable voxels in a sparse grid', () => {
    // Two floating voxels with no support at all
    const grid = makeGrid(5, 5, 3, [
      [0, 0, 2], // floating at z=2
      [4, 4, 2], // floating at z=2
    ]);
    const result = checkGridStability(grid);
    expect(result.unstable.size).toBe(2);
    expect(result.unstable.has('0,0,2')).toBe(true);
    expect(result.unstable.has('4,4,2')).toBe(true);
  });
});

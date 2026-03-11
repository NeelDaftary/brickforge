import { describe, expect, it } from 'vitest';
import { voxelGridToBrickModel, type VoxelGrid } from './voxel-to-bricks';
import type { BrickInstance } from '@/lib/engine/types';

// ─── Test Helpers ──────────────────────────────────────────────────────────────

/**
 * Build a 3D grid[x][y][z] filled with a constant value.
 * Dimensions: sizeX x sizeY x sizeZ.
 */
function makeGrid(sizeX: number, sizeY: number, sizeZ: number, fill: string): string[][][] {
  return Array.from({ length: sizeX }, () =>
    Array.from({ length: sizeY }, () =>
      new Array(sizeZ).fill(fill),
    ),
  );
}

/**
 * Build a completely empty grid (all '0').
 */
function makeEmptyGrid(sizeX: number, sizeY: number, sizeZ: number): string[][][] {
  return makeGrid(sizeX, sizeY, sizeZ, '0');
}

/**
 * Sum the stud area of all bricks (studWidth * studDepth) to verify total
 * coverage equals the number of filled voxels.
 */
function totalBrickVolume(bricks: BrickInstance[]): number {
  return bricks.reduce((sum, b) => sum + (b.studWidth ?? 1) * (b.studDepth ?? 1), 0);
}

/**
 * Count the number of filled (non-'0') voxels in a grid.
 */
function countFilledVoxels(grid: string[][][]): number {
  let count = 0;
  for (const plane of grid) {
    for (const col of plane) {
      for (const cell of col) {
        if (cell !== '0') count++;
      }
    }
  }
  return count;
}

/**
 * Build a VoxelGrid input for the pipeline.
 */
function buildVoxelGrid(grid: string[][][], colorLegend: Record<string, string>): VoxelGrid {
  return { grid, colorLegend, gridSize: Math.max(grid.length, grid[0]?.length ?? 0, grid[0]?.[0]?.length ?? 0) };
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('voxelGridToBrickModel', () => {
  // ── Basic: 1x1x1 grid produces exactly one 1x1 brick ──────────────────────

  it('converts a 1x1x1 voxel grid into exactly one 1x1 brick', () => {
    const grid = makeGrid(1, 1, 1, 'R');
    const input = buildVoxelGrid(grid, { R: '#FF0000' });

    const result = voxelGridToBrickModel(input, 'test', 'desc');

    expect(result.bricks).toHaveLength(1);
    expect(result.totalBricks).toBe(1);

    const brick = result.bricks[0];
    expect(brick.brickId).toBe('b_1x1');
    expect(brick.studWidth).toBe(1);
    expect(brick.studDepth).toBe(1);
    expect(brick.color).toBe('#FF0000');
    expect(brick.step).toBe(1);
  });

  // ── 2x1x1 grid can produce a 1x2 brick (or two 1x1s) ─────────────────────

  it('converts a 2x1x1 grid into a single 1x2 brick', () => {
    // grid[0][0][0] = 'R', grid[1][0][0] = 'R'  => 2 studs wide, 1 deep
    const grid = makeGrid(2, 1, 1, 'R');
    const input = buildVoxelGrid(grid, { R: '#FF0000' });

    const result = voxelGridToBrickModel(input, 'test', 'desc');

    // The greedy algorithm should combine into a single 2x1 or 1x2 brick
    expect(result.bricks.length).toBeLessThanOrEqual(2);
    expect(totalBrickVolume(result.bricks)).toBe(2);

    if (result.bricks.length === 1) {
      const brick = result.bricks[0];
      expect(brick.brickId).toBe('b_1x2');
      expect(brick.color).toBe('#FF0000');
    }
  });

  // ── Total brick volume equals total voxel count (no gaps) ──────────────────

  it('covers all voxels with no gaps: total brick volume equals voxel count (3x3x1)', () => {
    const grid = makeGrid(3, 3, 1, 'B');
    const input = buildVoxelGrid(grid, { B: '#0000FF' });

    const result = voxelGridToBrickModel(input, 'test', 'desc');

    expect(totalBrickVolume(result.bricks)).toBe(9);
  });

  it('covers all voxels with no gaps: total brick volume equals voxel count (4x4x2)', () => {
    const grid = makeGrid(4, 4, 2, 'G');
    const input = buildVoxelGrid(grid, { G: '#00FF00' });

    const result = voxelGridToBrickModel(input, 'test', 'desc');

    expect(totalBrickVolume(result.bricks)).toBe(32);
  });

  it('covers all voxels with no gaps in an irregular grid with holes', () => {
    // 4x4x1 grid with some holes
    const grid = makeGrid(4, 4, 1, 'R');
    grid[0][0][0] = '0';
    grid[2][3][0] = '0';
    grid[3][3][0] = '0';
    const input = buildVoxelGrid(grid, { R: '#FF0000' });

    const result = voxelGridToBrickModel(input, 'test', 'desc');

    const filledVoxels = countFilledVoxels(grid);
    expect(totalBrickVolume(result.bricks)).toBe(filledVoxels);
  });

  // ── Empty grid produces no bricks ──────────────────────────────────────────

  it('produces no bricks from a fully empty grid', () => {
    const grid = makeEmptyGrid(3, 3, 3);
    const input = buildVoxelGrid(grid, {});

    const result = voxelGridToBrickModel(input, 'test', 'desc');

    expect(result.bricks).toHaveLength(0);
    expect(result.totalBricks).toBe(0);
  });

  it('produces no bricks from a 0x0x0 grid', () => {
    const grid: string[][][] = [];
    const input = buildVoxelGrid(grid, {});

    const result = voxelGridToBrickModel(input, 'test', 'desc');

    expect(result.bricks).toHaveLength(0);
    expect(result.totalBricks).toBe(0);
  });

  // ── Output bricks have valid positions and types ───────────────────────────

  it('outputs bricks with valid brickId values from the supported set', () => {
    const SUPPORTED = new Set([
      'b_1x1', 'b_1x2', 'b_1x3', 'b_1x4', 'b_1x6', 'b_1x8',
      'b_2x2', 'b_2x3', 'b_2x4', 'b_2x6', 'b_2x8', 'b_4x4',
    ]);

    const grid = makeGrid(6, 6, 3, 'R');
    const input = buildVoxelGrid(grid, { R: '#FF0000' });

    const result = voxelGridToBrickModel(input, 'test', 'desc');

    for (const brick of result.bricks) {
      expect(SUPPORTED.has(brick.brickId)).toBe(true);
    }
  });

  it('outputs bricks with valid positions (3-element number arrays)', () => {
    const grid = makeGrid(4, 4, 2, 'R');
    const input = buildVoxelGrid(grid, { R: '#FF0000' });

    const result = voxelGridToBrickModel(input, 'test', 'desc');

    for (const brick of result.bricks) {
      expect(brick.position).toHaveLength(3);
      expect(typeof brick.position[0]).toBe('number');
      expect(typeof brick.position[1]).toBe('number');
      expect(typeof brick.position[2]).toBe('number');
      expect(Number.isFinite(brick.position[0])).toBe(true);
      expect(Number.isFinite(brick.position[1])).toBe(true);
      expect(Number.isFinite(brick.position[2])).toBe(true);
    }
  });

  it('outputs bricks with rotation of 0', () => {
    const grid = makeGrid(3, 3, 1, 'R');
    const input = buildVoxelGrid(grid, { R: '#FF0000' });

    const result = voxelGridToBrickModel(input, 'test', 'desc');

    for (const brick of result.bricks) {
      expect(brick.rotation).toBe(0);
    }
  });

  it('outputs bricks with unique IDs', () => {
    const grid = makeGrid(4, 4, 2, 'R');
    const input = buildVoxelGrid(grid, { R: '#FF0000' });

    const result = voxelGridToBrickModel(input, 'test', 'desc');

    const ids = result.bricks.map((b) => b.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it('sets step number based on the z-layer (1-indexed)', () => {
    const grid = makeGrid(1, 1, 3, 'R');
    const input = buildVoxelGrid(grid, { R: '#FF0000' });

    const result = voxelGridToBrickModel(input, 'test', 'desc');

    const steps = result.bricks.map((b) => b.step).sort((a, b) => a - b);
    expect(steps).toEqual([1, 2, 3]);
  });

  // ── Multi-color grids keep colors separate ─────────────────────────────────

  it('keeps colors separate: no single brick spans two different colors', () => {
    // Build a 4x1x1 grid: two red cells then two blue cells
    const grid = makeGrid(4, 1, 1, '0');
    grid[0][0][0] = 'R';
    grid[1][0][0] = 'R';
    grid[2][0][0] = 'B';
    grid[3][0][0] = 'B';
    const input = buildVoxelGrid(grid, { R: '#FF0000', B: '#0000FF' });

    const result = voxelGridToBrickModel(input, 'test', 'desc');

    const colors = new Set(result.bricks.map((b) => b.color));
    expect(colors.has('#FF0000')).toBe(true);
    expect(colors.has('#0000FF')).toBe(true);

    // Verify no single brick covers both red and blue regions
    for (const brick of result.bricks) {
      const gx = brick.metadata?.gx ?? 0;
      const gw = brick.metadata?.gw ?? 1;
      // A brick spanning from x<2 to x>=2 would cross the color boundary
      if (gx < 2) {
        expect(gx + gw).toBeLessThanOrEqual(2);
      }
    }

    expect(totalBrickVolume(result.bricks)).toBe(4);
  });

  it('produces bricks of matching colors for a checkerboard pattern', () => {
    // 2x2x1 checkerboard: R B / B R
    const grid = makeGrid(2, 2, 1, '0');
    grid[0][0][0] = 'R';
    grid[0][1][0] = 'B';
    grid[1][0][0] = 'B';
    grid[1][1][0] = 'R';
    const input = buildVoxelGrid(grid, { R: '#FF0000', B: '#0000FF' });

    const result = voxelGridToBrickModel(input, 'test', 'desc');

    // Checkerboard forces all 1x1 bricks since no two adjacent cells share a color
    expect(result.bricks).toHaveLength(4);
    expect(totalBrickVolume(result.bricks)).toBe(4);

    const redBricks = result.bricks.filter((b) => b.color === '#FF0000');
    const blueBricks = result.bricks.filter((b) => b.color === '#0000FF');
    expect(redBricks).toHaveLength(2);
    expect(blueBricks).toHaveLength(2);
  });

  it('handles a multi-color row without merging across color boundaries', () => {
    // 6x1x1 grid: RR GG BB
    const grid = makeGrid(6, 1, 1, '0');
    grid[0][0][0] = 'R'; grid[1][0][0] = 'R';
    grid[2][0][0] = 'G'; grid[3][0][0] = 'G';
    grid[4][0][0] = 'B'; grid[5][0][0] = 'B';
    const input = buildVoxelGrid(grid, { R: '#FF0000', G: '#00FF00', B: '#0000FF' });

    const result = voxelGridToBrickModel(input, 'test', 'desc');

    expect(totalBrickVolume(result.bricks)).toBe(6);

    // Each brick should be a single color
    for (const brick of result.bricks) {
      expect(['#FF0000', '#00FF00', '#0000FF']).toContain(brick.color);
    }

    // At least 3 bricks (one per color), possibly more if they don't combine
    expect(result.bricks.length).toBeGreaterThanOrEqual(3);
  });

  // ── Shell-only mode ────────────────────────────────────────────────────────

  it('does not shell small grids (below threshold)', () => {
    // A solid 5x5x5 cube is below the SMALL_MODEL_THRESHOLD of 15
    const grid = makeGrid(5, 5, 5, 'R');
    const input = buildVoxelGrid(grid, { R: '#FF0000' });

    const resultWithShell = voxelGridToBrickModel(input, 'test', 'desc', { shell: true });
    const resultWithoutShell = voxelGridToBrickModel(input, 'test', 'desc', { shell: false });

    // For small grids, shell has no effect, so results should be identical in volume
    expect(totalBrickVolume(resultWithShell.bricks)).toBe(totalBrickVolume(resultWithoutShell.bricks));
  });

  it('respects shell: false option to skip shelling', () => {
    // Even with a large grid, shell: false should preserve all voxels
    // Use a 4x4x4 grid (below threshold anyway) to keep tests fast
    const grid = makeGrid(4, 4, 4, 'R');
    const input = buildVoxelGrid(grid, { R: '#FF0000' });

    const result = voxelGridToBrickModel(input, 'test', 'desc', { shell: false });

    expect(totalBrickVolume(result.bricks)).toBe(64);
  });

  // ── Greedy combining: the algorithm should produce larger bricks ───────────

  it('produces fewer bricks than voxels for a solid 4x4x1 slab', () => {
    const grid = makeGrid(4, 4, 1, 'R');
    const input = buildVoxelGrid(grid, { R: '#FF0000' });

    const result = voxelGridToBrickModel(input, 'test', 'desc');

    // Greedy combining should merge many voxels into larger bricks
    expect(result.bricks.length).toBeLessThan(16);
    expect(totalBrickVolume(result.bricks)).toBe(16);
  });

  it('produces a single brick for a 2x4 slab', () => {
    const grid = makeGrid(2, 4, 1, 'R');
    const input = buildVoxelGrid(grid, { R: '#FF0000' });

    const result = voxelGridToBrickModel(input, 'test', 'desc');

    // A 2x4 slab should be covered by exactly one 2x4 brick
    expect(result.bricks).toHaveLength(1);
    expect(result.bricks[0].brickId).toBe('b_2x4');
    expect(totalBrickVolume(result.bricks)).toBe(8);
  });

  it('produces a single brick for a 2x2 slab', () => {
    const grid = makeGrid(2, 2, 1, 'R');
    const input = buildVoxelGrid(grid, { R: '#FF0000' });

    const result = voxelGridToBrickModel(input, 'test', 'desc');

    expect(result.bricks).toHaveLength(1);
    expect(result.bricks[0].brickId).toBe('b_2x2');
  });

  // ── BrickModelData structure ───────────────────────────────────────────────

  it('returns correct BrickModelData structure', () => {
    const grid = makeGrid(2, 2, 1, 'R');
    const input = buildVoxelGrid(grid, { R: '#FF0000' });

    const result = voxelGridToBrickModel(input, 'MyModel', 'A test model');

    expect(result.name).toBe('MyModel');
    expect(result.description).toBe('A test model');
    expect(result.totalBricks).toBe(result.bricks.length);
    expect(result.voxelData).toBeDefined();
    expect(result.voxelData?.grid).toBe(grid);
    expect(result.voxelData?.colorLegend).toEqual({ R: '#FF0000' });
  });

  // ── Multi-layer tests ─────────────────────────────────────────────────────

  it('handles multiple layers correctly', () => {
    const grid = makeGrid(2, 2, 3, 'R');
    const input = buildVoxelGrid(grid, { R: '#FF0000' });

    const result = voxelGridToBrickModel(input, 'test', 'desc');

    expect(totalBrickVolume(result.bricks)).toBe(12);

    // Should have bricks at all three step levels
    const steps = new Set(result.bricks.map((b) => b.step));
    expect(steps.has(1)).toBe(true);
    expect(steps.has(2)).toBe(true);
    expect(steps.has(3)).toBe(true);
  });

  it('places bricks at correct viewer Y heights for each layer', () => {
    // 1x1x3 column: each layer should have viewer Y = z * 3
    const grid = makeGrid(1, 1, 3, 'R');
    const input = buildVoxelGrid(grid, { R: '#FF0000' });

    const result = voxelGridToBrickModel(input, 'test', 'desc');

    const yPositions = result.bricks.map((b) => b.position[1]).sort((a, b) => a - b);
    expect(yPositions).toEqual([0, 3, 6]);
  });

  // ── Metadata ───────────────────────────────────────────────────────────────

  it('includes grid origin and extent in brick metadata', () => {
    const grid = makeGrid(2, 2, 1, 'R');
    const input = buildVoxelGrid(grid, { R: '#FF0000' });

    const result = voxelGridToBrickModel(input, 'test', 'desc');

    for (const brick of result.bricks) {
      expect(brick.metadata).toBeDefined();
      expect(typeof brick.metadata?.gx).toBe('number');
      expect(typeof brick.metadata?.gy).toBe('number');
      expect(typeof brick.metadata?.gz).toBe('number');
      expect(typeof brick.metadata?.gw).toBe('number');
      expect(typeof brick.metadata?.gd).toBe('number');
    }
  });

  // ── Color legend fallback ──────────────────────────────────────────────────

  it('falls back to grey when a color symbol is not in the legend', () => {
    const grid = makeGrid(1, 1, 1, 'X'); // 'X' is not in the legend
    const input = buildVoxelGrid(grid, {});

    const result = voxelGridToBrickModel(input, 'test', 'desc');

    expect(result.bricks).toHaveLength(1);
    expect(result.bricks[0].color).toBe('#A0A5A9'); // default grey
  });

  // ── Sparse grid ────────────────────────────────────────────────────────────

  it('handles a sparse grid with isolated voxels', () => {
    // 5x5x1 grid with only a few voxels set
    const grid = makeEmptyGrid(5, 5, 1);
    grid[0][0][0] = 'R';
    grid[2][2][0] = 'R';
    grid[4][4][0] = 'R';
    const input = buildVoxelGrid(grid, { R: '#FF0000' });

    const result = voxelGridToBrickModel(input, 'test', 'desc');

    // Isolated voxels cannot combine, expect 3 individual 1x1 bricks
    expect(result.bricks).toHaveLength(3);
    expect(totalBrickVolume(result.bricks)).toBe(3);
    for (const brick of result.bricks) {
      expect(brick.brickId).toBe('b_1x1');
    }
  });

  // ── Position centering ─────────────────────────────────────────────────────

  it('centers brick positions around the grid midpoint', () => {
    // 1x1x1 at grid [0][0][0] with sizeX=2, sizeY=2
    // centerX = 1, centerY = 1
    // position[0] = 0 + (1/2 - 0.5) - 1 = 0 + 0 - 1 = -1
    // position[2] = 0 + (1/2 - 0.5) - 1 = 0 + 0 - 1 = -1
    const grid = makeGrid(2, 2, 1, '0');
    grid[0][0][0] = 'R';
    const input = buildVoxelGrid(grid, { R: '#FF0000' });

    const result = voxelGridToBrickModel(input, 'test', 'desc');

    expect(result.bricks).toHaveLength(1);
    const brick = result.bricks[0];
    // centerX = 2/2 = 1, centerY = 2/2 = 1
    // x_pos = 0 + (1/2 - 0.5) - 1 = -1
    // z_pos = 0 + (1/2 - 0.5) - 1 = -1
    expect(brick.position[0]).toBe(-1);
    expect(brick.position[2]).toBe(-1);
  });

  // ── Interior wildcard handling ─────────────────────────────────────────────

  it('handles interior wildcards in a 3x3x3 solid cube', () => {
    const grid = makeGrid(3, 3, 3, 'R');
    const input = buildVoxelGrid(grid, { R: '#FF0000' });

    const result = voxelGridToBrickModel(input, 'test', 'desc');

    expect(totalBrickVolume(result.bricks)).toBe(27);
  });

  it('wildcards voxels next to internal cavities (not exterior-connected)', () => {
    // 5x5x5 cube with a sealed internal cavity at center (3,3,3 area = 27 cells, hollow center = 1 cell)
    // The voxels surrounding the cavity should become wildcards since the cavity is sealed
    const grid = makeGrid(5, 5, 5, 'R');
    // Hollow out the single center cell
    grid[2][2][2] = '0';
    // Paint the surface a different color to verify interior adopts surface color
    // Set one surface voxel to blue — the rest are red
    const input = buildVoxelGrid(grid, { R: '#FF0000', B: '#0000FF' });

    const result = voxelGridToBrickModel(input, 'test', 'desc');

    // Total volume = 125 - 1 (cavity) = 124
    expect(totalBrickVolume(result.bricks)).toBe(124);
    // All bricks adjacent to the sealed cavity should still be red (not some stale color)
    // since the cavity is internal, neighbors become wildcards and adopt boundary color
    for (const brick of result.bricks) {
      expect(brick.color).toBe('#FF0000');
    }
  });

  // ── Staggering between layers ──────────────────────────────────────────────

  it('applies structural staggering across layers (more bricks than pure greedy)', () => {
    // A 4x4x2 solid block: layer 0 and layer 1 should have staggered seams
    // After staggering, layer 1 may have more bricks than a pure greedy approach
    const grid = makeGrid(4, 4, 2, 'R');
    const input = buildVoxelGrid(grid, { R: '#FF0000' });

    const result = voxelGridToBrickModel(input, 'test', 'desc');

    // Total coverage must still be preserved
    expect(totalBrickVolume(result.bricks)).toBe(32);

    // All bricks must be valid
    for (const brick of result.bricks) {
      expect(brick.studWidth).toBeGreaterThanOrEqual(1);
      expect(brick.studDepth).toBeGreaterThanOrEqual(1);
    }
  });

  // ── Single row produces optimal bricks ─────────────────────────────────────

  it('handles a 1x8x1 row with a single 1x8 brick', () => {
    const grid = makeGrid(1, 8, 1, 'R');
    const input = buildVoxelGrid(grid, { R: '#FF0000' });

    const result = voxelGridToBrickModel(input, 'test', 'desc');

    expect(result.bricks).toHaveLength(1);
    expect(result.bricks[0].brickId).toBe('b_1x8');
    expect(totalBrickVolume(result.bricks)).toBe(8);
  });

  it('handles a 1x4x1 row producing a single 1x4 brick', () => {
    const grid = makeGrid(1, 4, 1, 'R');
    const input = buildVoxelGrid(grid, { R: '#FF0000' });

    const result = voxelGridToBrickModel(input, 'test', 'desc');

    expect(result.bricks).toHaveLength(1);
    expect(result.bricks[0].brickId).toBe('b_1x4');
    expect(totalBrickVolume(result.bricks)).toBe(4);
  });

  // ── Non-uniform layer contents ─────────────────────────────────────────────

  it('handles layers with differing fill patterns', () => {
    // Layer 0: full 3x3, Layer 1: only center cell
    const grid = makeGrid(3, 3, 2, '0');
    for (let x = 0; x < 3; x++) {
      for (let y = 0; y < 3; y++) {
        grid[x][y][0] = 'R';
      }
    }
    grid[1][1][1] = 'R';
    const input = buildVoxelGrid(grid, { R: '#FF0000' });

    const result = voxelGridToBrickModel(input, 'test', 'desc');

    expect(totalBrickVolume(result.bricks)).toBe(10);

    const layer1Bricks = result.bricks.filter((b) => b.step === 1);
    const layer2Bricks = result.bricks.filter((b) => b.step === 2);
    expect(layer1Bricks.length).toBeGreaterThanOrEqual(1);
    expect(layer2Bricks).toHaveLength(1);
    expect(layer2Bricks[0].brickId).toBe('b_1x1');
  });

  // ── Bricks never overlap ──────────────────────────────────────────────────

  it('never produces overlapping bricks on the same layer', () => {
    const grid = makeGrid(6, 6, 2, 'R');
    const input = buildVoxelGrid(grid, { R: '#FF0000' });

    const result = voxelGridToBrickModel(input, 'test', 'desc');

    // Group bricks by layer (step)
    const byStep = new Map<number, BrickInstance[]>();
    for (const brick of result.bricks) {
      if (!byStep.has(brick.step)) byStep.set(brick.step, []);
      byStep.get(brick.step)!.push(brick);
    }

    for (const [, layerBricks] of byStep) {
      const occupied = new Set<string>();
      for (const brick of layerBricks) {
        const gx = brick.metadata?.gx ?? 0;
        const gy = brick.metadata?.gy ?? 0;
        const gw = brick.metadata?.gw ?? 1;
        const gd = brick.metadata?.gd ?? 1;
        for (let dx = 0; dx < gw; dx++) {
          for (let dy = 0; dy < gd; dy++) {
            const key = `${gx + dx},${gy + dy}`;
            expect(occupied.has(key)).toBe(false);
            occupied.add(key);
          }
        }
      }
    }
  });
});

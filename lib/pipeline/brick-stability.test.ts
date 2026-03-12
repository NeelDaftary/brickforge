import { describe, expect, it } from 'vitest';
import type { BrickInstance } from '@/lib/engine/types';
import { checkBrickStability, checkGridStability } from './brick-stability';

// ─── Helpers ──────────────────────────────────────────────────────────────────

let _nextId = 0;

function brick(opts: {
  gx: number; gy: number; gz: number; gw?: number; gd?: number;
}): BrickInstance {
  const id = `brick_${_nextId++}`;
  return {
    id, brickId: 'b_1x1',
    position: [opts.gx, opts.gy, opts.gz],
    rotation: 0, studWidth: opts.gw ?? 1, studDepth: opts.gd ?? 1,
    color: '#ff0000', step: 0,
    metadata: { gx: opts.gx, gy: opts.gy, gz: opts.gz, gw: opts.gw ?? 1, gd: opts.gd ?? 1 },
  };
}

function makeGrid(
  sizeX: number, sizeY: number, sizeZ: number,
  filled: [number, number, number][],
): string[][][] {
  const grid: string[][][] = [];
  for (let x = 0; x < sizeX; x++) {
    grid[x] = [];
    for (let y = 0; y < sizeY; y++) {
      grid[x][y] = new Array(sizeZ).fill('0');
    }
  }
  for (const [x, y, z] of filled) grid[x][y][z] = 'B';
  return grid;
}

// ─── checkBrickStability ──────────────────────────────────────────────────────

describe('checkBrickStability', () => {
  it('returns zeroed result for empty input', () => {
    const r = checkBrickStability([]);
    expect(r.criticalCount).toBe(0);
    expect(r.weakCount).toBe(0);
    expect(r.marginalCount).toBe(0);
    expect(r.stableCount).toBe(0);
    expect(r.warnings).toHaveLength(0);
  });

  it('treats ground-layer bricks as stable regardless of size', () => {
    const bricks = [
      brick({ gx: 0, gy: 0, gz: 0 }),
      brick({ gx: 0, gy: 0, gz: 0, gw: 4, gd: 2 }),
      brick({ gx: 4, gy: 0, gz: 0, gw: 2, gd: 2 }),
    ];
    const r = checkBrickStability(bricks);
    expect(r.stableCount).toBe(3);
    expect(r.criticalCount + r.weakCount + r.marginalCount).toBe(0);
  });

  it('classifies tiers correctly at support ratio boundaries', () => {
    // Vertical stack: 100% support → stable
    const stack = [
      brick({ gx: 0, gy: 0, gz: 0 }),
      brick({ gx: 0, gy: 1, gz: 0 }),
      brick({ gx: 0, gy: 2, gz: 0 }),
    ];
    expect(checkBrickStability(stack).stableCount).toBe(3);

    // 50% support → stable
    const half = [
      brick({ gx: 0, gy: 0, gz: 0, gw: 1, gd: 1 }),
      brick({ gx: 0, gy: 1, gz: 0, gw: 2, gd: 1 }),
    ];
    expect(checkBrickStability(half).stableCount).toBe(2);

    // 25% support → weak
    const quarter = [
      brick({ gx: 0, gy: 0, gz: 0, gw: 1, gd: 1 }),
      brick({ gx: 0, gy: 1, gz: 0, gw: 4, gd: 1 }),
    ];
    const qr = checkBrickStability(quarter);
    expect(qr.weakCount).toBe(1);
    expect(qr.criticalCount).toBe(0);

    // <25% support → critical
    const tiny = [
      brick({ gx: 0, gy: 0, gz: 0, gw: 1, gd: 1 }),
      brick({ gx: 0, gy: 1, gz: 0, gw: 8, gd: 1 }),
    ];
    expect(checkBrickStability(tiny).criticalCount).toBe(1);

    // 0% support (floating) → critical
    const floating = [
      brick({ gx: 0, gy: 0, gz: 0 }),
      brick({ gx: 5, gy: 2, gz: 0 }),
    ];
    expect(checkBrickStability(floating).criticalCount).toBe(1);
  });

  it('downgrades to marginal when locked from above', () => {
    const bricks = [
      brick({ gx: 0, gy: 0, gz: 0, gw: 1, gd: 1 }),
      brick({ gx: 0, gy: 1, gz: 0, gw: 4, gd: 1 }), // 25% → would be weak
      brick({ gx: 0, gy: 2, gz: 0, gw: 1, gd: 1 }),   // locks from above
    ];
    const r = checkBrickStability(bricks);
    expect(r.marginalCount).toBe(1);
    expect(r.weakCount).toBe(0);
  });

  it('reports all tiers simultaneously with correct warnings', () => {
    const bricks = [
      brick({ gx: 0, gy: 0, gz: 0, gw: 1, gd: 1 }),
      brick({ gx: 0, gy: 1, gz: 0, gw: 4, gd: 1 }), // marginal (locked)
      brick({ gx: 0, gy: 2, gz: 0, gw: 1, gd: 1 }),   // stable (locks above)
      brick({ gx: 10, gy: 3, gz: 0, gw: 1, gd: 1 }),   // critical (floating)
    ];
    const r = checkBrickStability(bricks);
    expect(r.criticalCount).toBe(1);
    expect(r.marginalCount).toBe(1);
    expect(r.warnings.length).toBeGreaterThanOrEqual(2);
    expect(r.warnings.some((w) => w.includes('critical'))).toBe(true);
    expect(r.warnings.some((w) => w.includes('marginal'))).toBe(true);
  });

  it('uses position fallback when metadata is absent', () => {
    const floating: BrickInstance = {
      id: 'no-meta', brickId: 'b_1x1', position: [5, 3, 0],
      rotation: 0, studWidth: 1, studDepth: 1, color: '#ff0000', step: 0,
    };
    const ground: BrickInstance = {
      id: 'ground', brickId: 'b_1x1', position: [0, 0, 0],
      rotation: 0, studWidth: 1, studDepth: 1, color: '#ff0000', step: 0,
    };
    expect(checkBrickStability([ground, floating]).criticalCount).toBe(1);
  });

  it('supports multi-stud bricks and distributed support', () => {
    // Full overlap → stable
    const full = [
      brick({ gx: 0, gy: 0, gz: 0, gw: 2, gd: 2 }),
      brick({ gx: 0, gy: 1, gz: 0, gw: 2, gd: 2 }),
    ];
    expect(checkBrickStability(full).stableCount).toBe(2);

    // Resting on two separate bricks → stable
    const split = [
      brick({ gx: 0, gy: 0, gz: 0, gw: 1, gd: 1 }),
      brick({ gx: 1, gy: 0, gz: 0, gw: 1, gd: 1 }),
      brick({ gx: 0, gy: 1, gz: 0, gw: 2, gd: 1 }),
    ];
    expect(checkBrickStability(split).stableCount).toBe(3);
  });

  it('provides per-brick support info in brickSupport map', () => {
    const b1 = brick({ gx: 0, gy: 0, gz: 0, gw: 1, gd: 1 });
    const b2 = brick({ gx: 0, gy: 1, gz: 0, gw: 2, gd: 1 });
    const r = checkBrickStability([b1, b2]);

    expect(r.brickSupport.size).toBe(2);
    expect(r.brickSupport.get(b1.id)!.tier).toBe('stable');
    const info2 = r.brickSupport.get(b2.id)!;
    expect(info2.supportRatio).toBe(0.5);
    expect(info2.supportedStuds).toBe(1);
    expect(info2.totalStuds).toBe(2);
  });
});

// ─── checkGridStability ───────────────────────────────────────────────────────

describe('checkGridStability', () => {
  it('empty grid and ground-layer voxels are stable', () => {
    const empty = checkGridStability([]);
    expect(empty.critical.size + empty.weak.size + empty.marginal.size).toBe(0);

    const ground = makeGrid(2, 2, 1, [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0]]);
    const gr = checkGridStability(ground);
    expect(gr.stable.size).toBe(4);
    expect(gr.critical.size).toBe(0);
  });

  it('floating voxel is critical, direct support is stable', () => {
    const floating = makeGrid(3, 3, 3, [[1, 1, 1]]);
    expect(checkGridStability(floating).critical.has('1,1,1')).toBe(true);

    const supported = makeGrid(1, 1, 2, [[0, 0, 0], [0, 0, 1]]);
    const sr = checkGridStability(supported);
    expect(sr.stable.size).toBe(2);
    expect(sr.critical.size).toBe(0);
  });

  it('adjacent support: 2 neighbors → stable, 1 neighbor → weak, locked → marginal', () => {
    // Two adjacent supports at z-1 → stable
    const twoAdj = makeGrid(3, 3, 2, [[0, 0, 0], [2, 0, 0], [1, 0, 1]]);
    const tr = checkGridStability(twoAdj);
    expect(tr.critical.has('1,0,1')).toBe(false);
    expect(tr.weak.has('1,0,1')).toBe(false);

    // One adjacent support → weak
    const oneAdj = makeGrid(3, 1, 2, [[0, 0, 0], [1, 0, 1]]);
    const or = checkGridStability(oneAdj);
    expect(or.weak.has('1,0,1') || or.critical.has('1,0,1')).toBe(true);

    // One adjacent + locked from above → marginal
    const locked = makeGrid(3, 1, 3, [[0, 0, 0], [1, 0, 1], [1, 0, 2]]);
    expect(checkGridStability(locked).marginal.has('1,0,1')).toBe(true);
  });

  it('skips empty and wildcard cells', () => {
    const grid = makeGrid(1, 1, 2, []);
    grid[0][0][1] = '*';
    const r = checkGridStability(grid);
    expect(r.critical.size + r.weak.size + r.marginal.size).toBe(0);
  });

  it('identifies multiple critical voxels in sparse grid', () => {
    const grid = makeGrid(5, 5, 3, [[0, 0, 2], [4, 4, 2]]);
    const r = checkGridStability(grid);
    expect(r.critical.size).toBe(2);
    expect(r.critical.has('0,0,2')).toBe(true);
    expect(r.critical.has('4,4,2')).toBe(true);
  });
});

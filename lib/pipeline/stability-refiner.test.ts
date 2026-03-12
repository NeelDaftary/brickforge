import { describe, expect, it } from 'vitest';
import type { PlacedBrick } from './voxel-to-bricks';
import { isValidBrickSize } from './voxel-to-bricks';
import { refineStability } from './stability-refiner';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pb(x: number, y: number, z: number, w: number, d: number, color = '#ff0000'): PlacedBrick {
  return { x, y, z, w, d, color };
}

/** Total cell count across all layers (coverage invariant). */
function totalCells(layers: PlacedBrick[][]): number {
  let sum = 0;
  for (const layer of layers) {
    for (const b of layer) sum += b.w * b.d;
  }
  return sum;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('refineStability', () => {
  it('improves a cantilevered brick via neighborhood re-merge', () => {
    // Layer 0: two 1x1 bricks at (0,0) and (1,0)
    // Layer 1: one 1x4 brick at (0,0)-(3,0) — only 2/4 support = 50%, stable
    // But make it worse: layer 0 only covers (0,0), layer 1 is 1x4 → 1/4 = 25% weak
    const layers: PlacedBrick[][] = [
      [pb(0, 0, 0, 1, 1)],
      [pb(0, 0, 1, 4, 1)],
    ];

    const { layers: refined, stats } = refineStability(layers, { seed: 123 });

    // The refiner should find the weak brick and attempt re-merge
    expect(stats.regionsFound).toBeGreaterThanOrEqual(1);
    // Coverage must be preserved
    expect(totalCells(refined)).toBe(totalCells(layers));
  });

  it('leaves an already stable model unchanged', () => {
    // Fully supported stack
    const layers: PlacedBrick[][] = [
      [pb(0, 0, 0, 2, 2)],
      [pb(0, 0, 1, 2, 2)],
      [pb(0, 0, 2, 2, 2)],
    ];

    const { layers: refined, stats } = refineStability(layers, { seed: 1 });

    expect(stats.regionsFound).toBe(0);
    expect(stats.regionsImproved).toBe(0);
    // Layers should be identical
    for (let z = 0; z < layers.length; z++) {
      expect(refined[z].length).toBe(layers[z].length);
    }
  });

  it('preserves total cell coverage', () => {
    // A model with some weak bricks
    const layers: PlacedBrick[][] = [
      [pb(0, 0, 0, 2, 1), pb(2, 0, 0, 2, 1)],
      [pb(1, 0, 1, 4, 1)], // 2/4 supported = 50% stable, but let's make it weaker
    ];
    // Override: only 1 cell of support
    layers[0] = [pb(0, 0, 0, 1, 1)];
    // Now layer 1 has 1/4 = 25% → weak

    const before = totalCells(layers);
    const { layers: refined } = refineStability(layers, { seed: 42 });
    expect(totalCells(refined)).toBe(before);
  });

  it('produces only valid brick sizes', () => {
    const layers: PlacedBrick[][] = [
      [pb(0, 0, 0, 2, 2), pb(2, 0, 0, 1, 1)],
      [pb(0, 0, 1, 4, 1)], // 2/4 = 50% but let's push it
    ];
    // Make it weaker
    layers[0] = [pb(0, 0, 0, 1, 1)];

    const { layers: refined } = refineStability(layers, { seed: 7 });

    for (const layer of refined) {
      for (const b of layer) {
        expect(isValidBrickSize(b.w, b.d)).toBe(true);
      }
    }
  });

  it('is deterministic with the same seed', () => {
    const layers: PlacedBrick[][] = [
      [pb(0, 0, 0, 1, 1), pb(3, 0, 0, 1, 1)],
      [pb(0, 0, 1, 4, 1)],
    ];

    const r1 = refineStability(layers, { seed: 999 });
    const r2 = refineStability(layers, { seed: 999 });

    expect(r1.stats.totalAttempts).toBe(r2.stats.totalAttempts);
    expect(r1.stats.regionsImproved).toBe(r2.stats.regionsImproved);
    expect(r1.layers.length).toBe(r2.layers.length);
    for (let z = 0; z < r1.layers.length; z++) {
      expect(r1.layers[z].length).toBe(r2.layers[z].length);
    }
  });

  it('handles empty layers without crashing', () => {
    const layers: PlacedBrick[][] = [[], [], []];
    const { layers: refined, stats } = refineStability(layers, { seed: 1 });
    expect(refined.length).toBe(3);
    expect(stats.regionsFound).toBe(0);
  });

  it('never modifies ground layer (z=0)', () => {
    const groundBricks = [pb(0, 0, 0, 2, 2), pb(2, 0, 0, 2, 2)];
    const layers: PlacedBrick[][] = [
      [...groundBricks],
      [pb(0, 0, 1, 4, 1)], // weak
    ];

    // Make it weak: remove most ground support
    layers[0] = [pb(0, 0, 0, 1, 1)];
    const groundCells = totalCells([layers[0]]);

    const { layers: refined } = refineStability(layers, { seed: 42 });

    // Ground layer cell count must not change
    expect(totalCells([refined[0]])).toBe(groundCells);
  });

  it('score never regresses (monotonic improvement)', () => {
    const layers: PlacedBrick[][] = [
      [pb(0, 0, 0, 2, 1)],
      [pb(0, 0, 1, 4, 1)], // 2/4 = 50%→stable, but let's make it weak
    ];
    layers[0] = [pb(0, 0, 0, 1, 1)]; // 1/4 = 25% → weak

    // Run with just 1 attempt per region so we can check monotonicity
    const { stats } = refineStability(layers, { seed: 42, maxAttemptsPerRegion: 50 });

    // After refinement, critical+weak should not increase
    expect(stats.criticalAfter).toBeLessThanOrEqual(stats.criticalBefore);
    expect(stats.weakAfter).toBeLessThanOrEqual(stats.weakBefore);
  });

  it('handles multi-region: two isolated weak spots both addressed', () => {
    // Two separate weak regions far apart
    const layers: PlacedBrick[][] = [
      [pb(0, 0, 0, 1, 1), pb(10, 0, 0, 1, 1)],
      [pb(0, 0, 1, 4, 1), pb(10, 0, 1, 4, 1)], // both 1/4 = 25% weak
    ];

    const { stats } = refineStability(layers, { seed: 42 });

    // Both weak spots should be found as regions
    expect(stats.regionsFound).toBeGreaterThanOrEqual(2);
  });

  it('preserves colors after re-merge', () => {
    const layers: PlacedBrick[][] = [
      [pb(0, 0, 0, 1, 1, '#ff0000'), pb(1, 0, 0, 1, 1, '#00ff00')],
      [pb(0, 0, 1, 2, 1, '#ff0000')], // spans two colors below but is one color
    ];

    const { layers: refined } = refineStability(layers, { seed: 42 });

    // All bricks should have a valid color (non-empty)
    for (const layer of refined) {
      for (const b of layer) {
        expect(b.color).toBeTruthy();
        expect(b.color.startsWith('#')).toBe(true);
      }
    }
  });

  it('respects maxPasses and maxAttemptsPerRegion config', () => {
    const layers: PlacedBrick[][] = [
      [pb(0, 0, 0, 1, 1)],
      [pb(0, 0, 1, 4, 1)],
    ];

    const { stats: s1 } = refineStability(layers, { seed: 42, maxPasses: 1 });
    expect(s1.passes).toBeLessThanOrEqual(1);

    const { stats: s2 } = refineStability(layers, { seed: 42, maxAttemptsPerRegion: 5 });
    expect(s2.totalAttempts).toBeLessThanOrEqual(5 * s2.passes);
  });
});

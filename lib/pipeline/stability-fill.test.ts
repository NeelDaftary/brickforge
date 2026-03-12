import { describe, it, expect } from 'vitest';
import { fillGaps, type FillConfig } from './stability-fill';
import type { PlacedBrick } from './voxel-to-bricks';

/** Helper: build a layer array with the right number of slots. */
function makeLayers(count: number): PlacedBrick[][] {
  return Array.from({ length: count }, () => []);
}

describe('fillGaps', () => {
  it('floating brick gets support column to ground', () => {
    const layers = makeLayers(3);
    // Ground layer empty at (2,2), layer 2 has a floating brick
    layers[0].push({ x: 0, y: 0, z: 0, w: 2, d: 2, color: '#FF0000' });
    layers[2].push({ x: 2, y: 2, z: 2, w: 1, d: 1, color: '#00FF00' });

    const { layers: filled, stats } = fillGaps(layers);

    // Should have added support at (2,2) on layers 0 and 1
    const supports1 = filled[1].filter((b) => b.x === 2 && b.y === 2);
    const supports0 = filled[0].filter((b) => b.x === 2 && b.y === 2);
    expect(supports1).toHaveLength(1);
    expect(supports0).toHaveLength(1);
    expect(stats.cellsFilled).toBe(2);
    expect(stats.columnsBuilt).toBe(1);
  });

  it('already stable model returns zero fills', () => {
    const layers = makeLayers(2);
    layers[0].push({ x: 0, y: 0, z: 0, w: 2, d: 2, color: '#FF0000' });
    layers[1].push({ x: 0, y: 0, z: 1, w: 2, d: 2, color: '#FF0000' });

    const { stats } = fillGaps(layers);
    expect(stats.cellsFilled).toBe(0);
    expect(stats.columnsBuilt).toBe(0);
  });

  it('cascade stops at existing structure', () => {
    const layers = makeLayers(5);
    // Ground support
    layers[0].push({ x: 0, y: 0, z: 0, w: 2, d: 2, color: '#FF0000' });
    layers[1].push({ x: 0, y: 0, z: 1, w: 2, d: 2, color: '#FF0000' });
    // Structure at layer 2 (supported by layers below)
    layers[2].push({ x: 0, y: 0, z: 2, w: 2, d: 2, color: '#FF0000' });
    // Floating brick at layer 4 at (0,0)
    layers[4].push({ x: 0, y: 0, z: 4, w: 1, d: 1, color: '#00FF00' });

    const { layers: filled, stats } = fillGaps(layers);

    // Should only fill layer 3, since layer 2 already has structure at (0,0)
    const supports3 = filled[3].filter((b) => b.x === 0 && b.y === 0);
    expect(supports3).toHaveLength(1);
    // Layers 0-2 already had structure, no new fills there
    expect(filled[0].length).toBe(1); // original brick only
    expect(filled[1].length).toBe(1);
    expect(stats.cellsFilled).toBe(1);
  });

  it('budget cap respected', () => {
    const layers = makeLayers(10);
    // Ground layer with one brick
    layers[0].push({ x: 0, y: 0, z: 0, w: 1, d: 1, color: '#FF0000' });
    // Many floating bricks high up — would need lots of fill
    for (let i = 0; i < 10; i++) {
      layers[9].push({ x: i + 5, y: 0, z: 9, w: 1, d: 1, color: '#00FF00' });
    }

    // Very tight budget
    const config: FillConfig = { budgetRatio: 0.01 };
    const { stats } = fillGaps(layers, config);

    // Budget is max(floor(0.01 * totalCells), 20) = 20 (floor is tiny)
    expect(stats.cellsFilled).toBeLessThanOrEqual(20);
  });

  it('ground layer bricks never receive support', () => {
    const layers = makeLayers(1);
    layers[0].push({ x: 0, y: 0, z: 0, w: 2, d: 2, color: '#FF0000' });

    const { stats } = fillGaps(layers);
    expect(stats.cellsFilled).toBe(0);
  });

  it('support bricks are 1x1', () => {
    const layers = makeLayers(2);
    layers[1].push({ x: 0, y: 0, z: 1, w: 2, d: 2, color: '#FF0000' });

    const { layers: filled } = fillGaps(layers);

    const added = filled[0].filter((b) => b.color === '#A0A5A9');
    for (const b of added) {
      expect(b.w).toBe(1);
      expect(b.d).toBe(1);
    }
  });

  it('support bricks use configured color', () => {
    const layers = makeLayers(2);
    layers[1].push({ x: 0, y: 0, z: 1, w: 1, d: 1, color: '#FF0000' });

    const { layers: filled } = fillGaps(layers, { supportColor: '#123456' });

    const added = filled[0].filter((b) => b.color === '#123456');
    expect(added.length).toBeGreaterThan(0);
  });

  it('independent overhangs both filled', () => {
    const layers = makeLayers(2);
    // Two separate floating bricks
    layers[1].push({ x: 0, y: 0, z: 1, w: 1, d: 1, color: '#FF0000' });
    layers[1].push({ x: 5, y: 5, z: 1, w: 1, d: 1, color: '#00FF00' });

    const { layers: filled, stats } = fillGaps(layers);

    const atA = filled[0].filter((b) => b.x === 0 && b.y === 0);
    const atB = filled[0].filter((b) => b.x === 5 && b.y === 5);
    expect(atA).toHaveLength(1);
    expect(atB).toHaveLength(1);
    expect(stats.columnsBuilt).toBe(2);
  });

  it('empty layers in between are handled (cascade through them)', () => {
    const layers = makeLayers(4);
    // Ground brick at (0,0)
    layers[0].push({ x: 0, y: 0, z: 0, w: 1, d: 1, color: '#FF0000' });
    // Layers 1, 2 empty
    // Floating brick at layer 3 at different position
    layers[3].push({ x: 3, y: 3, z: 3, w: 1, d: 1, color: '#00FF00' });

    const { layers: filled, stats } = fillGaps(layers);

    // Should cascade through layers 2, 1, 0 at (3,3)
    expect(filled[2].some((b) => b.x === 3 && b.y === 3)).toBe(true);
    expect(filled[1].some((b) => b.x === 3 && b.y === 3)).toBe(true);
    expect(filled[0].some((b) => b.x === 3 && b.y === 3)).toBe(true);
    expect(stats.cellsFilled).toBe(3);
  });
});

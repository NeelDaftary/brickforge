import { describe, expect, it } from 'vitest';
import type { BrickInstance, BrickModelData } from '@/lib/engine/types';
import { analyzeBrickGraph } from './brick-graph';
import { applyRepairSuggestion, buildRepairSuggestions } from './guided-repair-v2';

function brick(id: string, opts: { x: number; y: number; z: number; w: number; d: number }): BrickInstance {
  return {
    id,
    brickId: `b_${Math.min(opts.w, opts.d)}x${Math.max(opts.w, opts.d)}`,
    position: [opts.x, opts.z * 3, opts.y],
    rotation: 0,
    studWidth: opts.w,
    studDepth: opts.d,
    color: '#DB0000',
    step: opts.z + 1,
    metadata: { gx: opts.x, gy: opts.z, gz: opts.y, gw: opts.w, gd: opts.d },
  };
}

function tailModel(): BrickModelData {
  const grid = Array.from({ length: 4 }, () =>
    Array.from({ length: 2 }, () => ['0', '0']),
  );
  for (let x = 0; x < 2; x++) {
    for (let y = 0; y < 2; y++) {
      grid[x][y][0] = 'R';
      grid[x][y][1] = 'R';
    }
  }
  grid[2][0][1] = 'R';
  grid[3][0][1] = 'R';

  return {
    name: 'cat tail',
    description: 'side attached tail',
    totalBricks: 3,
    bricks: [
      brick('base', { x: 0, y: 0, z: 0, w: 2, d: 2 }),
      brick('body', { x: 0, y: 0, z: 1, w: 2, d: 2 }),
      brick('tail', { x: 2, y: 0, z: 1, w: 2, d: 1 }),
    ],
    voxelData: {
      grid,
      colorLegend: { R: '#DB0000' },
      gridSize: 4,
    },
  };
}

describe('guided repair v2', () => {
  it('keeps side-attached tail regions out of detached floating repair class', () => {
    const diagnostics = analyzeBrickGraph(tailModel().bricks);

    expect(diagnostics.detachedFloatingBrickIds.size).toBe(0);
    expect(diagnostics.attachedCantileverBrickIds.has('tail')).toBe(true);
    expect(diagnostics.connectionClassByBrickId.get('tail')).toBe('attached_cantilever');
  });

  it('suggests root or brace repairs before last-resort columns for attached cantilevers', () => {
    const initial = buildRepairSuggestions(tailModel());
    const attachedRegion = initial.queue.find((region) => region.connectionClass === 'attached_cantilever');
    const result = buildRepairSuggestions(tailModel(), { activeRegionId: attachedRegion?.id });

    expect(result.activeRegion?.connectionClass).toBe('attached_cantilever');
    expect(result.suggestions.length).toBeGreaterThan(0);
    expect(result.suggestions[0].family).not.toBe('column_stand');
    expect(result.suggestions.some((suggestion) => (
      suggestion.family === 'strengthen_attachment_root' ||
      suggestion.family === 'hidden_internal_brace' ||
      suggestion.family === 'tapered_support'
    ))).toBe(true);
  });

  it('applies a selected suggestion by rebricking the source voxel grid', () => {
    const model = tailModel();
    const result = buildRepairSuggestions(model);
    const suggestion = result.suggestions[0];

    expect(result.activeRegion).toBeDefined();
    expect(suggestion).toBeDefined();

    const repaired = applyRepairSuggestion(model, result.activeRegion!.id, suggestion.id);

    expect(repaired.totalBricks).toBeGreaterThan(0);
    expect(repaired.voxelData).toBeDefined();
    expect(repaired.diagnostics?.layout?.detachedFloatingBricks ?? repaired.diagnostics?.layout?.floatingBricks).toBe(0);
  });
});

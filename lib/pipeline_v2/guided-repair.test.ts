import { describe, expect, it } from 'vitest';
import type { BrickModelData } from '@/lib/engine/types';
import { analyzeBrickGraph, summarizeGraphDiagnostics } from './brick-graph';
import { buildGuidedRepairSuggestions } from './guided-repair';

function brick(id: string, x: number, y: number, z: number, w = 1, d = 1) {
  return {
    id,
    brickId: `b_${Math.min(w, d)}x${Math.max(w, d)}`,
    position: [x, z * 3, y] as [number, number, number],
    rotation: 0 as const,
    studWidth: w,
    studDepth: d,
    color: '#DB0000',
    step: z + 1,
    metadata: { gx: x, gy: z, gz: y, gw: w, gd: d },
  };
}

describe('guided repair suggestions', () => {
  it('proposes user-approved support columns for unsupported bricks', () => {
    const model: BrickModelData = {
      name: 'unsupported',
      description: '',
      totalBricks: 1,
      bricks: [brick('unsupported', 0, 0, 1)],
    };

    const suggestions = buildGuidedRepairSuggestions(model);
    const minimal = suggestions.find((suggestion) => suggestion.id === 'minimal_support');

    expect(minimal).toBeDefined();
    expect(minimal?.addedBricks).toBe(1);
    expect(minimal?.before.unsupportedBricks).toBe(1);
    expect(minimal?.after.unsupportedBricks).toBe(0);
    expect(minimal?.after.floatingBricks).toBe(0);
  });

  it('can fully support weak cantilevers when the user accepts the larger repair', () => {
    const model: BrickModelData = {
      name: 'weak',
      description: '',
      totalBricks: 2,
      bricks: [
        brick('base', 0, 0, 0, 1, 1),
        brick('weak', 0, 0, 1, 4, 1),
      ],
    };
    const before = summarizeGraphDiagnostics(analyzeBrickGraph(model.bricks));

    const full = buildGuidedRepairSuggestions(model).find((suggestion) => suggestion.id === 'full_support');

    expect(before.weakCantilevers).toBe(1);
    expect(full).toBeDefined();
    expect(full?.addedBricks).toBe(3);
    expect(full?.after.weakCantilevers).toBe(0);
    expect(full?.after.unsupportedBricks).toBe(0);
  });
});

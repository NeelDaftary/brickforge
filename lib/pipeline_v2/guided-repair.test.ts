import { describe, expect, it } from 'vitest';
import type { BrickModelData } from '@/lib/engine/types';
import { analyzeBrickGraph, summarizeGraphDiagnostics } from './brick-graph';
import { buildGuidedRepairIssues } from './guided-repair';

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

    const issues = buildGuidedRepairIssues(model);
    const minimal = issues[0]?.suggestions[0];

    expect(minimal).toBeDefined();
    expect(minimal?.application).toBe('direct');
    expect(minimal?.editedVoxelData).toBeUndefined();
    expect(minimal?.addedBricks).toBe(1);
    expect(minimal?.before.unsupportedBricks).toBe(1);
    expect(minimal?.after.unsupportedBricks).toBe(0);
    expect(minimal?.after.floatingBricks).toBe(0);
  });

  it('turns voxel-backed repairs into source-grid intents for rebricking', () => {
    const model: BrickModelData = {
      name: 'unsupported source',
      description: '',
      totalBricks: 1,
      bricks: [brick('unsupported', 0, 0, 1)],
      voxelData: {
        grid: [[['0', 'R']]],
        colorLegend: { R: '#DB0000' },
        gridSize: 2,
      },
    };

    const minimal = buildGuidedRepairIssues(model)[0]?.suggestions[0];

    expect(minimal).toBeDefined();
    expect(minimal?.application).toBe('rebrick');
    expect(minimal?.addedVoxels).toBe(1);
    expect(minimal?.intent.supportCells).toEqual([{ x: 0, y: 0, z: 0 }]);
    expect(minimal?.editedVoxelData?.grid[0][0][0]).toBe('E');
    expect(minimal?.editedVoxelData?.grid[0][0][1]).toBe('R');
    expect(minimal?.editedVoxelData?.colorLegend.E).toBe('#A0A5A9');
  });

  it('does not propose structural edits for already grounded bricks', () => {
    const model: BrickModelData = {
      name: 'stable',
      description: '',
      totalBricks: 1,
      bricks: [brick('ground', 0, 0, 0)],
      voxelData: {
        grid: [[['R']]],
        colorLegend: { R: '#DB0000' },
        gridSize: 1,
      },
    };

    expect(buildGuidedRepairIssues(model)).toEqual([]);
  });

  it('orders repair issues from lower layers upward', () => {
    const model: BrickModelData = {
      name: 'bottom up',
      description: '',
      totalBricks: 2,
      bricks: [
        brick('higher', 0, 0, 3),
        brick('lower', 1, 0, 1),
      ],
      voxelData: {
        grid: [
          [['0', '0', '0', 'R']],
          [['0', 'R', '0', '0']],
        ],
        colorLegend: { R: '#DB0000' },
        gridSize: 4,
      },
    };

    const issues = buildGuidedRepairIssues(model);

    expect(issues.length).toBeGreaterThanOrEqual(2);
    expect(issues[0].primaryBrickId).toBe('lower');
    expect(issues[0].layer).toBe(1);
    expect(issues[1].primaryBrickId).toBe('higher');
    expect(issues[1].layer).toBe(3);
  });

  it('scopes issue suggestions to one selected defect instead of the whole model', () => {
    const model: BrickModelData = {
      name: 'local only',
      description: '',
      totalBricks: 2,
      bricks: [
        brick('left', 0, 0, 1),
        brick('right', 1, 0, 1),
      ],
      voxelData: {
        grid: [
          [['0', 'R']],
          [['0', 'R']],
        ],
        colorLegend: { R: '#DB0000' },
        gridSize: 2,
      },
    };

    const issues = buildGuidedRepairIssues(model);
    const firstSuggestion = issues[0].suggestions[0];

    expect(issues).toHaveLength(2);
    expect(firstSuggestion.targetBrickIds).toEqual([issues[0].primaryBrickId]);
    expect(firstSuggestion.addedVoxels).toBe(1);
    expect(firstSuggestion.intent.supportCells).toHaveLength(1);
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

    const footprint = buildGuidedRepairIssues(model)
      .find((issue) => issue.defectType === 'critical_cantilever')
      ?.suggestions.find((suggestion) => (
      suggestion.title === 'Support this brick footprint'
    ));

    expect(before.weakCantilevers).toBe(1);
    expect(footprint).toBeDefined();
    expect(footprint?.addedBricks).toBe(3);
    expect(footprint?.after.weakCantilevers).toBe(0);
    expect(footprint?.after.unsupportedBricks).toBe(0);
  });
});

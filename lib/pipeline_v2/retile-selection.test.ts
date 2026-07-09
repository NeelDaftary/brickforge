import { describe, expect, it } from 'vitest';
import type { GeneratedModel } from '@/lib/pipeline/model-diagnostics';
import { voxelGridToBrickModelV2 } from './stability-bricker';
import { buildRetileSelectionCandidates } from './retile-selection';

function model(): GeneratedModel {
  const grid = Array.from({ length: 7 }, (_, x) => [
    [x < 4 ? 'R' : x === 4 ? '0' : 'B'],
  ]);
  const built = voxelGridToBrickModelV2(
    { grid, colorLegend: { R: '#DB0000', B: '#0059CF' }, gridSize: 7 },
    'Retile fixture',
    'fixture',
    { shell: false, repair: false, refine: false, variant: 'stability_v2' },
  );
  return built;
}

function coveredCells(model: GeneratedModel): Set<string> {
  const cells = new Set<string>();
  for (const brick of model.bricks) {
    const gx = brick.metadata?.gx;
    const layer = brick.metadata?.gy;
    const depth = brick.metadata?.gz;
    if (gx == null || layer == null || depth == null) continue;
    const gw = brick.metadata?.gw ?? brick.studWidth ?? 1;
    const gd = brick.metadata?.gd ?? brick.studDepth ?? 1;
    for (let dx = 0; dx < gw; dx++) {
      for (let dy = 0; dy < gd; dy++) cells.add(`${gx + dx},${depth + dy},${layer}`);
    }
  }
  return cells;
}

describe('buildRetileSelectionCandidates', () => {
  it('returns stable candidate labels and metrics', () => {
    const result = buildRetileSelectionCandidates(model(), [{ x: 0, y: 0, z: 0 }]);

    expect(result.candidates.map((candidate) => candidate.label)).toEqual([
      'Balanced',
      'Fewer pieces',
      'Stronger layout',
    ]);
    expect(result.candidates[0].recommended).toBe(true);
    expect(result.candidates[0].metrics.selectedCells).toBe(1);
    expect(result.candidates[0].metrics.affectedBricks).toBeGreaterThan(0);
  });

  it('preserves voxel occupancy outside the selected brick footprint', () => {
    const original = model();
    const result = buildRetileSelectionCandidates(original, [{ x: 0, y: 0, z: 0 }], ['balanced']);
    const candidate = result.candidates[0].model;

    expect(candidate.voxelData).toEqual(original.voxelData);
    expect(coveredCells(candidate)).toEqual(coveredCells(original));
    expect(candidate.bricks.some((brick) => brick.color.toLowerCase() === '#0059cf')).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import type { BrickInstance } from '@/lib/engine/types';
import { analyzeBrickGraph, buildAttachmentTree, buildBrickGraph, descendantIds, summarizeGraphDiagnostics } from './brick-graph';

function brick(id: string, opts: { x: number; y: number; z: number; w: number; d: number }): BrickInstance {
  return {
    id,
    brickId: `b_${Math.min(opts.w, opts.d)}x${Math.max(opts.w, opts.d)}`,
    position: [0, 0, 0],
    rotation: 0,
    studWidth: opts.w,
    studDepth: opts.d,
    color: '#DB0000',
    step: opts.z + 1,
    metadata: { gx: opts.x, gy: opts.z, gz: opts.y, gw: opts.w, gd: opts.d },
  };
}

describe('brick graph diagnostics', () => {
  it('classifies partial overhangs as supported cantilevers, not unsupported', () => {
    const bricks = [
      brick('base', { x: 0, y: 0, z: 0, w: 2, d: 2 }),
      brick('overhang', { x: 0, y: 0, z: 1, w: 4, d: 1 }),
    ];

    const diagnostics = analyzeBrickGraph(bricks);
    const support = diagnostics.support.get('overhang');

    expect(support).toMatchObject({
      supportedStuds: 2,
      totalStuds: 4,
      overhangStuds: 2,
      supportRatio: 0.5,
      classification: 'supported_cantilever',
    });
    expect(diagnostics.unsupportedBrickIds.has('overhang')).toBe(false);
    expect(diagnostics.cantileveredBrickIds.has('overhang')).toBe(true);
  });

  it('classifies bricks with no vertical contact as unsupported and floating', () => {
    const bricks = [
      brick('base', { x: 0, y: 0, z: 0, w: 2, d: 2 }),
      brick('floating', { x: 5, y: 0, z: 1, w: 2, d: 2 }),
    ];

    const diagnostics = analyzeBrickGraph(bricks);

    expect(diagnostics.support.get('floating')?.classification).toBe('unsupported');
    expect(diagnostics.unsupportedBrickIds.has('floating')).toBe(true);
    expect(diagnostics.floatingBrickIds.has('floating')).toBe(true);
    expect(diagnostics.connectedComponents).toHaveLength(2);
  });

  it('builds weighted vertical edges from stud overlap', () => {
    const graph = buildBrickGraph([
      brick('base', { x: 0, y: 0, z: 0, w: 4, d: 1 }),
      brick('top', { x: 1, y: 0, z: 1, w: 2, d: 1 }),
    ]);

    const edge = graph.edges.find((e) => e.type === 'vertical' && e.from === 'base' && e.to === 'top');
    expect(edge?.weight).toBe(2);
  });

  it('detects articulation bricks and bridge edges in vertical support chains', () => {
    const diagnostics = analyzeBrickGraph([
      brick('base', { x: 0, y: 0, z: 0, w: 2, d: 2 }),
      brick('middle', { x: 0, y: 0, z: 1, w: 2, d: 2 }),
      brick('top', { x: 0, y: 0, z: 2, w: 2, d: 2 }),
    ]);

    expect(diagnostics.articulationBrickIds.has('middle')).toBe(true);
    expect(diagnostics.bridgeEdges.some((edge) => edge.from === 'middle' && edge.to === 'top')).toBe(true);
    expect(diagnostics.loadAbove.get('base')).toEqual({ dependentBrickCount: 2, loadAboveStuds: 8 });
  });

  it('measures repeated seam alignment across adjacent layers', () => {
    const diagnostics = analyzeBrickGraph([
      brick('a0', { x: 0, y: 0, z: 0, w: 2, d: 1 }),
      brick('b0', { x: 2, y: 0, z: 0, w: 2, d: 1 }),
      brick('a1', { x: 0, y: 0, z: 1, w: 2, d: 1 }),
      brick('b1', { x: 2, y: 0, z: 1, w: 2, d: 1 }),
    ]);

    expect(diagnostics.seamAlignment.totalSeams).toBe(2);
    expect(diagnostics.seamAlignment.repeatedAdjacentLayerSeams).toBe(1);
    expect(diagnostics.seamAlignment.maxVerticalRun).toBe(2);
  });

  it('summarizes graph diagnostics into JSON-safe benchmark metrics', () => {
    const summary = summarizeGraphDiagnostics(analyzeBrickGraph([
      brick('base', { x: 0, y: 0, z: 0, w: 2, d: 2 }),
      brick('overhang', { x: 0, y: 0, z: 1, w: 4, d: 1 }),
    ]));

    expect(summary).toMatchObject({
      connectedComponents: 1,
      floatingBricks: 0,
      unsupportedBricks: 0,
      supportedCantilevers: 1,
      weakCantilevers: 0,
      gateStatus: 'warn',
    });
    expect(summary.healthScore).toBeGreaterThanOrEqual(0);
  });

  it('chooses strongest vertical support as attachment parent and exposes descendants', () => {
    const graph = buildBrickGraph([
      brick('left', { x: 0, y: 0, z: 0, w: 2, d: 2 }),
      brick('right', { x: 2, y: 0, z: 0, w: 1, d: 1 }),
      brick('child', { x: 0, y: 0, z: 1, w: 3, d: 1 }),
      brick('grandchild', { x: 0, y: 0, z: 2, w: 1, d: 1 }),
    ]);

    const tree = buildAttachmentTree(graph);

    expect(tree.parentByBrickId.get('child')).toBe('left');
    expect(descendantIds(tree, 'child')).toEqual(new Set(['grandchild']));
  });

  it('ranks weak regions with floating defects first', () => {
    const diagnostics = analyzeBrickGraph([
      brick('base', { x: 0, y: 0, z: 0, w: 2, d: 2 }),
      brick('floating', { x: 5, y: 0, z: 1, w: 2, d: 2 }),
      brick('weak', { x: 0, y: 0, z: 1, w: 4, d: 1 }),
    ]);

    expect(diagnostics.weakRegions[0]).toMatchObject({
      defectType: 'floating',
      primaryBrickId: 'floating',
    });
  });
});

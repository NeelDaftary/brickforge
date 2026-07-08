import { describe, expect, it } from 'vitest';
import type { BrickInstance, BrickModelData } from '@/lib/engine/types';
import { POST as suggestionsPost } from './suggestions/route';
import { POST as applyPost } from './apply/route';

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

function req(url: string, body: unknown): Parameters<typeof suggestionsPost>[0] {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as Parameters<typeof suggestionsPost>[0];
}

function model(): BrickModelData {
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

describe('repair API', () => {
  it('returns weak-region suggestions with attached cantilever classification', async () => {
    const initial = await suggestionsPost(req('http://localhost/api/repair/suggestions', { model: model() }));
    const initialBody = await initial.json();
    const attachedRegion = initialBody.queue.find((region: { connectionClass: string }) => region.connectionClass === 'attached_cantilever');
    const res = await suggestionsPost(req('http://localhost/api/repair/suggestions', {
      model: model(),
      activeRegionId: attachedRegion.id,
    }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.activeRegion.connectionClass).toBe('attached_cantilever');
    expect(body.suggestions.length).toBeGreaterThan(0);
    expect(body.suggestions[0].preview).toBeDefined();
  });

  it('applies a selected suggestion and returns fresh diagnostics', async () => {
    const suggestions = await suggestionsPost(req('http://localhost/api/repair/suggestions', { model: model() }));
    const suggestionsBody = await suggestions.json();
    const suggestion = suggestionsBody.suggestions[0];

    const res = await applyPost(req('http://localhost/api/repair/apply', {
      model: model(),
      regionId: suggestionsBody.activeRegion.id,
      suggestionId: suggestion.id,
    }) as Parameters<typeof applyPost>[0]);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.totalBricks).toBeGreaterThan(0);
    expect(body.diagnostics.layout).toBeDefined();
    expect(body.diagnostics.layout.detachedFloatingBricks ?? body.diagnostics.layout.floatingBricks).toBe(0);
  });
});

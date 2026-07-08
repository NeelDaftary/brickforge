import { describe, expect, it } from 'vitest';
import type { BrickInstance } from '@/lib/engine/types';
import { runPhysicsOracle } from './physics-oracle';

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

describe('physics oracle', () => {
  it('flags no-support and center-outside-support weak regions', () => {
    const result = runPhysicsOracle([
      brick('base', { x: 0, y: 0, z: 0, w: 1, d: 1 }),
      brick('cantilever', { x: 0, y: 0, z: 1, w: 4, d: 1 }),
      brick('floating', { x: 8, y: 0, z: 1, w: 1, d: 1 }),
    ]);

    expect(result.failureBrickIds).toContain('floating');
    expect(result.failureBrickIds).toContain('cantilever');
  });
});

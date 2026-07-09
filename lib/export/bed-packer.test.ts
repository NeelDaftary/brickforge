import { describe, expect, it } from 'vitest';
import type { BrickInstance, BrickModelData } from '../engine/types';
import { packBed } from './bed-packer';
import type { BedBrick } from './types';

function brick(id: string, index: number): BrickInstance {
  return {
    id: `${id}-${index}`,
    brickId: id,
    position: [0, 0, 0],
    rotation: 0,
    color: '#ffffff',
    step: 1,
  };
}

function meshFootprint(brick: BedBrick): { x: number; z: number; w: number; d: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  for (let i = 0; i < brick.mesh.vertices.length; i += 3) {
    const x = brick.mesh.vertices[i];
    const z = brick.mesh.vertices[i + 2];
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }

  const w = maxX - minX;
  const d = maxZ - minZ;
  return {
    x: brick.bedPosition[0],
    z: brick.bedPosition[1],
    w: brick.rotated ? d : w,
    d: brick.rotated ? w : d,
  };
}

function overlaps(a: ReturnType<typeof meshFootprint>, b: ReturnType<typeof meshFootprint>): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.z < b.z + b.d && a.z + a.d > b.z;
}

function clearance(a: ReturnType<typeof meshFootprint>, b: ReturnType<typeof meshFootprint>): number {
  const xGap = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w), 0);
  const zGap = Math.max(b.z - (a.z + a.d), a.z - (b.z + b.d), 0);
  return Math.max(xGap, zGap);
}

describe('packBed', () => {
  it('preserves rotated placements so packed STL meshes do not overlap', () => {
    const model: BrickModelData = {
      name: 'rotated packing',
      description: 'two long bricks on a constrained bed',
      totalBricks: 2,
      bricks: [brick('b_1x10', 0), brick('b_1x10', 1)],
    };

    const result = packBed(model, { bedWidth: 30, bedDepth: 90, gap: 2 });

    expect(result.plates).toHaveLength(1);
    expect(result.plates[0].bricks).toHaveLength(2);
    expect(result.plates[0].bricks.every((placed) => placed.rotated)).toBe(true);

    const [a, b] = result.plates[0].bricks.map(meshFootprint);
    expect(overlaps(a, b)).toBe(false);
    expect(clearance(a, b)).toBeGreaterThanOrEqual(1.999);
  });
});

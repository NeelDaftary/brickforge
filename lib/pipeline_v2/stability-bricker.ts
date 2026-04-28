import { voxelGridToBrickModel, type VoxelGrid } from '@/lib/pipeline/voxel-to-bricks';
import type { BrickModelData } from '@/lib/engine/types';

interface StabilityV2Options {
  shell?: boolean;
}

/**
 * Parallel bricker engine scaffold.
 *
 * Intentionally delegates to the legacy tiler for now so we can wire
 * engine selection + shadow comparison safely before introducing
 * aggressive structural changes.
 */
export function voxelGridToBrickModelV2(
  voxelGrid: VoxelGrid,
  name: string,
  description: string,
  options?: StabilityV2Options,
): BrickModelData {
  return voxelGridToBrickModel(voxelGrid, name, description, options);
}

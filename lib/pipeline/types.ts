/**
 * Pipeline-specific stages for BrickForge upload, voxelization, and bricking.
 */

export type PipelineStage =
  | 'idle'
  | 'uploading'
  | 'validating'
  | 'voxelizing'
  | 'optimizing_bricks'
  | 'ready'
  | 'error';

export const STAGE_LABELS: Record<PipelineStage, string> = {
  idle: 'Ready',
  uploading: 'Uploading mesh files...',
  validating: 'Validating mesh...',
  voxelizing: 'Converting to voxel grid...',
  optimizing_bricks: 'Optimizing brick layout...',
  ready: 'Build ready!',
  error: 'Something went wrong',
};

export const STAGE_PROGRESS: Record<PipelineStage, number> = {
  idle: 0,
  uploading: 10,
  validating: 25,
  voxelizing: 50,
  optimizing_bricks: 80,
  ready: 100,
  error: 0,
};

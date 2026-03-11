/**
 * Pipeline-specific types for the BrickForge generation flow.
 */

export type PipelineStage =
  | 'idle'
  | 'uploading'
  | 'refining_prompt'
  | 'generating_model'
  | 'exporting_mesh'
  | 'downloading_mesh'
  | 'validating'
  | 'voxelizing'
  | 'optimizing_bricks'
  | 'ready'
  | 'error';

export const STAGE_LABELS: Record<PipelineStage, string> = {
  idle: 'Ready',
  uploading: 'Uploading mesh files...',
  refining_prompt: 'Crafting generation prompt...',
  generating_model: 'Generating 3D model...',
  exporting_mesh: 'Exporting mesh...',
  downloading_mesh: 'Downloading 3D model...',
  validating: 'Validating mesh...',
  voxelizing: 'Converting to voxel grid...',
  optimizing_bricks: 'Optimizing brick layout...',
  ready: 'Build ready!',
  error: 'Something went wrong',
};

export const STAGE_PROGRESS: Record<PipelineStage, number> = {
  idle: 0,
  uploading: 10,
  refining_prompt: 10,
  generating_model: 30,
  exporting_mesh: 50,
  downloading_mesh: 70,
  validating: 25,
  voxelizing: 50,
  optimizing_bricks: 80,
  ready: 100,
  error: 0,
};

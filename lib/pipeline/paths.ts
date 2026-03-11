import path from 'node:path';

const PROJECT_ROOT = process.cwd();

export const TMP_ROOT_DIR = path.join(PROJECT_ROOT, '.tmp');
export const TMP_UPLOADS_DIR = path.join(TMP_ROOT_DIR, 'uploads');
export const TMP_MESHES_DIR = path.join(TMP_ROOT_DIR, 'meshes');
export const TMP_VOXELS_DIR = path.join(TMP_ROOT_DIR, 'voxels');

export const SAMPLES_DIR = path.join(PROJECT_ROOT, 'samples');
export const RUNTIME_SAMPLES_DIR = path.join(SAMPLES_DIR, 'runtime');
export const HOUSE_VOXELS_SAMPLE_JSON = path.join(RUNTIME_SAMPLES_DIR, 'house_voxels_25.json');

export const BLENDER_SCRIPTS_DIR = path.join(PROJECT_ROOT, 'scripts', 'blender');
export const BLENDER_VOXEL_TO_GRID_SCRIPT = path.join(BLENDER_SCRIPTS_DIR, 'blender_voxel_to_grid.py');

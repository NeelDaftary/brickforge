import path from 'node:path';

const PROJECT_ROOT = process.cwd();

const TMP_ROOT_DIR = path.join(PROJECT_ROOT, '.tmp');
export const TMP_UPLOADS_DIR = path.join(TMP_ROOT_DIR, 'uploads');
export const TMP_MESHES_DIR = path.join(TMP_ROOT_DIR, 'meshes');
export const TMP_VOXELS_DIR = path.join(TMP_ROOT_DIR, 'voxels');

export const HOUSE_VOXELS_SAMPLE_JSON = path.join(PROJECT_ROOT, 'samples', 'runtime', 'house_voxels_25.json');

export const BLENDER_VOXEL_TO_GRID_SCRIPT = path.join(PROJECT_ROOT, 'scripts', 'blender', 'blender_voxel_to_grid.py');

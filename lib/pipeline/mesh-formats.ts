export const SUPPORTED_UPLOAD_EXTENSIONS = ['.blend', '.glb', '.obj', '.stl', '.ply'] as const;
export const MESH_UPLOAD_ACCEPT = SUPPORTED_UPLOAD_EXTENSIONS.join(',');
export const SUPPORTED_UPLOAD_FORMATS_LABEL = SUPPORTED_UPLOAD_EXTENSIONS.join(', ');

export function isSupportedUploadExtension(fileName: string): boolean {
  const ext = fileName.slice(fileName.lastIndexOf('.')).toLowerCase();
  return SUPPORTED_UPLOAD_EXTENSIONS.includes(
    ext as (typeof SUPPORTED_UPLOAD_EXTENSIONS)[number],
  );
}

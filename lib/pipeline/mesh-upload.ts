import path from 'node:path';
import { PipelineError } from './errors';
import { isSupportedUploadExtension, SUPPORTED_UPLOAD_FORMATS_LABEL } from './mesh-formats';

export function safeUploadedMeshName(fileName: string): string {
  const baseName = path.basename(fileName).replace(/[^\w .()[\]-]/g, '_');
  return baseName || 'model.blend';
}

function isBlenderMagic(buf: Buffer): boolean {
  if (buf.subarray(0, 7).toString('ascii') === 'BLENDER') return true;
  // Gzip-compressed .blend
  if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) return true;
  // Zstandard-compressed .blend
  if (buf.length >= 4 && buf[0] === 0x28 && buf[1] === 0xb5 && buf[2] === 0x2f && buf[3] === 0xfd) return true;
  return false;
}

function isGlbMagic(buf: Buffer): boolean {
  return buf.length >= 4 && buf.subarray(0, 4).toString('ascii') === 'glTF';
}

function isPlyMagic(buf: Buffer): boolean {
  return buf.length >= 3 && buf.subarray(0, 3).toString('ascii') === 'ply';
}

export function assertSupportedMeshUpload(fileName: string, meshBytes?: Buffer): void {
  const ext = path.extname(fileName).toLowerCase();

  if (!isSupportedUploadExtension(fileName)) {
    throw new PipelineError(
      'UPLOAD_INVALID_FILE',
      `Only ${SUPPORTED_UPLOAD_FORMATS_LABEL} mesh files are supported for upload`,
    );
  }

  if (!meshBytes) return;

  if (ext === '.blend' && !isBlenderMagic(meshBytes)) {
    throw new PipelineError('UPLOAD_INVALID_FILE', 'File does not look like a Blender (.blend) file');
  }

  if (ext === '.glb' && !isGlbMagic(meshBytes)) {
    throw new PipelineError('UPLOAD_INVALID_FILE', 'File does not look like a binary glTF (.glb) file');
  }

  if (ext === '.ply' && !isPlyMagic(meshBytes)) {
    throw new PipelineError('UPLOAD_INVALID_FILE', 'File does not look like a PLY (.ply) file');
  }
}

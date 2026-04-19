import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { runVoxelPipeline } from '@/lib/pipeline/run-voxel-pipeline';
import { PipelineError, errorResponse } from '@/lib/pipeline/errors';
import { TMP_UPLOADS_DIR } from '@/lib/pipeline/paths';

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MB

function isBlenderMagic(buf: Buffer): boolean {
  if (buf.length < 7) return false;
  if (buf.subarray(0, 7).toString('ascii') === 'BLENDER') return true;
  // Gzip-compressed .blend
  if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) return true;
  return false;
}

/**
 * POST /api/upload
 *
 * Accepts multipart/form-data with:
 * - mesh (required): .blend file, max 50 MB
 * - voxelSize (optional): 0.02-0.5, default 0.06
 * - objectName (optional): Blender object name
 * - name (optional): build name
 * - shell (optional): boolean, default true
 */
export async function POST(req: NextRequest) {
  // Short-circuit oversized uploads before buffering the body
  const declared = req.headers.get('content-length');
  if (declared && Number(declared) > MAX_UPLOAD_BYTES) {
    return errorResponse(
      new PipelineError('UPLOAD_TOO_LARGE', `Upload exceeds ${MAX_UPLOAD_BYTES / 1024 / 1024} MB limit`),
    );
  }

  let uploadDir: string | undefined;

  try {
    const formData = await req.formData();

    const meshFile = formData.get('mesh') as File | null;
    if (!meshFile || !(meshFile instanceof File)) {
      throw new PipelineError('INVALID_INPUT', 'Missing required .blend file');
    }

    if (meshFile.size > MAX_UPLOAD_BYTES) {
      throw new PipelineError('UPLOAD_TOO_LARGE', `File exceeds ${MAX_UPLOAD_BYTES / 1024 / 1024} MB limit`);
    }

    if (!meshFile.name.toLowerCase().endsWith('.blend')) {
      throw new PipelineError('UPLOAD_INVALID_FILE', 'Only .blend files are supported for upload');
    }

    const voxelSize = parseFloat(formData.get('voxelSize') as string) || 0.06;
    const objectName = (formData.get('objectName') as string) || undefined;
    const name = (formData.get('name') as string) || meshFile.name.replace(/\.\w+$/, '');
    const shell = (formData.get('shell') as string) !== 'false';

    const meshBytes = Buffer.from(await meshFile.arrayBuffer());

    if (!isBlenderMagic(meshBytes)) {
      throw new PipelineError('UPLOAD_INVALID_FILE', 'File does not look like a Blender (.blend) file');
    }

    const runId = `${Date.now()}-${randomUUID()}`;
    uploadDir = path.join(TMP_UPLOADS_DIR, runId);
    await mkdir(uploadDir, { recursive: true });

    const meshPath = path.join(uploadDir, meshFile.name);
    await writeFile(meshPath, meshBytes);

    const result = await runVoxelPipeline({
      meshPath,
      voxelSize: Math.max(0.02, Math.min(0.5, voxelSize)),
      objectName,
      name,
      description: `LEGO build of "${name}"`,
      shell,
    });

    return NextResponse.json({
      ...result.model,
      diagnostics: result.diagnostics,
    });
  } catch (error) {
    if (!(error instanceof PipelineError)) {
      console.error('Upload error:', error);
    }
    return errorResponse(error, 'Upload processing failed');
  } finally {
    if (uploadDir) {
      await rm(uploadDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

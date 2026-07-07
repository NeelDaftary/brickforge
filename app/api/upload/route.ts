import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { runVoxelPipeline } from '@/lib/pipeline/run-voxel-pipeline';
import { PipelineError, errorResponse } from '@/lib/pipeline/errors';
import { TMP_UPLOADS_DIR } from '@/lib/pipeline/paths';
import { SUPPORTED_UPLOAD_FORMATS_LABEL } from '@/lib/pipeline/mesh-formats';
import { assertSupportedMeshUpload, safeUploadedMeshName } from '@/lib/pipeline/mesh-upload';
import { isBrickerVariant } from '@/lib/pipeline_v2/variants';

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MB

/**
 * POST /api/upload
 *
 * Accepts multipart/form-data with:
 * - mesh (required): .blend/.glb/.obj/.stl/.ply file, max 50 MB
 * - voxelSize (optional): 0.02-0.5, default 0.06
 * - objectName (optional): Blender object name
 * - name (optional): build name
 * - shell (optional): boolean, default true
 * - brickerEngine (optional): legacy | stability_v2 | v2_masks | v2_tree_repair | v2_lexicographic | v2_oracle
 * - shadowCompare (optional): boolean, default false
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
      throw new PipelineError('INVALID_INPUT', `Missing required mesh file (${SUPPORTED_UPLOAD_FORMATS_LABEL})`);
    }

    if (meshFile.size > MAX_UPLOAD_BYTES) {
      throw new PipelineError('UPLOAD_TOO_LARGE', `File exceeds ${MAX_UPLOAD_BYTES / 1024 / 1024} MB limit`);
    }

    assertSupportedMeshUpload(meshFile.name);

    const voxelSize = parseFloat(formData.get('voxelSize') as string) || 0.06;
    const objectName = (formData.get('objectName') as string) || undefined;
    const safeFileName = safeUploadedMeshName(meshFile.name);
    const name = (formData.get('name') as string) || safeFileName.replace(/\.\w+$/, '');
    const shell = (formData.get('shell') as string) !== 'false';
    const rawBrickerEngine = formData.get('brickerEngine') as string | null;
    const brickerEngine = rawBrickerEngine && isBrickerVariant(rawBrickerEngine) ? rawBrickerEngine : 'legacy';
    const shadowCompare = (formData.get('shadowCompare') as string) === 'true';

    const meshBytes = Buffer.from(await meshFile.arrayBuffer());
    assertSupportedMeshUpload(meshFile.name, meshBytes);

    const runId = `${Date.now()}-${randomUUID()}`;
    uploadDir = path.join(TMP_UPLOADS_DIR, runId);
    await mkdir(uploadDir, { recursive: true });

    const meshPath = path.join(uploadDir, safeFileName);
    await writeFile(meshPath, meshBytes);

    const result = await runVoxelPipeline({
      meshPath,
      voxelSize: Math.max(0.02, Math.min(0.5, voxelSize)),
      objectName,
      name,
      description: `LEGO build of "${name}"`,
      shell,
      brickerEngine,
      shadowCompare,
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

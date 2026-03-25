import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { runVoxelPipeline, PipelineError } from '@/lib/pipeline/run-voxel-pipeline';
import { TMP_UPLOADS_DIR } from '@/lib/pipeline/paths';

/**
 * POST /api/upload
 *
 * Accepts multipart/form-data with:
 * - mesh (required): .blend file
 * - voxelSize (optional): 0.02-0.5, default 0.06
 * - objectName (optional): Blender object name
 * - name (optional): build name
 * - shell (optional): boolean, default true
 */
export async function POST(req: NextRequest) {
  let uploadDir: string | undefined;

  try {
    const formData = await req.formData();

    const meshFile = formData.get('mesh') as File | null;
    if (!meshFile || !(meshFile instanceof File)) {
      return NextResponse.json(
        { error: 'Missing required .blend file' },
        { status: 400 },
      );
    }

    if (!meshFile.name.toLowerCase().endsWith('.blend')) {
      return NextResponse.json(
        { error: 'Only .blend files are supported for upload' },
        { status: 400 },
      );
    }

    const voxelSize = parseFloat(formData.get('voxelSize') as string) || 0.06;
    const objectName = (formData.get('objectName') as string) || undefined;
    const name = (formData.get('name') as string) || meshFile.name.replace(/\.\w+$/, '');
    const shell = (formData.get('shell') as string) !== 'false';

    // Create temp upload directory
    const runId = `${Date.now()}-${randomUUID()}`;
    uploadDir = path.join(TMP_UPLOADS_DIR, runId);
    await mkdir(uploadDir, { recursive: true });

    // Save .blend file
    const meshBytes = Buffer.from(await meshFile.arrayBuffer());
    const meshPath = path.join(uploadDir, meshFile.name);
    await writeFile(meshPath, meshBytes);

    // Run pipeline
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
    if (error instanceof PipelineError) {
      return NextResponse.json(
        { error: error.message, preflight: error.preflight },
        { status: 400 },
      );
    }
    const message = error instanceof Error ? error.message : 'Upload processing failed';
    console.error('Upload error:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    if (uploadDir) {
      await rm(uploadDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

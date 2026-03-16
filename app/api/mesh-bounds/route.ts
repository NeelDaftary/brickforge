import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getMeshBounds, PipelineError } from '@/lib/pipeline/run-voxel-pipeline';
import { TMP_UPLOADS_DIR } from '@/lib/pipeline/paths';

/**
 * POST /api/mesh-bounds
 *
 * Lightweight endpoint that returns the world-space bounding box of a mesh.
 * Used to compute voxel size from a user-friendly "target studs" input.
 *
 * Input: multipart/form-data with mesh (.blend) file
 * Output: { width, depth, height, maxExtent }
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
        { error: 'Only .blend files are supported' },
        { status: 400 },
      );
    }

    const objectName = (formData.get('objectName') as string) || undefined;

    // Save to temp directory
    const runId = `${Date.now()}-${randomUUID()}`;
    uploadDir = path.join(TMP_UPLOADS_DIR, runId);
    await mkdir(uploadDir, { recursive: true });

    const meshBytes = Buffer.from(await meshFile.arrayBuffer());
    const meshPath = path.join(uploadDir, meshFile.name);
    await writeFile(meshPath, meshBytes);

    const bounds = await getMeshBounds(meshPath, objectName);

    return NextResponse.json(bounds);
  } catch (error) {
    if (error instanceof PipelineError) {
      return NextResponse.json(
        { error: error.message },
        { status: 400 },
      );
    }
    const message = error instanceof Error ? error.message : 'Failed to read mesh bounds';
    console.error('Mesh bounds error:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    if (uploadDir) {
      await rm(uploadDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

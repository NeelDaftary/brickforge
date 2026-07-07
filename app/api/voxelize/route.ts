import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { voxelGridToBrickModel, type VoxelGrid } from '@/lib/pipeline/voxel-to-bricks';
import { voxelGridToBrickModelV2, type StabilityV2Stats } from '@/lib/pipeline_v2/stability-bricker';
import { analyzeBrickGraph, buildBrickGraph, summarizeGraphDiagnosticBrickIds, summarizeGraphDiagnostics } from '@/lib/pipeline_v2/brick-graph';
import { runVoxelPipeline } from '@/lib/pipeline/run-voxel-pipeline';
import { PipelineError, errorResponse } from '@/lib/pipeline/errors';
import { BRICKER_VARIANTS, isStabilityV2Variant, type BrickerVariant } from '@/lib/pipeline_v2/variants';

const VoxelRequestSchema = z.object({
  meshPath: z.string().optional(),
  voxelData: z.object({
    color_legend: z.record(z.string(), z.string()),
    grid: z.array(z.array(z.array(z.string()))),
  }).optional(),
  voxelSize: z.number().min(0.02).max(0.5).default(0.06),
  objectName: z.string().optional(),
  name: z.string().default('Generated Build'),
  description: z.string().default('LEGO build generated from 3D model'),
  shell: z.boolean().default(true),
  brickerEngine: z.enum(BRICKER_VARIANTS).default('legacy'),
  shadowCompare: z.boolean().default(false),
});

function deriveGridSize(grid: string[][][]): number {
  return Math.max(grid.length, grid[0]?.length ?? 0, grid[0]?.[0]?.length ?? 0);
}

function logGrid(grid: string[][][], colorLegend: Record<string, string>): void {
  console.log(`[voxelize] Grid: [${grid.length}][${grid[0]?.length ?? 0}][${grid[0]?.[0]?.length ?? 0}] = [x][y][z]`);
  console.log(`[voxelize] Color legend keys: ${Object.keys(colorLegend).join(', ')}`);
}

function buildDiagnostics(
  startedAt: number,
  voxelSize: number,
  gridSize: number,
  grid: string[][][],
  totalBricks: number,
  shell: boolean,
  brickerEngine: BrickerVariant,
  bricks: ReturnType<typeof voxelGridToBrickModel>['bricks'],
  stabilityV2?: StabilityV2Stats,
) {
  const graph = buildBrickGraph(bricks);
  const graphDiagnostics = analyzeBrickGraph(graph);
  return {
    pipeline: 'brickforge-v3',
    timingMs: Date.now() - startedAt,
    voxelSize,
    gridSize,
    voxelLayers: grid[0]?.[0]?.length ?? 0,
    totalBricks,
    shelled: shell,
    brickerEngine,
    layout: summarizeGraphDiagnostics(graphDiagnostics, {
      internalSupportBricks: stabilityV2?.internalSupport?.internalSupportBricks ?? 0,
      internalSupportVoxels: stabilityV2?.internalSupport?.internalSupportVoxels ?? 0,
    }),
    layoutIds: summarizeGraphDiagnosticBrickIds(graphDiagnostics, graph, stabilityV2?.oracleFailureBrickIds ?? []),
    ...(stabilityV2 ? { stabilityV2 } : {}),
  };
}

/**
 * POST /api/voxelize
 *
 * Accepts either:
 * - meshPath: path to a mesh file to voxelize via Blender GN
 * - voxelData: pre-built voxel grid (from direct generation)
 *
 * Then runs the TypeScript brick optimizer and returns BrickModelData.
 */
export async function POST(req: NextRequest) {
  const startedAt = Date.now();

  try {
    const body = await req.json();
    const {
      meshPath, voxelData, voxelSize, objectName, name, description, shell, brickerEngine, shadowCompare,
    } = VoxelRequestSchema.parse(body);

    if (voxelData) {
      const { grid, color_legend: colorLegend } = voxelData;
      const gridSize = deriveGridSize(grid);
      logGrid(grid, colorLegend);

      const voxelGrid: VoxelGrid = { grid, colorLegend, gridSize };
      const model = isStabilityV2Variant(brickerEngine)
        ? voxelGridToBrickModelV2(voxelGrid, name, description, { shell, variant: brickerEngine })
        : voxelGridToBrickModel(voxelGrid, name, description, { shell });

      return NextResponse.json({
        ...model,
        diagnostics: buildDiagnostics(
          startedAt,
          voxelSize,
          gridSize,
          grid,
          model.totalBricks,
          shell,
          brickerEngine,
          model.bricks,
          (model as typeof model & { stabilityV2Stats?: StabilityV2Stats }).stabilityV2Stats,
        ),
      });
    }

    if (meshPath) {
      const result = await runVoxelPipeline({
        meshPath,
        voxelSize,
        objectName,
        name,
        description,
        shell,
        brickerEngine,
        shadowCompare,
      });
      return NextResponse.json({ ...result.model, diagnostics: result.diagnostics });
    }

    throw new PipelineError('INVALID_INPUT', 'Provide either meshPath or voxelData');
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(
        new PipelineError('INVALID_INPUT', error.issues.map((i) => i.message).join('; '), {
          details: { issues: error.issues },
        }),
      );
    }
    if (!(error instanceof PipelineError)) {
      console.error('Voxelize error:', error);
    }
    return errorResponse(error, 'Voxelization failed');
  }
}

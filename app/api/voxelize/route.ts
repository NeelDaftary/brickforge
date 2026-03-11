import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { voxelGridToBrickModel, type VoxelGrid } from '@/lib/pipeline/voxel-to-bricks';
import { runVoxelPipeline, PipelineError } from '@/lib/pipeline/run-voxel-pipeline';
import { HOUSE_VOXELS_SAMPLE_JSON } from '@/lib/pipeline/paths';

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
) {
  return {
    pipeline: 'brickforge-v3',
    timingMs: Date.now() - startedAt,
    voxelSize,
    gridSize,
    voxelLayers: grid[0]?.[0]?.length ?? 0,
    totalBricks,
    shelled: shell,
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
    const { meshPath, voxelData, voxelSize, objectName, name, description, shell } = VoxelRequestSchema.parse(body);

    // Path 1: Direct voxel data provided
    if (voxelData) {
      const { grid, color_legend: colorLegend } = voxelData;
      const gridSize = deriveGridSize(grid);
      logGrid(grid, colorLegend);

      const voxelGrid: VoxelGrid = { grid, colorLegend, gridSize };
      const model = voxelGridToBrickModel(voxelGrid, name, description, { shell });

      return NextResponse.json({
        ...model,
        diagnostics: buildDiagnostics(startedAt, voxelSize, gridSize, grid, model.totalBricks, shell),
      });
    }

    // Path 2: Mesh file path — delegate to shared pipeline
    if (meshPath) {
      const result = await runVoxelPipeline({ meshPath, voxelSize, objectName, name, description, shell });
      return NextResponse.json({ ...result.model, diagnostics: result.diagnostics });
    }

    // Path 3: Fallback sample voxel file
    try {
      const raw = await readFile(HOUSE_VOXELS_SAMPLE_JSON, 'utf8');
      const sample = JSON.parse(raw);
      const colorLegend: Record<string, string> = sample.color_legend;

      // The sample file has axes [y_depth][z_height][x_width] but our
      // pipeline expects [x][y][z]. Transpose accordingly.
      const rawGrid: string[][][] = sample.grid; // rawGrid[y][z][x]
      const sizeY = rawGrid.length;
      const sizeZ = rawGrid[0]?.length ?? 0;
      const sizeX = rawGrid[0]?.[0]?.length ?? 0;

      const grid: string[][][] = [];
      for (let x = 0; x < sizeX; x++) {
        const plane: string[][] = [];
        for (let y = 0; y < sizeY; y++) {
          const col: string[] = [];
          for (let zz = 0; zz < sizeZ; zz++) {
            col.push(rawGrid[y][zz][x]);
          }
          plane.push(col);
        }
        grid.push(plane);
      }

      const gridSize = Math.max(sizeX, sizeY, sizeZ);
      logGrid(grid, colorLegend);

      const voxelGrid: VoxelGrid = { grid, colorLegend, gridSize };
      const model = voxelGridToBrickModel(voxelGrid, name, description, { shell });

      return NextResponse.json({
        ...model,
        diagnostics: buildDiagnostics(startedAt, voxelSize, gridSize, grid, model.totalBricks, shell),
      });
    } catch {
      return NextResponse.json(
        { error: 'No mesh or voxel data provided, and sample file not found' },
        { status: 400 },
      );
    }
  } catch (error) {
    if (error instanceof PipelineError) {
      return NextResponse.json(
        { error: error.message, preflight: error.preflight },
        { status: 400 },
      );
    }
    const message = error instanceof Error ? error.message : 'Voxelization failed';
    console.error('Voxelize error:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

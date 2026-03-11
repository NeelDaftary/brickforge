/**
 * BrickForge v3 — Voxelization Pipeline: mesh → preflight → Blender GN voxelizer → TS brick optimizer.
 *
 * Replaces the v2 Python trimesh voxelizer with Blender Geometry Nodes.
 * Calls blender_voxel_to_grid.py via Blender subprocess.
 */

import { readFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { voxelGridToBrickModel, type VoxelGrid } from '@/lib/pipeline/voxel-to-bricks';
import { preflightMeshPath, type MeshPreflightResult } from '@/lib/pipeline/mesh-preflight';
import { checkBrickStability } from '@/lib/pipeline/brick-stability';
import type { BrickModelData } from '@/lib/engine/types';
import { BLENDER_VOXEL_TO_GRID_SCRIPT, TMP_VOXELS_DIR } from '@/lib/pipeline/paths';

const execFileAsync = promisify(execFile);

// ─── Blender Binary ────────────────────────────────────────────────────────────

function getBlenderBinary(): string {
  if (process.env.BLENDER_PATH) {
    return process.env.BLENDER_PATH;
  }
  // Platform defaults
  if (process.platform === 'darwin') {
    return '/Applications/Blender.app/Contents/MacOS/Blender';
  }
  if (process.platform === 'win32') {
    return 'C:\\Program Files\\Blender Foundation\\Blender\\blender.exe';
  }
  return 'blender'; // Linux: assume on PATH
}

export async function validateBlenderBinary(): Promise<{ valid: boolean; version?: string; error?: string }> {
  try {
    const { stdout } = await execFileAsync(getBlenderBinary(), ['--version'], { timeout: 10000 });
    const match = stdout.match(/Blender\s+(\d+)\.(\d+)/);
    if (!match) return { valid: false, error: 'Could not parse Blender version' };

    const major = parseInt(match[1], 10);
    const minor = parseInt(match[2], 10);
    const version = `${major}.${minor}`;

    if (major < 3 || (major === 3 && minor < 6)) {
      return { valid: false, version, error: `Blender ${version} found but >= 3.6 required` };
    }

    return { valid: true, version };
  } catch {
    return { valid: false, error: 'Blender binary not found. Set BLENDER_PATH env var or install Blender >= 3.6.' };
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface VoxelPipelineOptions {
  meshPath: string;
  voxelSize?: number;
  objectName?: string;
  name?: string;
  description?: string;
  shell?: boolean;
}

export interface VoxelPipelineResult {
  model: BrickModelData;
  preflight: MeshPreflightResult;
  diagnostics: {
    pipeline: string;
    timingMs: number;
    voxelSize: number;
    gridSize: number;
    voxelLayers: number;
    totalBricks: number;
    shelled: boolean;
    warnings: string[];
  };
}

// ─── Pipeline ─────────────────────────────────────────────────────────────────

export async function runVoxelPipeline(options: VoxelPipelineOptions): Promise<VoxelPipelineResult> {
  const startedAt = Date.now();
  const voxelSize = options.voxelSize ?? 0.06;
  const name = options.name ?? 'Generated Build';
  const description = options.description ?? 'LEGO build generated from 3D model';
  const shell = options.shell ?? false;

  // Step 0: Validate Blender
  const blenderCheck = await validateBlenderBinary();
  if (!blenderCheck.valid) {
    throw new PipelineError(blenderCheck.error ?? 'Blender not available');
  }

  // Step 1: Preflight validation
  const preflight = await preflightMeshPath(options.meshPath);
  if (!preflight.shouldProceed) {
    throw new PipelineError(preflight.errors.join(' '), preflight);
  }

  // Step 2: Blender GN voxelizer
  await mkdir(TMP_VOXELS_DIR, { recursive: true });

  const runId = `${Date.now()}-${randomUUID()}`;
  const outputPath = path.join(TMP_VOXELS_DIR, `${runId}.voxels.json`);
  const scriptPath = BLENDER_VOXEL_TO_GRID_SCRIPT;
  const blenderBin = getBlenderBinary();

  try {
    // Build Blender command args
    const blenderArgs: string[] = ['--background'];
    const scriptArgs: string[] = [
      '--voxel-size', String(voxelSize),
      '--output', outputPath,
    ];

    if (preflight.format === 'blend') {
      // .blend file: open it directly
      blenderArgs.splice(1, 0, preflight.resolvedPath); // insert after --background
      if (options.objectName) {
        scriptArgs.push('--object', options.objectName);
      }
    } else {
      // Non-.blend: import into empty Blender scene
      scriptArgs.push('--import', preflight.resolvedPath);
    }

    blenderArgs.push('--python', scriptPath, '--', ...scriptArgs);

    console.log(`[Pipeline] Running: ${blenderBin} ${blenderArgs.join(' ')}`);

    const { stdout, stderr } = await execFileAsync(blenderBin, blenderArgs, {
      timeout: 600000, // 10 minutes for large models
      maxBuffer: 10 * 1024 * 1024,
    });

    if (stdout) console.log('Blender:', stdout.slice(0, 1000));
    if (stderr) console.error('Blender stderr:', stderr.slice(0, 500));

    // Read grid JSON output
    const voxelRaw = await readFile(outputPath, 'utf8');
    const voxelJson = JSON.parse(voxelRaw);
    const grid: string[][][] = voxelJson.grid;
    const colorLegend: Record<string, string> = voxelJson.color_legend;

    // Derive gridSize from actual grid dimensions
    const gridSize = Math.max(
      grid.length,
      grid[0]?.length ?? 0,
      grid[0]?.[0]?.length ?? 0,
    );

    // Step 3: TS brick optimizer
    const warnings: string[] = [...(preflight.warnings ?? [])];

    // Detect monochrome output
    const ACHROMATIC_SYMBOLS = new Set(['G', 'D', 'K', 'W', 'T']);
    const legendKeys = Object.keys(colorLegend);
    if (legendKeys.length > 0 && legendKeys.every((k) => ACHROMATIC_SYMBOLS.has(k))) {
      if (preflight.format === 'blend') {
        warnings.push(
          'Colors appear monochrome — the .blend file may not have UV-mapped textures or materials. ' +
          'Ensure the mesh has a Principled BSDF material with an Image Texture or a solid Base Color.',
        );
      } else {
        warnings.push(
          'Colors appear monochrome — mesh materials may not have been recognized. ' +
          'For best results, use a .blend file with UV-mapped textures.',
        );
      }
    }

    const voxelGrid: VoxelGrid = { grid, colorLegend, gridSize };
    const model = voxelGridToBrickModel(voxelGrid, name, description, { shell });

    // Step 4: Brick stability check
    const stability = checkBrickStability(model.bricks);
    if (stability.warnings.length > 0) {
      warnings.push(...stability.warnings);
    }

    return {
      model,
      preflight,
      diagnostics: {
        pipeline: 'brickforge-v3',
        timingMs: Date.now() - startedAt,
        voxelSize,
        gridSize,
        voxelLayers: grid[0]?.[0]?.length ?? 0,
        totalBricks: model.totalBricks,
        shelled: shell,
        warnings,
      },
    };
  } finally {
    await rm(outputPath, { force: true }).catch(() => {});
  }
}

// ─── Error ────────────────────────────────────────────────────────────────────

export class PipelineError extends Error {
  constructor(message: string, public preflight?: MeshPreflightResult) {
    super(message);
    this.name = 'PipelineError';
  }
}

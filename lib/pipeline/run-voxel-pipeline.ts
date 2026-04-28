/**
 * BrickForge v3 — Voxelization Pipeline: mesh → preflight → Blender GN voxelizer → TS brick optimizer.
 *
 * Calls blender_voxel_to_grid.py via Blender subprocess.
 */

import { readFile, mkdir, rm, access } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { voxelGridToBrickModel, type VoxelGrid } from '@/lib/pipeline/voxel-to-bricks';
import { voxelGridToBrickModelV2 } from '@/lib/pipeline_v2/stability-bricker';
import { preflightMeshPath, type MeshPreflightResult } from '@/lib/pipeline/mesh-preflight';
import { checkBrickStability } from '@/lib/pipeline/brick-stability';
import type { BrickModelData } from '@/lib/engine/types';
import {
  BLENDER_VOXEL_TO_GRID_SCRIPT,
  TMP_VOXELS_DIR,
} from '@/lib/pipeline/paths';
import { DEFAULT_VOXEL_SIZE, DEFAULT_SHELL_ENABLED } from '@/lib/pipeline/constants';
import { PipelineError } from '@/lib/pipeline/errors';

// Re-export for backwards compatibility; new code should import from errors.ts.
export { PipelineError };

const execFileAsync = promisify(execFile);

// ─── Blender Binary ────────────────────────────────────────────────────────────

function getBlenderBinary(): string {
  if (process.env.BLENDER_PATH) {
    return process.env.BLENDER_PATH;
  }
  if (process.platform === 'darwin') {
    return '/Applications/Blender.app/Contents/MacOS/Blender';
  }
  if (process.platform === 'win32') {
    return 'C:\\Program Files\\Blender Foundation\\Blender\\blender.exe';
  }
  return 'blender';
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
  brickerEngine?: 'legacy' | 'stability_v2';
  shadowCompare?: boolean;
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
    unsupportedBricks: number;
    warnings: string[];
    brickerEngine?: 'legacy' | 'stability_v2';
    shadowComparison?: {
      compared: boolean;
      primaryBricks: number;
      shadowBricks: number;
      primaryUnsupportedBricks: number;
      shadowUnsupportedBricks: number;
    };
    color?: {
      sourceType: string;
      confidence: number;
      achromaticRatio: number;
      paletteEntropy: number;
      warnings: string[];
    };
    refinement?: {
      regionsFound: number;
      regionsImproved: number;
      criticalBefore: number;
      criticalAfter: number;
      weakBefore: number;
      weakAfter: number;
      elapsedMs: number;
    };
  };
}

// ─── Mesh Bounds ──────────────────────────────────────────────────────────────

export interface MeshBounds {
  width: number;
  depth: number;
  height: number;
  maxExtent: number;
}

/**
 * Get the world-space bounding box of a mesh via a lightweight Blender call.
 * Much faster than full voxelization — just imports + reads dimensions.
 */
export async function getMeshBounds(meshPath: string, objectName?: string): Promise<MeshBounds> {
  const blenderCheck = await validateBlenderBinary();
  if (!blenderCheck.valid) {
    throw new PipelineError('BLENDER_UNAVAILABLE', blenderCheck.error ?? 'Blender not available');
  }

  const preflight = await preflightMeshPath(meshPath);
  if (!preflight.shouldProceed) {
    throw new PipelineError('MESH_PREFLIGHT_FAILED', preflight.errors.join(' '), { preflight });
  }

  await mkdir(TMP_VOXELS_DIR, { recursive: true });

  const runId = `${Date.now()}-${randomUUID()}`;
  const outputPath = path.join(TMP_VOXELS_DIR, `${runId}.bounds.json`);
  const blenderBin = getBlenderBinary();

  try {
    const blenderArgs: string[] = ['--background'];
    const scriptArgs: string[] = [
      '--bounds-only',
      '--output', outputPath,
    ];

    if (preflight.format === 'blend') {
      blenderArgs.splice(1, 0, preflight.resolvedPath);
      if (objectName) {
        scriptArgs.push('--object', objectName);
      }
    } else {
      scriptArgs.push('--import', preflight.resolvedPath);
    }

    blenderArgs.push('--python', BLENDER_VOXEL_TO_GRID_SCRIPT, '--', ...scriptArgs);

    await execFileAsync(blenderBin, blenderArgs, {
      timeout: 30000,
      maxBuffer: 5 * 1024 * 1024,
    });

    const raw = await readFile(outputPath, 'utf8');
    const bounds = JSON.parse(raw) as { width: number; depth: number; height: number };

    return {
      ...bounds,
      maxExtent: Math.max(bounds.width, bounds.depth, bounds.height),
    };
  } finally {
    await rm(outputPath, { force: true }).catch(() => {});
  }
}

/**
 * Compute voxel size from mesh extent and target stud count.
 * Rounds UP to the nearest 0.01 so the grid never exceeds the target.
 */
export function computeVoxelSize(maxExtent: number, targetStuds: number): number {
  const raw = maxExtent / targetStuds;
  const rounded = Math.ceil(raw * 100) / 100;
  return Math.max(0.02, Math.min(0.5, rounded));
}

// ─── Pipeline ─────────────────────────────────────────────────────────────────

export async function runVoxelPipeline(options: VoxelPipelineOptions): Promise<VoxelPipelineResult> {
  const startedAt = Date.now();
  const voxelSize = options.voxelSize ?? DEFAULT_VOXEL_SIZE;
  const name = options.name ?? 'Generated Build';
  const description = options.description ?? 'LEGO build generated from 3D model';
  const shell = options.shell ?? DEFAULT_SHELL_ENABLED;
  const brickerEngine = options.brickerEngine ?? 'legacy';
  const shadowCompare = options.shadowCompare ?? false;

  // Step 0: Validate Blender
  const blenderCheck = await validateBlenderBinary();
  if (!blenderCheck.valid) {
    throw new PipelineError('BLENDER_UNAVAILABLE', blenderCheck.error ?? 'Blender not available');
  }

  // Step 1: Preflight validation
  const preflight = await preflightMeshPath(options.meshPath);
  if (!preflight.shouldProceed) {
    throw new PipelineError('MESH_PREFLIGHT_FAILED', preflight.errors.join(' '), { preflight });
  }

  // Step 2: Blender GN voxelizer
  await mkdir(TMP_VOXELS_DIR, { recursive: true });

  const runId = `${Date.now()}-${randomUUID()}`;
  const outputPath = path.join(TMP_VOXELS_DIR, `${runId}.voxels.json`);
  const blenderBin = getBlenderBinary();

  try {
    const blenderArgs: string[] = ['--background'];
    const scriptArgs: string[] = [
      '--voxel-size', String(voxelSize),
      '--output', outputPath,
    ];

    if (preflight.format === 'blend') {
      blenderArgs.splice(1, 0, preflight.resolvedPath);
      if (options.objectName) {
        scriptArgs.push('--object', options.objectName);
      }
    } else {
      scriptArgs.push('--import', preflight.resolvedPath);
    }

    blenderArgs.push('--python', BLENDER_VOXEL_TO_GRID_SCRIPT, '--', ...scriptArgs);

    console.log(`[Pipeline] Running: ${blenderBin} ${blenderArgs.join(' ')}`);

    const { stdout, stderr } = await execFileAsync(blenderBin, blenderArgs, {
      timeout: 600000,
      maxBuffer: 10 * 1024 * 1024,
    });

    if (stdout) console.log('Blender:', stdout.slice(0, 1000));
    if (stderr) console.error('Blender stderr:', stderr.slice(0, 1500));

    const outputExists = await access(outputPath).then(() => true).catch(() => false);
    if (!outputExists) {
      const details = stderr?.trim().slice(0, 1500) || stdout?.trim().slice(0, 1500) || 'Blender completed without producing voxel output.';
      throw new PipelineError('VOXELIZATION_FAILED', `Blender voxelizer did not produce output JSON. ${details}`, { preflight });
    }

    // Read grid JSON output
    const voxelRaw = await readFile(outputPath, 'utf8');
    const voxelJson = JSON.parse(voxelRaw);
    const grid: string[][][] = voxelJson.grid;
    const colorLegend: Record<string, string> = voxelJson.color_legend;

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
      warnings.push(
        'Colors appear monochrome — mesh materials may not have been recognized. ' +
        'For best results, use a mesh with UV-mapped textures or a Principled BSDF base color.',
      );
    }

    const voxelGrid: VoxelGrid = { grid, colorLegend, gridSize };
    const model = brickerEngine === 'stability_v2'
      ? voxelGridToBrickModelV2(voxelGrid, name, description, { shell })
      : voxelGridToBrickModel(voxelGrid, name, description, { shell });

    // Step 4: Graduated stability check
    const stability = checkBrickStability(model.bricks);
    if (stability.warnings.length > 0) {
      warnings.push(...stability.warnings);
    }

    // Count completely unsupported bricks (zero support from below)
    const unsupportedCount = [...stability.brickSupport.values()]
      .filter(info => info.supportRatio === 0 && info.tier !== 'stable')
      .length;
    if (unsupportedCount > 0) {
      console.log(`[stability] ${unsupportedCount} brick(s) have zero support from below`);
    }

    let shadowSummary: VoxelPipelineResult['diagnostics']['shadowComparison'] | undefined;
    if (shadowCompare) {
      const shadowModel = brickerEngine === 'stability_v2'
        ? voxelGridToBrickModel(voxelGrid, name, description, { shell })
        : voxelGridToBrickModelV2(voxelGrid, name, description, { shell });
      const shadowStability = checkBrickStability(shadowModel.bricks);
      const shadowUnsupported = [...shadowStability.brickSupport.values()]
        .filter(info => info.supportRatio === 0 && info.tier !== 'stable')
        .length;
      shadowSummary = {
        compared: true,
        primaryBricks: model.totalBricks,
        shadowBricks: shadowModel.totalBricks,
        primaryUnsupportedBricks: unsupportedCount,
        shadowUnsupportedBricks: shadowUnsupported,
      };
      warnings.push(
        `Shadow compare (${brickerEngine === 'legacy' ? 'stability_v2' : 'legacy'}): ` +
        `${shadowUnsupported} unsupported vs primary ${unsupportedCount}.`,
      );
    }

    const refinementStats = (model as BrickModelData & { refinementStats?: VoxelPipelineResult['diagnostics']['refinement'] }).refinementStats;
    const colorDiagnostics = voxelJson.color_diagnostics as
      | {
        sourceType?: string;
        confidence?: number;
        achromaticRatio?: number;
        paletteEntropy?: number;
        warnings?: string[];
      }
      | undefined;

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
        unsupportedBricks: unsupportedCount,
        brickerEngine,
        ...(shadowSummary ? { shadowComparison: shadowSummary } : {}),
        ...(colorDiagnostics ? {
          color: {
            sourceType: colorDiagnostics.sourceType ?? 'unknown',
            confidence: colorDiagnostics.confidence ?? 0,
            achromaticRatio: colorDiagnostics.achromaticRatio ?? 0,
            paletteEntropy: colorDiagnostics.paletteEntropy ?? 0,
            warnings: colorDiagnostics.warnings ?? [],
          },
        } : {}),
        warnings,
        ...(refinementStats ? {
          refinement: {
            regionsFound: refinementStats.regionsFound,
            regionsImproved: refinementStats.regionsImproved,
            criticalBefore: refinementStats.criticalBefore,
            criticalAfter: refinementStats.criticalAfter,
            weakBefore: refinementStats.weakBefore,
            weakAfter: refinementStats.weakAfter,
            elapsedMs: refinementStats.elapsedMs,
          },
        } : {}),
      },
    };
  } finally {
    await rm(outputPath, { force: true }).catch(() => {});
  }
}

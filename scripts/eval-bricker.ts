#!/usr/bin/env tsx

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { voxelGridToBrickModel, type VoxelGrid } from '@/lib/pipeline/voxel-to-bricks';
import { voxelGridToBrickModelV2, type StabilityV2Stats } from '@/lib/pipeline_v2/stability-bricker';
import { analyzeBrickGraph, summarizeGraphDiagnostics } from '@/lib/pipeline_v2/brick-graph';
import { BRICKER_VARIANTS, isBrickerVariant, isStabilityV2Variant, type BrickerVariant } from '@/lib/pipeline_v2/variants';
import type { BrickModelData, VoxelData } from '@/lib/engine/types';

export interface EvalOptions {
  engines: BrickerVariant[];
  shell: boolean;
  json: boolean;
  verbose: boolean;
  deepRepair: boolean;
  files: string[];
}

export interface EvalRow {
  file: string;
  engine: BrickerVariant | 'existing';
  variant: BrickerVariant | 'existing';
  voxels: number;
  bricks: number;
  compression: number;
  runtimeMs: number;
  occupiedCells: number;
  overlapCells: number;
  missingVoxels: number | null;
  connectedComponents: number;
  floatingBricks: number;
  unsupportedBricks: number;
  supportedCantilevers: number;
  weakCantilevers: number;
  articulationBricks: number;
  bridgeEdges: number;
  repeatedSeams: number;
  maxSeamRun: number;
  gateStatus: 'pass' | 'warn' | 'fail';
  healthScore: number;
  candidateCount: number;
  candidateMaskMs: number;
  repairPatchType: string | null;
  repairAcceptedBy: string | null;
  oracleCheckedRegions: number;
  oracleFailures: number;
  readinessStatus: 'ready' | 'prototype' | 'needs_repair';
}

function usage(): never {
  console.error([
    `Usage: npx tsx scripts/eval-bricker.ts <model-or-voxels.json> [...] [--engines ${BRICKER_VARIANTS.join(',')}] [--shell false] [--json] [--verbose] [--deep]`,
    '',
    'Accepts .brickforge.json model files with voxelData or raw voxel grid JSON:',
    '  { "grid": ..., "color_legend": ... }',
  ].join('\n'));
  process.exit(1);
}

export function parseArgs(argv: string[]): EvalOptions {
  const options: EvalOptions = {
    engines: ['legacy', 'stability_v2'],
    shell: true,
    json: false,
    verbose: false,
    deepRepair: false,
    files: [],
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') {
      options.json = true;
    } else if (arg === '--verbose') {
      options.verbose = true;
    } else if (arg === '--deep') {
      options.deepRepair = true;
    } else if (arg === '--shell') {
      const value = argv[++i];
      if (value !== 'true' && value !== 'false') usage();
      options.shell = value === 'true';
    } else if (arg === '--engines') {
      const value = argv[++i];
      const engines = value === 'all' ? [...BRICKER_VARIANTS] : value?.split(',');
      if (!engines?.length || engines.some((engine) => !isBrickerVariant(engine))) usage();
      options.engines = engines as BrickerVariant[];
    } else if (arg.startsWith('--')) {
      usage();
    } else {
      options.files.push(arg);
    }
  }

  if (options.files.length === 0) usage();
  return options;
}

function prototypeUnsupportedLimit(totalBricks: number): number {
  if (totalBricks < 100) return Math.max(1, Math.ceil(totalBricks * 0.05));
  return Math.min(10, Math.max(5, Math.ceil(totalBricks * 0.015)));
}

function prototypeWeakLimit(totalBricks: number): number {
  if (totalBricks < 100) return Math.max(2, Math.ceil(totalBricks * 0.08));
  return Math.min(20, Math.max(8, Math.ceil(totalBricks * 0.03)));
}

function readinessStatus(layout: ReturnType<typeof summarizeGraphDiagnostics>, totalBricks: number): EvalRow['readinessStatus'] {
  if (layout.floatingBricks > 0) return 'needs_repair';
  if (layout.unsupportedBricks === 0 && layout.weakCantilevers === 0) return 'ready';
  if (
    layout.unsupportedBricks <= prototypeUnsupportedLimit(totalBricks) &&
    layout.weakCantilevers <= prototypeWeakLimit(totalBricks)
  ) return 'prototype';
  return 'needs_repair';
}

function deriveGridSize(grid: string[][][]): number {
  return Math.max(grid.length, grid[0]?.length ?? 0, grid[0]?.[0]?.length ?? 0);
}

export function countFilledVoxels(grid: string[][][]): number {
  let count = 0;
  for (const plane of grid) {
    for (const column of plane) {
      for (const cell of column) {
        if (cell !== '0') count++;
      }
    }
  }
  return count;
}

export function toVoxelGrid(raw: unknown): VoxelGrid | null {
  const data = raw as {
    voxelData?: VoxelData;
    grid?: string[][][];
    colorLegend?: Record<string, string>;
    color_legend?: Record<string, string>;
    gridSize?: number;
  };

  if (data.voxelData?.grid && data.voxelData.colorLegend) {
    return {
      grid: data.voxelData.grid,
      colorLegend: data.voxelData.colorLegend,
      gridSize: data.voxelData.gridSize ?? deriveGridSize(data.voxelData.grid),
    };
  }

  if (data.grid && (data.colorLegend || data.color_legend)) {
    return {
      grid: data.grid,
      colorLegend: data.colorLegend ?? data.color_legend ?? {},
      gridSize: data.gridSize ?? deriveGridSize(data.grid),
    };
  }

  return null;
}

function existingModel(raw: unknown): BrickModelData | null {
  const data = raw as Partial<BrickModelData>;
  if (Array.isArray(data.bricks) && typeof data.totalBricks === 'number') {
    return data as BrickModelData;
  }
  return null;
}

function brickCoverage(model: BrickModelData, voxelGrid: VoxelGrid | null, validateAgainstVoxels: boolean): {
  occupiedCells: number;
  overlapCells: number;
  missingVoxels: number | null;
} {
  const occupied = new Set<string>();
  let overlapCells = 0;

  for (const brick of model.bricks) {
    const gx = brick.metadata?.gx ?? 0;
    const gy = brick.metadata?.gy ?? 0;
    const gz = brick.metadata?.gz ?? 0;
    const gw = brick.metadata?.gw ?? brick.studWidth ?? 1;
    const gd = brick.metadata?.gd ?? brick.studDepth ?? 1;
    for (let dx = 0; dx < gw; dx++) {
      for (let dz = 0; dz < gd; dz++) {
        const key = `${gx + dx},${gz + dz},${gy}`;
        if (occupied.has(key)) overlapCells++;
        occupied.add(key);
      }
    }
  }

  if (!voxelGrid || !validateAgainstVoxels) {
    return { occupiedCells: occupied.size, overlapCells, missingVoxels: null };
  }

  let missingVoxels = 0;
  for (let x = 0; x < voxelGrid.grid.length; x++) {
    for (let y = 0; y < (voxelGrid.grid[x]?.length ?? 0); y++) {
      for (let z = 0; z < (voxelGrid.grid[x]?.[y]?.length ?? 0); z++) {
        if (voxelGrid.grid[x][y][z] !== '0' && !occupied.has(`${x},${y},${z}`)) missingVoxels++;
      }
    }
  }

  return { occupiedCells: occupied.size, overlapCells, missingVoxels };
}

function rowForModel(
  file: string,
  engine: EvalRow['engine'],
  voxels: number,
  model: BrickModelData,
  runtimeMs: number,
  voxelGrid: VoxelGrid | null,
  validateAgainstVoxels: boolean,
): EvalRow {
  const layout = summarizeGraphDiagnostics(analyzeBrickGraph(model.bricks));
  const coverage = brickCoverage(model, voxelGrid, validateAgainstVoxels);
  const stabilityV2 = (model as BrickModelData & { stabilityV2Stats?: StabilityV2Stats }).stabilityV2Stats;
  return {
    file,
    engine,
    variant: engine,
    voxels,
    bricks: model.totalBricks,
    compression: model.totalBricks === 0 ? 0 : Number((voxels / model.totalBricks).toFixed(2)),
    runtimeMs,
    ...coverage,
    connectedComponents: layout.connectedComponents,
    floatingBricks: layout.floatingBricks,
    unsupportedBricks: layout.unsupportedBricks,
    supportedCantilevers: layout.supportedCantilevers,
    weakCantilevers: layout.weakCantilevers,
    articulationBricks: layout.articulationBricks,
    bridgeEdges: layout.bridgeEdges,
    repeatedSeams: layout.seamAlignment.repeatedAdjacentLayerSeams,
    maxSeamRun: layout.seamAlignment.maxVerticalRun,
    gateStatus: layout.gateStatus,
    healthScore: layout.healthScore,
    candidateCount: stabilityV2?.candidateCount ?? 0,
    candidateMaskMs: stabilityV2?.candidateMaskMs ?? 0,
    repairPatchType: stabilityV2?.repair?.repairPatchType ?? null,
    repairAcceptedBy: stabilityV2?.repair?.repairAcceptedBy ?? null,
    oracleCheckedRegions: stabilityV2?.oracleCheckedRegions ?? 0,
    oracleFailures: stabilityV2?.oracleFailures ?? 0,
    readinessStatus: readinessStatus(layout, model.totalBricks),
  };
}

function runQuietly<T>(enabled: boolean, fn: () => T): T {
  if (enabled) return fn();
  const originalLog = console.log;
  try {
    console.log = () => {};
    return fn();
  } finally {
    console.log = originalLog;
  }
}

export async function evaluateFile(filePath: string, options: EvalOptions): Promise<EvalRow[]> {
  const raw = JSON.parse(await readFile(filePath, 'utf8')) as unknown;
  const file = path.basename(filePath);
  const voxelGrid = toVoxelGrid(raw);
  const existing = existingModel(raw);

  if (!voxelGrid && !existing) {
    throw new Error(`${filePath} does not contain voxelData, raw grid data, or BrickModelData`);
  }

  const voxels = voxelGrid ? countFilledVoxels(voxelGrid.grid) : 0;
  const rows: EvalRow[] = [];

  if (existing) {
    const existingVoxelGrid = existing.voxelData
      ? { grid: existing.voxelData.grid, colorLegend: existing.voxelData.colorLegend, gridSize: existing.voxelData.gridSize }
      : voxelGrid;
    rows.push(rowForModel(
      file,
      'existing',
      existing.voxelData ? countFilledVoxels(existing.voxelData.grid) : voxels,
      existing,
      0,
      existingVoxelGrid,
      true,
    ));
  }

  if (!voxelGrid) return rows;

  for (const engine of options.engines) {
    const startedAt = Date.now();
    const model = runQuietly(options.verbose, () => (
      !isStabilityV2Variant(engine)
        ? voxelGridToBrickModel(voxelGrid, file.replace(/\.\w+$/, ''), `Eval build for ${file}`, { shell: options.shell })
        : voxelGridToBrickModelV2(voxelGrid, file.replace(/\.\w+$/, ''), `Eval build for ${file}`, {
          shell: options.shell,
          deepRepair: options.deepRepair,
          variant: engine,
        })
    ));
    rows.push(rowForModel(file, engine, voxels, model, Date.now() - startedAt, voxelGrid, !options.shell));
  }

  return rows;
}

export function printTable(rows: EvalRow[]): void {
  console.table(rows.map((row) => ({
    file: row.file,
    engine: row.engine,
    voxels: row.voxels,
    bricks: row.bricks,
    compression: row.compression,
    ms: row.runtimeMs,
    overlaps: row.overlapCells,
    missing: row.missingVoxels ?? '-',
    components: row.connectedComponents,
    floating: row.floatingBricks,
    unsupported: row.unsupportedBricks,
    cantilever: row.supportedCantilevers,
    weakCantilever: row.weakCantilevers,
    articulations: row.articulationBricks,
    bridges: row.bridgeEdges,
    repeatedSeams: row.repeatedSeams,
    maxSeamRun: row.maxSeamRun,
    candidates: row.candidateCount,
    maskMs: row.candidateMaskMs,
    oracleFailures: row.oracleFailures,
    readiness: row.readinessStatus,
    gate: row.gateStatus,
  })));
}

export async function evaluateFiles(files: string[], options: EvalOptions): Promise<EvalRow[]> {
  return (await Promise.all(files.map((file) => evaluateFile(file, options)))).flat();
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const rows = await evaluateFiles(options.files, options);

  if (options.json) {
    console.log(JSON.stringify(rows, null, 2));
  } else {
    printTable(rows);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

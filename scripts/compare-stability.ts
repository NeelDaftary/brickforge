/**
 * Compare stability: baseline (no refinement) vs refiner (split-remerge).
 *
 * Usage: npx tsx scripts/compare-stability.ts [path-to-voxel-json]
 *
 * If no JSON is provided, runs the Blender pipeline on samples/source-assets/charmander.glb first.
 */

import { readFile, access, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import {
  voxelGridToBrickModel,
  type VoxelGrid,
} from '@/lib/pipeline/voxel-to-bricks';
import { checkBrickStability, type StabilityResult } from '@/lib/pipeline/brick-stability';
import { BLENDER_VOXEL_TO_GRID_SCRIPT, TMP_VOXELS_DIR } from '@/lib/pipeline/paths';

const execFileAsync = promisify(execFile);

// ─── Blender helpers ─────────────────────────────────────────────────────────

function getBlenderBinary(): string {
  if (process.env.BLENDER_PATH) return process.env.BLENDER_PATH;
  if (process.platform === 'darwin') return '/Applications/Blender.app/Contents/MacOS/Blender';
  return 'blender';
}

async function voxelizeWithBlender(meshPath: string): Promise<{ grid: string[][][]; colorLegend: Record<string, string> }> {
  await mkdir(TMP_VOXELS_DIR, { recursive: true });
  const outputPath = path.join(TMP_VOXELS_DIR, `compare-${Date.now()}-${randomUUID()}.voxels.json`);
  const blender = getBlenderBinary();

  const args = [
    '--background',
    '--python', BLENDER_VOXEL_TO_GRID_SCRIPT,
    '--',
    '--voxel-size', '0.06',
    '--output', outputPath,
    '--import', meshPath,
  ];

  console.log(`\n[blender] Voxelizing ${path.basename(meshPath)}...`);
  await execFileAsync(blender, args, { timeout: 120000, maxBuffer: 10 * 1024 * 1024 });

  const raw = await readFile(outputPath, 'utf8');
  const json = JSON.parse(raw);
  return { grid: json.grid, colorLegend: json.color_legend };
}

// ─── Stability summary printer ───────────────────────────────────────────────

function printStability(label: string, result: StabilityResult, totalBricks: number) {
  console.log(`\n═══ ${label} ═══`);
  console.log(`  Total bricks:  ${totalBricks}`);
  console.log(`  Stable:        ${result.stableCount}  (${pct(result.stableCount, totalBricks)})`);
  console.log(`  Marginal:      ${result.marginalCount}  (${pct(result.marginalCount, totalBricks)})`);
  console.log(`  Weak:          ${result.weakCount}  (${pct(result.weakCount, totalBricks)})`);
  console.log(`  Critical:      ${result.criticalCount}  (${pct(result.criticalCount, totalBricks)})`);
  if (result.warnings.length > 0) {
    for (const w of result.warnings) console.log(`  ! ${w}`);
  } else {
    console.log(`  OK — No warnings`);
  }
}

function pct(n: number, total: number): string {
  if (total === 0) return '0%';
  return `${((n / total) * 100).toFixed(1)}%`;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const arg = process.argv[2];
  let grid: string[][][];
  let colorLegend: Record<string, string>;

  if (arg && arg.endsWith('.json')) {
    console.log(`Loading voxel JSON: ${arg}`);
    const raw = await readFile(arg, 'utf8');
    const json = JSON.parse(raw);
    grid = json.grid;
    colorLegend = json.color_legend;
  } else {
    const meshPath = arg || path.resolve('samples/source-assets/charmander.glb');
    const exists = await access(meshPath).then(() => true).catch(() => false);
    if (!exists) {
      console.error(`File not found: ${meshPath}`);
      process.exit(1);
    }
    const result = await voxelizeWithBlender(meshPath);
    grid = result.grid;
    colorLegend = result.colorLegend;
  }

  const sx = grid.length;
  const sy = sx > 0 ? grid[0].length : 0;
  const sz = sy > 0 ? grid[0][0].length : 0;
  let totalVoxels = 0;
  for (let x = 0; x < sx; x++)
    for (let y = 0; y < sy; y++)
      for (let z = 0; z < sz; z++)
        if (grid[x][y][z] !== '0') totalVoxels++;

  console.log(`\nGrid: ${sx} x ${sy} x ${sz}  (${totalVoxels} filled voxels)`);

  const voxelGrid: VoxelGrid = { grid, colorLegend, gridSize: Math.max(sx, sy, sz) };

  // ─── OLD: No refinement ──────────────────────────────────────────────
  console.log('\n────────────────────────────────────────');
  console.log('Running BASELINE (refine: false)...');

  const oldModel = voxelGridToBrickModel(voxelGrid, 'baseline', 'baseline', { shell: false, refine: false, fill: false });
  const oldStability = checkBrickStability(oldModel.bricks);
  printStability('BASELINE (no refinement)', oldStability, oldModel.totalBricks);

  // ─── NEW: With refinement + fill ─────────────────────────────────────
  console.log('\n────────────────────────────────────────');
  console.log('Running REFINED + FILL (refine: true, fill: true)...');

  const newModel = voxelGridToBrickModel(voxelGrid, 'refined+fill', 'refined+fill', { shell: false, refine: true, fill: true });
  const newStability = checkBrickStability(newModel.bricks);
  printStability('REFINED + FILL (split-remerge + gap-fill)', newStability, newModel.totalBricks);

  const fillStats = (newModel as { fillStats?: { cellsFilled: number; columnsBuilt: number; budgetUsed: number } }).fillStats;
  if (fillStats) {
    console.log(`\n  Fill stats: ${fillStats.cellsFilled} cells filled, ${fillStats.columnsBuilt} columns (${(fillStats.budgetUsed * 100).toFixed(1)}% budget)`);
  }

  // ─── Comparison ────────────────────────────────────────────────────────
  console.log('\n════════════════════════════════════════');
  console.log('COMPARISON SUMMARY (baseline → refine+fill)');
  console.log('════════════════════════════════════════');

  const arrow = (a: number, b: number) => b < a ? `↓${a - b}` : b > a ? `↑${b - a}` : '=';

  console.log(`  Critical:  ${oldStability.criticalCount} → ${newStability.criticalCount}  (${arrow(oldStability.criticalCount, newStability.criticalCount)})`);
  console.log(`  Weak:      ${oldStability.weakCount} → ${newStability.weakCount}  (${arrow(oldStability.weakCount, newStability.weakCount)})`);
  console.log(`  Marginal:  ${oldStability.marginalCount} → ${newStability.marginalCount}  (${arrow(oldStability.marginalCount, newStability.marginalCount)})`);
  console.log(`  Stable:    ${pct(oldStability.stableCount, oldModel.totalBricks)} → ${pct(newStability.stableCount, newModel.totalBricks)}`);
  console.log(`  Bricks:    ${oldModel.totalBricks} → ${newModel.totalBricks}`);

  const oldUnstable = oldStability.criticalCount + oldStability.weakCount + oldStability.marginalCount;
  const newUnstable = newStability.criticalCount + newStability.weakCount + newStability.marginalCount;

  if (newUnstable < oldUnstable) {
    console.log(`\n  OK — Refine+fill improved stability by ${oldUnstable - newUnstable} fewer unstable bricks`);
  } else if (newUnstable === oldUnstable) {
    console.log(`\n  = No change in unstable brick count`);
  } else {
    console.log(`\n  X Refine+fill added ${newUnstable - oldUnstable} more unstable bricks`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

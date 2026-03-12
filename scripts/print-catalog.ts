/**
 * Print Catalog — generates a brick parts list and print bed layout.
 *
 * Usage:
 *   npx tsx scripts/print-catalog.ts <path-to-.brickforge.json>
 *   npx tsx scripts/print-catalog.ts <path-to-voxel.json>
 *
 * Options:
 *   --bed-width <mm>    Print bed width (default 220)
 *   --bed-depth <mm>    Print bed depth (default 220)
 *   --gap <mm>          Spacing between bricks (default 2)
 */

import { readFile } from 'node:fs/promises';
import type { BrickModelData } from '@/lib/engine/types';
import { generateBOM, type BOMItem } from '@/lib/engine/bom-generator';
import { planPrintBeds, type PrintPlan } from '@/lib/export/print-planner';
import { voxelGridToBrickModel, type VoxelGrid } from '@/lib/pipeline/voxel-to-bricks';

// ─── CLI arg parsing ─────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  let filePath: string | undefined;
  let bedWidth = 220;
  let bedDepth = 220;
  let gap = 2;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--bed-width') { bedWidth = Number(args[++i]); continue; }
    if (args[i] === '--bed-depth') { bedDepth = Number(args[++i]); continue; }
    if (args[i] === '--gap') { gap = Number(args[++i]); continue; }
    if (!filePath) filePath = args[i];
  }

  if (!filePath) {
    console.error('Usage: npx tsx scripts/print-catalog.ts <model.brickforge.json | voxels.json>');
    process.exit(1);
  }

  return { filePath, bedWidth, bedDepth, gap };
}

// ─── Load model ──────────────────────────────────────────────────────────────

async function loadModel(filePath: string): Promise<BrickModelData> {
  const raw = await readFile(filePath, 'utf8');
  const json = JSON.parse(raw);

  // If it has a 'bricks' array, it's a .brickforge.json
  if (Array.isArray(json.bricks)) {
    return json as BrickModelData;
  }

  // Otherwise treat as voxel grid JSON
  if (json.grid && json.color_legend) {
    const voxelGrid: VoxelGrid = {
      grid: json.grid,
      colorLegend: json.color_legend,
      gridSize: Math.max(json.grid.length, json.grid[0]?.length ?? 0, json.grid[0]?.[0]?.length ?? 0),
    };
    console.log('Detected voxel JSON — running brick pipeline...\n');
    return voxelGridToBrickModel(voxelGrid, 'print-catalog', 'print-catalog');
  }

  console.error('Unrecognized file format. Expected .brickforge.json or voxel grid JSON.');
  process.exit(1);
}

// ─── Pretty printers ─────────────────────────────────────────────────────────

function pad(s: string, n: number): string { return s.padEnd(n); }
function padL(s: string, n: number): string { return s.padStart(n); }

function printBOM(bom: BOMItem[]) {
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║                        BILL OF MATERIALS                        ║');
  console.log('╠══════════════════════════════════════════════════════════════════╣');
  console.log(`║  ${pad('Part', 16)} ${pad('Color', 14)} ${padL('Count', 6)} ${padL('BrickLink', 10)}  ║`);
  console.log('╟──────────────────────────────────────────────────────────────────╢');

  let total = 0;
  for (const item of bom) {
    const part = pad(item.displayName, 16);
    const color = pad(item.colorName, 14);
    const count = padL(String(item.count), 6);
    const bl = padL(item.bricklinkPartId, 10);
    console.log(`║  ${part} ${color} ${count} ${bl}  ║`);
    total += item.count;
  }

  console.log('╟──────────────────────────────────────────────────────────────────╢');
  console.log(`║  ${pad('TOTAL', 16)} ${pad('', 14)} ${padL(String(total), 6)} ${pad('', 10)}  ║`);
  console.log(`║  ${pad(`${bom.length} unique parts`, 48)}  ║`);
  console.log('╚══════════════════════════════════════════════════════════════════╝');
}

function printPrintPlan(plan: PrintPlan) {
  console.log('\n╔══════════════════════════════════════════════════════════════════╗');
  console.log('║                         PRINT PLAN                             ║');
  console.log('╠══════════════════════════════════════════════════════════════════╣');

  // Color summary
  console.log(`║  ${pad('Color', 16)} ${padL('Bricks', 8)} ${padL('Beds', 6)} ${pad('', 20)}  ║`);
  console.log('╟──────────────────────────────────────────────────────────────────╢');

  for (const cs of plan.colorSummary) {
    const color = pad(cs.colorName, 16);
    const bricks = padL(String(cs.bricks), 8);
    const beds = padL(String(cs.beds), 6);
    const swatch = cs.color.toUpperCase();
    console.log(`║  ${color} ${bricks} ${beds}   ${pad(swatch, 17)}  ║`);
  }

  console.log('╟──────────────────────────────────────────────────────────────────╢');
  console.log(`║  ${pad(`Total: ${plan.totalBricks} bricks across ${plan.totalBeds} print bed(s)`, 50)}  ║`);
  console.log('╚══════════════════════════════════════════════════════════════════╝');

  // Per-bed detail
  console.log('\n── Bed Details ─────────────────────────────────────────────────');
  for (const bed of plan.beds) {
    const label = plan.colorSummary.find(c => c.color === bed.color)!;
    const bedLabel = label.beds > 1 ? ` (bed ${bed.bedIndex + 1}/${label.beds})` : '';
    console.log(`\n  ${bed.colorName}${bedLabel}  —  ${bed.brickCount} bricks  —  ${(bed.utilization * 100).toFixed(0)}% bed utilization`);

    // Tally bricks on this bed
    const tally = new Map<string, number>();
    for (const b of bed.bricks) {
      tally.set(b.displayName, (tally.get(b.displayName) ?? 0) + 1);
    }
    for (const [name, count] of [...tally.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${padL(String(count), 4)}×  ${name}`);
    }
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const { filePath, bedWidth, bedDepth, gap } = parseArgs();
  console.log(`Loading: ${filePath}`);
  console.log(`Bed size: ${bedWidth} × ${bedDepth} mm  |  Gap: ${gap} mm\n`);

  const model = await loadModel(filePath);
  console.log(`\nModel: "${model.name}" — ${model.totalBricks} bricks\n`);

  // BOM
  const bom = generateBOM(model);
  printBOM(bom);

  // Print plan
  const plan = planPrintBeds(bom, { bedWidth, bedDepth, gap });
  printPrintPlan(plan);

  // Summary
  console.log('\n════════════════════════════════════════════════════════════════════');
  console.log(`  ${plan.totalBeds} print job${plan.totalBeds === 1 ? '' : 's'} needed (1 per color bed)`);
  console.log(`  ${plan.colorSummary.length} filament color${plan.colorSummary.length === 1 ? '' : 's'} required`);
  console.log('════════════════════════════════════════════════════════════════════');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

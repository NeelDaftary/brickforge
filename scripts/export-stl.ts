/**
 * Export STL — generates print-ready STL files from a BrickForge model.
 *
 * Outputs one STL per print bed (color + bed index), packed with MaxRects.
 *
 * Usage:
 *   npx tsx scripts/export-stl.ts <model.brickforge.json> [--out-dir <dir>]
 *   npx tsx scripts/export-stl.ts <voxels.json> [--out-dir <dir>]
 *
 * Options:
 *   --out-dir <dir>     Output directory (default: .tmp/stl-export)
 *   --bed-width <mm>    Print bed width (default 220)
 *   --bed-depth <mm>    Print bed depth (default 220)
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { BrickModelData } from '@/lib/engine/types';
import { voxelGridToBrickModel, type VoxelGrid } from '@/lib/pipeline/voxel-to-bricks';
import { packBed } from '@/lib/export/bed-packer';
import { plateToSTL } from '@/lib/export/stl-writer';

// ─── CLI args ────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  let filePath: string | undefined;
  let outDir = path.join(process.cwd(), '.tmp', 'stl-export');
  let bedWidth = 220;
  let bedDepth = 220;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--out-dir') { outDir = args[++i]; continue; }
    if (args[i] === '--bed-width') { bedWidth = Number(args[++i]); continue; }
    if (args[i] === '--bed-depth') { bedDepth = Number(args[++i]); continue; }
    if (!filePath) filePath = args[i];
  }

  if (!filePath) {
    console.error('Usage: npx tsx scripts/export-stl.ts <model.brickforge.json | voxels.json> [--out-dir <dir>]');
    process.exit(1);
  }

  return { filePath, outDir, bedWidth, bedDepth };
}

// ─── Load model ──────────────────────────────────────────────────────────────

async function loadModel(filePath: string): Promise<BrickModelData> {
  const raw = await readFile(filePath, 'utf8');
  const json = JSON.parse(raw);

  if (Array.isArray(json.bricks)) return json as BrickModelData;

  if (json.grid && json.color_legend) {
    const voxelGrid: VoxelGrid = {
      grid: json.grid,
      colorLegend: json.color_legend,
      gridSize: Math.max(json.grid.length, json.grid[0]?.length ?? 0, json.grid[0]?.[0]?.length ?? 0),
    };
    console.log('Detected voxel JSON — running brick pipeline...\n');
    return voxelGridToBrickModel(voxelGrid, 'stl-export', 'stl-export');
  }

  console.error('Unrecognized file format.');
  process.exit(1);
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const { filePath, outDir, bedWidth, bedDepth } = parseArgs();
  console.log(`Loading: ${filePath}`);
  console.log(`Bed: ${bedWidth} x ${bedDepth} mm`);
  console.log(`Output: ${outDir}\n`);

  const model = await loadModel(filePath);
  console.log(`Model: "${model.name}" — ${model.totalBricks} bricks\n`);

  console.log('Packing beds + generating meshes...');
  const result = packBed(model, { bedWidth, bedDepth });
  console.log(`  ${result.plates.length} plate(s) across ${new Set(result.plates.map(p => p.color)).size} color(s)\n`);

  await mkdir(outDir, { recursive: true });

  console.log('Writing STL files...');
  let totalBytes = 0;

  for (let i = 0; i < result.plates.length; i++) {
    const plate = result.plates[i];
    const stlBuffer = plateToSTL(plate);

    // Sanitize color name for filename
    const safeName = plate.colorName.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
    const fileName = `plate_${String(i + 1).padStart(2, '0')}_${safeName}.stl`;
    const filePath = path.join(outDir, fileName);

    await writeFile(filePath, Buffer.from(stlBuffer));
    totalBytes += stlBuffer.byteLength;

    const tris = (stlBuffer.byteLength - 84) / 50;
    console.log(`  ${fileName}  —  ${plate.bricks.length} bricks, ${tris} triangles, ${(stlBuffer.byteLength / 1024).toFixed(0)} KB`);
  }

  console.log(`\nDone! ${result.plates.length} STL files written (${(totalBytes / 1024 / 1024).toFixed(1)} MB total)`);
  console.log(`Output directory: ${outDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

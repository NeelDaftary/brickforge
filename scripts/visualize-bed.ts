/**
 * Visualize the most efficiently packed print bed as a terminal matrix.
 */

import { readFile } from 'node:fs/promises';
import type { BrickModelData } from '@/lib/engine/types';
import { generateBOM } from '@/lib/engine/bom-generator';
import { planPrintBeds } from '@/lib/export/print-planner';

const CELL_MM = 2; // mm per grid cell — 220mm / 2 = 110 cols

const BRICK_CHARS = '█▓▒░▆▅▃▂◼◻●○■□▪▫'.split('');

async function main() {
  const filePath = process.argv[2];
  if (!filePath) { console.error('Usage: npx tsx scripts/visualize-bed.ts <model.json>'); process.exit(1); }

  const raw = await readFile(filePath, 'utf8');
  const model = JSON.parse(raw) as BrickModelData;
  const bom = generateBOM(model);
  const plan = planPrintBeds(bom);

  // Find bed with highest utilization
  const best = plan.beds.reduce((a, b) => a.utilization > b.utilization ? a : b);

  const cols = Math.ceil(220 / CELL_MM);
  const rows = Math.ceil(220 / CELL_MM);
  const grid: string[][] = Array.from({ length: rows }, () => Array(cols).fill('·'));

  // Assign each brick a visual character (cycle through for distinction)
  for (let bi = 0; bi < best.bricks.length; bi++) {
    const b = best.bricks[bi];
    const ch = BRICK_CHARS[bi % BRICK_CHARS.length];
    const x0 = Math.round(b.x / CELL_MM);
    const z0 = Math.round(b.z / CELL_MM);
    const x1 = Math.round((b.x + b.widthMm) / CELL_MM);
    const z1 = Math.round((b.z + b.depthMm) / CELL_MM);

    for (let r = z0; r < z1 && r < rows; r++) {
      for (let c = x0; c < x1 && c < cols; c++) {
        grid[r][c] = ch;
      }
    }
  }

  // Trim empty rows/cols from bottom and right
  let maxRow = 0, maxCol = 0;
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      if (grid[r][c] !== '·') { maxRow = Math.max(maxRow, r); maxCol = Math.max(maxCol, c); }

  const trimmedRows = maxRow + 2; // +1 for content, +1 for border
  const trimmedCols = maxCol + 2;

  console.log(`\n  Best bed: ${best.colorName} (bed ${best.bedIndex + 1}) — ${best.brickCount} bricks — ${(best.utilization * 100).toFixed(0)}% utilization`);
  console.log(`  220 × 220 mm bed  |  1 char = ${CELL_MM}mm  |  · = empty\n`);

  // Top border
  console.log('  ┌' + '─'.repeat(trimmedCols) + '┐');

  for (let r = 0; r < trimmedRows; r++) {
    console.log('  │' + grid[r].slice(0, trimmedCols).join('') + '│');
  }

  // Bottom border
  console.log('  └' + '─'.repeat(trimmedCols) + '┘');

  // Legend: tally by brick type
  const tally = new Map<string, number>();
  for (const b of best.bricks) tally.set(b.displayName, (tally.get(b.displayName) ?? 0) + 1);
  console.log('\n  Brick tally:');
  for (const [name, count] of [...tally.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(count).padStart(4)}×  ${name}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });

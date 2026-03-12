import { readFile } from 'node:fs/promises';
import { checkBrickStability } from '@/lib/pipeline/brick-stability';

async function main() {
  const filePath = process.argv[2];
  if (!filePath) { console.error('Usage: npx tsx scripts/check-stability-quick.ts <model.json>'); process.exit(1); }

  const raw = await readFile(filePath, 'utf8');
  const model = JSON.parse(raw);
  const r = checkBrickStability(model.bricks);
  const total = r.stableCount + r.marginalCount + r.weakCount + r.criticalCount;

  console.log(`\nStability Report — ${total} bricks`);
  console.log('─'.repeat(40));
  console.log(`  Stable:    ${r.stableCount}  (${((r.stableCount / total) * 100).toFixed(1)}%)`);
  console.log(`  Marginal:  ${r.marginalCount}`);
  console.log(`  Weak:      ${r.weakCount}`);
  console.log(`  Critical:  ${r.criticalCount}`);
  for (const w of r.warnings) console.log(`  ! ${w}`);
  if (r.warnings.length === 0) console.log('  OK — structurally sound');
}

main().catch((e) => { console.error(e); process.exit(1); });

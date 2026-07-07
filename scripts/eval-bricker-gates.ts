#!/usr/bin/env tsx

import { evaluateFiles, printTable, type EvalOptions, type EvalRow } from './eval-bricker';

interface GateFailure {
  file: string;
  engine: string;
  reason: string;
}

function parseGateArgs(argv: string[]): EvalOptions {
  const files = argv.filter((arg) => !arg.startsWith('--'));
  const json = argv.includes('--json');
  const verbose = argv.includes('--verbose');
  const deepRepair = argv.includes('--deep');
  if (files.length === 0) {
    console.error('Usage: npx tsx scripts/eval-bricker-gates.ts <fixture-or-sample.json> [...] [--json] [--verbose]');
    process.exit(1);
  }
  return { files, engines: ['legacy', 'stability_v2'], shell: true, json, verbose, deepRepair };
}

function isImpossible(row: EvalRow): boolean {
  return row.file.toLowerCase().includes('impossible');
}

function isFixture(row: EvalRow): boolean {
  return !row.file.toLowerCase().includes('squirtle') && !row.file.toLowerCase().includes('house_voxels');
}

function failuresForRows(rows: EvalRow[]): GateFailure[] {
  const failures: GateFailure[] = [];
  const byFile = new Map<string, EvalRow[]>();
  for (const row of rows) {
    const group = byFile.get(row.file) ?? [];
    group.push(row);
    byFile.set(row.file, group);
  }

  for (const [file, fileRows] of byFile) {
    const legacy = fileRows.find((row) => row.engine === 'legacy');
    const v2 = fileRows.find((row) => row.engine === 'stability_v2');
    if (!v2) continue;

    if (v2.overlapCells > 0) failures.push({ file, engine: 'stability_v2', reason: `overlapCells=${v2.overlapCells}` });
    if (v2.missingVoxels != null && v2.missingVoxels > 0) failures.push({ file, engine: 'stability_v2', reason: `missingVoxels=${v2.missingVoxels}` });

    if (isImpossible(v2)) continue;

    if (isFixture(v2)) {
      if (v2.floatingBricks !== 0) failures.push({ file, engine: 'stability_v2', reason: `fixture floatingBricks=${v2.floatingBricks}` });
      if (v2.unsupportedBricks !== 0) failures.push({ file, engine: 'stability_v2', reason: `fixture unsupportedBricks=${v2.unsupportedBricks}` });
      continue;
    }

    if (!legacy) continue;
    if (v2.floatingBricks !== 0) failures.push({ file, engine: 'stability_v2', reason: `organic floatingBricks=${v2.floatingBricks}` });
    if (v2.unsupportedBricks > legacy.unsupportedBricks) {
      failures.push({ file, engine: 'stability_v2', reason: `unsupported ${v2.unsupportedBricks} > legacy ${legacy.unsupportedBricks}` });
    }
    if (v2.weakCantilevers > legacy.weakCantilevers) {
      failures.push({ file, engine: 'stability_v2', reason: `weakCantilevers ${v2.weakCantilevers} > legacy ${legacy.weakCantilevers}` });
    }
    if (v2.articulationBricks > legacy.articulationBricks) {
      failures.push({ file, engine: 'stability_v2', reason: `articulations ${v2.articulationBricks} > legacy ${legacy.articulationBricks}` });
    }
    if (v2.bridgeEdges > legacy.bridgeEdges) {
      failures.push({ file, engine: 'stability_v2', reason: `bridges ${v2.bridgeEdges} > legacy ${legacy.bridgeEdges}` });
    }
    if (v2.bricks > legacy.bricks * 1.2) {
      failures.push({ file, engine: 'stability_v2', reason: `bricks ${v2.bricks} > 1.2x legacy ${legacy.bricks}` });
    }
    if (legacy.runtimeMs > 0 && v2.runtimeMs > legacy.runtimeMs * 8) {
      failures.push({ file, engine: 'stability_v2', reason: `runtime ${v2.runtimeMs}ms > 8x legacy ${legacy.runtimeMs}ms` });
    }
  }

  return failures;
}

async function main(): Promise<void> {
  const options = parseGateArgs(process.argv.slice(2));
  const rows = await evaluateFiles(options.files, options);
  const failures = failuresForRows(rows);

  if (options.json) {
    console.log(JSON.stringify({ rows, failures, passed: failures.length === 0 }, null, 2));
  } else {
    printTable(rows);
    if (failures.length > 0) {
      console.error('\nGate failures:');
      for (const failure of failures) {
        console.error(`- ${failure.file}: ${failure.reason}`);
      }
    }
  }

  if (failures.length > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

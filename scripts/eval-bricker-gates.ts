#!/usr/bin/env tsx

import { evaluateFiles, EVAL_BRICKER_VARIANTS, printTable, type EvalBrickerVariant, type EvalOptions, type EvalRow } from './eval-bricker';

interface GateFailure {
  file: string;
  engine: string;
  reason: string;
}

function parseGateArgs(argv: string[]): EvalOptions {
  const files: string[] = [];
  let engines: EvalBrickerVariant[] = ['legacy', 'stability_v2'];
  let json = false;
  let verbose = false;
  let deepRepair = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') json = true;
    else if (arg === '--verbose') verbose = true;
    else if (arg === '--deep') deepRepair = true;
    else if (arg === '--engines') {
      const value = argv[++i];
      const parsed = value === 'all' ? [...EVAL_BRICKER_VARIANTS] : value?.split(',');
      if (!parsed?.length || parsed.some((engine) => !EVAL_BRICKER_VARIANTS.includes(engine as EvalBrickerVariant))) {
        console.error(`Invalid --engines. Use a comma-separated list from: ${EVAL_BRICKER_VARIANTS.join(',')}`);
        process.exit(1);
      }
      engines = parsed as EvalBrickerVariant[];
    } else if (arg.startsWith('--')) {
      console.error('Usage: npx tsx scripts/eval-bricker-gates.ts <fixture-or-sample.json> [...] [--engines all] [--json] [--verbose]');
      process.exit(1);
    } else {
      files.push(arg);
    }
  }
  if (files.length === 0) {
    console.error('Usage: npx tsx scripts/eval-bricker-gates.ts <fixture-or-sample.json> [...] [--engines all] [--json] [--verbose]');
    process.exit(1);
  }
  return { files, engines, shell: true, json, verbose, deepRepair };
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
    const baseline = fileRows.find((row) => row.engine === 'stability_v2');
    if (!baseline) continue;

    const targets = fileRows.filter((row) => row.engine !== 'legacy' && row.engine !== 'existing');

    for (const v2 of targets) {
      if (v2.overlapCells > 0) failures.push({ file, engine: v2.engine, reason: `overlapCells=${v2.overlapCells}` });
      if (v2.missingVoxels != null && v2.missingVoxels > 0) failures.push({ file, engine: v2.engine, reason: `missingVoxels=${v2.missingVoxels}` });

      if (isImpossible(v2)) continue;

      if (isFixture(v2)) {
        if (v2.floatingBricks !== 0) failures.push({ file, engine: v2.engine, reason: `fixture floatingBricks=${v2.floatingBricks}` });
        if (v2.unsupportedBricks !== 0) failures.push({ file, engine: v2.engine, reason: `fixture unsupportedBricks=${v2.unsupportedBricks}` });
        continue;
      }

      const comparator = v2.engine === 'stability_v2' ? legacy : baseline;
      if (!comparator) continue;
      if (v2.floatingBricks !== 0) failures.push({ file, engine: v2.engine, reason: `organic floatingBricks=${v2.floatingBricks}` });
      if (v2.unsupportedBricks > comparator.unsupportedBricks) {
        failures.push({ file, engine: v2.engine, reason: `unsupported ${v2.unsupportedBricks} > baseline ${comparator.unsupportedBricks}` });
      }
      if (v2.weakCantilevers > comparator.weakCantilevers) {
        failures.push({ file, engine: v2.engine, reason: `weakCantilevers ${v2.weakCantilevers} > baseline ${comparator.weakCantilevers}` });
      }
      if (v2.articulationBricks > comparator.articulationBricks) {
        failures.push({ file, engine: v2.engine, reason: `articulations ${v2.articulationBricks} > baseline ${comparator.articulationBricks}` });
      }
      if (v2.bridgeEdges > comparator.bridgeEdges) {
        failures.push({ file, engine: v2.engine, reason: `bridges ${v2.bridgeEdges} > baseline ${comparator.bridgeEdges}` });
      }
      if (v2.bricks > comparator.bricks * 1.2) {
        failures.push({ file, engine: v2.engine, reason: `bricks ${v2.bricks} > 1.2x baseline ${comparator.bricks}` });
      }
      if (legacy && legacy.runtimeMs > 0 && v2.runtimeMs > legacy.runtimeMs * 8) {
        failures.push({ file, engine: v2.engine, reason: `runtime ${v2.runtimeMs}ms > 8x legacy ${legacy.runtimeMs}ms` });
      }
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

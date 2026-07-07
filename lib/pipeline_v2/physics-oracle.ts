import {
  analyzeBrickGraph,
  buildBrickGraph,
  type BrickGraph,
  type GraphBrick,
} from './brick-graph';

export interface PhysicsOracleFailure {
  brickId: string;
  reason: 'no_support' | 'center_outside_support' | 'low_support_ratio';
  supportRatio: number;
}

export interface PhysicsOracleResult {
  checkedRegions: number;
  failures: PhysicsOracleFailure[];
  failureBrickIds: string[];
}

function supportFootprint(graph: BrickGraph, brick: GraphBrick): { minX: number; maxX: number; minY: number; maxY: number; count: number } | null {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, count = 0;
  for (let dx = 0; dx < brick.w; dx++) {
    for (let dy = 0; dy < brick.d; dy++) {
      const x = brick.x + dx;
      const y = brick.y + dy;
      const below = graph.cellToBrick.get(`${x},${y},${brick.z - 1}`);
      if (!below || below === brick.id) continue;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      count++;
    }
  }
  return count > 0 ? { minX, maxX, minY, maxY, count } : null;
}

export function runPhysicsOracle(input: BrickGraph | Parameters<typeof buildBrickGraph>[0]): PhysicsOracleResult {
  const graph = Array.isArray(input) ? buildBrickGraph(input) : input;
  const diagnostics = analyzeBrickGraph(graph);
  const targetIds = new Set<string>([
    ...diagnostics.unsupportedBrickIds,
    ...diagnostics.weakCantileverBrickIds,
    ...diagnostics.cantileveredBrickIds,
  ]);
  const failures: PhysicsOracleFailure[] = [];

  for (const brick of graph.bricks) {
    if (!targetIds.has(brick.id) || brick.z === 0) continue;
    const support = graph.support.get(brick.id);
    if (!support) continue;
    if (support.supportedStuds === 0) {
      failures.push({ brickId: brick.id, reason: 'no_support', supportRatio: 0 });
      continue;
    }
    if (support.supportRatio < 0.25) {
      failures.push({ brickId: brick.id, reason: 'low_support_ratio', supportRatio: support.supportRatio });
      continue;
    }

    const footprint = supportFootprint(graph, brick);
    if (!footprint) continue;
    const centerX = brick.x + (brick.w - 1) / 2;
    const centerY = brick.y + (brick.d - 1) / 2;
    if (centerX < footprint.minX || centerX > footprint.maxX || centerY < footprint.minY || centerY > footprint.maxY) {
      failures.push({ brickId: brick.id, reason: 'center_outside_support', supportRatio: support.supportRatio });
    }
  }

  return {
    checkedRegions: targetIds.size,
    failures,
    failureBrickIds: failures.map((failure) => failure.brickId),
  };
}

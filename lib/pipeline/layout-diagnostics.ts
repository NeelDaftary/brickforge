import type { BrickInstance } from '@/lib/engine/types';
import { checkBrickStability } from '@/lib/pipeline/brick-stability';
import {
  analyzeBrickGraph,
  buildBrickGraph,
  summarizeGraphDiagnosticBrickIds,
  summarizeGraphDiagnostics,
  type GraphDiagnosticBrickIds,
  type GraphDiagnosticsSummary,
} from '@/lib/pipeline_v2/brick-graph';
import type { StabilityV2Stats } from '@/lib/pipeline_v2/stability-bricker';

export interface LayoutDiagnosticsResult {
  unsupportedBricks: number;
  layout: GraphDiagnosticsSummary;
  layoutIds: GraphDiagnosticBrickIds;
  stabilityWarnings: string[];
}

export function buildLayoutDiagnostics(
  bricks: BrickInstance[],
  stabilityV2?: StabilityV2Stats,
): LayoutDiagnosticsResult {
  const stability = checkBrickStability(bricks);
  const graph = buildBrickGraph(bricks);
  const graphDiagnostics = analyzeBrickGraph(graph);
  const layout = summarizeGraphDiagnostics(graphDiagnostics, {
    internalSupportBricks: stabilityV2?.internalSupport?.internalSupportBricks ?? 0,
    internalSupportVoxels: stabilityV2?.internalSupport?.internalSupportVoxels ?? 0,
  });
  const layoutIds = summarizeGraphDiagnosticBrickIds(graphDiagnostics, graph);
  const unsupportedBricks = [...stability.brickSupport.values()]
    .filter((info) => info.supportRatio === 0 && info.tier !== 'stable')
    .length;

  return {
    unsupportedBricks,
    layout,
    layoutIds,
    stabilityWarnings: stability.warnings,
  };
}

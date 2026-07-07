import type { GraphDiagnosticsSummary } from './brick-graph';

export interface LexicographicStabilityScore {
  gaps: number;
  overlaps: number;
  floatingBricks: number;
  unsupportedBricks: number;
  weakCantilevers: number;
  articulationBricks: number;
  bridgeEdges: number;
  repeatedSeams: number;
  brickCount: number;
  runtimeOrCandidates: number;
}

export function scoreSummaryLexicographically(
  summary: GraphDiagnosticsSummary,
  brickCount: number,
  runtimeOrCandidates = 0,
  gaps = 0,
  overlaps = 0,
): LexicographicStabilityScore {
  return {
    gaps,
    overlaps,
    floatingBricks: summary.floatingBricks,
    unsupportedBricks: summary.unsupportedBricks,
    weakCantilevers: summary.weakCantilevers,
    articulationBricks: summary.articulationBricks,
    bridgeEdges: summary.bridgeEdges,
    repeatedSeams: summary.seamAlignment.repeatedAdjacentLayerSeams,
    brickCount,
    runtimeOrCandidates,
  };
}

export function compareStabilityScores(
  a: LexicographicStabilityScore,
  b: LexicographicStabilityScore,
): number {
  const keys: Array<keyof LexicographicStabilityScore> = [
    'gaps',
    'overlaps',
    'floatingBricks',
    'unsupportedBricks',
    'weakCantilevers',
    'articulationBricks',
    'bridgeEdges',
    'repeatedSeams',
    'brickCount',
    'runtimeOrCandidates',
  ];

  for (const key of keys) {
    if (a[key] !== b[key]) return a[key] - b[key];
  }
  return 0;
}

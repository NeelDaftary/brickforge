import { describe, expect, it } from 'vitest';
import { compareStabilityScores, type LexicographicStabilityScore } from './stability-score';

function score(overrides: Partial<LexicographicStabilityScore>): LexicographicStabilityScore {
  return {
    gaps: 0,
    overlaps: 0,
    floatingBricks: 0,
    unsupportedBricks: 0,
    weakCantilevers: 0,
    articulationBricks: 0,
    bridgeEdges: 0,
    repeatedSeams: 0,
    brickCount: 10,
    runtimeOrCandidates: 10,
    ...overrides,
  };
}

describe('lexicographic stability scoring', () => {
  it('rejects lower-priority gains that worsen floating or unsupported defects', () => {
    expect(compareStabilityScores(
      score({ floatingBricks: 1, brickCount: 1 }),
      score({ floatingBricks: 0, brickCount: 100 }),
    )).toBeGreaterThan(0);

    expect(compareStabilityScores(
      score({ unsupportedBricks: 1, repeatedSeams: 0 }),
      score({ unsupportedBricks: 0, repeatedSeams: 999 }),
    )).toBeGreaterThan(0);
  });
});

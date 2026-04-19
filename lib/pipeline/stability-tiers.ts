/**
 * Shared stability tier classifier.
 *
 * Two pipeline modules classify bricks by how well supported they are:
 * brick-stability.ts (post-build warnings) and stability-refiner.ts
 * (accept/reject decisions during split-remerge). Both use the same rule,
 * expressed here once in terms of pure primitives.
 */

import { STABLE_SUPPORT_RATIO, WEAK_SUPPORT_RATIO } from './constants';

export type StabilityTier = 'critical' | 'weak' | 'marginal' | 'stable';

export interface TierInputs {
  /** Fraction of the brick's cells resting on a brick below. 0 to 1. */
  supportRatio: number;
  /** Any cell of the brick has a brick directly above. */
  lockedFromAbove: boolean;
  /** Brick is on the ground layer. */
  isGround: boolean;
}

export function classifySupport({ supportRatio, lockedFromAbove, isGround }: TierInputs): StabilityTier {
  if (isGround) return 'stable';
  if (supportRatio >= STABLE_SUPPORT_RATIO) return 'stable';
  if (lockedFromAbove) return 'marginal';
  if (supportRatio >= WEAK_SUPPORT_RATIO) return 'weak';
  return 'critical';
}

import { describe, expect, it } from 'vitest';
import { classifySupport } from './stability-tiers';
import { STABLE_SUPPORT_RATIO, WEAK_SUPPORT_RATIO } from './constants';

describe('classifySupport', () => {
  it('ground is stable regardless of support or lock', () => {
    expect(classifySupport({ supportRatio: 0, lockedFromAbove: false, isGround: true })).toBe('stable');
    expect(classifySupport({ supportRatio: 0, lockedFromAbove: true, isGround: true })).toBe('stable');
    expect(classifySupport({ supportRatio: 1, lockedFromAbove: false, isGround: true })).toBe('stable');
  });

  it('supportRatio >= STABLE_SUPPORT_RATIO is stable', () => {
    // Exact boundary — spec says inclusive
    expect(classifySupport({ supportRatio: STABLE_SUPPORT_RATIO, lockedFromAbove: false, isGround: false })).toBe('stable');
    expect(classifySupport({ supportRatio: 1, lockedFromAbove: false, isGround: false })).toBe('stable');
    expect(classifySupport({ supportRatio: 0.75, lockedFromAbove: true, isGround: false })).toBe('stable');
  });

  it('below stable but locked from above is marginal (not weak/critical)', () => {
    expect(classifySupport({ supportRatio: 0.4, lockedFromAbove: true, isGround: false })).toBe('marginal');
    expect(classifySupport({ supportRatio: 0.1, lockedFromAbove: true, isGround: false })).toBe('marginal');
    expect(classifySupport({ supportRatio: 0, lockedFromAbove: true, isGround: false })).toBe('marginal');
  });

  it('WEAK_SUPPORT_RATIO <= supportRatio < STABLE_SUPPORT_RATIO with no lock is weak', () => {
    expect(classifySupport({ supportRatio: WEAK_SUPPORT_RATIO, lockedFromAbove: false, isGround: false })).toBe('weak');
    expect(classifySupport({ supportRatio: 0.4, lockedFromAbove: false, isGround: false })).toBe('weak');
    // Just below stable
    expect(classifySupport({
      supportRatio: STABLE_SUPPORT_RATIO - 0.001,
      lockedFromAbove: false,
      isGround: false,
    })).toBe('weak');
  });

  it('supportRatio < WEAK_SUPPORT_RATIO with no lock is critical', () => {
    expect(classifySupport({
      supportRatio: WEAK_SUPPORT_RATIO - 0.001,
      lockedFromAbove: false,
      isGround: false,
    })).toBe('critical');
    expect(classifySupport({ supportRatio: 0, lockedFromAbove: false, isGround: false })).toBe('critical');
  });

  it('stable takes precedence over lock (a fully supported locked brick is stable)', () => {
    expect(classifySupport({ supportRatio: 1, lockedFromAbove: true, isGround: false })).toBe('stable');
  });

  it('ground takes precedence over all other flags', () => {
    // Even with 0 support and locked, ground wins.
    expect(classifySupport({ supportRatio: 0, lockedFromAbove: true, isGround: true })).toBe('stable');
  });

  it('is monotonic in supportRatio when lock/ground are fixed', () => {
    // For unlocked non-ground bricks, tier ordering matches support ratio.
    const order = { critical: 0, weak: 1, marginal: 2, stable: 3 } as const;
    let prevTierRank = -1;
    for (let r = 0; r <= 1.0001; r += 0.05) {
      const tier = classifySupport({ supportRatio: Math.min(r, 1), lockedFromAbove: false, isGround: false });
      expect(order[tier]).toBeGreaterThanOrEqual(prevTierRank);
      prevTierRank = order[tier];
    }
  });
});

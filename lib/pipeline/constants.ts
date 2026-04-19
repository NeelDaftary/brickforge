/**
 * Pipeline tuning knobs.
 *
 * Everything that controls voxelization, brick layout, or stability
 * scoring lives here so the algorithm can be tuned without surgery on
 * the phase implementations. Each group of constants has a short note
 * explaining what the numbers mean in practice.
 */

// ─── Phase 0: Shell (hollow out interior) ─────────────────────────────────────

/** Min grid dimension required before shelling kicks in. Smaller models
 *  have no meaningful interior to hollow out. */
export const SHELL_THRESHOLD = 15;

/** Number of voxel layers of surface shell to retain. Lower = hollower
 *  builds with fewer bricks but more fragile. */
export const SHELL_DEPTH = 2;

// ─── Phase 1: Grid-partition combiner scoring ────────────────────────────────
//
// Score = cellsClaimed * COVERAGE_WEIGHT + supportScore
// Tuning lever if bricks look wrong:
//   - Too many floating surface bricks? Raise UNSUPPORTED_SURFACE_PENALTY.
//   - Layers too aligned (no interlock)? Raise STRADDLE_BONUS.
//   - Too many 1x1 fallback bricks? Lower UNSUPPORTED_SURFACE_PENALTY.

/** Multiplier on raw cell coverage. Baseline score per claimed cell. */
export const COVERAGE_WEIGHT = 10;

/** Bonus when a brick straddles the support boundary (part supported,
 *  part cantilevered). This is the best interlocking shape. */
export const STRADDLE_BONUS = 3;

/** Bonus when a brick is fully supported from below. Less interlocking
 *  than straddling but still structurally sound. */
export const FULLY_SUPPORTED_BONUS = 1;

/** Reward per exterior (surface) cell that has a brick beneath it. */
export const SUPPORTED_SURFACE_REWARD = 2;

/** Penalty per exterior cell with zero support below. Heavy by design —
 *  a single dangling surface cell costs more than 1 cell of coverage. */
export const UNSUPPORTED_SURFACE_PENALTY = 15;

// ─── Stability tier thresholds ────────────────────────────────────────────────
//
// Used by both the post-build stability check (brick-stability.ts) and the
// refiner's accept/reject decisions. A brick's tier is determined by the
// fraction of its cells that sit on top of another brick.

/** Support ratio at or above this → 'stable'. */
export const STABLE_SUPPORT_RATIO = 0.5;

/** Support ratio at or above this (but below stable) + not locked from
 *  above → 'weak'. Below this → 'critical'. */
export const WEAK_SUPPORT_RATIO = 0.25;

// ─── Phase 2: Refiner scoring ────────────────────────────────────────────────
//
// Refiner compares layer scores before and after a re-merge. Higher is better.
// Tier weights are intentionally non-linear: critical is catastrophic,
// stable is a small positive, so the refiner aggressively fixes criticals
// before improving marginal/stable counts.

export const TIER_SCORES = {
  critical: -100,
  weak: -10,
  marginal: -1,
  stable: 1,
} as const;

// ─── Phase 2: Refiner iteration limits ────────────────────────────────────────

/** Shuffled re-merge attempts per weak/critical region. More = better
 *  quality, longer pipeline time. */
export const REFINER_MAX_ATTEMPTS_PER_REGION = 50;

/** Full passes over the model. Refinement stops early if a pass made
 *  no improvement. */
export const REFINER_MAX_PASSES = 3;

/** Default PRNG seed. Fixed for reproducibility; callers can override. */
export const REFINER_DEFAULT_SEED = 42;

/** Ring count for 4-connected neighborhood expansion around a weak brick.
 *  Larger = more context per region, slower, more disruption per attempt. */
export const REFINER_NEIGHBORHOOD_RINGS = 2;

// ─── Pipeline defaults ────────────────────────────────────────────────────────

/** Default voxel edge size in world units (metres). Callers typically
 *  override this via computeVoxelSize() from target stud count. */
export const DEFAULT_VOXEL_SIZE = 0.06;

/** Default shell behaviour. Matches the zod default on /api/voxelize
 *  and the implicit default in the upload form. */
export const DEFAULT_SHELL_ENABLED = true;

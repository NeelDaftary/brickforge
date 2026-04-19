/**
 * Stability Refiner — Neighborhood split-remerge for better inter-layer overlap.
 *
 * For each weak/critical brick, expands a ring-N neighborhood on the same layer
 * decomposes all bricks in that region to 1×1 cells, then re-merges with a
 * shuffled visitation order. Accepts the new tiling only if stability improves.
 *
 * This is a local-search / hill-climbing approach that explores different points
 * in the combinatorial tiling space by varying which cell gets tiled first.
 */

import type { PlacedBrick } from './voxel-to-bricks';
import { BRICK_SIZES, isValidBrickSize } from './voxel-to-bricks';
import { classifySupport, type StabilityTier } from './stability-tiers';
import {
  TIER_SCORES,
  REFINER_MAX_ATTEMPTS_PER_REGION,
  REFINER_MAX_PASSES,
  REFINER_DEFAULT_SEED,
  REFINER_NEIGHBORHOOD_RINGS,
} from './constants';

// ─── Public types ────────────────────────────────────────────────────────────

export interface RefinementConfig {
  /** Defaults come from lib/pipeline/constants.ts. */
  maxAttemptsPerRegion?: number;
  maxPasses?: number;
  seed?: number;
}

export interface RefinementStats {
  regionsFound: number;
  regionsImproved: number;
  totalAttempts: number;
  passes: number;
  criticalBefore: number;
  criticalAfter: number;
  weakBefore: number;
  weakAfter: number;
  elapsedMs: number;
}

interface RefinementResult {
  layers: PlacedBrick[][];
  stats: RefinementStats;
}

// ─── Seeded PRNG (mulberry32) ────────────────────────────────────────────────

function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── Stability scoring ──────────────────────────────────────────────────────

export function buildOccupiedSet(bricks: PlacedBrick[]): Set<string> {
  const set = new Set<string>();
  for (const b of bricks) {
    for (let dx = 0; dx < b.w; dx++)
      for (let dy = 0; dy < b.d; dy++)
        set.add(`${b.x + dx},${b.y + dy}`);
  }
  return set;
}

export function classifyBrick(
  b: PlacedBrick,
  belowOccupied: Set<string>,
  aboveOccupied: Set<string>,
): StabilityTier {
  const total = b.w * b.d;
  let supported = 0;
  let lockedFromAbove = false;

  for (let dx = 0; dx < b.w; dx++) {
    for (let dy = 0; dy < b.d; dy++) {
      const key = `${b.x + dx},${b.y + dy}`;
      if (belowOccupied.has(key)) supported++;
      if (aboveOccupied.has(key)) lockedFromAbove = true;
    }
  }

  return classifySupport({
    supportRatio: supported / total,
    lockedFromAbove,
    isGround: b.z === 0,
  });
}

function scoreLayers(layers: PlacedBrick[][]): number {
  let score = 0;
  for (let z = 0; z < layers.length; z++) {
    const below = z > 0 ? buildOccupiedSet(layers[z - 1]) : new Set<string>();
    const above = z < layers.length - 1 ? buildOccupiedSet(layers[z + 1]) : new Set<string>();
    for (const b of layers[z]) {
      score += TIER_SCORES[classifyBrick(b, below, above)];
    }
  }
  return score;
}

function countTiers(layers: PlacedBrick[][]): { critical: number; weak: number; marginal: number; stable: number } {
  const counts = { critical: 0, weak: 0, marginal: 0, stable: 0 };
  for (let z = 0; z < layers.length; z++) {
    const below = z > 0 ? buildOccupiedSet(layers[z - 1]) : new Set<string>();
    const above = z < layers.length - 1 ? buildOccupiedSet(layers[z + 1]) : new Set<string>();
    for (const b of layers[z]) {
      counts[classifyBrick(b, below, above)]++;
    }
  }
  return counts;
}

// ─── Neighborhood discovery ──────────────────────────────────────────────────

/** Find the ring-N 4-connected neighborhood of a brick on its layer. */
function findNeighborhood(target: PlacedBrick, layer: PlacedBrick[]): Set<PlacedBrick> {
  // Build cell → brick lookup for the layer
  const cellToBrick = new Map<string, PlacedBrick>();
  for (const b of layer) {
    for (let dx = 0; dx < b.w; dx++)
      for (let dy = 0; dy < b.d; dy++)
        cellToBrick.set(`${b.x + dx},${b.y + dy}`, b);
  }

  const neighborhood = new Set<PlacedBrick>();
  neighborhood.add(target);

  for (let ring = 0; ring < REFINER_NEIGHBORHOOD_RINGS; ring++) {
    const frontier = new Set<PlacedBrick>();
    for (const b of neighborhood) {
      for (let dx = -1; dx <= b.w; dx++) {
        for (let dy = -1; dy <= b.d; dy++) {
          // Only check border cells (adjacent to the brick)
          if (dx >= 0 && dx < b.w && dy >= 0 && dy < b.d) continue;
          const key = `${b.x + dx},${b.y + dy}`;
          const neighbor = cellToBrick.get(key);
          if (neighbor && !neighborhood.has(neighbor)) {
            frontier.add(neighbor);
          }
        }
      }
    }
    for (const b of frontier) neighborhood.add(b);
  }

  return neighborhood;
}

// ─── Decompose & Re-merge ────────────────────────────────────────────────────

interface Cell {
  x: number;
  y: number;
  color: string;
}

function decomposeToCells(bricks: Iterable<PlacedBrick>): Cell[] {
  const cells: Cell[] = [];
  for (const b of bricks) {
    for (let dx = 0; dx < b.w; dx++)
      for (let dy = 0; dy < b.d; dy++)
        cells.push({ x: b.x + dx, y: b.y + dy, color: b.color });
  }
  return cells;
}

function remergeNeighborhood(
  cells: Cell[],
  z: number,
  rng: () => number,
): PlacedBrick[] {
  // Fisher-Yates shuffle
  for (let i = cells.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [cells[i], cells[j]] = [cells[j], cells[i]];
  }

  // Build lookup
  const cellMap = new Map<string, Cell>();
  for (const c of cells) cellMap.set(`${c.x},${c.y}`, c);

  const consumed = new Set<string>();
  const bricks: PlacedBrick[] = [];

  for (const cell of cells) {
    const key = `${cell.x},${cell.y}`;
    if (consumed.has(key)) continue;

    let placed = false;

    for (const [bw, bd] of BRICK_SIZES) {
      const orientations: [number, number][] = [[bw, bd]];
      if (bw !== bd) orientations.push([bd, bw]);

      for (const [w, d] of orientations) {
        let fits = true;
        for (let dx = 0; dx < w && fits; dx++) {
          for (let dy = 0; dy < d && fits; dy++) {
            const k = `${cell.x + dx},${cell.y + dy}`;
            const c = cellMap.get(k);
            if (!c || consumed.has(k) || c.color !== cell.color) fits = false;
          }
        }

        if (fits) {
          for (let dx = 0; dx < w; dx++)
            for (let dy = 0; dy < d; dy++)
              consumed.add(`${cell.x + dx},${cell.y + dy}`);
          bricks.push({ x: cell.x, y: cell.y, z, w, d, color: cell.color });
          placed = true;
          break;
        }
      }
      if (placed) break;
    }

    if (!placed) {
      consumed.add(key);
      bricks.push({ x: cell.x, y: cell.y, z, w: 1, d: 1, color: cell.color });
    }
  }

  return bricks;
}

// ─── Union-Find for grouping overlapping neighborhoods ───────────────────────

class UnionFind {
  private parent: number[];
  private rank: number[];

  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
    this.rank = new Array(n).fill(0);
  }

  find(x: number): number {
    if (this.parent[x] !== x) this.parent[x] = this.find(this.parent[x]);
    return this.parent[x];
  }

  union(a: number, b: number): void {
    const ra = this.find(a), rb = this.find(b);
    if (ra === rb) return;
    if (this.rank[ra] < this.rank[rb]) this.parent[ra] = rb;
    else if (this.rank[ra] > this.rank[rb]) this.parent[rb] = ra;
    else { this.parent[rb] = ra; this.rank[ra]++; }
  }
}

// ─── Main refinement ────────────────────────────────────────────────────────

export function refineStability(
  layers: PlacedBrick[][],
  config?: RefinementConfig,
): RefinementResult {
  const maxAttempts = config?.maxAttemptsPerRegion ?? REFINER_MAX_ATTEMPTS_PER_REGION;
  const maxPasses = config?.maxPasses ?? REFINER_MAX_PASSES;
  const rng = mulberry32(config?.seed ?? REFINER_DEFAULT_SEED);
  const startMs = Date.now();

  // Deep-clone layers
  const result: PlacedBrick[][] = layers.map((l) => l.map((b) => ({ ...b })));

  const tiersBefore = countTiers(result);
  let totalAttempts = 0;
  let regionsFound = 0;
  let regionsImproved = 0;
  let passes = 0;

  for (let pass = 0; pass < maxPasses; pass++) {
    passes++;
    let anyImproved = false;

    // Find all weak/critical bricks (skip z=0)
    const weakBricks: PlacedBrick[] = [];
    for (let z = 1; z < result.length; z++) {
      const below = buildOccupiedSet(result[z - 1]);
      const above = z < result.length - 1 ? buildOccupiedSet(result[z + 1]) : new Set<string>();
      for (const b of result[z]) {
        const tier = classifyBrick(b, below, above);
        if (tier === 'critical' || tier === 'weak') {
          weakBricks.push(b);
        }
      }
    }

    if (weakBricks.length === 0) break;

    // Compute neighborhoods for each weak brick, group overlapping ones
    const neighborhoods: Set<PlacedBrick>[] = [];
    const brickToNeighIdx = new Map<PlacedBrick, number>();

    for (const wb of weakBricks) {
      const layer = result[wb.z];
      const hood = findNeighborhood(wb, layer);
      const idx = neighborhoods.length;
      neighborhoods.push(hood);

      for (const b of hood) {
        if (brickToNeighIdx.has(b)) {
          // This brick appears in another neighborhood — will merge via union-find
        }
        brickToNeighIdx.set(b, idx);
      }
    }

    // Merge overlapping neighborhoods using union-find
    const uf = new UnionFind(neighborhoods.length);
    const brickSeen = new Map<PlacedBrick, number>();
    for (let i = 0; i < neighborhoods.length; i++) {
      for (const b of neighborhoods[i]) {
        const prev = brickSeen.get(b);
        if (prev !== undefined) {
          uf.union(prev, i);
        } else {
          brickSeen.set(b, i);
        }
      }
    }

    // Group into regions
    const regionMap = new Map<number, Set<PlacedBrick>>();
    for (let i = 0; i < neighborhoods.length; i++) {
      const root = uf.find(i);
      if (!regionMap.has(root)) regionMap.set(root, new Set());
      const region = regionMap.get(root)!;
      for (const b of neighborhoods[i]) region.add(b);
    }

    // Sort regions by severity (most critical first)
    const regions = [...regionMap.values()];
    regions.sort((a, b) => {
      const severityScore = (bricks: Set<PlacedBrick>) => {
        let score = 0;
        for (const brick of bricks) {
          if (brick.z === 0) continue;
          const below = buildOccupiedSet(result[brick.z - 1]);
          const above = brick.z < result.length - 1 ? buildOccupiedSet(result[brick.z + 1]) : new Set<string>();
          const tier = classifyBrick(brick, below, above);
          if (tier === 'critical') score += 100;
          else if (tier === 'weak') score += 10;
        }
        return score;
      };
      return severityScore(b) - severityScore(a);
    });

    regionsFound += regions.length;

    for (const region of regions) {
      // All bricks in a region must be on the same layer (neighborhoods are per-layer)
      const z = [...region][0].z;
      const currentScore = scoreLayers(result);
      const currentBrickCount = result.reduce((s, l) => s + l.length, 0);

      const cells = decomposeToCells(region);
      const regionBrickSet = new Set(region);

      let improved = false;

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        totalAttempts++;

        // Re-merge with shuffled order
        const cellsCopy = cells.map((c) => ({ ...c }));
        const newBricks = remergeNeighborhood(cellsCopy, z, rng);

        // Validate all brick sizes
        if (!newBricks.every((b) => isValidBrickSize(b.w, b.d))) continue;

        // Replace region bricks in the layer
        const savedLayer = result[z];
        result[z] = [
          ...savedLayer.filter((b) => !regionBrickSet.has(b)),
          ...newBricks,
        ];

        const newScore = scoreLayers(result);
        const newBrickCount = result.reduce((s, l) => s + l.length, 0);

        if (newScore > currentScore || (newScore === currentScore && newBrickCount < currentBrickCount)) {
          // Accept — update regionBrickSet for subsequent checks
          improved = true;
          anyImproved = true;
          regionsImproved++;
          break;
        } else {
          // Reject — restore
          result[z] = savedLayer;
        }
      }
    }

    if (!anyImproved) break;
  }

  const tiersAfter = countTiers(result);

  return {
    layers: result,
    stats: {
      regionsFound,
      regionsImproved,
      totalAttempts,
      passes,
      criticalBefore: tiersBefore.critical,
      criticalAfter: tiersAfter.critical,
      weakBefore: tiersBefore.weak,
      weakAfter: tiersAfter.weak,
      elapsedMs: Date.now() - startMs,
    },
  };
}

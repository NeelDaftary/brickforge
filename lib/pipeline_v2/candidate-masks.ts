import { BRICK_SIZES } from '@/lib/pipeline/voxel-to-bricks';

export interface CandidateMaskPlacement {
  x: number;
  y: number;
  w: number;
  d: number;
  cells: string[];
  supportedStuds: number;
  supportRatio: number;
  colorCompatible: boolean;
  optionalSupportCells: number;
}

export interface CandidateMaskIndex {
  placementsByCell: Map<string, CandidateMaskPlacement[]>;
  stats: {
    checkedPlacements: number;
    validCoveragePlacements: number;
    supportedPlacements: number;
    colorCompatiblePlacements: number;
    optionalSupportPlacements: number;
    elapsedMs: number;
  };
}

interface CandidateMaskInput {
  grid: string[][][];
  z: number;
  belowOwners: ReadonlyMap<string, string>;
  surfaceCells: ReadonlySet<string>;
  supportOptionalCells?: ReadonlySet<string>;
}

const WILDCARD = '*';

function key2(x: number, y: number): string {
  return `${x},${y}`;
}

function key3(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

function dims(grid: string[][][]): { sx: number; sy: number } {
  const sx = grid.length;
  const sy = sx > 0 ? grid[0].length : 0;
  return { sx, sy };
}

function visibleSymbols(input: CandidateMaskInput, cells: string[]): Set<string> {
  const symbols = new Set<string>();
  for (const cell of cells) {
    const [xRaw, yRaw] = cell.split(',');
    const x = Number(xRaw), y = Number(yRaw);
    const symbol = input.grid[x][y][input.z];
    if (symbol === WILDCARD && !input.surfaceCells.has(key3(x, y, input.z))) continue;
    symbols.add(symbol);
  }
  return symbols;
}

export function buildCandidateMaskIndex(input: CandidateMaskInput): CandidateMaskIndex {
  const startedAt = Date.now();
  const { sx, sy } = dims(input.grid);
  const placementsByCell = new Map<string, CandidateMaskPlacement[]>();
  const stats = {
    checkedPlacements: 0,
    validCoveragePlacements: 0,
    supportedPlacements: 0,
    colorCompatiblePlacements: 0,
    optionalSupportPlacements: 0,
    elapsedMs: 0,
  };

  for (const [baseW, baseD] of BRICK_SIZES) {
    const orientations: [number, number][] = [[baseW, baseD]];
    if (baseW !== baseD) orientations.push([baseD, baseW]);

    for (const [w, d] of orientations) {
      for (let x = 0; x <= sx - w; x++) {
        for (let y = 0; y <= sy - d; y++) {
          stats.checkedPlacements++;
          const cells: string[] = [];
          let validCoverage = true;
          let supportedStuds = 0;
          let optionalSupportCells = 0;

          for (let dx = 0; dx < w && validCoverage; dx++) {
            for (let dy = 0; dy < d && validCoverage; dy++) {
              const cx = x + dx, cy = y + dy;
              if (input.grid[cx][cy][input.z] === '0') {
                validCoverage = false;
                break;
              }
              const cell = key2(cx, cy);
              cells.push(cell);
              if (input.z === 0 || input.belowOwners.has(cell)) supportedStuds++;
              if (input.supportOptionalCells?.has(key3(cx, cy, input.z))) optionalSupportCells++;
            }
          }
          if (!validCoverage) continue;
          stats.validCoveragePlacements++;

          const supportRatio = supportedStuds / (w * d);
          const colorCompatible = visibleSymbols(input, cells).size <= 1;
          if (supportedStuds > 0) stats.supportedPlacements++;
          if (colorCompatible) stats.colorCompatiblePlacements++;
          if (optionalSupportCells > 0) stats.optionalSupportPlacements++;

          const placement: CandidateMaskPlacement = {
            x,
            y,
            w,
            d,
            cells,
            supportedStuds,
            supportRatio,
            colorCompatible,
            optionalSupportCells,
          };
          for (const cell of cells) {
            const placements = placementsByCell.get(cell) ?? [];
            placements.push(placement);
            placementsByCell.set(cell, placements);
          }
        }
      }
    }
  }

  stats.elapsedMs = Date.now() - startedAt;
  return { placementsByCell, stats };
}

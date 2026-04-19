import { describe, expect, it } from 'vitest';
import { combineMosaic, mosaicGridToModel } from './mosaic-combiner';
import type { MosaicGrid } from './image-to-grid';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a [w][h][1] grid from a row-major string array, where each string is
 * one row top-to-bottom and each char is one cell left-to-right.
 */
function gridFromRows(rows: string[]): { grid: string[][][]; w: number; h: number } {
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const grid: string[][][] = [];
  for (let x = 0; x < w; x++) {
    const col: string[][] = [];
    for (let y = 0; y < h; y++) {
      col.push([rows[y][x] ?? '0']);
    }
    grid.push(col);
  }
  return { grid, w, h };
}

/** Given placed bricks, return the set of (x,y) grid cells they cover. */
function coveredCells(bricks: Array<{ metadata?: { gx?: number; gz?: number; gw?: number; gd?: number } }>): Set<string> {
  const cells = new Set<string>();
  for (const b of bricks) {
    const gx = b.metadata?.gx ?? 0;
    const gz = b.metadata?.gz ?? 0;
    const gw = b.metadata?.gw ?? 1;
    const gd = b.metadata?.gd ?? 1;
    for (let dx = 0; dx < gw; dx++) {
      for (let dy = 0; dy < gd; dy++) {
        cells.add(`${gx + dx},${gz + dy}`);
      }
    }
  }
  return cells;
}

/** Count colored cells in a [w][h][1] grid. */
function countColoredCells(grid: string[][][]): number {
  let n = 0;
  for (const col of grid) {
    for (const cell of col) {
      if (cell[0] && cell[0] !== '0') n++;
    }
  }
  return n;
}

const LEGEND = { R: '#DB0000', B: '#0055BF', G: '#237841', W: '#FFFFFF' };

// ─── combineMosaic ────────────────────────────────────────────────────────────

describe('combineMosaic', () => {
  it('empty grid returns zero bricks', () => {
    const { grid, w, h } = gridFromRows(['000', '000']);
    const r = combineMosaic(grid, LEGEND, w, h);
    expect(r.totalBricks).toBe(0);
    expect(r.bricks).toHaveLength(0);
  });

  it('single 1x1 cell yields one p_1x1', () => {
    const { grid, w, h } = gridFromRows(['R']);
    const r = combineMosaic(grid, LEGEND, w, h);
    expect(r.totalBricks).toBe(1);
    expect(r.bricks[0].brickId).toBe('p_1x1');
    expect(r.bricks[0].color).toBe('#DB0000');
  });

  it('covers every colored cell exactly once (no overlap, no gaps)', () => {
    const { grid, w, h } = gridFromRows([
      'RRRRBB',
      'RRRRBB',
      'RRRRWW',
      'GGRRWW',
    ]);
    const colored = countColoredCells(grid);
    const r = combineMosaic(grid, LEGEND, w, h);

    const covered = coveredCells(r.bricks);
    expect(covered.size).toBe(colored);
    // Sum of areas equals colored count (no overlaps means this holds)
    const areaSum = r.bricks.reduce((acc, b) => acc + (b.metadata!.gw! * b.metadata!.gd!), 0);
    expect(areaSum).toBe(colored);
  });

  it('4x4 solid single color collapses to one 4x4 plate', () => {
    const { grid, w, h } = gridFromRows([
      'RRRR',
      'RRRR',
      'RRRR',
      'RRRR',
    ]);
    const r = combineMosaic(grid, LEGEND, w, h);
    expect(r.totalBricks).toBe(1);
    expect(r.bricks[0].brickId).toBe('p_4x4');
  });

  it('2x8 solid row collapses to one 2x8 plate', () => {
    const { grid, w, h } = gridFromRows([
      'RRRRRRRR',
      'RRRRRRRR',
    ]);
    const r = combineMosaic(grid, LEGEND, w, h);
    expect(r.totalBricks).toBe(1);
    expect(r.bricks[0].brickId).toBe('p_2x8');
  });

  it('colors are kept separate — no plate spans two colors', () => {
    const { grid, w, h } = gridFromRows([
      'RRRRBBBB',
      'RRRRBBBB',
    ]);
    const r = combineMosaic(grid, LEGEND, w, h);
    const reds = r.bricks.filter((b) => b.color === '#DB0000');
    const blues = r.bricks.filter((b) => b.color === '#0055BF');
    // Each side is 2x4 = one 2x4 plate
    expect(reds).toHaveLength(1);
    expect(blues).toHaveLength(1);
    expect(reds[0].brickId).toBe('p_2x4');
    expect(blues[0].brickId).toBe('p_2x4');
  });

  it('falls back to p_1x1 for isolated cells', () => {
    // Red cells are disconnected, no plate larger than 1x1 fits
    const { grid, w, h } = gridFromRows([
      'R0R',
      '000',
      'R0R',
    ]);
    const r = combineMosaic(grid, LEGEND, w, h);
    expect(r.totalBricks).toBe(4);
    expect(r.bricks.every((b) => b.brickId === 'p_1x1')).toBe(true);
  });

  it('ignores symbols not present in the legend', () => {
    const { grid, w, h } = gridFromRows([
      'RX',
      'RX',
    ]);
    // 'X' is not in the legend — should be skipped entirely
    const r = combineMosaic(grid, LEGEND, w, h);
    // Only the 2 R cells are placed
    const covered = coveredCells(r.bricks);
    expect(covered.size).toBe(2);
    expect(covered.has('0,0')).toBe(true);
    expect(covered.has('0,1')).toBe(true);
  });

  it('treats "0" as transparent / empty', () => {
    const { grid, w, h } = gridFromRows([
      '0R0',
      '0R0',
    ]);
    const r = combineMosaic(grid, LEGEND, w, h);
    const covered = coveredCells(r.bricks);
    expect(covered.size).toBe(2);
    expect(covered.has('0,0')).toBe(false);
    expect(covered.has('1,0')).toBe(true);
    expect(covered.has('1,1')).toBe(true);
    expect(covered.has('2,0')).toBe(false);
  });

  it('uses larger plates when geometry allows it (compression)', () => {
    // 4x4 all red → must be fewer than 16 bricks
    const { grid, w, h } = gridFromRows([
      'RRRR',
      'RRRR',
      'RRRR',
      'RRRR',
    ]);
    const r = combineMosaic(grid, LEGEND, w, h);
    expect(r.totalBricks).toBeLessThan(16);
  });

  it('every brick is at ground level (y=0) and ground-only metadata', () => {
    const { grid, w, h } = gridFromRows([
      'RRBB',
      'RRBB',
    ]);
    const r = combineMosaic(grid, LEGEND, w, h);
    for (const b of r.bricks) {
      expect(b.position[1]).toBe(0);
      expect(b.metadata!.gy).toBe(0);
    }
  });

  it('assigns unique ids and deterministic positions', () => {
    const { grid, w, h } = gridFromRows([
      'RRRR',
      'RRRR',
    ]);
    const r1 = combineMosaic(grid, LEGEND, w, h);
    const r2 = combineMosaic(grid, LEGEND, w, h);
    const ids = new Set(r1.bricks.map((b) => b.id));
    expect(ids.size).toBe(r1.totalBricks);

    // Same inputs → same output
    expect(r1.bricks.map((b) => b.brickId).sort()).toEqual(r2.bricks.map((b) => b.brickId).sort());
    expect(r1.bricks.map((b) => b.position.join(','))).toEqual(r2.bricks.map((b) => b.position.join(',')));
  });
});

// ─── mosaicGridToModel ────────────────────────────────────────────────────────

describe('mosaicGridToModel', () => {
  function mosaic(rows: string[]): MosaicGrid {
    const { grid, w, h } = gridFromRows(rows);
    const legend: Record<string, string> = {};
    // Only include symbols that appear
    for (const row of rows) {
      for (const ch of row) {
        if (ch !== '0' && LEGEND[ch as keyof typeof LEGEND]) {
          legend[ch] = LEGEND[ch as keyof typeof LEGEND];
        }
      }
    }
    return { grid, colorLegend: legend, width: w, height: h };
  }

  it('combine=false places one 1x1 per colored cell', () => {
    const m = mosaic(['RRR', 'BBB']);
    const model = mosaicGridToModel(m, 'test', 'desc', false);
    expect(model.totalBricks).toBe(6);
    expect(model.bricks.every((b) => b.brickId === 'p_1x1')).toBe(true);
  });

  it('combine=true collapses runs into larger plates', () => {
    const m = mosaic(['RRRR', 'RRRR']);
    const model = mosaicGridToModel(m, 'test', 'desc', true);
    expect(model.totalBricks).toBeLessThan(8);
  });

  it('exposes voxelData matching inputs and covers all cells', () => {
    const m = mosaic(['RR', 'BB']);
    const model = mosaicGridToModel(m, 'name', 'desc', true);
    expect(model.name).toBe('name');
    expect(model.description).toBe('desc');
    expect(model.voxelData).toBeDefined();
    expect(model.voxelData!.grid).toBe(m.grid);
    expect(model.voxelData!.colorLegend).toBe(m.colorLegend);

    const covered = coveredCells(model.bricks);
    expect(covered.size).toBe(4);
  });

  it('empty grid yields zero bricks in both modes', () => {
    const m = mosaic(['000', '000']);
    expect(mosaicGridToModel(m, 'n', 'd', false).totalBricks).toBe(0);
    expect(mosaicGridToModel(m, 'n', 'd', true).totalBricks).toBe(0);
  });
});

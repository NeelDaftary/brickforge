import { describe, expect, it } from 'vitest';
import {
  COLOR_PALETTE,
  getBrickLinkColorId,
  getColorName,
  getHexForSymbol,
  getSymbolForHex,
  nearestLegoColorHex,
  nearestLegoColorRgb,
  nearestLegoSymbol,
} from './color-palette';

/** Convert a hex string like "#DB0000" to normalized [0-1] RGB. */
function hexToRgb01(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
}

// ─── Palette structure ────────────────────────────────────────────────────────

describe('COLOR_PALETTE', () => {
  it('has 20+ well-formed entries with unique hex, symbol, and bricklinkId', () => {
    expect(COLOR_PALETTE.length).toBeGreaterThanOrEqual(20);

    const hexes = new Set<string>();
    const symbols = new Set<string>();
    const ids = new Set<number>();

    for (const entry of COLOR_PALETTE) {
      expect(entry.name.length).toBeGreaterThan(0);
      expect(entry.hex).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(entry.symbol).toHaveLength(1);
      expect(Number.isInteger(entry.bricklinkId)).toBe(true);
      expect(entry.bricklinkId).toBeGreaterThan(0);

      hexes.add(entry.hex.toLowerCase());
      symbols.add(entry.symbol);
      ids.add(entry.bricklinkId);
    }

    expect(hexes.size).toBe(COLOR_PALETTE.length);
    expect(symbols.size).toBe(COLOR_PALETTE.length);
    expect(ids.size).toBe(COLOR_PALETTE.length);
  });

  it('includes core colors: White, Black, Red, Blue, Green, Yellow', () => {
    const names = COLOR_PALETTE.map((c) => c.name);
    for (const core of ['White', 'Black', 'Red', 'Blue', 'Green', 'Yellow']) {
      expect(names).toContain(core);
    }
  });
});

// ─── Simple lookups (case-insensitive, fallbacks) ─────────────────────────────

describe('lookup functions', () => {
  it('getBrickLinkColorId returns correct ID, is case-insensitive, undefined for unknown', () => {
    expect(getBrickLinkColorId('#FFFFFF')).toBe(1);
    expect(getBrickLinkColorId('#DB0000')).toBe(5);
    expect(getBrickLinkColorId('#ffffff')).toBe(1);
    expect(getBrickLinkColorId('#123456')).toBeUndefined();
  });

  it('getColorName returns correct name, is case-insensitive, undefined for unknown', () => {
    expect(getColorName('#FFFFFF')).toBe('White');
    expect(getColorName('#ffd500')).toBe('Yellow');
    expect(getColorName('#ABCDEF')).toBeUndefined();
  });

  it('getHexForSymbol returns hex for known symbols, falls back to Light Grey', () => {
    expect(getHexForSymbol('W')).toBe('#FFFFFF');
    expect(getHexForSymbol('K')).toBe('#101010');
    expect(getHexForSymbol('R')).toBe('#DB0000');
    expect(getHexForSymbol('?')).toBe('#A0A5A9');
    expect(getHexForSymbol('')).toBe('#A0A5A9');
  });

  it('getSymbolForHex returns symbol for known hex, is case-insensitive, falls back to G', () => {
    expect(getSymbolForHex('#FFFFFF')).toBe('W');
    expect(getSymbolForHex('#ffffff')).toBe('W');
    expect(getSymbolForHex('#123456')).toBe('G');
  });
});

// ─── Nearest color matching ──────────────────────────────────────────────────

describe('nearestLegoColorHex', () => {
  it('maps exact palette colors to themselves', () => {
    for (const entry of COLOR_PALETTE) {
      expect(nearestLegoColorHex(entry.hex)).toBe(entry.hex);
    }
  });

  it('maps pure colors to correct LEGO equivalents', () => {
    expect(nearestLegoColorHex('#FF0000')).toBe('#DB0000'); // Red
    expect(nearestLegoColorHex('#000000')).toBe('#101010'); // Black
    expect(nearestLegoColorHex('#FFFFFF')).toBe('#FFFFFF'); // White
    expect(nearestLegoColorHex('#ffffff')).toBe('#FFFFFF'); // case-insensitive

    const blue = nearestLegoColorHex('#0000FF');
    const blueEntry = COLOR_PALETTE.find((c) => c.hex === blue);
    expect(blueEntry!.name.toLowerCase()).toContain('blue');
  });

  it('maps gray-range colors to plausible neutrals', () => {
    const midGray = COLOR_PALETTE.find((c) => c.hex === nearestLegoColorHex('#808080'));
    expect(['Light Grey', 'Dark Grey', 'Dark Tan']).toContain(midGray!.name);

    expect(nearestLegoColorHex('#C0C0C0')).toBe('#A0A5A9'); // Light Grey
    expect(nearestLegoColorHex('#F0F0F0')).toBe('#FFFFFF'); // near-white → White
    expect(nearestLegoColorHex('#0A0A0A')).toBe('#101010'); // near-black → Black
  });
});

describe('nearest color functions agree', () => {
  it('hex/rgb/symbol paths produce consistent results for all palette + pure colors', () => {
    // Palette identity: all three paths map palette values back to themselves
    for (const entry of COLOR_PALETTE) {
      const [r, g, b] = hexToRgb01(entry.hex);
      expect(nearestLegoColorRgb(r, g, b)).toBe(entry.hex);
      expect(nearestLegoSymbol(r, g, b)).toBe(entry.symbol);
    }

    // Cross-function consistency for arbitrary colors
    const testCases = ['#FF0000', '#00FF00', '#0000FF', '#808080', '#FFD500'];
    for (const hex of testCases) {
      const [r, g, b] = hexToRgb01(hex);
      expect(nearestLegoColorRgb(r, g, b)).toBe(nearestLegoColorHex(hex));

      const matchedHex = nearestLegoColorRgb(r, g, b);
      const sym = nearestLegoSymbol(r, g, b);
      const entry = COLOR_PALETTE.find((c) => c.hex === matchedHex);
      expect(entry!.symbol).toBe(sym);
    }
  });

  it('nearby colors map same, complementary colors map different', () => {
    expect(nearestLegoColorHex('#DA0000')).toBe(nearestLegoColorHex('#DC0000'));
    expect(nearestLegoColorHex('#FF0000')).not.toBe(nearestLegoColorHex('#00FFFF'));
    expect(nearestLegoColorHex('#000000')).not.toBe(nearestLegoColorHex('#FFFFFF'));
  });
});

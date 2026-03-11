import { describe, expect, it } from 'vitest';
import {
  COLOR_PALETTE,
  type ColorEntry,
  getBrickLinkColorId,
  getColorName,
  getHexForSymbol,
  getSymbolForHex,
  nearestLegoColorHex,
  nearestLegoColorRgb,
  nearestLegoSymbol,
} from './color-palette';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert a hex string like "#DB0000" to normalized [0-1] RGB. */
function hexToRgb01(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
}

// ---------------------------------------------------------------------------
// COLOR_PALETTE structure
// ---------------------------------------------------------------------------

describe('COLOR_PALETTE', () => {
  it('is non-empty', () => {
    expect(COLOR_PALETTE.length).toBeGreaterThan(0);
  });

  it('has at least 20 entries (reasonable brick set)', () => {
    expect(COLOR_PALETTE.length).toBeGreaterThanOrEqual(20);
  });

  it('every entry has the expected fields', () => {
    for (const entry of COLOR_PALETTE) {
      expect(typeof entry.name).toBe('string');
      expect(entry.name.length).toBeGreaterThan(0);

      expect(entry.hex).toMatch(/^#[0-9A-Fa-f]{6}$/);

      expect(typeof entry.symbol).toBe('string');
      expect(entry.symbol).toHaveLength(1);

      expect(typeof entry.bricklinkId).toBe('number');
      expect(Number.isInteger(entry.bricklinkId)).toBe(true);
      expect(entry.bricklinkId).toBeGreaterThan(0);
    }
  });

  it('has unique hex values', () => {
    const hexes = COLOR_PALETTE.map((c) => c.hex.toLowerCase());
    expect(new Set(hexes).size).toBe(hexes.length);
  });

  it('has unique symbols', () => {
    const symbols = COLOR_PALETTE.map((c) => c.symbol);
    expect(new Set(symbols).size).toBe(symbols.length);
  });

  it('has unique BrickLink IDs', () => {
    const ids = COLOR_PALETTE.map((c) => c.bricklinkId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('includes core colors: White, Black, Red, Blue, Green, Yellow', () => {
    const names = COLOR_PALETTE.map((c) => c.name);
    for (const core of ['White', 'Black', 'Red', 'Blue', 'Green', 'Yellow']) {
      expect(names).toContain(core);
    }
  });
});

// ---------------------------------------------------------------------------
// Simple lookups
// ---------------------------------------------------------------------------

describe('getBrickLinkColorId', () => {
  it('returns the correct ID for a known hex', () => {
    expect(getBrickLinkColorId('#FFFFFF')).toBe(1);  // White
    expect(getBrickLinkColorId('#DB0000')).toBe(5);  // Red
    expect(getBrickLinkColorId('#101010')).toBe(11); // Black
  });

  it('is case-insensitive', () => {
    expect(getBrickLinkColorId('#ffffff')).toBe(1);
    expect(getBrickLinkColorId('#Ffffff')).toBe(1);
  });

  it('returns undefined for unknown hex', () => {
    expect(getBrickLinkColorId('#123456')).toBeUndefined();
  });
});

describe('getColorName', () => {
  it('returns the correct name for a known hex', () => {
    expect(getColorName('#FFFFFF')).toBe('White');
    expect(getColorName('#101010')).toBe('Black');
    expect(getColorName('#FFD500')).toBe('Yellow');
  });

  it('is case-insensitive', () => {
    expect(getColorName('#ffd500')).toBe('Yellow');
  });

  it('returns undefined for unknown hex', () => {
    expect(getColorName('#ABCDEF')).toBeUndefined();
  });
});

describe('getHexForSymbol', () => {
  it('returns hex for known symbols', () => {
    expect(getHexForSymbol('W')).toBe('#FFFFFF');
    expect(getHexForSymbol('K')).toBe('#101010');
    expect(getHexForSymbol('R')).toBe('#DB0000');
  });

  it('falls back to Light Grey hex for unknown symbol', () => {
    expect(getHexForSymbol('?')).toBe('#A0A5A9');
    expect(getHexForSymbol('')).toBe('#A0A5A9');
  });
});

describe('getSymbolForHex', () => {
  it('returns symbol for known hex', () => {
    expect(getSymbolForHex('#FFFFFF')).toBe('W');
    expect(getSymbolForHex('#101010')).toBe('K');
  });

  it('is case-insensitive', () => {
    expect(getSymbolForHex('#ffffff')).toBe('W');
  });

  it('falls back to G for unknown hex', () => {
    expect(getSymbolForHex('#123456')).toBe('G');
  });
});

// ---------------------------------------------------------------------------
// nearestLegoColorHex
// ---------------------------------------------------------------------------

describe('nearestLegoColorHex', () => {
  it('returns a string in hex format', () => {
    const result = nearestLegoColorHex('#FF0000');
    expect(result).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it('maps exact palette colors to themselves', () => {
    for (const entry of COLOR_PALETTE) {
      expect(nearestLegoColorHex(entry.hex)).toBe(entry.hex);
    }
  });

  it('maps pure red (#FF0000) to LEGO Red (#DB0000)', () => {
    expect(nearestLegoColorHex('#FF0000')).toBe('#DB0000');
  });

  it('maps pure blue (#0000FF) to a blue palette color', () => {
    const result = nearestLegoColorHex('#0000FF');
    const entry = COLOR_PALETTE.find((c) => c.hex === result);
    expect(entry).toBeDefined();
    // Should land on one of the blue family entries
    expect(entry!.name.toLowerCase()).toContain('blue');
  });

  it('maps pure green (#00FF00) to a green palette color', () => {
    const result = nearestLegoColorHex('#00FF00');
    const entry = COLOR_PALETTE.find((c) => c.hex === result);
    expect(entry).toBeDefined();
    expect(['Green', 'Lime', 'Dark Green']).toContain(entry!.name);
  });

  it('maps pure white (#FFFFFF) to White', () => {
    expect(nearestLegoColorHex('#FFFFFF')).toBe('#FFFFFF');
  });

  it('maps pure black (#000000) to Black (#101010)', () => {
    expect(nearestLegoColorHex('#000000')).toBe('#101010');
  });

  it('handles lowercase hex input', () => {
    expect(nearestLegoColorHex('#ffffff')).toBe('#FFFFFF');
  });
});

// ---------------------------------------------------------------------------
// nearestLegoColorRgb
// ---------------------------------------------------------------------------

describe('nearestLegoColorRgb', () => {
  it('returns a string in hex format', () => {
    const result = nearestLegoColorRgb(1.0, 0.0, 0.0);
    expect(result).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it('maps palette RGB values back to their own hex', () => {
    for (const entry of COLOR_PALETTE) {
      const [r, g, b] = hexToRgb01(entry.hex);
      expect(nearestLegoColorRgb(r, g, b)).toBe(entry.hex);
    }
  });

  it('maps (0, 0, 0) to Black', () => {
    expect(nearestLegoColorRgb(0, 0, 0)).toBe('#101010');
  });

  it('maps (1, 1, 1) to White', () => {
    expect(nearestLegoColorRgb(1, 1, 1)).toBe('#FFFFFF');
  });

  it('maps bright red (1, 0, 0) to LEGO Red', () => {
    expect(nearestLegoColorRgb(1.0, 0.0, 0.0)).toBe('#DB0000');
  });
});

// ---------------------------------------------------------------------------
// nearestLegoSymbol
// ---------------------------------------------------------------------------

describe('nearestLegoSymbol', () => {
  it('returns a single character', () => {
    const result = nearestLegoSymbol(0.5, 0.5, 0.5);
    expect(typeof result).toBe('string');
    expect(result).toHaveLength(1);
  });

  it('returns a symbol that exists in the palette', () => {
    const validSymbols = new Set(COLOR_PALETTE.map((c) => c.symbol));
    expect(validSymbols.has(nearestLegoSymbol(0.5, 0.5, 0.5))).toBe(true);
    expect(validSymbols.has(nearestLegoSymbol(1.0, 0.0, 0.0))).toBe(true);
    expect(validSymbols.has(nearestLegoSymbol(0.0, 0.0, 0.0))).toBe(true);
  });

  it('maps palette RGB values to their own symbol', () => {
    for (const entry of COLOR_PALETTE) {
      const [r, g, b] = hexToRgb01(entry.hex);
      expect(nearestLegoSymbol(r, g, b)).toBe(entry.symbol);
    }
  });

  it('maps black to K', () => {
    expect(nearestLegoSymbol(0, 0, 0)).toBe('K');
  });

  it('maps white to W', () => {
    expect(nearestLegoSymbol(1, 1, 1)).toBe('W');
  });

  it('maps bright red to R', () => {
    expect(nearestLegoSymbol(1.0, 0.0, 0.0)).toBe('R');
  });
});

// ---------------------------------------------------------------------------
// Mid-gray edge cases
// ---------------------------------------------------------------------------

describe('mid-gray edge cases', () => {
  it('maps perfect mid-gray (#808080) to a plausible neutral entry', () => {
    const result = nearestLegoColorHex('#808080');
    const entry = COLOR_PALETTE.find((c) => c.hex === result);
    expect(entry).toBeDefined();
    // OKLCH perceptual matching can map achromatic grays to desaturated warm
    // tones (e.g., Dark Tan) because they are perceptually closer than the
    // palette's specific grey values.
    expect(['Light Grey', 'Dark Grey', 'Dark Tan']).toContain(entry!.name);
  });

  it('maps light gray (#C0C0C0) to Light Grey', () => {
    const result = nearestLegoColorHex('#C0C0C0');
    expect(result).toBe('#A0A5A9'); // Light Grey
  });

  it('maps dark gray (#404040) to a dark neutral entry', () => {
    const result = nearestLegoColorHex('#404040');
    const entry = COLOR_PALETTE.find((c) => c.hex === result);
    expect(entry).toBeDefined();
    // OKLCH distance can favor desaturated browns over palette greys
    // at this lightness level.
    expect(['Dark Grey', 'Black', 'Brown', 'Reddish Brown']).toContain(entry!.name);
  });

  it('maps near-white (#F0F0F0) to White', () => {
    expect(nearestLegoColorHex('#F0F0F0')).toBe('#FFFFFF');
  });

  it('maps near-black (#0A0A0A) to Black', () => {
    expect(nearestLegoColorHex('#0A0A0A')).toBe('#101010');
  });
});

// ---------------------------------------------------------------------------
// sRGB → OKLCH conversion (tested indirectly through matching consistency)
// ---------------------------------------------------------------------------

describe('sRGB to OKLCH conversion (indirect)', () => {
  it('black and white are maximally different', () => {
    // Black and white should not map to the same entry
    const black = nearestLegoColorHex('#000000');
    const white = nearestLegoColorHex('#FFFFFF');
    expect(black).not.toBe(white);
  });

  it('nearby colors map to the same palette entry', () => {
    // Two very similar reds should both map to LEGO Red
    expect(nearestLegoColorHex('#DA0000')).toBe(nearestLegoColorHex('#DC0000'));
  });

  it('complementary colors map to different entries', () => {
    // Red and cyan are complementary
    const red = nearestLegoColorHex('#FF0000');
    const cyan = nearestLegoColorHex('#00FFFF');
    expect(red).not.toBe(cyan);
  });

  it('produces consistent results between hex and rgb paths', () => {
    // The hex path and the rgb path should yield the same result for the same color
    const testCases = ['#FF0000', '#00FF00', '#0000FF', '#808080', '#FFD500'];
    for (const hex of testCases) {
      const [r, g, b] = hexToRgb01(hex);
      expect(nearestLegoColorRgb(r, g, b)).toBe(nearestLegoColorHex(hex));
    }
  });

  it('symbol and hex functions agree', () => {
    // nearestLegoSymbol and nearestLegoColorRgb should point to the same entry
    const testRgb: [number, number, number][] = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
      [0.5, 0.5, 0.5],
      [0, 0, 0],
      [1, 1, 1],
    ];
    for (const [r, g, b] of testRgb) {
      const hex = nearestLegoColorRgb(r, g, b);
      const sym = nearestLegoSymbol(r, g, b);
      const entry = COLOR_PALETTE.find((c) => c.hex === hex);
      expect(entry).toBeDefined();
      expect(entry!.symbol).toBe(sym);
    }
  });
});

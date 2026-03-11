/**
 * LEGO Color Palette — Single Source of Truth
 *
 * All color data lives here: hex values, BrickLink IDs, symbols (for voxel grids),
 * and perceptual matching via OKLCH color space.
 *
 * BrickLink color IDs: https://www.bricklink.com/catalogColors.asp
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ColorEntry {
  name: string;
  hex: string;
  symbol: string;      // Single-char symbol for voxel grids (must match Python voxelizer)
  bricklinkId: number;
}

interface OklchColor {
  L: number; // Lightness [0, 1]
  C: number; // Chroma [0, ~0.37]
  h: number; // Hue [0, 360)
}

interface LabColor {
  L: number;
  a: number;
  b: number;
}

// ─── Palette ──────────────────────────────────────────────────────────────────

export const COLOR_PALETTE: ColorEntry[] = [
  { name: 'White',              hex: '#FFFFFF', symbol: 'W', bricklinkId: 1   },
  { name: 'Tan',                hex: '#D9BB7A', symbol: 'T', bricklinkId: 2   },
  { name: 'Yellow',             hex: '#FFD500', symbol: 'Y', bricklinkId: 3   },
  { name: 'Orange',             hex: '#FF7E14', symbol: 'O', bricklinkId: 4   },
  { name: 'Bright Light Orange',hex: '#F7BA30', symbol: 'A', bricklinkId: 110 },
  { name: 'Red',                hex: '#DB0000', symbol: 'R', bricklinkId: 5   },
  { name: 'Bright Pink',        hex: '#FF5A7E', symbol: 'P', bricklinkId: 26  },
  { name: 'Dark Red',           hex: '#A1223B', symbol: 'M', bricklinkId: 59  },
  { name: 'Magenta',            hex: '#B11585', symbol: 'X', bricklinkId: 71  },
  { name: 'Green',              hex: '#2DBE2D', symbol: 'E', bricklinkId: 6   },
  { name: 'Lime',               hex: '#A6CA1E', symbol: 'L', bricklinkId: 34  },
  { name: 'Dark Green',         hex: '#007B28', symbol: 'F', bricklinkId: 80  },
  { name: 'Olive Green',        hex: '#7C8C3C', symbol: 'J', bricklinkId: 155 },
  { name: 'Sand Green',         hex: '#76A290', symbol: 'S', bricklinkId: 48  },
  { name: 'Blue',               hex: '#0059CF', symbol: 'B', bricklinkId: 7   },
  { name: 'Medium Blue',        hex: '#1A85E0', symbol: 'C', bricklinkId: 72  },
  { name: 'Dark Blue',          hex: '#003987', symbol: 'I', bricklinkId: 42  },
  { name: 'Purple',             hex: '#8B1FA0', symbol: 'V', bricklinkId: 24  },
  { name: 'Reddish Brown',      hex: '#6C3A20', symbol: 'H', bricklinkId: 88  },
  { name: 'Brown',              hex: '#583927', symbol: 'N', bricklinkId: 8   },
  { name: 'Dark Tan',           hex: '#897D62', symbol: 'Q', bricklinkId: 69  },
  { name: 'Medium Nougat',      hex: '#E3A05B', symbol: 'U', bricklinkId: 150 },
  { name: 'Black',              hex: '#101010', symbol: 'K', bricklinkId: 11  },
  { name: 'Light Grey',         hex: '#A0A5A9', symbol: 'G', bricklinkId: 86  },
  { name: 'Dark Grey',          hex: '#5A5A5A', symbol: 'D', bricklinkId: 85  },
];

/** Quick lookups */
const HEX_TO_ENTRY = new Map(COLOR_PALETTE.map((c) => [c.hex.toLowerCase(), c]));
const SYMBOL_TO_ENTRY = new Map(COLOR_PALETTE.map((c) => [c.symbol, c]));

// ─── Simple Lookups ───────────────────────────────────────────────────────────

/** Find BrickLink color ID by hex (case-insensitive). */
export function getBrickLinkColorId(hex: string): number | undefined {
  return HEX_TO_ENTRY.get(hex.toLowerCase())?.bricklinkId;
}

/** Find color name by hex. */
export function getColorName(hex: string): string | undefined {
  return HEX_TO_ENTRY.get(hex.toLowerCase())?.name;
}

/** Find hex by symbol. */
export function getHexForSymbol(symbol: string): string {
  return SYMBOL_TO_ENTRY.get(symbol)?.hex ?? '#A0A5A9';
}

/** Find symbol by hex. */
export function getSymbolForHex(hex: string): string {
  return HEX_TO_ENTRY.get(hex.toLowerCase())?.symbol ?? 'G';
}

// ─── Perceptual Color Matching (OKLCH) ────────────────────────────────────────
//
// OKLCH is a perceptually uniform color space. Unlike RGB Euclidean distance,
// OKLCH distance correlates with human-perceived color difference.
//
// Pipeline: sRGB → linear RGB → Oklab (L, a, b) → OKLCH (L, C, h)
//
// We use a weighted Delta-OKLCH distance:
//   ΔE = sqrt( wL*(ΔL)² + wC*(ΔC)² + wH*(Δh_chord)² )
//
// Where:
//   wL = 1.0  (lightness weight)
//   wC = 1.5  (chroma weight — penalize saturation mismatches)
//   wH = 1.0  (hue weight)
//   Δh_chord = 2*sqrt(C1*C2)*sin(Δh/2) — hue difference scaled by chroma

// sRGB gamma → linear
function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

// Oklab from linear RGB (M1 and M2 matrices from Björn Ottosson's Oklab)
function linearRgbToOklab(r: number, g: number, b: number): LabColor {
  const l_ = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m_ = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s_ = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;

  const l = Math.cbrt(l_);
  const m = Math.cbrt(m_);
  const s = Math.cbrt(s_);

  return {
    L: 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  };
}

function oklabToOklch(lab: LabColor): OklchColor {
  const C = Math.sqrt(lab.a * lab.a + lab.b * lab.b);
  let h = Math.atan2(lab.b, lab.a) * (180 / Math.PI);
  if (h < 0) h += 360;
  return { L: lab.L, C, h };
}

function hexToOklch(hex: string): OklchColor {
  const h = hex.replace('#', '');
  const r = srgbToLinear(parseInt(h.slice(0, 2), 16) / 255);
  const g = srgbToLinear(parseInt(h.slice(2, 4), 16) / 255);
  const b = srgbToLinear(parseInt(h.slice(4, 6), 16) / 255);
  return oklabToOklch(linearRgbToOklab(r, g, b));
}

function rgbToOklch(r: number, g: number, b: number): OklchColor {
  return oklabToOklch(linearRgbToOklab(srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)));
}

// Perceptual distance in OKLCH space
const W_L = 1.0;   // lightness weight
const W_C = 1.5;   // chroma weight — penalize saturation mismatches
const W_H = 1.0;   // hue weight

function oklchDistance(a: OklchColor, b: OklchColor): number {
  const dL = a.L - b.L;
  const dC = a.C - b.C;
  // Hue difference as chord distance, weighted by chroma
  const avgC = Math.sqrt(a.C * b.C);
  let dh = a.h - b.h;
  if (dh > 180) dh -= 360;
  if (dh < -180) dh += 360;
  const dhChord = 2 * avgC * Math.sin((dh * Math.PI) / 360);

  return Math.sqrt(W_L * dL * dL + W_C * dC * dC + W_H * dhChord * dhChord);
}

// Pre-compute OKLCH for palette (cached at module load)
const PALETTE_OKLCH: OklchColor[] = COLOR_PALETTE.map((c) => hexToOklch(c.hex));

/** Return the index of the palette entry closest to the given OKLCH input. */
function nearestPaletteIdx(input: OklchColor): number {
  let bestIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < PALETTE_OKLCH.length; i++) {
    const d = oklchDistance(input, PALETTE_OKLCH[i]);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  return bestIdx;
}

/**
 * Find the nearest LEGO palette color for an input hex color.
 * Uses perceptually uniform OKLCH distance.
 */
export function nearestLegoColorHex(inputHex: string): string {
  return COLOR_PALETTE[nearestPaletteIdx(hexToOklch(inputHex))].hex;
}

/**
 * Find the nearest LEGO palette color for normalized RGB [0-1].
 * Used by the Python voxelizer bridge.
 */
export function nearestLegoColorRgb(r: number, g: number, b: number): string {
  return COLOR_PALETTE[nearestPaletteIdx(rgbToOklch(r, g, b))].hex;
}

/**
 * Find nearest LEGO color symbol for normalized RGB [0-1].
 * This is the primary function for voxel coloring.
 */
export function nearestLegoSymbol(r: number, g: number, b: number): string {
  return COLOR_PALETTE[nearestPaletteIdx(rgbToOklch(r, g, b))].symbol;
}

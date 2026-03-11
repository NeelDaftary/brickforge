"""
Shared color quantization helpers for Blender-side voxel export.

Color-space contract:
- Blender material base colors and image pixels are treated as linear RGB.
- Palette hex codes are authored in sRGB and converted to linear exactly once
  before perceptual OKLCH matching data is cached.
- If a caller already has sRGB values, it should convert at the API boundary
  by using `srgb_tuple_to_nearest_lego_hex()`.
"""

from __future__ import annotations

import math
from typing import Dict, Tuple


LEGO_COLORS: Dict[str, str] = {
    "#FFFFFF": "W",   # White
    "#D9BB7A": "T",   # Tan
    "#FFD500": "Y",   # Yellow
    "#FF7E14": "O",   # Orange
    "#F7BA30": "A",   # Bright Light Orange
    "#DB0000": "R",   # Red
    "#FF5A7E": "P",   # Bright Pink
    "#A1223B": "M",   # Dark Red
    "#B11585": "X",   # Magenta
    "#2DBE2D": "E",   # Green
    "#A6CA1E": "L",   # Lime
    "#007B28": "F",   # Dark Green
    "#7C8C3C": "J",   # Olive Green
    "#76A290": "S",   # Sand Green
    "#0059CF": "B",   # Blue
    "#1A85E0": "C",   # Medium Blue
    "#003987": "I",   # Dark Blue
    "#8B1FA0": "V",   # Purple
    "#6C3A20": "H",   # Reddish Brown
    "#583927": "N",   # Brown
    "#897D62": "Q",   # Dark Tan
    "#E3A05B": "U",   # Medium Nougat
    "#101010": "K",   # Black
    "#A0A5A9": "G",   # Light Grey
    "#5A5A5A": "D",   # Dark Grey
}

SYMBOL_TO_HEX = {symbol: hex_color for hex_color, symbol in LEGO_COLORS.items()}

_W_L = 1.0
_W_C = 1.5
_W_H = 1.0


def srgb_to_linear(c: float) -> float:
    """Convert one normalized sRGB channel to linear RGB."""
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def _linear_rgb_to_oklab(r: float, g: float, b: float) -> Tuple[float, float, float]:
    """Convert normalized linear RGB directly to Oklab."""
    l_ = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b
    m_ = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b
    s_ = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b

    l = math.copysign(abs(l_) ** (1 / 3), l_) if l_ != 0 else 0.0
    m = math.copysign(abs(m_) ** (1 / 3), m_) if m_ != 0 else 0.0
    s = math.copysign(abs(s_) ** (1 / 3), s_) if s_ != 0 else 0.0

    L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s
    a = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s
    b_val = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s
    return (L, a, b_val)


def _oklab_to_oklch(L: float, a: float, b: float) -> Tuple[float, float, float]:
    C = math.sqrt(a * a + b * b)
    h = math.degrees(math.atan2(b, a))
    if h < 0:
        h += 360.0
    return (L, C, h)


def linear_rgb_to_oklch(rgb: Tuple[float, float, float]) -> Tuple[float, float, float]:
    """Convert normalized linear RGB directly to OKLCH."""
    L, a, b = _linear_rgb_to_oklab(*rgb)
    return _oklab_to_oklch(L, a, b)


def _oklch_distance(a: Tuple[float, float, float], b: Tuple[float, float, float]) -> float:
    dL = a[0] - b[0]
    dC = a[1] - b[1]
    avg_C = math.sqrt(a[1] * b[1])
    dh = a[2] - b[2]
    if dh > 180:
        dh -= 360
    if dh < -180:
        dh += 360
    dh_chord = 2 * avg_C * math.sin(math.radians(dh / 2))
    return math.sqrt(_W_L * dL * dL + _W_C * dC * dC + _W_H * dh_chord * dh_chord)


def _hex_to_linear_rgb(hex_color: str) -> Tuple[float, float, float]:
    h = hex_color.lstrip("#")
    return (
        srgb_to_linear(int(h[0:2], 16) / 255.0),
        srgb_to_linear(int(h[2:4], 16) / 255.0),
        srgb_to_linear(int(h[4:6], 16) / 255.0),
    )


_PALETTE_OKLCH = {
    hex_color: linear_rgb_to_oklch(_hex_to_linear_rgb(hex_color))
    for hex_color in LEGO_COLORS
}


def linear_rgb_to_nearest_lego_hex(rgb: Tuple[float, float, float]) -> str:
    """Match a normalized Blender-linear RGB sample to the nearest LEGO hex."""
    input_oklch = linear_rgb_to_oklch(rgb)
    best_hex = "#A0A5A9"
    best_dist = float("inf")
    for hex_color, palette_oklch in _PALETTE_OKLCH.items():
        dist = _oklch_distance(input_oklch, palette_oklch)
        if dist < best_dist:
            best_dist = dist
            best_hex = hex_color
    return best_hex


def srgb_tuple_to_nearest_lego_hex(rgb: Tuple[float, float, float]) -> str:
    """Match normalized sRGB input by converting once at the boundary."""
    linear_rgb = tuple(srgb_to_linear(channel) for channel in rgb)
    return linear_rgb_to_nearest_lego_hex(linear_rgb)

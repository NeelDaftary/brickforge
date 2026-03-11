"""
Voxelizer: Converts a 3D mesh file into a voxel grid matrix.

Samples the mesh bounding box into a NxNxN grid. For each grid cell,
determines if the cell center is inside the mesh surface.

Color extraction priority:
  1. GLB/PLY vertex/face colors (trimesh visual) — preferred, works directly
  2. OBJ extended vertex colors (v x y z r g b)
  3. OBJ + MTL Kd per-face materials

Color matching uses OKLCH perceptual distance (not RGB Euclidean).

Color space contract: All color values are sRGB [0-1] unless noted otherwise.
  GLB COLOR_0 (sRGB uint8 [0-255])
    → extract_face_colors_from_visual() → sRGB float [0-1]
    → nearest_lego_color() → _rgb_to_oklch() applies sRGB→linear internally
    → OKLCH perceptual matching → palette hex (sRGB)
No manual linear↔sRGB conversions exist outside of _rgb_to_oklch().

Output: JSON with color_legend and grid.
"""

import argparse
import json
import math
import sys
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np

try:
    import trimesh
except ImportError:
    print("ERROR: trimesh is required. Install with: pip install trimesh", file=sys.stderr)
    sys.exit(1)


# ─── LEGO Color Palette ─────────────────────────────────────────────────────
# Must match color-palette.ts exactly.

LEGO_COLORS = {
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

SYMBOL_TO_HEX = {v: k for k, v in LEGO_COLORS.items()}

# Saturation threshold for rejecting "unset" Blender default materials.
_ACHROMATIC_SATURATION_THRESHOLD = 0.08


# ─── OKLCH Perceptual Color Matching ────────────────────────────────────────
#
# sRGB → linear RGB → Oklab → OKLCH
# Distance uses weighted ΔL, ΔC, and chord-based Δh.

def _srgb_to_linear(c: float) -> float:
    """sRGB gamma → linear."""
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def _linear_rgb_to_oklab(r: float, g: float, b: float) -> Tuple[float, float, float]:
    """Linear RGB → Oklab (L, a, b). Matrices from Björn Ottosson."""
    l_ = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b
    m_ = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b
    s_ = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b

    l = math.copysign(abs(l_) ** (1/3), l_) if l_ != 0 else 0.0
    m = math.copysign(abs(m_) ** (1/3), m_) if m_ != 0 else 0.0
    s = math.copysign(abs(s_) ** (1/3), s_) if s_ != 0 else 0.0

    L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s
    a = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s
    b_val = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s
    return (L, a, b_val)


def _oklab_to_oklch(L: float, a: float, b: float) -> Tuple[float, float, float]:
    """Oklab → OKLCH (L, C, h)."""
    C = math.sqrt(a * a + b * b)
    h = math.degrees(math.atan2(b, a))
    if h < 0:
        h += 360.0
    return (L, C, h)


def _rgb_to_oklch(r: float, g: float, b: float) -> Tuple[float, float, float]:
    """Normalized sRGB [0-1] → OKLCH (L, C, h)."""
    lr = _srgb_to_linear(r)
    lg = _srgb_to_linear(g)
    lb = _srgb_to_linear(b)
    L, a, b_val = _linear_rgb_to_oklab(lr, lg, lb)
    return _oklab_to_oklch(L, a, b_val)


# Weights for perceptual distance
_W_L = 1.0   # lightness
_W_C = 1.5   # chroma (penalize saturation mismatches)
_W_H = 1.0   # hue

def _oklch_distance(a: Tuple[float, float, float], b: Tuple[float, float, float]) -> float:
    """Weighted OKLCH distance with chord-based hue difference."""
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


# Pre-compute OKLCH for all palette colors
def _hex_to_rgb(hex_color: str) -> Tuple[float, float, float]:
    h = hex_color.lstrip("#")
    return (int(h[0:2], 16) / 255.0, int(h[2:4], 16) / 255.0, int(h[4:6], 16) / 255.0)


_PALETTE_OKLCH = {
    hex_color: _rgb_to_oklch(*_hex_to_rgb(hex_color))
    for hex_color in LEGO_COLORS
}


def nearest_lego_color(rgb: Tuple[float, float, float]) -> str:
    """Find the nearest LEGO palette color hex using OKLCH perceptual distance.

    Args:
        rgb: Normalized sRGB [0-1] tuple. NOT linear RGB.
             The sRGB→linear conversion happens inside _rgb_to_oklch.
    """
    input_oklch = _rgb_to_oklch(*rgb)
    best_hex = "#A0A5A9"
    best_dist = float("inf")
    for hex_color, palette_oklch in _PALETTE_OKLCH.items():
        dist = _oklch_distance(input_oklch, palette_oklch)
        if dist < best_dist:
            best_dist = dist
            best_hex = hex_color
    return best_hex


def is_achromatic(rgb: Tuple[float, float, float]) -> bool:
    """Return True if the color is achromatic (near-grey/unset Blender material)."""
    return max(rgb) - min(rgb) < _ACHROMATIC_SATURATION_THRESHOLD


# ─── OBJ / MTL Parsing ──────────────────────────────────────────────────────

def parse_obj_vertex_colors(obj_path: str) -> Optional[np.ndarray]:
    """Parse extended OBJ vertex color format: 'v x y z r g b'."""
    vertex_colors = []
    has_colors = False
    try:
        with open(obj_path, "r") as f:
            for line in f:
                if not line.startswith("v "):
                    continue
                parts = line.split()
                if len(parts) >= 7:
                    r, g, b = float(parts[4]), float(parts[5]), float(parts[6])
                    vertex_colors.append((r, g, b))
                    has_colors = True
                elif len(parts) >= 4:
                    vertex_colors.append((0.5, 0.5, 0.5))
    except Exception as e:
        print(f"Warning: Could not parse OBJ vertex colors: {e}", file=sys.stderr)
        return None
    if not has_colors or not vertex_colors:
        return None
    return np.array(vertex_colors, dtype=float)


def build_face_colors_from_obj_vertex_colors(obj_path: str, mesh) -> Optional[np.ndarray]:
    """Build per-face colors from OBJ extended vertex colors."""
    vc = parse_obj_vertex_colors(obj_path)
    if vc is None:
        return None
    if len(vc) != len(mesh.vertices):
        print(f"[LOG] OBJ vertex color count ({len(vc)}) != mesh vertices ({len(mesh.vertices)}), skipping")
        return None
    faces = np.asarray(mesh.faces, dtype=int)
    if len(faces) == 0:
        return None
    face_colors = vc[faces].mean(axis=1)
    print(f"[LOG] Loaded vertex colors from OBJ v-lines for {len(face_colors)} faces")
    return face_colors


def parse_mtl_colors(mtl_path: str) -> Dict[str, Tuple[float, float, float]]:
    """Parse an MTL file and extract diffuse color (Kd) for each material."""
    materials: Dict[str, Tuple[float, float, float]] = {}
    current_name = None
    try:
        with open(mtl_path, "r") as f:
            for line in f:
                line = line.strip()
                if line.startswith("newmtl "):
                    current_name = line[7:].strip()
                elif line.startswith("Kd ") and current_name:
                    parts = line.split()
                    if len(parts) >= 4:
                        r, g, b = float(parts[1]), float(parts[2]), float(parts[3])
                        materials[current_name] = (r, g, b)
    except Exception as e:
        print(f"Warning: Could not parse MTL file {mtl_path}: {e}", file=sys.stderr)
    return materials


def parse_obj_face_materials(obj_path: str) -> Tuple[List[str], Optional[str]]:
    """Parse an OBJ file to extract per-face material assignments."""
    face_materials: List[str] = []
    current_material = None
    mtl_file = None
    with open(obj_path, "r") as f:
        for line in f:
            line = line.strip()
            if line.startswith("mtllib "):
                mtl_file = line[7:].strip()
            elif line.startswith("usemtl "):
                current_material = line[7:].strip()
            elif line.startswith("f "):
                face_materials.append(current_material or "default")
    return face_materials, mtl_file


def build_face_colors(obj_path: str, num_faces: int) -> Optional[np.ndarray]:
    """Build per-face RGB color array by parsing OBJ + MTL files directly."""
    face_materials, mtl_filename = parse_obj_face_materials(obj_path)
    if not mtl_filename:
        return None
    mtl_path = str(Path(obj_path).parent / mtl_filename)
    mtl_colors = parse_mtl_colors(mtl_path)
    if not mtl_colors:
        return None

    colors = np.full((num_faces, 3), 0.5, dtype=float)

    if len(face_materials) == num_faces:
        for i, mat_name in enumerate(face_materials):
            if mat_name in mtl_colors:
                colors[i] = mtl_colors[mat_name]
    elif len(face_materials) > 0:
        mat_groups: List[Tuple[str, int]] = []
        current = face_materials[0]
        count = 0
        for mat in face_materials:
            if mat == current:
                count += 1
            else:
                mat_groups.append((current, count))
                current = mat
                count = 1
        mat_groups.append((current, count))

        total_obj = sum(c for _, c in mat_groups)
        ratio = num_faces / max(total_obj, 1)

        idx = 0
        for mat_name, group_count in mat_groups:
            tri_count = max(1, round(group_count * ratio))
            end = min(idx + tri_count, num_faces)
            if mat_name in mtl_colors:
                colors[idx:end] = mtl_colors[mat_name]
            idx = end

    return colors


def extract_face_colors_from_visual(mesh) -> Optional[np.ndarray]:
    """Extract per-face normalized RGB colors from trimesh visual data."""
    if not hasattr(mesh, "visual") or mesh.visual is None:
        return None

    face_colors_raw = getattr(mesh.visual, "face_colors", None)
    if face_colors_raw is not None and len(face_colors_raw) == len(mesh.faces):
        # trimesh returns uint8 [0-255] for vertex/face colors from GLB/PLY/OBJ.
        # Always normalize to [0-1]. Result is sRGB — no gamma conversion.
        face_colors = np.asarray(face_colors_raw, dtype=float)[:, :3] / 255.0
        return face_colors

    vertex_colors_raw = getattr(mesh.visual, "vertex_colors", None)
    if vertex_colors_raw is None or len(vertex_colors_raw) != len(mesh.vertices):
        return None

    # trimesh returns uint8 [0-255]. Normalize to sRGB [0-1].
    vertex_colors = np.asarray(vertex_colors_raw, dtype=float)[:, :3] / 255.0

    faces = np.asarray(mesh.faces, dtype=int)
    if len(faces) == 0:
        return None
    # Average vertex colors per face in sRGB space. Acceptable for palette
    # matching (15 highly distinct colors) despite sRGB being nonlinear.
    return vertex_colors[faces].mean(axis=1)


def _extract_glb_scene_submeshes(scene) -> List[Tuple]:
    """Extract per-geometry PBR material colors from a GLB Scene.

    When Blender exports a multi-material GLB, each material becomes a
    separate glTF primitive / trimesh geometry with a PBRMaterial whose
    baseColorFactor holds the sRGB color.

    On trimesh.util.concatenate() this material info is lost (visual kind
    becomes None and everything defaults to grey). This function must be
    called BEFORE concatenation to capture per-geometry colors.

    Returns a list of (Trimesh, LEGO symbol) tuples for color_grid_from_submeshes.
    Returns empty list if the scene doesn't have usable PBR material colors.
    """
    if not isinstance(scene, trimesh.Scene) or not scene.geometry:
        return []

    sub_meshes: List[Tuple] = []
    has_color = False

    for geom_name, geom in scene.geometry.items():
        if not isinstance(geom, trimesh.Trimesh):
            continue

        rgb = None
        source = "none"

        if hasattr(geom, "visual") and hasattr(geom.visual, "material"):
            vm = geom.visual.material
            for attr in ("main_color", "diffuse", "ambient"):
                val = getattr(vm, attr, None)
                if val is not None:
                    try:
                        candidate = tuple(
                            c / 255.0 if c > 1.0 else float(c)
                            for c in list(val)[:3]
                        )
                        if not is_achromatic(candidate):
                            rgb = candidate
                            source = attr
                            break
                    except Exception:
                        pass

        if rgb is not None:
            hex_c = nearest_lego_color(rgb)
            symbol = LEGO_COLORS[hex_c]
            sub_meshes.append((geom, symbol))
            has_color = True
            print(f"[LOG] GLB sub-mesh '{geom_name}': {symbol} ({hex_c}) via {source}")
        else:
            sub_meshes.append((geom, "G"))
            print(f"[LOG] GLB sub-mesh '{geom_name}': no color -> Grey")

    if not has_color:
        return []

    return sub_meshes


def _extract_face_colors_from_texture(mesh) -> Optional[np.ndarray]:
    """Extract per-face colors from texture-mapped meshes (e.g. Hyper3D Rodin output).

    Uses trimesh's built-in to_color() to sample the diffuse texture at UV coords,
    producing vertex colors which are then averaged per face.

    Returns sRGB [0-1] per-face colors, or None if the mesh isn't texture-mapped.
    """
    if not hasattr(mesh, "visual") or mesh.visual is None:
        return None

    visual_kind = getattr(mesh.visual, "kind", None)
    if visual_kind != "texture":
        return None

    if not hasattr(mesh.visual, "to_color"):
        return None

    try:
        color_visual = mesh.visual.to_color()
        vc_raw = getattr(color_visual, "vertex_colors", None)
        if vc_raw is None or len(vc_raw) != len(mesh.vertices):
            return None

        # to_color() returns uint8 [0-255]. Normalize to sRGB [0-1].
        vertex_colors = np.asarray(vc_raw, dtype=float)[:, :3] / 255.0

        faces = np.asarray(mesh.faces, dtype=int)
        if len(faces) == 0:
            return None

        face_colors = vertex_colors[faces].mean(axis=1)
        print(f"[LOG] Converted texture to {len(vertex_colors)} vertex colors via to_color()")
        return face_colors
    except Exception as e:
        print(f"[LOG] Texture→color conversion failed: {e}", file=sys.stderr)
        return None


# ─── OBJ Sub-mesh Loader ─────────────────────────────────────────────────────

def _load_obj_submeshes(obj_path: str) -> List[Tuple]:
    """Re-load an OBJ as a Scene to extract per-geometry material colors."""
    _, mtl_filename = parse_obj_face_materials(obj_path)
    if not mtl_filename:
        return []
    mtl_path_str = str(Path(obj_path).parent / mtl_filename)
    mtl_colors = parse_mtl_colors(mtl_path_str)
    if not mtl_colors:
        return []

    sub_meshes: List[Tuple] = []
    try:
        scene = trimesh.load(obj_path, force=None)
        if not isinstance(scene, trimesh.Scene) or not scene.geometry:
            return []
        for geom_name, geom in scene.geometry.items():
            if not isinstance(geom, trimesh.Trimesh):
                continue
            rgb = None
            source = "none"

            if hasattr(geom, "visual") and hasattr(geom.visual, "material"):
                vm = geom.visual.material
                for attr in ("main_color", "diffuse", "ambient"):
                    val = getattr(vm, attr, None)
                    if val is not None:
                        try:
                            candidate = tuple(
                                c / 255.0 if c > 1.0 else float(c)
                                for c in list(val)[:3]
                            )
                            if not is_achromatic(candidate):
                                rgb = candidate
                                source = attr
                                break
                        except Exception:
                            pass

            if rgb is None:
                for mname, mrgb in mtl_colors.items():
                    if mname in geom_name or geom_name in mname:
                        rgb = mrgb
                        source = f"name_match({mname})"
                        break

            if rgb is None and len(mtl_colors) == 1:
                rgb = list(mtl_colors.values())[0]
                source = "single_material"

            if rgb is not None:
                hex_c = nearest_lego_color(rgb)
                symbol = LEGO_COLORS[hex_c]
                sub_meshes.append((geom, symbol))
                print(f"[LOG] Sub-mesh '{geom_name}': {symbol} ({hex_c}) via {source}")
            else:
                sub_meshes.append((geom, "G"))
                print(f"[LOG] Sub-mesh '{geom_name}': no color -> Grey")
    except Exception as e:
        print(f"[LOG] Scene load failed ({e}), using face-based coloring")

    return sub_meshes


# ─── Color Grid Builders ────────────────────────────────────────────────────

def color_grid_from_submeshes(
    sub_meshes: List[Tuple],
    inside_grid: np.ndarray,
    xs: np.ndarray,
    ys: np.ndarray,
    zs: np.ndarray,
    grid_size: int,
) -> Tuple[np.ndarray, Dict[str, int]]:
    """Assign colors to filled voxels using nearest sub-mesh approach."""
    color_grid = np.full((grid_size, grid_size, grid_size), "", dtype=object)
    inside_indices = np.argwhere(inside_grid)
    color_counts: Dict[str, int] = {}

    if len(inside_indices) == 0:
        return color_grid, color_counts

    inside_points = np.array([[xs[i], ys[j], zs[k]] for i, j, k in inside_indices])
    best_dist = np.full(len(inside_points), np.inf)
    best_symbol = np.full(len(inside_points), "G", dtype=object)

    for sub_mesh, symbol in sub_meshes:
        try:
            _, distances, _ = sub_mesh.nearest.on_surface(inside_points)
            closer = distances < best_dist
            best_dist[closer] = distances[closer]
            best_symbol[closer] = symbol
        except Exception:
            continue

    for idx, (i, j, k) in enumerate(inside_indices):
        color_grid[i, j, k] = best_symbol[idx]
        s = best_symbol[idx]
        color_counts[s] = color_counts.get(s, 0) + 1

    print(f"[LOG] Sub-mesh color distribution: {color_counts}")
    return color_grid, color_counts


def color_grid_from_faces(
    face_colors: np.ndarray,
    mesh,
    inside_grid: np.ndarray,
    xs: np.ndarray,
    ys: np.ndarray,
    zs: np.ndarray,
    grid_size: int,
) -> Tuple[np.ndarray, Dict[str, int]]:
    """Assign colors to filled voxels using area-weighted multi-sample approach.

    For each voxel, samples 7 points (center + 6 axis-aligned jitters at ±30%
    of voxel size). Each sample's face color is weighted by that face's area,
    so large flat surfaces dominate over tiny noisy triangles. The weighted
    average is quantized to the nearest LEGO color.
    """
    color_grid = np.full((grid_size, grid_size, grid_size), "", dtype=object)
    inside_indices = np.argwhere(inside_grid)
    color_counts: Dict[str, int] = {}

    if len(inside_indices) == 0:
        return color_grid, color_counts

    inside_points = np.array([[xs[i], ys[j], zs[k]] for i, j, k in inside_indices])
    n_voxels = len(inside_points)

    # Face areas for weighting — larger faces get more influence
    face_areas = np.asarray(mesh.area_faces, dtype=float)

    # Voxel size for jitter offsets
    voxel_size = float(xs[1] - xs[0]) if len(xs) > 1 else 1.0
    jitter = voxel_size * 0.3

    # 7-point stencil: center + 6 axis-aligned offsets
    offsets = np.array([
        [0, 0, 0],
        [jitter, 0, 0], [-jitter, 0, 0],
        [0, jitter, 0], [0, -jitter, 0],
        [0, 0, jitter], [0, 0, -jitter],
    ])

    # Accumulate area-weighted RGB across all samples (vectorized)
    weighted_rgb = np.zeros((n_voxels, 3), dtype=float)
    total_weight = np.zeros(n_voxels, dtype=float)
    n_face_colors = len(face_colors)
    n_face_areas = len(face_areas)

    for offset in offsets:
        sample_points = inside_points + offset
        _, _, face_idx_arr = mesh.nearest.on_surface(sample_points)
        face_idx_arr = np.asarray(face_idx_arr, dtype=int)

        valid = face_idx_arr < n_face_colors
        safe_idx = np.where(valid, face_idx_arr, 0)

        colors = face_colors[safe_idx]                                  # (N, 3)
        areas = face_areas[np.minimum(safe_idx, n_face_areas - 1)]      # (N,)

        # Zero out invalid entries
        colors[~valid] = 0.0
        areas[~valid] = 0.0

        weighted_rgb += colors * areas[:, np.newaxis]
        total_weight += areas

    # Compute weighted average and quantize
    nonzero = total_weight > 0
    avg_rgb = np.zeros_like(weighted_rgb)
    avg_rgb[nonzero] = weighted_rgb[nonzero] / total_weight[nonzero, np.newaxis]
    avg_rgb = np.clip(avg_rgb, 0.0, 1.0)

    for idx, (i, j, k) in enumerate(inside_indices):
        if nonzero[idx]:
            rgb = tuple(avg_rgb[idx])
            hex_color = nearest_lego_color(rgb)
            symbol = LEGO_COLORS[hex_color]
        else:
            symbol = "G"
        color_grid[i, j, k] = symbol
        color_counts[symbol] = color_counts.get(symbol, 0) + 1

    print(f"[LOG] Face-based color distribution (area-weighted 7-sample): {color_counts}")
    return color_grid, color_counts


_ACHROMATIC_SYMBOLS = {"G", "D", "K", "W"}  # Light Grey, Dark Grey, Black, White

def grey_fraction(color_counts: Dict[str, int]) -> float:
    """Fraction of voxels that are achromatic (grey/black/white).

    A high achromatic fraction suggests the color extraction path failed
    and produced default/fallback colors rather than real material data.
    """
    total = sum(color_counts.values())
    achromatic = sum(color_counts.get(s, 0) for s in _ACHROMATIC_SYMBOLS)
    return achromatic / max(total, 1)


# ─── Main Voxelization ──────────────────────────────────────────────────────

def voxelize_mesh(
    mesh_path: str,
    grid_size: int = 25,
    hollow: bool = True,
    up_axis: str = "auto",
) -> Tuple[List[List[List[str]]], Dict[str, str]]:
    """
    Load a mesh and convert it to a voxel grid.

    Args:
        mesh_path: Path to OBJ/STL/PLY/GLB file
        grid_size: Size of the grid (NxNxN)
        hollow: If True, only keep the shell (exterior voxels)
        up_axis: Which mesh axis is 'up' (X/Y/Z/auto)

    Returns:
        (grid, color_legend) where grid is [x][y][z] string array
    """
    mesh_ext = Path(mesh_path).suffix.lower()
    is_obj = mesh_ext == ".obj"

    # Load mesh — trimesh.util.concatenate preserves vertex colors in trimesh 4.x+
    try:
        scene_or_mesh = trimesh.load(mesh_path, force=None)
    except (ModuleNotFoundError, Exception) as e:
        if "PIL" in str(e) or "pillow" in str(e).lower():
            print("Warning: Loading without texture images (PIL not available).", file=sys.stderr)
            scene_or_mesh = trimesh.load(mesh_path, force=None)
        else:
            raise

    # Extract GLB scene PBR material colors BEFORE concatenation.
    # Concatenation drops material info, so this must happen first.
    glb_scene_submeshes: List[Tuple] = []
    if isinstance(scene_or_mesh, trimesh.Scene):
        glb_scene_submeshes = _extract_glb_scene_submeshes(scene_or_mesh)
        meshes = [g for g in scene_or_mesh.geometry.values() if isinstance(g, trimesh.Trimesh)]
        if not meshes:
            raise ValueError("No geometry found in file")
        mesh = trimesh.util.concatenate(meshes)
    else:
        mesh = scene_or_mesh

    if not isinstance(mesh, trimesh.Trimesh):
        raise ValueError(f"Expected Trimesh, got {type(mesh)}")

    # Ensure watertight for inside/outside testing
    if not mesh.is_watertight:
        trimesh.repair.fix_normals(mesh)
        try:
            trimesh.repair.fill_holes(mesh)
        except Exception:
            pass

    # Color extraction priority:
    # 1) Trimesh visual data (GLB/PLY vertex/face colors) — preferred path
    # 2) Texture-mapped mesh (Hyper3D Rodin output) — sample texture via UVs
    # 3) GLB scene PBR materials (Blender multi-material export) — per sub-mesh
    # 4) OBJ extended vertex colors (v x y z r g b)
    # 5) OBJ + MTL Kd per-face materials
    face_colors = None
    color_source = "none"

    # Try visual data first (GLB COLOR_0, PLY vertex colors)
    face_colors = extract_face_colors_from_visual(mesh)
    if face_colors is not None:
        color_source = "visual"
        print(f"[LOG] Loaded colors from mesh visual data ({len(face_colors)} faces)")

    # Try texture-mapped mesh (e.g. Hyper3D Rodin GLB with diffuse texture)
    if face_colors is None:
        face_colors = _extract_face_colors_from_texture(mesh)
        if face_colors is not None:
            color_source = "texture"
            print(f"[LOG] Loaded colors from texture sampling ({len(face_colors)} faces)")

    # OBJ-specific fallbacks
    if face_colors is None and is_obj:
        face_colors = build_face_colors_from_obj_vertex_colors(mesh_path, mesh)
        if face_colors is not None:
            color_source = "obj_vertex"
            print(f"[LOG] Loaded vertex colors from OBJ v-lines")
    if face_colors is None and is_obj:
        face_colors = build_face_colors(mesh_path, len(mesh.faces))
        if face_colors is not None:
            color_source = "obj_mtl"
            unique = len(set(tuple(c) for c in face_colors))
            print(f"[LOG] Loaded {unique} unique material colors from MTL")

    # Bounding box
    bounds_min = np.array(mesh.bounds[0], dtype=float)
    bounds_max = np.array(mesh.bounds[1], dtype=float)
    extents = bounds_max - bounds_min

    print(f"[LOG] Mesh bounds min: x={bounds_min[0]:.3f}, y={bounds_min[1]:.3f}, z={bounds_min[2]:.3f}")
    print(f"[LOG] Mesh bounds max: x={bounds_max[0]:.3f}, y={bounds_max[1]:.3f}, z={bounds_max[2]:.3f}")
    print(f"[LOG] Mesh extents: x={extents[0]:.3f}, y={extents[1]:.3f}, z={extents[2]:.3f}")
    print(f"[LOG] Mesh vertices: {len(mesh.vertices)}, faces: {len(mesh.faces)}")

    # Padding
    padding = extents * 0.05
    bounds_min -= padding
    bounds_max += padding
    extents = bounds_max - bounds_min

    # Uniform voxel size
    max_extent = max(extents)
    voxel_size = max_extent / grid_size
    print(f"[LOG] Voxel size: {voxel_size:.4f}, grid: {grid_size}x{grid_size}x{grid_size}")

    # Center the grid
    center = (bounds_min + bounds_max) / 2
    grid_origin = center - (voxel_size * grid_size / 2)

    # Create sample points
    xs = grid_origin[0] + (np.arange(grid_size) + 0.5) * voxel_size
    ys = grid_origin[1] + (np.arange(grid_size) + 0.5) * voxel_size
    zs = grid_origin[2] + (np.arange(grid_size) + 0.5) * voxel_size

    xx, yy, zz = np.meshgrid(xs, ys, zs, indexing="ij")
    points = np.column_stack([xx.ravel(), yy.ravel(), zz.ravel()])

    # Inside/outside testing
    inside = mesh.contains(points)
    inside_grid = inside.reshape((grid_size, grid_size, grid_size))
    filled_base = int(np.sum(inside_grid))

    # Surface proximity pass
    closest_pts, distances, closest_faces = mesh.nearest.on_surface(points)
    distances_grid = distances.reshape((grid_size, grid_size, grid_size))
    surface_threshold = voxel_size * 0.4
    surface_close = distances_grid <= surface_threshold
    inside_grid = inside_grid | surface_close
    filled_after_surface = int(np.sum(inside_grid))

    # Small hole-filling per z-slice
    filled_by_holefill = 0
    try:
        from scipy import ndimage
        for z_idx in range(grid_size):
            layer_slice = inside_grid[:, :, z_idx].copy()
            if not np.any(layer_slice):
                continue
            filled_in_layer = int(np.sum(layer_slice))
            max_hole_size = max(3, int(filled_in_layer * 0.15))

            padded = np.zeros((grid_size + 2, grid_size + 2), dtype=bool)
            padded[1:-1, 1:-1] = ~layer_slice
            labeled, num_features = ndimage.label(padded)
            exterior_label = labeled[0, 0]

            for label_id in range(1, num_features + 1):
                if label_id == exterior_label:
                    continue
                hole_mask = labeled[1:-1, 1:-1] == label_id
                hole_size = int(np.sum(hole_mask))
                if 0 < hole_size <= max_hole_size:
                    inside_grid[:, :, z_idx] = inside_grid[:, :, z_idx] | hole_mask
                    filled_by_holefill += hole_size
    except ImportError:
        pass

    filled_final = int(np.sum(inside_grid))
    print(f"Containment: {filled_base} base + {filled_after_surface - filled_base} surface + {filled_by_holefill} hole-fill = {filled_final} total")

    # Orient: Transpose so the user-selected "up" axis maps to grid Z (height)
    applied_up = up_axis if up_axis != "auto" else "Y"
    print(f"[LOG] Up axis: {applied_up} (requested={up_axis})")

    if applied_up == "X":
        inside_grid = np.transpose(inside_grid, (2, 1, 0))
        xs, zs = zs, xs
    elif applied_up == "Y":
        inside_grid = np.transpose(inside_grid, (0, 2, 1))
        ys, zs = zs, ys

    # === COLOR ASSIGNMENT ===
    #
    # For GLB/PLY (visual data): face_colors are already extracted — use them directly.
    # For OBJ with MTL: try sub-mesh approach as an alternative and pick the better one.
    # The sub-mesh approach re-loads the file as a Scene to get per-geometry materials.

    color_grid = np.full((grid_size, grid_size, grid_size), "", dtype=object)

    if face_colors is not None and color_source in ("visual", "texture"):
        # Fast path for GLB/PLY vertex colors or texture-sampled colors
        color_grid, color_counts = color_grid_from_faces(
            face_colors, mesh, inside_grid, xs, ys, zs, grid_size
        )
        # If visual/texture path produced mostly grey, try GLB PBR materials instead
        if grey_fraction(color_counts) > 0.5 and glb_scene_submeshes:
            print(f"[LOG] {color_source} path produced {grey_fraction(color_counts):.0%} grey, trying GLB PBR materials")
            alt_cg, alt_counts = color_grid_from_submeshes(
                glb_scene_submeshes, inside_grid, xs, ys, zs, grid_size
            )
            if grey_fraction(alt_counts) < grey_fraction(color_counts):
                color_grid = alt_cg
                print(f"[LOG] GLB PBR materials ({grey_fraction(alt_counts):.0%} grey) better than {color_source}")
            else:
                print(f"[LOG] Using {color_source} face colors (fast path)")
        else:
            print(f"[LOG] Using {color_source} face colors (fast path)")

    elif glb_scene_submeshes:
        # GLB scene with PBR material colors but no vertex colors / no texture
        color_grid, _ = color_grid_from_submeshes(
            glb_scene_submeshes, inside_grid, xs, ys, zs, grid_size
        )
        print("[LOG] Using GLB scene PBR material colors")

    elif is_obj:
        # OBJ path: try sub-mesh approach alongside face colors and pick best
        sub_meshes = _load_obj_submeshes(mesh_path)
        sub_cg, sub_counts = None, {}
        face_cg, face_counts = None, {}

        if sub_meshes:
            sub_cg, sub_counts = color_grid_from_submeshes(
                sub_meshes, inside_grid, xs, ys, zs, grid_size
            )
        if face_colors is not None:
            face_cg, face_counts = color_grid_from_faces(
                face_colors, mesh, inside_grid, xs, ys, zs, grid_size
            )

        if face_cg is not None and sub_cg is not None:
            face_grey = grey_fraction(face_counts)
            sub_grey = grey_fraction(sub_counts)
            if face_grey <= sub_grey:
                print(f"[LOG] Using face-based coloring ({face_grey:.0%} grey) over sub-mesh ({sub_grey:.0%} grey)")
                color_grid = face_cg
            else:
                print(f"[LOG] Sub-mesh ({sub_grey:.0%} grey) better than face-based ({face_grey:.0%} grey)")
                color_grid = sub_cg
        elif face_cg is not None:
            color_grid = face_cg
        elif sub_cg is not None:
            color_grid = sub_cg
        else:
            print("Warning: No OBJ material colors found, using grey")
            inside_indices = np.argwhere(inside_grid)
            for i, j, k in inside_indices:
                color_grid[i, j, k] = "G"

    elif face_colors is not None:
        # Non-OBJ with face colors (edge case)
        color_grid, _ = color_grid_from_faces(
            face_colors, mesh, inside_grid, xs, ys, zs, grid_size
        )

    else:
        print("Warning: No material colors found, using grey for all voxels")
        inside_indices = np.argwhere(inside_grid)
        for i, j, k in inside_indices:
            color_grid[i, j, k] = "G"

    # Find bounding box of filled voxels to trim empty space
    filled_indices = np.argwhere(inside_grid)
    if len(filled_indices) == 0:
        raise ValueError("No voxels filled — mesh may be empty or too small for grid")

    x_min, y_min, z_min = filled_indices.min(axis=0)
    x_max, y_max, z_max = filled_indices.max(axis=0)
    print(f"[LOG] Filled voxel bounds: x=[{x_min},{x_max}], y=[{y_min},{y_max}], z=[{z_min},{z_max}]")

    # Build output grid as [x][y][z]
    grid: List[List[List[str]]] = []
    for x in range(x_min, x_max + 1):
        plane: List[List[str]] = []
        for y in range(y_min, y_max + 1):
            col: List[str] = []
            for z in range(z_min, z_max + 1):
                if inside_grid[x, y, z]:
                    col.append(color_grid[x, y, z] or "G")
                else:
                    col.append("0")
            plane.append(col)
        grid.append(plane)

    print(f"[LOG] Output grid shape: [{len(grid)}][{len(grid[0])}][{len(grid[0][0])}] = [x][y][z]")

    # Build color legend — only used symbols
    color_legend: Dict[str, str] = {}
    for hex_color, symbol in LEGO_COLORS.items():
        used = any(symbol in row for plane in grid for row in plane)
        if used:
            color_legend[symbol] = hex_color

    return grid, color_legend


def main():
    parser = argparse.ArgumentParser(description="Voxelize a 3D mesh into a LEGO-compatible grid")
    parser.add_argument("input", help="Path to OBJ/STL/PLY/GLB mesh file")
    parser.add_argument("--output", "-o", required=True, help="Output JSON path")
    parser.add_argument("--grid-size", "-g", type=int, default=25, help="Grid size (NxNxN)")
    parser.add_argument("--hollow", action="store_true", default=False)
    parser.add_argument("--up-axis", choices=["X", "Y", "Z", "auto"], default="auto")
    args = parser.parse_args()

    print(f"Voxelizing {args.input} into {args.grid_size}x{args.grid_size}x{args.grid_size} grid...")
    grid, color_legend = voxelize_mesh(args.input, args.grid_size, args.hollow, args.up_axis)

    filled = sum(1 for layer in grid for row in layer for cell in row if cell != "0")
    total = args.grid_size ** 3
    print(f"Filled: {filled}/{total} voxels ({filled/total*100:.1f}%)")
    print(f"Colors used: {list(color_legend.keys())}")

    output = {"color_legend": color_legend, "grid": grid}
    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    with open(args.output, "w") as f:
        json.dump(output, f)
    print(f"Written to {args.output}")


if __name__ == "__main__":
    main()

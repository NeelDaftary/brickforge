# BrickForge v3 — Blender Geometry Nodes Pipeline Technical Build Plan

**Purpose:** This document is a complete, self-contained technical specification for building the BrickForge v3 voxel-to-LEGO pipeline. It is designed to be handed directly to Claude Code (or any AI coding agent) to implement from scratch.

**What this system does:** Takes any 3D model, voxelizes it using Blender's Geometry Nodes engine while preserving texture colors, maps colors to a 25-color LEGO palette via OKLCH perceptual matching, then runs a multi-stage optimization pipeline (shelling, interior wildcards, greedy meshing, structural staggering, stability checks) to produce a buildable LEGO set with a bill of materials, layer-by-layer build instructions, and an interactive 3D visualizer.

**What changed from v2:** The voxelization engine moved from Python trimesh raycasting to Blender Geometry Nodes. This produces higher-quality voxelization with native color transfer from UV-mapped textures. The "grid size" parameter was replaced by direct voxel size control (default: 0.06). A brick stability post-processing step was added.

---

## Table of Contents

1. [Project Structure](#1-project-structure)
2. [Color System](#2-color-system)
3. [Stage 1 — 3D Model Input & Blender Preparation](#3-stage-1--3d-model-input--blender-preparation)
4. [Stage 2 — Geometry Nodes Voxelization](#4-stage-2--geometry-nodes-voxelization)
5. [Stage 3 — Color Transfer](#5-stage-3--color-transfer)
6. [Stage 4 — Grid Extraction & Export](#6-stage-4--grid-extraction--export)
7. [Stage 5 — Brick Optimization Pipeline](#7-stage-5--brick-optimization-pipeline)
8. [Stage 5b — Brick Stability Post-Processing](#8-stage-5b--brick-stability-post-processing)
9. [Stage 6 — Output & Visualization](#9-stage-6--output--visualization)
10. [Data Schemas](#10-data-schemas)
11. [Standard LEGO Brick Catalog](#11-standard-lego-brick-catalog)
12. [Algorithm Pseudocode](#12-algorithm-pseudocode)
13. [What to Borrow from v2](#13-what-to-borrow-from-v2)
14. [What Needs to Be Rebuilt for v3](#14-what-needs-to-be-rebuilt-for-v3)
15. [Testing Strategy](#15-testing-strategy)
16. [CLI Interface](#16-cli-interface)
17. [Key Constraints & Edge Cases](#17-key-constraints--edge-cases)

---

## 1. Project Structure

```
brickforge/
├── scripts/
│   └── blender/
│       ├── voxelize_with_color.py        # ★ Core GN voxelizer (ALREADY BUILT)
│       ├── blender_voxel_to_grid.py      # ★ Bridge: GN cubes → grid JSON (NEW)
│       └── prep_mesh_for_voxelizer.py    # Bake LEGO colors into vertex attrs
│
├── lib/
│   ├── pipeline/
│   │   ├── run-voxel-pipeline.ts         # Pipeline orchestrator (REWRITE)
│   │   ├── voxel-to-bricks.ts            # ★ Brick optimizer (REUSE AS-IS)
│   │   ├── mesh-preflight.ts             # Format detection (MODIFY)
│   │   └── blender-service.ts            # Blender subprocess helpers
│   │
│   └── engine/
│       └── types.ts                      # BrickModelData, BrickInstance types (REUSE)
│
├── app/
│   ├── api/
│   │   ├── voxelize/route.ts             # Voxelization API endpoint (MODIFY)
│   │   └── upload/route.ts               # File upload endpoint (MODIFY)
│   └── page.tsx                          # Main UI
│
├── components/                           # React UI components (REUSE)
│
├── docs/
│   └── blender-voxelization-guide.md     # Step-by-step manual guide (ALREADY BUILT)
│
├── brickforge-pipeline/
│   └── src/
│       └── voxelizer.py                  # v2 trimesh voxelizer (REFERENCE ONLY — not used in v3)
│
└── tests/
    ├── lib/pipeline/
    │   ├── mesh-preflight.test.ts
    │   └── voxel-to-bricks.test.ts
    └── scripts/blender/
        └── test_blender_voxel_to_grid.py # Blender integration test (NEW)
```

**Key dependencies:**
- **Blender 3.6+** — Required for Geometry Nodes with Mesh to Volume support. Invoked as a subprocess.
- **Node.js / Next.js** — Web app and pipeline orchestration.
- **No trimesh dependency** — The v3 pipeline does NOT require Python trimesh. Blender handles all mesh operations.

**Architecture principle:** Blender does the heavy lifting (voxelization + color sampling), then outputs a simple JSON grid. Everything downstream (brick optimization, visualization, UI) is pure TypeScript with no Blender dependency.

---

## 2. Color System

The color system uses single-character codes. `"0"` is always empty. Letters are chosen to be mnemonic and avoid collisions.

```python
# 25-color LEGO palette — hex values are sRGB
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
```

### OKLCH Perceptual Color Matching

Colors are matched using OKLCH perceptual distance — NOT RGB Euclidean distance. This produces much more accurate color mapping for the human eye.

**Pipeline:** sRGB [0-1] → linear RGB (gamma decode) → Oklab (L, a, b) → OKLCH (Lightness, Chroma, Hue)

```python
def _srgb_to_linear(c: float) -> float:
    """sRGB gamma → linear."""
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

def _linear_rgb_to_oklab(r, g, b) -> (float, float, float):
    """Linear RGB → Oklab (L, a, b). Matrices from Björn Ottosson."""
    l_ = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b
    m_ = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b
    s_ = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b
    l = copysign(abs(l_) ** (1/3), l_) if l_ != 0 else 0.0
    m = copysign(abs(m_) ** (1/3), m_) if m_ != 0 else 0.0
    s = copysign(abs(s_) ** (1/3), s_) if s_ != 0 else 0.0
    L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s
    a = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s
    b_val = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s
    return (L, a, b_val)

def _oklab_to_oklch(L, a, b) -> (float, float, float):
    C = sqrt(a * a + b * b)
    h = degrees(atan2(b, a))
    if h < 0: h += 360.0
    return (L, C, h)
```

**Distance function** — weighted with chroma penalized more heavily:

```python
_W_L = 1.0   # lightness weight
_W_C = 1.5   # chroma weight (penalize saturation mismatches)
_W_H = 1.0   # hue weight

def _oklch_distance(a, b) -> float:
    dL = a[0] - b[0]
    dC = a[1] - b[1]
    avg_C = sqrt(a[1] * b[1])
    dh = a[2] - b[2]
    if dh > 180: dh -= 360
    if dh < -180: dh += 360
    dh_chord = 2 * avg_C * sin(radians(dh / 2))
    return sqrt(_W_L * dL * dL + _W_C * dC * dC + _W_H * dh_chord * dh_chord)
```

**Color space contract:** All color values entering `nearest_lego_color()` must be **sRGB [0-1]**, NOT linear RGB. The sRGB→linear conversion happens inside `_rgb_to_oklch()`. Blender stores colors in linear space, so a linear→sRGB conversion is needed when extracting colors from Blender.

```python
def _linear_to_srgb(c: float) -> float:
    """Linear → sRGB gamma."""
    if c <= 0.0031308:
        return 12.92 * c
    return 1.055 * (c ** (1.0 / 2.4)) - 0.055
```

---

## 3. Stage 1 — 3D Model Input & Blender Preparation

### 3.1 Input Methods

The pipeline accepts 3D models via:

1. **`.blend` file** (primary) — User provides a Blender file containing a textured mesh object. This is the native path and produces the best results.

2. **Imported mesh** — GLB, OBJ, STL, PLY files are imported into Blender first, then voxelized. The import step converts any format to a Blender mesh.

3. **AI-generated model** — Via Hyper3D Rodin or similar text-to-3D services (accessed via MCP), which produce a textured mesh that can be saved as `.blend` or exported as GLB.

### 3.2 Model Preparation Requirements

Before voxelization, the mesh must satisfy:

1. **Single mesh object** — All parts joined into one object (`Ctrl+J` in Blender). Multi-object scenes need to be joined first.

2. **Single material** — The color transfer chain expects one Image Texture through one UV map. Multi-material models should have their textures baked to a single atlas.

3. **Watertight surface** — The Mesh to Volume node requires a closed surface. Holes cause missing voxels. Use *Mesh > Clean Up > Fill Holes* or Remesh if needed.

4. **All modifiers applied** — Subdivision Surface, Mirror, Array etc. must be applied before the GN modifier is added.

5. **UV map present** — Named `"UVMap"` (Blender default). Required for the color transfer chain.

**Implementation:** `scripts/blender/voxelize_with_color.py` → `prepare_model()` handles validation and modifier application.

```python
def prepare_model(obj: bpy.types.Object) -> None:
    if obj.type != "MESH":
        raise ValueError(f"Object '{obj.name}' is not a mesh")
    bpy.context.view_layer.objects.active = obj
    for mod in list(obj.modifiers):
        if mod.type != "NODES":
            bpy.ops.object.modifier_apply(modifier=mod.name)
```

---

## 4. Stage 2 — Geometry Nodes Voxelization

This is the core innovation of v3. Instead of raycasting through a grid (v2), we use Blender's Geometry Nodes to natively convert a mesh into a grid of cube instances.

### 4.1 Voxel Size (Direct User Control)

**There is no "grid size" parameter.** The user sets the voxel size directly:

| Voxel Size | Detail    | Performance    | Use Case                        |
|-----------|-----------|----------------|---------------------------------|
| 0.15–0.2  | Low       | Very fast      | Quick preview, testing          |
| 0.08–0.1  | Medium    | Comfortable    | Standard builds                 |
| **0.06**  | **Default** | **Good balance** | **Recommended starting point** |
| 0.04–0.05 | High      | Slow           | Detailed models, final export   |
| < 0.03    | Very high | May crash      | Only small/simple models        |

Grid dimensions are derived automatically: `grid_size_axis = ceil(bounding_extent / voxel_size)`

**Warning:** Start with 0.06 or larger and decrease gradually. Very small values generate millions of cube instances and can freeze or crash Blender.

### 4.2 Node Graph

The Geometry Nodes tree consists of 4 core nodes plus 3 control nodes:

```
                                ┌─────────────────┐
                                │   Value (0.06)   │
                                └──┬──┬──┬──┬─────┘
                                   │  │  │  │
                      ┌────────────┘  │  │  └──────────────────┐
                      │  ┌────────────┘  └───────────┐         │
                      ▼  ▼                           ▼         ▼
                ┌─Combine XYZ─┐               ┌─Combine XYZ─┐ │
                │  (Spacing)  │               │ (Cube Size)  │ │
                └──────┬──────┘               └──────┬───────┘ │
                       │                             │         │
Group Input   ┌────────▼────────┐  ┌──────────▼──┐  │   ┌─────▼──────────┐
(Geometry) ──►│ Mesh to Volume  ├─►│ Dist Points  │  │   │                │
              │ Mode=Size       │  │ Mode=Grid    │  │   │                │
              │ Fill=Off        │  └──────┬───────┘  │   │                │
              │ ExtBand=0       │         │          │   │                │
              └─────────────────┘         ▼          │   │                │
                              ┌───────────────────┐  │   │  Cube         │
                              │ Instance on Points│◄─┘   │  Primitive    │
                              │                   │◄─────┘               │
                              └────────┬──────────┘                      │
                                       │                                 │
                                       ▼                                 │
                              Group Output (Geometry)                    │
```

### 4.3 Node Wiring Details

**Value node** (single float) drives ALL resolution controls:

| Target Node                    | Input               | Connection Type      |
|-------------------------------|----------------------|----------------------|
| Mesh to Volume                | Voxel Size           | Scalar (direct)      |
| Mesh to Volume                | Interior Band Width  | Scalar (direct)      |
| Distribute Points in Volume   | Spacing              | Vector (via Combine XYZ) |
| Cube                          | Size                 | Vector (via Combine XYZ) |

For the vector inputs, the Value output connects to all three (X, Y, Z) inputs of a Combine XYZ node, producing a uniform vector.

### 4.4 Node Settings

**Mesh to Volume:**
- Resolution Mode: **Size** (not "Amount")
- Fill Volume: **Off**
- Exterior Band Width: **0**

**Distribute Points in Volume:**
- Distribution Method: **Grid** (not "Random")

**Implementation:** `scripts/blender/voxelize_with_color.py` → `build_voxelizer(obj, voxel_size=0.06)`

---

## 5. Stage 3 — Color Transfer

This stage extends the GN tree so each voxel cube inherits the original model's texture color via UV sampling.

### 5.1 UV Sampling Chain

The following nodes are inserted between Instance on Points and Group Output:

```
Instance on Points
    ↓
Store Named Attribute ("UVMap", Vector, Instance domain)
    ↓
Set Material (original material)
    ↓
Group Output
```

Plus a sampling sub-chain:

```
Group Input (Geometry) ──► Sample Nearest (Face Corner domain)
                                 ▲                    ▲
Named Attribute ("UVMap") ──────┘    Position node ──┘
        ↓
Sample Index (Vector)
        ↓
Store Named Attribute [Value input]
```

### 5.2 Node Details

| Node                    | Type     | Key Settings                         |
|-------------------------|----------|--------------------------------------|
| Named Attribute         | Input    | Name="UVMap", Data Type=**Vector**   |
| Sample Nearest          | Geometry | Domain=**Face Corner**               |
| Position                | Input    | (no settings)                        |
| Sample Index            | Geometry | Data Type=**Vector**                 |
| Store Named Attribute   | Attribute| Name="UVMap", Type=**Vector**, Domain=**Instance** |
| Set Material            | Material | Select original material             |

### 5.3 Critical: Position → Sample Nearest Connection

**This is essential.** The `Position` node must be explicitly connected to `Sample Nearest [Sample Position]`.

Without this connection, finer voxel sizes (< 0.1) produce washed-out uniform colors because the default evaluation position is incorrect in the instance domain context. At voxel size 0.1 colors appear roughly correct, but at 0.06 and below they break completely.

```python
# CRITICAL: Explicit Position → Sample Position connection
position_node = tree.nodes.new("GeometryNodeInputPosition")
L.new(position_node.outputs[0], sample_nearest.inputs["Sample Position"])
```

### 5.4 Shader Editor Patch

The original material's shader reads UVs from the mesh, but voxel cubes are instances — they need to read UVs from the **instancer**.

1. Delete the UV Map node in the Shader Editor
2. Add an **Attribute** node
3. Set type to **"Instancer"**
4. Set Name to **"UVMap"** (must match Store Named Attribute exactly)
5. Connect: `Attribute [Vector]` → `Image Texture [Vector]`

**Implementation:** `scripts/blender/voxelize_with_color.py` → `add_color_transfer()` and `patch_shader_for_voxels()`

---

## 6. Stage 4 — Grid Extraction & Export

This is the **bridge** between Blender (Stages 2-3) and the TypeScript brick optimizer (Stage 5). It converts the Blender GN cube instances into the standard grid JSON format.

**This is a NEW script:** `scripts/blender/blender_voxel_to_grid.py`

### 6.1 Algorithm Overview

```
1. Receive: voxelized object (with GN modifier) + original mesh
2. Apply GN modifier → realize cube instances into real geometry
3. Extract cube centers via BMesh island detection
4. For each center, query original mesh via BVHTree.find_nearest()
5. Sample color at hit face (UV texture lookup or flat material color)
6. Convert linear RGB → sRGB
7. Match to nearest LEGO color via OKLCH distance
8. Map world positions to grid indices
9. Write JSON output
```

### 6.2 Cube Center Extraction

After applying the GN modifier, the mesh is a collection of disconnected cube primitives. Each cube has 8 vertices.

```python
import bmesh

bm = bmesh.new()
bm.from_mesh(obj.data)
bm.verts.ensure_lookup_table()

# Separate connected islands
islands = []  # list of lists of vertex positions
visited = set()

for v in bm.verts:
    if v.index in visited:
        continue
    # BFS to find all connected verts (one cube island)
    island_verts = []
    queue = [v]
    while queue:
        current = queue.pop()
        if current.index in visited:
            continue
        visited.add(current.index)
        island_verts.append(current.co.copy())
        for edge in current.link_edges:
            other = edge.other_vert(current)
            if other.index not in visited:
                queue.append(other)
    islands.append(island_verts)

# Each island is one cube → center = average of its 8 vertices
centers = []
for island in islands:
    cx = sum(v.x for v in island) / len(island)
    cy = sum(v.y for v in island) / len(island)
    cz = sum(v.z for v in island) / len(island)
    centers.append((cx, cy, cz))
```

### 6.3 Color Sampling

For each cube center, find the closest face on the original mesh and sample its color:

```python
from mathutils.bvhtree import BVHTree

# Build BVH from original mesh (before voxelization)
orig_bm = bmesh.new()
orig_bm.from_mesh(orig_obj.data)
bmesh.ops.triangulate(orig_bm, faces=orig_bm.faces)
bvh = BVHTree.FromBMesh(orig_bm)

for center in centers:
    location, normal, face_index, distance = bvh.find_nearest(center)
    if face_index is None:
        color = default_color
        continue

    # Sample color at the hit face
    face = orig_bm.faces[face_index]
    # ... UV lookup + texture sampling OR flat material color
    # ... linear RGB → sRGB conversion
    # ... OKLCH matching to nearest LEGO color
```

**UV Texture Sampling:** If the face has a UV map and the material has an Image Texture:
1. Get barycentric coordinates of the hit point within the face
2. Interpolate UVs from the face corner UVs using barycentric weights
3. Sample the image texture at the interpolated UV coordinate
4. Convert from linear RGB (Blender internal) to sRGB

**Flat Material Color:** If no texture, extract the Base Color from the Principled BSDF node.

### 6.4 World Position → Grid Index Mapping

Grid dimensions are derived from the cube positions (NOT from a user-specified grid size):

```python
# Find bounding box of all cube centers
min_pos = Vector((min(c[0] for c in centers),
                  min(c[1] for c in centers),
                  min(c[2] for c in centers)))
max_pos = Vector((max(c[0] for c in centers),
                  max(c[1] for c in centers),
                  max(c[2] for c in centers)))

# Grid dimensions
grid_x = round((max_pos.x - min_pos.x) / voxel_size) + 1
grid_y = round((max_pos.y - min_pos.y) / voxel_size) + 1
grid_z = round((max_pos.z - min_pos.z) / voxel_size) + 1

# Initialize empty grid
grid = [[["0" for _ in range(grid_z)] for _ in range(grid_y)] for _ in range(grid_x)]

# Place each voxel
for center, color_symbol in zip(centers, color_symbols):
    ix = round((center[0] - min_pos.x) / voxel_size)
    iy = round((center[1] - min_pos.y) / voxel_size)
    iz = round((center[2] - min_pos.z) / voxel_size)
    grid[ix][iy][iz] = color_symbol
```

### 6.5 Output Format

```json
{
    "color_legend": {
        "R": "#DB0000",
        "Y": "#FFD500",
        "O": "#FF7E14",
        "K": "#101010"
    },
    "grid": [
        [
            ["0", "R", "R", "0"],
            ["R", "Y", "Y", "R"],
            ...
        ],
        ...
    ]
}
```

- `grid[x][y][z]` — `"0"` for empty, single-character symbol for color
- `color_legend` — maps symbols to hex colors (only symbols actually used)
- Grid dimensions are implicit in the array shape

### 6.6 CLI

```bash
blender --background scene.blend --python scripts/blender/blender_voxel_to_grid.py -- \
    --object Pikachu \
    --voxel-size 0.06 \
    --output /tmp/pikachu_grid.json
```

If `--object` is omitted, auto-detect the first mesh object in the scene.

---

## 7. Stage 5 — Brick Optimization Pipeline

**This entire stage is REUSED from v2.** The TypeScript brick optimizer in `lib/pipeline/voxel-to-bricks.ts` operates on the grid JSON format and is completely independent of how the grid was produced.

### Pipeline Order (CRITICAL — do not reorder)

```
Grid JSON → Phase 0: Shelling
          → Phase 1: Greedy Meshing (with interior wildcards)
          → Phase 2: Structural Staggering
          → Phase 3: Convert to BrickModelData
          → Phase 3b: Stability Check (NEW, warn only)
```

### Phase 0: Shelling (Interior Removal)

A voxel is "interior" if ALL 6 face-neighbors (±X, ±Y, ±Z) are filled. Interior voxels are converted to wildcard symbol `"*"`, which can match any color during greedy meshing.

```typescript
// From voxel-to-bricks.ts
// For each filled voxel, check 6 neighbors
// If all 6 are filled → mark as wildcard "*"
// If any neighbor is empty or out-of-bounds → keep original color (shell voxel)
```

This allows the greedy mesher to merge interior voxels with any adjacent color, producing larger (more efficient) bricks inside the model.

### Phase 1: Greedy Meshing (Brick Consolidation)

Consolidates individual 1×1 voxels into standard LEGO brick footprints. This is the most complex algorithm.

**Scan direction alternates by layer for interlocking:**
- Even Z layers: scan X-first (bricks primarily along X axis)
- Odd Z layers: scan Y-first (bricks primarily along Y axis)

This creates a "running bond" pattern where joints don't align vertically.

```typescript
// Standard brick sizes, ordered by area (largest first) for greedy fitting
const STANDARD_BRICKS: [number, number][] = [
    [2, 8], [2, 6], [4, 4], [2, 4], [2, 3], [2, 2],
    [1, 4], [1, 3], [1, 2], [1, 1],
];

// For each unfilled voxel in scan order:
//   1. Get color (or wildcard "*")
//   2. Try each brick size from LARGEST to SMALLEST
//   3. Check if all covered voxels match color (wildcards match anything)
//   4. Place the first (largest) brick that fits
//   5. Mark covered voxels as "used"
```

### Phase 2: Structural Staggering

Reviews placed bricks and breaks up vertically aligned seams. If a brick joint at layer N aligns exactly with a joint at layer N-1, it may split one of the bricks to offset the seam.

### Phase 3: Convert to BrickModelData

Converts internal `PlacedBrick[]` representation to the `BrickModelData` format consumed by the Three.js viewer and UI components.

---

## 8. Stage 5b — Brick Stability Post-Processing

**NEW in v3.** After the brick optimization pipeline, run a structural integrity check.

### Rules

For each placed brick (skip ground-level z=0):

1. **Support check:** Count how many studs in the brick's footprint have a filled voxel directly below (z-1). Compute `support_ratio = supported_studs / total_studs`.

2. **Lock check:** Does any brick above (z+1) engage at least one stud of this brick?

3. **Stability classification:**
   - `support_ratio >= 0.5` → **Stable** (well supported from below)
   - `support_ratio < 0.5` but locked from above → **Marginal** (held in place by weight above)
   - `support_ratio < 0.5` and NOT locked → **Unstable** (may fall during physical build)

### Behavior: Warn Only

Unstable bricks are **reported in diagnostics/warnings** but NOT auto-fixed. This preserves intentional design features like wings, horns, antennas, and other overhangs.

Example warning output:
```
"warnings": [
    "12 bricks on layers 8-10 are unsupported — may fall during physical build",
    "3 cantilever bricks extend >4 studs past their support"
]
```

### Algorithm

```
FUNCTION check_stability(bricks: PlacedBrick[]) -> StabilityResult:
    unstable = []
    marginal = []

    // Build spatial lookup: (x, y, z) → brick_index
    voxel_map = {}
    FOR each brick:
        FOR each (x, y) in brick footprint:
            voxel_map[(x, y, brick.z)] = brick

    FOR each brick WHERE brick.z > 0:
        supported_studs = 0
        total_studs = brick.w * brick.d

        FOR each (x, y) in brick footprint:
            IF voxel_map contains (x, y, brick.z - 1):
                supported_studs += 1

        support_ratio = supported_studs / total_studs

        IF support_ratio < 0.5:
            // Check for lock from above
            locked = FALSE
            FOR each (x, y) in brick footprint:
                IF voxel_map contains (x, y, brick.z + 1):
                    locked = TRUE
                    BREAK

            IF locked:
                marginal.append(brick)
            ELSE:
                unstable.append(brick)

    RETURN StabilityResult(unstable, marginal)
```

---

## 9. Stage 6 — Output & Visualization

**REUSE from v2.** The output format and visualization are unchanged.

### 9.1 BrickModelData

The pipeline outputs a `BrickModelData` object containing:
- `bricks: BrickInstance[]` — position, size, color for each brick
- `totalBricks: number`
- `dimensions: { x, y, z }` — grid extent
- `name`, `description` — user-provided metadata
- `colorPalette: Record<string, string>` — hex colors used

### 9.2 Three.js Viewer

The existing React + Three.js viewer renders BrickModelData with:
- 3D interactive view with orbit controls
- Layer-by-layer build instructions (slider)
- Ghost mode for previously built layers
- Bill of materials sidebar
- Color palette legend

### 9.3 Bill of Materials

```json
{
    "total_bricks": 1533,
    "by_type": {
        "1×1": 823, "1×2": 44, "2×2": 310, "2×4": 48, ...
    },
    "by_color": {
        "#DB0000": { "1×1": 328, "2×2": 95, ... },
        ...
    }
}
```

---

## 10. Data Schemas

### VoxelGrid (TypeScript)

```typescript
interface VoxelGrid {
    grid: string[][][];                    // [x][y][z] — "0" = empty, letter = color
    colorLegend: Record<string, string>;   // symbol → hex color
    gridSize: number;                      // derived: max(dimX, dimY, dimZ)
}
```

**Note:** `gridSize` is derived from the actual grid dimensions, NOT user-specified.

### BrickInstance (TypeScript)

```typescript
interface BrickInstance {
    id: string;
    brickId: string;        // e.g. "b_2x4"
    position: Vector3;      // grid coordinates
    color: string;          // hex color
    rotation: number;       // 0 or 90
}
```

### BrickModelData (TypeScript)

```typescript
interface BrickModelData {
    id: string;
    name: string;
    description: string;
    dimensions: Vector3;
    totalBricks: number;
    bricks: BrickInstance[];
    colorPalette: Record<string, string>;
    voxelData?: VoxelData;
}
```

### Grid JSON (Python output)

```json
{
    "color_legend": { "R": "#DB0000", "Y": "#FFD500" },
    "grid": [[["0", "R", ...], ...], ...]
}
```

---

## 11. Standard LEGO Brick Catalog

These are the only brick sizes the greedy mesher may produce. Ordered by area descending for the greedy algorithm.

```typescript
const STANDARD_BRICKS: [number, number][] = [
    [2, 8],    // 16 studs
    [2, 6],    // 12 studs
    [4, 4],    // 16 studs (square)
    [2, 4],    // 8 studs — THE classic LEGO brick
    [2, 3],    // 6 studs
    [2, 2],    // 4 studs
    [1, 4],    // 4 studs
    [1, 3],    // 3 studs
    [1, 2],    // 2 studs
    [1, 1],    // 1 stud (fallback — always fits)
];
```

**BrickLink Part IDs** (for ordering real bricks):

| Size | Part ID |
|------|---------|
| 1×1  | 3005    |
| 1×2  | 3004    |
| 1×3  | 3622    |
| 1×4  | 3010    |
| 1×6  | 3009    |
| 1×8  | 3008    |
| 2×2  | 3003    |
| 2×3  | 3002    |
| 2×4  | 3001    |
| 2×6  | 2456    |
| 2×8  | 3007    |
| 4×4  | 3031    |

**Constraint:** Non-standard sizes (1×5, 2×5, 3×3, etc.) do NOT exist as standard bricks. The greedy mesher must NEVER produce them.

---

## 12. Algorithm Pseudocode

### 12.1 Full Pipeline Flow

```
FUNCTION run_pipeline(blend_file, object_name, voxel_size=0.06):

    // Stage 1: Prepare model in Blender
    obj = find_object(blend_file, object_name)
    prepare_model(obj)                              // validate + apply modifiers
    orig_mesh = duplicate(obj, "_BF_OrigMesh")      // keep for color sampling

    // Stage 2: Voxelize with Geometry Nodes
    mod = build_voxelizer(obj, voxel_size)          // from voxelize_with_color.py

    // Stage 3: Add color transfer (optional, for textured models)
    IF obj has UV map AND material with texture:
        add_color_transfer(mod.node_group, material_name)
        patch_shader_for_voxels(material_name)

    // Stage 4: Extract grid
    apply_modifier(obj, mod)                        // realize instances
    centers = extract_cube_centers(obj)             // BMesh island detection
    colors = sample_colors(centers, orig_mesh)      // BVHTree + OKLCH matching
    grid_json = build_grid(centers, colors, voxel_size)

    // Stages 5-5b: Brick optimization (TypeScript side)
    // grid_json is written to disk, then read by the TS pipeline:
    //   voxelGridToBrickModel(grid_json) → BrickModelData

    RETURN grid_json
```

### 12.2 Greedy Meshing (per layer)

```
FUNCTION greedy_mesh(grid, z_layer):
    used = empty set
    bricks = []

    // Alternating scan direction for interlocking
    IF z_layer is even:
        primary = X, secondary = Y
    ELSE:
        primary = Y, secondary = X

    FOR each (x, y) in scan order:
        IF (x, y, z) in used OR grid[x][y][z] == "0":
            CONTINUE

        color = grid[x][y][z]

        FOR each (bw, bd) in STANDARD_BRICKS:
            // Rotate for odd layers
            IF z_layer is odd:
                w, d = bd, bw
            ELSE:
                w, d = bw, bd

            // Check fit
            fits = TRUE
            FOR dx in 0..w-1, dy in 0..d-1:
                IF out_of_bounds(x+dx, y+dy) OR (x+dx, y+dy, z) in used:
                    fits = FALSE; BREAK
                cell = grid[x+dx][y+dy][z]
                IF cell != color AND cell != "*":
                    fits = FALSE; BREAK

            IF fits:
                mark_used(x, y, w, d, z)
                bricks.append(Brick(x, y, z, w, d, color))
                BREAK

    RETURN bricks
```

### 12.3 Connectivity Check

```
FUNCTION check_connectivity(bricks):
    // Build adjacency graph
    voxel_map = {}  // (x, y, z) → brick_index
    FOR i, brick in bricks:
        FOR (x, y) in brick.footprint:
            voxel_map[(x, y, brick.z)] = i

    adj = adjacency list for len(bricks) nodes
    FOR i, brick in bricks:
        FOR (x, y) in brick.footprint:
            below = voxel_map.get((x, y, brick.z - 1))
            above = voxel_map.get((x, y, brick.z + 1))
            IF below != None AND below != i: adj[i].add(below)
            IF above != None AND above != i: adj[i].add(above)

    // BFS from ground bricks
    min_z = min(b.z for b in bricks)
    roots = {i for i, b if b.z == min_z}
    visited = BFS(roots, adj)

    floating = [i for i not in visited]
    RETURN floating
```

---

## 13. What to Borrow from v2

These components are **proven and working** — reuse as-is or with minimal modification:

| Component | File | What it does | Reuse status |
|-----------|------|-------------|--------------|
| LEGO color palette | `voxelizer.py:43-69` | 25 colors, single-char symbols | Copy to new Blender script |
| OKLCH matching | `voxelizer.py:77-167` | Perceptual color distance | Copy to new Blender script |
| Brick optimizer | `voxel-to-bricks.ts` | Shelling, wildcards, greedy mesh, staggering | **Reuse as-is** |
| Grid JSON format | `voxelizer.py` output | `{color_legend, grid[x][y][z]}` | **Reuse as-is** |
| BrickModelData types | `lib/engine/types.ts` | TypeScript interfaces | **Reuse as-is** |
| Three.js viewer | `components/` | Interactive 3D brick display | **Reuse as-is** |
| API routes structure | `app/api/` | Next.js API endpoints | Modify for new pipeline |
| Brick catalog | `voxel-to-bricks.ts:23-31` | Standard sizes + BrickLink IDs | **Reuse as-is** |
| Greedy mesh algorithm | `voxel-to-bricks.ts` | Alternating scan + interlocking | **Reuse as-is** |
| Connectivity check | `voxel-to-bricks.ts` | BFS floating island detection | **Reuse as-is** |
| Color palette UI | `lib/lego/color-palette.ts` | Frontend color display | **Reuse as-is** |
| Monochrome detection | `run-voxel-pipeline.ts:93-100` | Warn if only achromatic colors | **Reuse as-is** |

---

## 14. What Needs to Be Rebuilt for v3

| Component | Why | Effort |
|-----------|-----|--------|
| **Voxelization engine** | Blender GN replaces trimesh raycasting | Already built (`voxelize_with_color.py`) |
| **Grid extraction bridge** | Convert GN cube instances → grid JSON | New script (`blender_voxel_to_grid.py`) |
| **Color extraction** | UV sampling chain replaces trimesh visual data parsing | Already built (color transfer nodes) |
| **Pipeline orchestration** | Blender subprocess instead of Python-only | Modify `run-voxel-pipeline.ts` |
| **Input handling** | `.blend` as primary format | Modify `mesh-preflight.ts` |
| **Voxel size UX** | Direct voxel size (no grid size) | Modify API routes + frontend |
| **Stability check** | New warn-only post-processing step | New code in `voxel-to-bricks.ts` or separate module |
| **Blender binary detection** | Find Blender installation, env var override | New helper function |

### Key New File: `scripts/blender/blender_voxel_to_grid.py`

This is the largest new piece of code. It:
1. Imports `build_voxelizer`, `prepare_model` from `voxelize_with_color.py`
2. Contains the LEGO palette + OKLCH algorithm (copied from `voxelizer.py`)
3. Implements cube center extraction via BMesh
4. Implements color sampling via BVHTree
5. Implements grid index mapping
6. Outputs the standard grid JSON

CLI:
```bash
blender --background file.blend --python blender_voxel_to_grid.py -- \
    --object Name --voxel-size 0.06 --output /tmp/grid.json
```

### Key Modified File: `lib/pipeline/run-voxel-pipeline.ts`

```typescript
// New Blender binary detection
function getBlenderBinary(): string {
    return process.env.BLENDER_PATH
        ?? '/Applications/Blender.app/Contents/MacOS/Blender';
}

// Pipeline options — voxelSize replaces gridSize
interface VoxelPipelineOptions {
    meshPath: string;
    voxelSize?: number;       // default 0.06 (was gridSize)
    objectName?: string;      // for .blend files
    name?: string;
    description?: string;
    shell?: boolean;
}

// Route based on format
async function runVoxelPipeline(options) {
    const preflight = await preflightMeshPath(options.meshPath);

    // Spawn Blender subprocess
    const args = [
        '--background', options.meshPath,
        '--python', blenderVoxelToGridScript,
        '--',
        '--voxel-size', String(options.voxelSize ?? 0.06),
        '--output', outputPath,
    ];
    if (options.objectName) {
        args.push('--object', options.objectName);
    }

    await execFileAsync(getBlenderBinary(), args, { timeout: 600000 });

    // Read grid JSON and pass to brick optimizer
    const gridJson = JSON.parse(await readFile(outputPath, 'utf8'));
    const voxelGrid = { grid: gridJson.grid, colorLegend: gridJson.color_legend, gridSize: ... };
    const model = voxelGridToBrickModel(voxelGrid, name, description, { shell });

    return { model, diagnostics: { pipeline: 'brickforge-v3-blender-gn', ... } };
}
```

---

## 15. Testing Strategy

### Unit Tests

| Test | Input | Expected |
|------|-------|----------|
| `test_shelling_solid_cube` | 5×5×5 solid grid | Only surface voxels remain |
| `test_greedy_mesh_single_row` | 1×8 same-color row | One 1×8 brick |
| `test_greedy_mesh_interlocking` | Two layers same color | Layer 0 X-aligned, layer 1 Y-aligned |
| `test_connectivity_solid` | Connected object | 0 floating islands |
| `test_connectivity_detached` | Two separate cubes | Detects floating island |
| `test_stability_supported` | Brick with 60% support | No warning |
| `test_stability_unstable` | Brick with 30% support, no lock | Warning flagged |
| `test_oklch_red` | sRGB(0.86, 0, 0) | Maps to "R" (#DB0000) |
| `test_oklch_orange` | sRGB(1.0, 0.5, 0.08) | Maps to "O" (#FF7E14) |

### Blender Integration Tests

**`scripts/blender/test_blender_voxel_to_grid.py`** — Runs inside Blender:

1. Programmatically create a colored cube (2×2×2 Blender units)
2. Run `build_voxelizer()` with voxel_size=0.5
3. Run grid extraction
4. Verify: grid is approximately 4×4×4, center voxels are filled, edges are empty
5. Verify: color symbols are valid (exist in LEGO palette)
6. Verify: JSON output is parseable

### End-to-End Tests

| Test | Input | Assertions |
|------|-------|-----------|
| `test_e2e_cube` | Simple colored cube .blend | Valid BrickModelData, correct colors |
| `test_e2e_textured` | UV-textured model .blend | Multiple colors in output, not monochrome |
| `test_e2e_voxel_size` | Same model at 0.1 vs 0.06 | Smaller size produces more bricks |
| `test_e2e_round_trip` | .blend → grid JSON → BrickModelData → viewer | No errors, valid render |

### Manual E2E Verification

1. Open Blender, generate model via Hyper3D Rodin (e.g., Squirtle)
2. Save as `.blend`
3. Run: `blender --background squirtle.blend --python blender_voxel_to_grid.py -- --voxel-size 0.06 --output /tmp/squirtle.json`
4. Verify JSON has reasonable grid dimensions and multiple colors
5. Upload to BrickForge web UI → verify 3D viewer renders correctly

---

## 16. CLI Interface

### Blender CLI (Voxelization)

```bash
# Full pipeline: .blend → grid JSON
blender --background scene.blend \
    --python scripts/blender/blender_voxel_to_grid.py -- \
    --object Pikachu \
    --voxel-size 0.06 \
    --output /tmp/pikachu_grid.json

# Just build GN voxelizer (view in Blender, no export)
blender scene.blend \
    --python scripts/blender/voxelize_with_color.py -- \
    --object Pikachu \
    --voxel-size 0.06

# Export voxelized mesh as GLB (for manual inspection)
blender --background scene.blend \
    --python scripts/blender/voxelize_with_color.py -- \
    --object Pikachu \
    --voxel-size 0.06 \
    --output /tmp/pikachu_voxelized.glb
```

### Web API

```bash
# Upload .blend file
curl -X POST http://localhost:3000/api/upload \
    -F "mesh=@squirtle.blend" \
    -F "voxelSize=0.06" \
    -F "objectName=Squirtle" \
    -F "name=Squirtle LEGO Build"

# Or provide pre-computed grid JSON
curl -X POST http://localhost:3000/api/voxelize \
    -H "Content-Type: application/json" \
    -d '{"voxelData": { "grid": [...], "colorLegend": {...} }, "name": "My Build"}'
```

---

## 17. Key Constraints & Edge Cases

### Must-Have Constraints

- **Only standard brick sizes.** Never produce non-standard sizes (3×3, 1×5, 2×5, etc.)
- **Single height per layer.** Each Z-layer = 1 brick height. No stacking plates.
- **Same-color bricks only.** A single brick cannot span two colors (wildcards excepted for interior).
- **Grid-aligned only.** No diagonal bricks, no rotation other than 0° and 90°.
- **Blender 3.6+ required.** Geometry Nodes Mesh to Volume is not available in older versions.
- **Stability warnings are advisory.** Do NOT auto-fix unstable bricks.

### Edge Cases

| Case | Behavior |
|------|----------|
| Model has no UV map | Fall back to flat material color (Principled BSDF Base Color) |
| Model has no material | Use default grey ("G") |
| Model has holes | Warn user; Mesh to Volume will produce incomplete volume |
| Voxel size too small (< 0.03) | Warn user; Blender may freeze |
| Object not found in .blend | Error with list of available objects |
| Very thin model (< 2 voxels thick) | May produce no interior, all shell — OK |
| Empty after voxelization | Error: "No voxels generated — check mesh is watertight" |
| Multiple objects in scene | Use `--object` to specify, or auto-select first mesh |
| Blender not installed | Error with installation instructions |
| Non-manifold mesh | Warn; results may be incomplete |

---

## Implementation Priority

**Phase 1 — Core Pipeline (get it working end-to-end):**
1. `blender_voxel_to_grid.py` — Bridge script (cube centers → grid JSON)
2. `run-voxel-pipeline.ts` — Blender subprocess orchestration
3. `mesh-preflight.ts` — Add `.blend` format support
4. API route updates — Pass voxelSize instead of gridSize

**Phase 2 — Stability & Polish:**
5. Brick stability post-processing (warn-only)
6. Improved color sampling (texture UV interpolation)
7. Error handling and user-friendly messages
8. Blender binary auto-detection (macOS, Linux, Windows paths)

**Phase 3 — Testing:**
9. Blender integration tests
10. End-to-end pipeline tests
11. Stability check unit tests

**Phase 4 — Frontend Updates:**
12. Replace "Grid Size" slider with "Voxel Size" input (default 0.06)
13. Add object name selector for `.blend` uploads
14. Display stability warnings in build viewer

---

*This plan is complete and self-contained. The voxelization engine (`voxelize_with_color.py`) and documentation (`blender-voxelization-guide.md`) are already built and tested. The main new work is the bridge script (`blender_voxel_to_grid.py`) and pipeline integration. All downstream brick optimization, visualization, and UI components are reused from v2.*

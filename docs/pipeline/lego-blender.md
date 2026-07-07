# BrickForge: External Blender Asset Preparation Reference

> **This is the reference for preparing externally generated or manually created Blender assets for BrickForge.**
> BrickForge no longer exposes an in-app text-to-3D generation API.
> All color values are derived from `lib/engine/color-palette.ts`.
> If any other doc contradicts this file, this file wins.

## Color Palette (sRGB)

These are the **exact** hex and sRGB float values. Do not approximate.
They match `COLOR_PALETTE` in `lib/engine/color-palette.ts` and
`LEGO_COLORS` in `brickforge-pipeline/src/voxelizer.py`.

| Name                | Hex     | sRGB float (0-1)           | Symbol |
|---------------------|---------|----------------------------|--------|
| White               | #FFFFFF | (1.000, 1.000, 1.000)      | W      |
| Tan                 | #D9BB7A | (0.851, 0.733, 0.478)      | T      |
| Yellow              | #FFD500 | (1.000, 0.835, 0.000)      | Y      |
| Orange              | #FF7E14 | (1.000, 0.494, 0.078)      | O      |
| Bright Light Orange | #F7BA30 | (0.969, 0.729, 0.188)      | A      |
| Red                 | #DB0000 | (0.859, 0.000, 0.000)      | R      |
| Bright Pink         | #FF5A7E | (1.000, 0.353, 0.494)      | P      |
| Dark Red            | #A1223B | (0.631, 0.133, 0.231)      | M      |
| Magenta             | #B11585 | (0.694, 0.082, 0.522)      | X      |
| Green               | #2DBE2D | (0.176, 0.745, 0.176)      | E      |
| Lime                | #A6CA1E | (0.651, 0.792, 0.118)      | L      |
| Dark Green          | #007B28 | (0.000, 0.482, 0.157)      | F      |
| Olive Green         | #7C8C3C | (0.486, 0.549, 0.235)      | J      |
| Sand Green          | #76A290 | (0.463, 0.635, 0.565)      | S      |
| Blue                | #0059CF | (0.000, 0.349, 0.812)      | B      |
| Medium Blue         | #1A85E0 | (0.102, 0.522, 0.878)      | C      |
| Dark Blue           | #003987 | (0.000, 0.224, 0.529)      | I      |
| Purple              | #8B1FA0 | (0.545, 0.122, 0.627)      | V      |
| Reddish Brown       | #6C3A20 | (0.424, 0.227, 0.125)      | H      |
| Brown               | #583927 | (0.345, 0.224, 0.153)      | N      |
| Dark Tan            | #897D62 | (0.537, 0.490, 0.384)      | Q      |
| Medium Nougat       | #E3A05B | (0.890, 0.627, 0.357)      | U      |
| Black               | #101010 | (0.063, 0.063, 0.063)      | K      |
| Light Grey          | #A0A5A9 | (0.627, 0.647, 0.663)      | G      |
| Dark Grey           | #5A5A5A | (0.353, 0.353, 0.353)      | D      |

**sRGB float values are computed as**: `int(hex_pair, 16) / 255.0`

## Pipeline Overview

```
External mesh source (manual Blender work, MCP tool, downloaded GLB, etc.)
    |
Import into Blender
    |
Create LEGO palette materials
    |
Sample texture -> assign LEGO materials to faces
    |
Strip textures + UVs
    |
Export GLB (with materials, no vertex color baking)
    |
Voxelizer reads PBR baseColorFactor per sub-mesh
```

---

## Step 1 — Bring A Mesh Into Blender

Use Blender directly, an external generation tool, or an existing GLB/OBJ/STL/PLY
asset. If an external tool produces a textured GLB, import it into Blender before
normalizing materials and exporting for BrickForge upload.

## Step 2 — Create LEGO Palette Materials

```python
import bpy

# Canonical LEGO palette — values from color-palette.ts
LEGO_COLORS = {
    "White":               (1.000, 1.000, 1.000),
    "Tan":                 (0.851, 0.733, 0.478),
    "Yellow":              (1.000, 0.835, 0.000),
    "Orange":              (1.000, 0.494, 0.078),
    "Bright_Light_Orange": (0.969, 0.729, 0.188),
    "Red":                 (0.859, 0.000, 0.000),
    "Bright_Pink":         (1.000, 0.353, 0.494),
    "Dark_Red":            (0.631, 0.133, 0.231),
    "Magenta":             (0.694, 0.082, 0.522),
    "Green":               (0.176, 0.745, 0.176),
    "Lime":                (0.651, 0.792, 0.118),
    "Dark_Green":          (0.000, 0.482, 0.157),
    "Olive_Green":         (0.486, 0.549, 0.235),
    "Sand_Green":          (0.463, 0.635, 0.565),
    "Blue":                (0.000, 0.349, 0.812),
    "Medium_Blue":         (0.102, 0.522, 0.878),
    "Dark_Blue":           (0.000, 0.224, 0.529),
    "Purple":              (0.545, 0.122, 0.627),
    "Reddish_Brown":       (0.424, 0.227, 0.125),
    "Brown":               (0.345, 0.224, 0.153),
    "Dark_Tan":            (0.537, 0.490, 0.384),
    "Medium_Nougat":       (0.890, 0.627, 0.357),
    "Black":               (0.063, 0.063, 0.063),
    "Light_Grey":          (0.627, 0.647, 0.663),
    "Dark_Grey":           (0.353, 0.353, 0.353),
}

for name, (r, g, b) in LEGO_COLORS.items():
    mat = bpy.data.materials.new(name=f"LEGO_{name}")
    mat.use_nodes = True
    mat.diffuse_color = (r, g, b, 1.0)
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = (r, g, b, 1.0)
        bsdf.inputs["Roughness"].default_value = 0.8
        bsdf.inputs["Metallic"].default_value = 0.0
```

## Step 3 — Replace Texture with LEGO Materials

Sample the Hyper3D texture at each face's UV centroid, map to the
nearest LEGO palette color, and assign the corresponding material.

```python
import bpy
import numpy as np

obj = bpy.data.objects["ModelName"]  # adjust to actual object name
mesh = obj.data

# Find diffuse texture on the existing Hyper3D material
img = None
for mat in mesh.materials:
    if mat and mat.use_nodes:
        for node in mat.node_tree.nodes:
            if node.type == 'TEX_IMAGE' and node.image:
                if 'diffuse' in node.image.name.lower() or 'color' in node.image.name.lower():
                    img = node.image
                    break
        if img:
            break

if img is None:
    raise ValueError("No diffuse texture found on model")

w, h = img.size
px = np.array(img.pixels[:]).reshape(h, w, 4)
uv_layer = mesh.uv_layers.active.data

# LEGO_COLORS dict must be defined (same as Step 2)
palette_names = list(LEGO_COLORS.keys())
palette_arr = np.array(list(LEGO_COLORS.values()))

# Clear existing materials, add LEGO materials to mesh
mesh.materials.clear()
mat_slot_map = {}
for name in palette_names:
    mat = bpy.data.materials.get(f"LEGO_{name}")
    mesh.materials.append(mat)
    mat_slot_map[name] = len(mesh.materials) - 1

# For each face: sample texture at UV centroid, assign nearest LEGO material
for poly in mesh.polygons:
    u_avg, v_avg = 0.0, 0.0
    for li in poly.loop_indices:
        uv = uv_layer[li].uv
        u_avg += uv[0]
        v_avg += uv[1]
    n = len(poly.loop_indices)
    u_avg /= n
    v_avg /= n

    ix = min(int((u_avg % 1.0) * w), w - 1)
    iy = min(int((v_avg % 1.0) * h), h - 1)
    sr, sg, sb = float(px[iy, ix, 0]), float(px[iy, ix, 1]), float(px[iy, ix, 2])

    # Nearest palette color (Euclidean is fine for snapping to 25 distinct colors)
    dists = np.sum((palette_arr - np.array([sr, sg, sb]))**2, axis=1)
    idx = int(np.argmin(dists))
    poly.material_index = mat_slot_map[palette_names[idx]]
```

## Step 4 — Clean Up and Export

Strip textures, UVs, and texture nodes. Apply transforms. Export GLB
with materials only.

```python
import bpy
import os

obj = bpy.data.objects["ModelName"]  # adjust to actual object name
mesh = obj.data

# Remove UV maps — they cause trimesh to read TextureVisuals
# instead of PBR material colors, which breaks the voxelizer.
while mesh.uv_layers:
    mesh.uv_layers.remove(mesh.uv_layers[0])

# Remove texture nodes from all materials
for mat in mesh.materials:
    if mat and mat.use_nodes:
        for node in list(mat.node_tree.nodes):
            if node.type in ('TEX_IMAGE', 'SEPARATE_COLOR', 'NORMAL_MAP'):
                mat.node_tree.nodes.remove(node)

# Apply transforms
bpy.ops.object.select_all(action='DESELECT')
obj.select_set(True)
bpy.context.view_layer.objects.active = obj
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

# Center at origin, bottom at Z=0
import mathutils
bbox = [obj.matrix_world @ mathutils.Vector(c) for c in obj.bound_box]
cx = (min(v.x for v in bbox) + max(v.x for v in bbox)) / 2
cy = (min(v.y for v in bbox) + max(v.y for v in bbox)) / 2
min_z = min(v.z for v in bbox)
for v in mesh.vertices:
    v.co.x -= cx
    v.co.y -= cy
    v.co.z -= min_z

# Export GLB with materials (NOT vertex colors)
export_path = "/tmp/brickforge_export.glb"
bpy.ops.export_scene.gltf(
    filepath=export_path,
    export_format='GLB',
    use_selection=True,
    export_apply=True,
    export_image_format='NONE',
)

print(f"Exported to {export_path}")
print(f"File size: {os.path.getsize(export_path) / 1024:.0f} KB")
```

---

## How the Voxelizer Reads These GLBs

The voxelizer (`brickforge-pipeline/src/voxelizer.py`) loads the GLB as a
`trimesh.Scene`. Each LEGO material becomes a separate glTF primitive.
trimesh loads each as a geometry with a `PBRMaterial` whose `main_color`
is the `baseColorFactor` in sRGB uint8.

Color extraction priority in the voxelizer:

1. **Vertex colors** (`mesh.visual.vertex_colors`) — if present and non-grey
2. **Texture sampling** (`mesh.visual.to_color()`) — if texture-mapped
3. **GLB scene PBR materials** — reads `baseColorFactor` per sub-mesh,
   maps each to nearest LEGO color, uses nearest-surface for voxel assignment
4. Grey fallback

For BrickForge Blender exports, **path 3 is the intended path**.

## Why NOT Vertex Color Baking

Blender's color attribute system has color-space footguns:

- `FLOAT_COLOR` stores linear internally. The GLB exporter may or may not
  convert back to sRGB depending on version and settings.
- `BYTE_COLOR` applies its own gamma curve.
- The result is that trimesh reads unpredictable sRGB values.
- On Scene concatenation, trimesh drops all visual data if it reads the
  mesh as `TextureVisuals` (caused by leftover UV maps).

Exporting with PBR materials side-steps all of this. Each material's
`baseColorFactor` is written as sRGB directly by the glTF exporter.

## Troubleshooting

**All grey / Dark Grey output (`{'D': 1595}`):**
The GLB has UV maps causing trimesh to read `TextureVisuals` instead of
material colors. On concatenation everything becomes grey. Fix: remove
all UV maps before export (Step 4).

**Wrong colors (purple instead of blue, etc.):**
Wrote sRGB values into FLOAT_COLOR, Blender stored as linear, exported
as linear, trimesh read as sRGB, OKLCH matched wrong color. Fix: don't
bake vertex colors. Use material-based export.

**Colors appear monochrome warning:**
Achromatic detection threshold (0.08) rejected all face colors.
Verify materials have actual LEGO palette colors, not Blender defaults.

**`to_color()` error in voxelizer:**
trimesh version incompatibility with texture sampling. The PBR material
path avoids this entirely — the texture path is a fallback for raw
GLBs that haven't been processed through Blender.

## What NOT to Do

- Do NOT bake vertex colors via `BYTE_COLOR` or `FLOAT_COLOR` attributes.
- Do NOT leave UV maps on the mesh when exporting with materials.
- Do NOT use `export_materials='NONE'` — this strips the PBR data.
- Do NOT use `export_colors='ACTIVE'` as the primary color path.
- Do NOT approximate palette sRGB values — use the exact table above.
- Do NOT use OBJ format. GLB only.
- Do NOT enable Draco compression — it corrupts vertex colors.

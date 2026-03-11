# BrickForge: Blender MCP Generation Spec

## Overview

This document defines the step-by-step sequence for generating a LEGO-ready
3D model via the Blender MCP tools and exporting it for voxelization.

The Blender MCP provides `execute_blender_code` which runs Python in Blender's
context. Each step below is a separate `execute_blender_code` call.

> **Color values must match `lego-blender.md` exactly.** That file is the
> single source of truth, derived from `lib/engine/color-palette.ts`.

## Generation Sequence

### Step 1: Clean Scene + Create LEGO Materials

Single script that clears the scene and creates all 25 LEGO palette materials.
Each material is named `LEGO_<ColorName>` (e.g., `LEGO_Red`, `LEGO_Blue`).

```python
import bpy

# Clean scene
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
for block in bpy.data.meshes:
    if block.users == 0:
        bpy.data.meshes.remove(block)
for block in bpy.data.materials:
    if block.users == 0:
        bpy.data.materials.remove(block)

# Create LEGO palette materials — exact sRGB values from color-palette.ts
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
        bsdf.inputs['Base Color'].default_value = (r, g, b, 1.0)
        bsdf.inputs['Roughness'].default_value = 0.8
        bsdf.inputs['Metallic'].default_value = 0.0
```

### Step 2: Generate Model Geometry

This is the creative step. The model must follow these rules:

**Geometry rules:**
- Low-poly, blocky shapes. Flat faces, sharp edges.
- No subdivisions, no smooth shading, no curves.
- All parts joined into a single mesh object.
- Centered at origin (0, 0, 0), resting on ground plane (lowest Z = 0).
- Largest dimension between 1-4 Blender units.
- Watertight / manifold (no holes, no non-manifold edges).

**Material assignment rules:**
- Use ONLY the `LEGO_*` materials created in Step 1.
- Assign materials per-face in Edit Mode, not per-object.
- Each face gets exactly one material.
- For multi-colored models, add multiple material slots and assign.

**Style guidance for the model prompt:**
- Think "what would this look like built from LEGO bricks?"
- Simplify details aggressively. A car is a box with a smaller box on top.
- Use flat faces where possible — the voxelizer converts everything to a grid.
- Avoid thin features (< 2 voxels wide). They disappear during voxelization.
- Avoid overhangs steeper than 45 degrees — they're hard to build with real bricks.

### Step 3: Apply Transforms + Verify

```python
import bpy

obj = bpy.context.active_object
if obj is None:
    for o in bpy.data.objects:
        if o.type == 'MESH':
            obj = o
            break

if obj:
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    # Verify mesh quality
    mesh = obj.data
    print(f"Object: {obj.name}")
    print(f"Vertices: {len(mesh.vertices)}")
    print(f"Faces: {len(mesh.polygons)}")
    print(f"Materials: {len(mesh.materials)}")
    for i, mat in enumerate(mesh.materials):
        print(f"  Slot {i}: {mat.name if mat else 'None'}")

    dims = obj.dimensions
    print(f"Dimensions: {dims.x:.3f} x {dims.y:.3f} x {dims.z:.3f}")
    print(f"Location: {obj.location.x:.3f}, {obj.location.y:.3f}, {obj.location.z:.3f}")
```

### Step 4: Clean Up and Export

Strip UV maps and texture nodes, then export GLB with PBR materials.
Do NOT bake vertex colors — use material-based export.

```python
import bpy
import os

obj = bpy.context.active_object
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

# Select and export
bpy.ops.object.select_all(action='DESELECT')
obj.select_set(True)
bpy.context.view_layer.objects.active = obj

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

### Step 5: Feed to BrickForge Pipeline

The exported `.glb` file is passed to the voxelization pipeline:
- Via file upload: user drops GLB on `/api/upload`
- Via MCP: pipeline reads from export path with `runVoxelPipeline({ meshPath })`

## Prompt Engineering for Model Generation

When generating the Blender Python code for Step 2, the prompt should
emphasize:

### Good prompt structure:
```
Create a [object] in Blender.

Style: Low-poly, blocky, LEGO-like. Flat faces, no smooth shading.
Think of how this would look as a LEGO set.

Colors: Use only the LEGO_* materials already in the scene.
  - [part]: LEGO_Red
  - [part]: LEGO_Blue
  - [part]: LEGO_White

Size: Largest dimension ~2 Blender units.
Position: Centered at origin, bottom at Z=0.
Mesh: Single watertight mesh, all transforms applied.
```

### Example — "Red house with blue roof":
```
Create a simple house in Blender.

Style: Low-poly, blocky, LEGO-like.
- Rectangular body (box shape, slightly wider than tall)
- Triangular prism roof on top
- Small rectangular door opening on front face
- Two small square windows on side faces

Colors:
  - Walls: LEGO_Red
  - Roof: LEGO_Blue
  - Door: LEGO_Dark_Grey
  - Windows: LEGO_Medium_Blue
  - Base/ground slab: LEGO_Green

Size: Body ~2 units wide, ~1.5 units deep, ~1.5 units tall.
       Roof adds ~0.8 units height.
Position: Centered at origin, bottom at Z=0.
Mesh: Single watertight mesh, all parts joined.
```

### Anti-patterns (what NOT to do):
- "Make it detailed" — produces curves and small features that vanish in voxelization
- "Use realistic materials" — textures and shaders don't carry through to voxels
- "Add windows with glass" — transparent materials have no meaning in brick form
- No color specification — Blender uses default grey, everything maps to Light Grey
- Using `BYTE_COLOR` or `FLOAT_COLOR` vertex attributes — color-space footguns
- Leaving UV maps on the mesh — causes trimesh to misread colors

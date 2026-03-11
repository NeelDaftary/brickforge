# BrickForge: Blender Export Specification

## Overview

This document defines how 3D models should be created in Blender and exported
for the BrickForge voxelization pipeline. Following this spec ensures accurate
color preservation and clean geometry for brick conversion.

> For Hyper3D → Blender → BrickForge workflows, see `lego-blender.md`
> (the authoritative reference). This doc covers general Blender export rules.

## Export Format: GLB (Binary glTF)

**Always export as `.glb`.** Do not use OBJ, PLY, STL, or FBX for the primary pipeline.

Why GLB:
- Single self-contained binary file (no companion .mtl files to lose)
- Each Principled BSDF material becomes a separate glTF primitive with `baseColorFactor`
- trimesh reads per-geometry PBR material colors reliably
- No color-space footguns (unlike vertex color baking)

## Blender Model Requirements

### Geometry

1. **Low-poly, blocky shapes.** Flat surfaces, sharp edges, minimal curves.
   Think Minecraft, not Pixar. The voxelizer samples a NxNxN grid — curved
   detail below voxel resolution is wasted geometry.

2. **Watertight mesh.** The voxelizer uses inside/outside testing. Open meshes,
   non-manifold edges, or holes cause voxels to leak. Run Mesh > Clean Up >
   Make Manifold before export.

3. **Single object.** Join all parts into one mesh (Ctrl+J). Multi-object
   scenes export correctly but add complexity. The voxelizer concatenates
   sub-meshes anyway.

4. **Applied transforms.** Apply location, rotation, and scale (Ctrl+A > All
   Transforms) before export. Un-applied transforms cause misaligned bounding
   boxes.

5. **Centered at origin, sitting on ground plane.** The model's lowest point
   should be at Z=0 and horizontally centered at the origin.

6. **Reasonable scale.** The model's largest dimension should be 1-4 Blender
   units. The voxelizer normalizes to a grid, but extreme scales can cause
   floating-point issues.

### Colors / Materials

1. **Use ONLY the 25 LEGO palette colors.** Each material's Principled BSDF
   Base Color must be one of these exact sRGB values:

   | Color               | Hex     | Symbol | sRGB (0-1)                |
   |---------------------|---------|--------|---------------------------|
   | White               | #FFFFFF | W      | (1.000, 1.000, 1.000)     |
   | Tan                 | #D9BB7A | T      | (0.851, 0.733, 0.478)     |
   | Yellow              | #FFD500 | Y      | (1.000, 0.835, 0.000)     |
   | Orange              | #FF7E14 | O      | (1.000, 0.494, 0.078)     |
   | Bright Light Orange | #F7BA30 | A      | (0.969, 0.729, 0.188)     |
   | Red                 | #DB0000 | R      | (0.859, 0.000, 0.000)     |
   | Bright Pink         | #FF5A7E | P      | (1.000, 0.353, 0.494)     |
   | Dark Red            | #A1223B | M      | (0.631, 0.133, 0.231)     |
   | Magenta             | #B11585 | X      | (0.694, 0.082, 0.522)     |
   | Green               | #2DBE2D | E      | (0.176, 0.745, 0.176)     |
   | Lime                | #A6CA1E | L      | (0.651, 0.792, 0.118)     |
   | Dark Green          | #007B28 | F      | (0.000, 0.482, 0.157)     |
   | Olive Green         | #7C8C3C | J      | (0.486, 0.549, 0.235)     |
   | Sand Green          | #76A290 | S      | (0.463, 0.635, 0.565)     |
   | Blue                | #0059CF | B      | (0.000, 0.349, 0.812)     |
   | Medium Blue         | #1A85E0 | C      | (0.102, 0.522, 0.878)     |
   | Dark Blue           | #003987 | I      | (0.000, 0.224, 0.529)     |
   | Purple              | #8B1FA0 | V      | (0.545, 0.122, 0.627)     |
   | Reddish Brown       | #6C3A20 | H      | (0.424, 0.227, 0.125)     |
   | Brown               | #583927 | N      | (0.345, 0.224, 0.153)     |
   | Dark Tan            | #897D62 | Q      | (0.537, 0.490, 0.384)     |
   | Medium Nougat       | #E3A05B | U      | (0.890, 0.627, 0.357)     |
   | Black               | #101010 | K      | (0.063, 0.063, 0.063)     |
   | Light Grey          | #A0A5A9 | G      | (0.627, 0.647, 0.663)     |
   | Dark Grey           | #5A5A5A | D      | (0.353, 0.353, 0.353)     |

2. **Color space: sRGB.** All hex values above are sRGB. The `baseColorFactor`
   in the exported glTF is written as sRGB by Blender's exporter. The voxelizer
   expects sRGB input for OKLCH palette matching.

3. **No textures, no gradients, no transparency.** Flat solid colors only.
   Remove all UV maps and texture image nodes before export. Leftover UVs cause
   trimesh to read `TextureVisuals` instead of PBR materials, which breaks
   color extraction.

4. **No emission, metallic, or subsurface.** Set Roughness to 0.8, Metallic
   to 0.0. These don't affect voxelization but keep the Blender viewport
   consistent with the final LEGO look.

5. **Assign materials to faces, not vertices.** Use Blender's material slot
   system. Select faces in Edit Mode, assign the appropriate LEGO material.

## Export Method: PBR Materials (Not Vertex Colors)

The correct export path uses **Principled BSDF materials**. Each material
becomes a separate glTF primitive whose `baseColorFactor` carries the color.

Do NOT bake vertex colors. Blender's `FLOAT_COLOR` / `BYTE_COLOR` attributes
have color-space issues that produce unpredictable sRGB values depending on
Blender version and settings.

### Export Code

```python
import bpy

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

# Export GLB with PBR materials (NOT vertex colors)
bpy.ops.export_scene.gltf(
    filepath="/tmp/model.glb",
    export_format='GLB',
    use_selection=True,
    export_apply=True,
    export_image_format='NONE',
)
```

### Prep Script (Complex Models)

For models that need color cleanup or material-index-to-LEGO mapping:

```bash
blender --background scene.blend --python scripts/blender/prep_mesh_for_voxelizer.py -- \
  --object MyModel \
  --mapping '{"0":"Red","1":"Blue","2":"White"}' \
  --output /tmp/model.glb \
  --format glb
```

## Blender MCP Integration

When generating models via the Blender MCP tools (`execute_blender_code`),
the pipeline should follow this sequence:

1. **Clean scene** — delete all objects and orphan data
2. **Create LEGO materials** — set up the 25 palette materials with Principled BSDF
3. **Generate model geometry** — build the mesh with proper materials assigned to faces
4. **Apply transforms** — `bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)`
5. **Verify watertight** — check `obj.data.is_manifold` or run repair
6. **Remove UV maps and texture nodes** — prevent TextureVisuals interference
7. **Export GLB** — with default material export settings

## How the Voxelizer Reads These GLBs

The voxelizer (`brickforge-pipeline/src/voxelizer.py`) loads the GLB as a
`trimesh.Scene`. Each LEGO material becomes a separate glTF primitive.
trimesh loads each as a geometry with a `PBRMaterial` whose `main_color`
is the `baseColorFactor` in sRGB uint8.

Color extraction priority:

1. **Vertex colors** (`mesh.visual.vertex_colors`) — if present and non-grey
2. **Texture sampling** (`mesh.visual.to_color()`) — if texture-mapped
3. **GLB scene PBR materials** — reads `baseColorFactor` per sub-mesh,
   maps each to nearest LEGO color via OKLCH distance
4. Grey fallback

For Blender exports following this spec, **path 3 is the intended path**.

## Troubleshooting

**All grey output**: Leftover UV maps cause trimesh to read `TextureVisuals`
instead of PBR material colors. On concatenation everything becomes grey.
Fix: remove all UV maps before export.

**Wrong colors (purple instead of blue, etc.)**: Used vertex color baking
(`FLOAT_COLOR`). Blender stored as linear, exported as linear, trimesh read
as sRGB, OKLCH matched wrong color. Fix: use PBR material export, not vertex
color baking.

**Colors appear monochrome warning**: Achromatic detection threshold (0.08)
rejected all face colors. Verify materials have actual LEGO palette colors,
not Blender defaults.

**Wrong colors at boundaries**: Using PLY instead of GLB. PLY averages colors
at shared vertices, corrupting boundaries between different-colored faces.

**Missing geometry**: Mesh not watertight. The inside/outside test fails for
open meshes. Check for non-manifold edges and fill holes.

**Mesh too small in grid**: Model scale too small relative to grid size.
Ensure the largest dimension is at least 1 Blender unit.

## What NOT to Do

- Do NOT bake vertex colors via `BYTE_COLOR` or `FLOAT_COLOR` attributes.
- Do NOT leave UV maps on the mesh when exporting with materials.
- Do NOT use `export_materials='NONE'` — this strips the PBR data.
- Do NOT use `export_colors='ACTIVE'` as the primary color path.
- Do NOT approximate palette sRGB values — use the exact table above.
- Do NOT use OBJ format. GLB only.
- Do NOT enable Draco compression — it corrupts vertex colors.

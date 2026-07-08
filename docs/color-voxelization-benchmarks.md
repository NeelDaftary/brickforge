# Color Voxelization Benchmarks

Date: 2026-07-09

## Purpose

Track whether Blender-side voxel export preserves source-object color well enough
for BrickForge builds.

The current strategy samples each voxel against the original mesh surface, maps
the sampled color to the nearest LEGO palette entry, and emits color diagnostics
with the voxel grid.

## Public Test Assets

Use tiny controlled GLB assets from Khronos glTF Sample Assets:

- `BoxTextured`: simple base-color texture path.
- `BoxVertexColors`: GLB `COLOR_0` / Blender color attributes.
- `TextureCoordinateTest`: UV coordinate stress case.
- `TextureEncodingTest`: texture color-space stress case.

Suggested cache location:

```bash
mkdir -p /tmp/brickforge-color-bench
curl -L -o /tmp/brickforge-color-bench/BoxTextured.glb \
  https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/BoxTextured/glTF-Binary/BoxTextured.glb
curl -L -o /tmp/brickforge-color-bench/BoxVertexColors.glb \
  https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/BoxVertexColors/glTF-Binary/BoxVertexColors.glb
curl -L -o /tmp/brickforge-color-bench/TextureCoordinateTest.glb \
  https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/TextureCoordinateTest/glTF-Binary/TextureCoordinateTest.glb
curl -L -o /tmp/brickforge-color-bench/TextureEncodingTest.glb \
  https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/TextureEncodingTest/glTF-Binary/TextureEncodingTest.glb
```

Run:

```bash
/Applications/Blender.app/Contents/MacOS/Blender --background \
  --python scripts/blender/blender_voxel_to_grid.py -- \
  --voxel-size 0.20 \
  --output /tmp/brickforge-color-bench/BoxVertexColors.json \
  --import /tmp/brickforge-color-bench/BoxVertexColors.glb
```

## Initial Findings

Before the first color fix:

- `BoxTextured` could select a non-mesh glTF node and crash before sampling.
- `BoxVertexColors` collapsed to all white because GLB vertex colors were not sampled.
- Existing `.blend` samples were generally non-monochrome, suggesting flat/material-slot
  `.blend` color is healthier than GLB edge cases.

After the first color fix:

| Asset | Source type | Result |
|---|---|---|
| BoxTextured | `pbr_texture` | Imports the actual mesh and produces multiple LEGO colors |
| BoxVertexColors | `vertex_color` | Preserves vertex color variation instead of all-white output |
| TextureEncodingTest | `pbr_texture` | Produces multi-color output with useful palette entropy |
| TextureCoordinateTest | `pbr_texture` | Still mostly white/black; keep as a UV/target-selection stress case |

## Open Work

- Add a stronger visible-color oracle by baking material base color/diffuse color
  inside Blender instead of manually walking shader graphs.
- Score source-color entropy before and after LEGO quantization.
- Add per-asset expected ranges for palette entropy and achromatic ratio.
- Include representative user `.blend` files once available.

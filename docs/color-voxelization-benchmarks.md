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

Audit source material readability without voxelizing:

```bash
/Applications/Blender.app/Contents/MacOS/Blender --background \
  --python scripts/blender/blender_voxel_to_grid.py -- \
  --color-audit-only \
  --color-audit-samples 128 \
  --output /tmp/brickforge-color-bench/BoxVertexColors-audit.json \
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

## Current Audit Baseline

Audit run: 2026-07-09, `--color-audit-samples 128`.

| Asset | Original -> effective source | Entropy | Achromatic ratio | Notes |
|---|---:|---:|---:|---|
| BoxTextured | `pbr_texture` -> `pbr_texture` | 1.5000 | 1.0000 | Reads Base Color texture; neutral texture maps to grey/tan/white |
| BoxVertexColors | `vertex_color` -> `vertex_color` | 3.2516 | 0.2500 | Uses mesh color attributes instead of flat material fallback |
| TextureCoordinateTest | `pbr_texture` -> `pbr_texture` | 0.8813 | 0.7000 | UV stress case, still low-diversity by design |
| TextureEncodingTest | `pbr_texture` -> `pbr_texture` | 1.8605 | 0.6641 | Flags image textures that are present but not Base Color-wired |
| pikachu.blend | `pbr_texture` -> `pbr_texture` | 1.3289 | 0.0938 | Dominant yellow with secondary palette detail |
| charmander2.blend | `flat_principled` -> `flat_principled` | 1.3805 | 0.0391 | Flat LEGO material slots produce expected orange/yellow palette |

## Fresh External Asset Check

Fresh CC0 GLBs from Poly Pizza / Quaternius were cached under
`/tmp/brickforge-color-bench/fresh-assets` and run on 2026-07-09.

Sources:

- `Mushroom`: `https://poly.pizza/m/db1tjMhmiA`
- `Star`: `https://poly.pizza/m/Tyau1aS2r0`
- `Pipe`: `https://poly.pizza/m/CpCnSuo786`
- `Yellow Box`: `https://poly.pizza/m/DDyKXPxxai`
- `Hoodie Character`: `https://poly.pizza/m/gKLBoRsyKe`
- `Worker`: `https://poly.pizza/m/Yg2bQZO6Hj`
- `Astronaut`: `https://poly.pizza/m/3hC2i0CTuO`

Findings after import transform normalization and flat-material name hints:

| Asset | Expected coarse palette | Audit result | Voxel result at `0.05` |
|---|---|---|---|
| Mushroom | white/red | white 64.5%, red 35.5% | white 54.4%, red 45.6% |
| Star | yellow | yellow 100.0% | yellow 100.0% |
| Pipe | green | green 100.0% | green 100.0% |
| Yellow Box | yellow/darker yellow | yellow 84.0%, bright light orange 16.0% | yellow 63.6%, bright light orange 36.4% |
| Hoodie Character | skin/purple/brown/blue/white | plausible multi-color audit | voxelizer still collapses to one cube |
| Worker | skin/brown/yellow/grey/black | plausible multi-color audit | voxelizer fails on evaluated mesh |
| Astronaut | brown/grey/dark grey | plausible multi-color audit | voxelizer fails on evaluated mesh |

The single-object external GLBs now provide useful end-to-end color checks.
The multi-part character GLBs expose a separate import/voxelizer robustness issue,
not a color-source detection failure.

## Open Work

- Add a stronger visible-color oracle by baking material base color/diffuse color
  inside Blender instead of manually walking shader graphs.
- Score source-color entropy before and after LEGO quantization.
- Add per-asset expected ranges for palette entropy and achromatic ratio.
- Include representative user `.blend` files once available.

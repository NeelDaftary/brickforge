# Mesh Input Spec (Voxelization)

> **See [blender-export-spec.md](./blender-export-spec.md) for the full Blender export specification.**
> **See [lego-blender.md](./lego-blender.md) for Hyper3D → Blender → BrickForge workflows.**

## Best Format: GLB

Use **GLB (Binary glTF)** with PBR materials as the primary export format.

Why GLB:
- Each Principled BSDF material becomes a separate glTF primitive with `baseColorFactor`
- trimesh reads per-geometry PBR material colors reliably
- Single self-contained file (no companion .mtl)
- No color-space issues (unlike vertex color baking)

## Supported Formats

| Format | Color Support | Recommended? |
|--------|--------------|-------------|
| `.glb` | PBR materials / vertex colors (COLOR_0) | **Yes** — primary format |
| `.ply` | Vertex colors (averaged) | Acceptable, but boundaries may blur |
| `.obj` | MTL Kd + extended vertex colors | Fallback only |
| `.stl` | None | Geometry only, no color |

## Export Checklist

1. Export as `.glb` with PBR materials (not vertex color baking)
2. Remove all UV maps and texture nodes before export
3. Apply all transforms before export
4. Mesh should be watertight / manifold
5. Colors should be from the 25-color LEGO palette
6. Single joined mesh object, centered at origin, bottom at Z=0

## Color Space

All colors in the BrickForge pipeline are **sRGB** from Blender export through
to voxelizer output. The only linear RGB conversion happens internally within
the OKLCH matching function (`_srgb_to_linear` inside `_rgb_to_oklch`).

PBR material `baseColorFactor` is written as sRGB by Blender's glTF exporter,
which is exactly what the voxelizer expects. No manual color-space conversion needed.

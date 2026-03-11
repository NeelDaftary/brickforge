# Mesh Input Spec (Voxelization)

> **See [blender-export-spec.md](./blender-export-spec.md) for the full Blender export specification.**
> **See [lego-blender.md](./lego-blender.md) for Hyper3D → Blender → BrickForge workflows.**

## Workflow Choice

There are **two valid intake workflows**:

- **Blender `.blend` workflow:** upload a `.blend` file. If it already has a
  Geometry Nodes voxelizer modifier, BrickForge will realize it. If not,
  BrickForge will add one automatically.
- **Raw mesh workflow:** upload a **GLB/OBJ/STL/PLY** file. BrickForge imports
  it into Blender and runs voxelization from raw mesh data.

## `.blend` Uploads

Upload any `.blend` file containing a mesh object. BrickForge will:
1. Auto-detect the largest mesh (or use the specified object name)
2. If a GN voxelizer modifier exists, realize its instances
3. If no GN modifier exists, add one using the upload voxel size
4. Sample colors from the original surface (textures or flat base colors)

For best color results, keep original materials on the mesh:
- Image texture + active UV map, or
- Flat Principled BSDF base color

## Best Non-Blender Format: GLB

Use **GLB (Binary glTF)** with PBR materials as the primary raw-mesh export format.

Why GLB:
- Each Principled BSDF material becomes a separate glTF primitive with `baseColorFactor`
- Single self-contained file (no companion `.mtl`)
- Good fit for raw mesh interchange into Blender before voxelization

## Supported Formats

| Format | Color Support | Recommended? |
|--------|--------------|-------------|
| `.blend` | Source materials + optional GN voxelizer | **Yes** — preferred for Blender-authored uploads |
| `.glb` | PBR materials / vertex colors (COLOR_0) | **Yes** — primary raw-mesh format |
| `.ply` | Vertex colors (averaged) | Acceptable, but boundaries may blur |
| `.obj` | MTL Kd + extended vertex colors | Fallback only |
| `.stl` | None | Geometry only, no color |

## Raw Mesh Export Checklist

1. Export as `.glb` with PBR materials (not vertex color baking)
2. Remove all UV maps and texture nodes before export
3. Apply all transforms before export
4. Mesh should be watertight / manifold
5. Colors should be from the 25-color LEGO palette
6. Single joined mesh object, centered at origin, bottom at Z=0

## Color Space

- For `.blend` uploads, Blender samples source colors in linear space
  during upload, and BrickForge matches those directly to the LEGO palette.
- For raw-mesh `GLB` uploads, material colors originate from exported sRGB/PBR
  data and are converted at the matcher boundary as needed.

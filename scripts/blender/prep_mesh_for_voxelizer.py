"""
Prepare a Blender mesh for BrickForge voxelization by baking LEGO palette colors
into mesh color attributes and exporting a material-free PLY/GLB.

Usage from Blender (example):
  blender --background scene.blend --python scripts/blender/prep_mesh_for_voxelizer.py -- \
    --object Charizard \
    --mapping '{"0":"Orange","1":"Yellow"}' \
    --output /tmp/charizard_ready.ply \
    --format ply
"""

import argparse
import json
import sys

import bpy


# sRGB hex values — must match color-palette.ts
_LEGO_HEX = {
    "White": "#FFFFFF", "Tan": "#D9BB7A", "Yellow": "#FFD500",
    "Orange": "#FF7E14", "Bright Light Orange": "#F7BA30",
    "Red": "#DB0000", "Bright Pink": "#FF5A7E",
    "Dark Red": "#A1223B", "Magenta": "#B11585",
    "Green": "#2DBE2D", "Lime": "#A6CA1E",
    "Dark Green": "#007B28", "Olive Green": "#7C8C3C", "Sand Green": "#76A290",
    "Blue": "#0059CF", "Medium Blue": "#1A85E0", "Dark Blue": "#003987",
    "Purple": "#8B1FA0",
    "Reddish Brown": "#6C3A20", "Brown": "#583927",
    "Dark Tan": "#897D62", "Medium Nougat": "#E3A05B",
    "Black": "#101010", "Light Grey": "#A0A5A9", "Dark Grey": "#5A5A5A",
}

def _hex_to_srgb(hex_str: str):
    """Convert hex to sRGB normalized RGBA tuple [0-1].

    No gamma conversion — values stay in sRGB space.
    The voxelizer expects sRGB input for OKLCH palette matching.
    """
    h = hex_str.lstrip("#")
    r, g, b = int(h[0:2], 16) / 255.0, int(h[2:4], 16) / 255.0, int(h[4:6], 16) / 255.0
    return (r, g, b, 1.0)

LEGO_PALETTE = {name: _hex_to_srgb(hx) for name, hx in _LEGO_HEX.items()}


def parse_args() -> argparse.Namespace:
    argv = sys.argv
    if "--" in argv:
        argv = argv[argv.index("--") + 1 :]
    else:
        argv = []

    parser = argparse.ArgumentParser(description="Bake LEGO colors into mesh and export PLY/GLB")
    parser.add_argument("--object", required=True, help="Object name in Blender")
    parser.add_argument(
        "--mapping",
        required=True,
        help='JSON dict mapping material index to LEGO color name, e.g. {"0":"Orange","1":"Yellow"}',
    )
    parser.add_argument("--output", required=True, help="Output path (.ply or .glb)")
    parser.add_argument("--format", choices=["ply", "glb"], default="glb", help="Export format (GLB recommended)")
    parser.add_argument("--default-color", default="Orange", help="Fallback LEGO color name")
    return parser.parse_args(argv)


def prep_mesh_for_voxelizer(
    obj_name: str,
    color_mapping: dict,
    export_path: str,
    export_format: str,
    default_color: str,
) -> None:
    obj = bpy.data.objects.get(obj_name)
    if obj is None:
        raise ValueError(f"Object not found: {obj_name}")
    if obj.type != "MESH":
        raise ValueError(f"Object is not a mesh: {obj_name}")

    mesh = obj.data
    color_attr = mesh.color_attributes.get("Lego_Voxel_Colors")
    if color_attr is None:
        color_attr = mesh.color_attributes.new(
            name="Lego_Voxel_Colors",
            type="FLOAT_COLOR",
            domain="CORNER",
        )

    mesh.color_attributes.active_color = color_attr
    mesh.color_attributes.render_color_index = mesh.color_attributes.find(color_attr.name)

    default_rgba = LEGO_PALETTE.get(default_color, (1.0, 1.0, 1.0, 1.0))
    for poly in mesh.polygons:
        lego_color_name = color_mapping.get(str(poly.material_index), default_color)
        target_rgba = LEGO_PALETTE.get(lego_color_name, default_rgba)
        for loop_index in poly.loop_indices:
            color_attr.data[loop_index].color = target_rgba

    # Remove materials so downstream stays color-attribute driven.
    mesh.materials.clear()

    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)

    if export_format == "glb":
        # Blender 5.0+ uses export_vertex_color, older uses export_colors
        gltf_kwargs = dict(
            filepath=export_path,
            export_format="GLB",
            use_selection=True,
            export_apply=True,
            export_materials="NONE",
        )
        if bpy.app.version >= (5, 0, 0):
            gltf_kwargs["export_vertex_color"] = "ACTIVE"
        else:
            gltf_kwargs["export_colors"] = "ACTIVE"
        bpy.ops.export_scene.gltf(**gltf_kwargs)
    else:
        # Blender API differs by version.
        if hasattr(bpy.ops.wm, "ply_export"):
            bpy.ops.wm.ply_export(
                filepath=export_path,
                export_selected_objects=True,
                export_colors="SRGB",
            )
        else:
            bpy.ops.export_mesh.ply(
                filepath=export_path,
                use_selection=True,
                use_colors=True,
            )

    print(f"[OK] Prepared '{obj_name}' for voxelizer export: {export_path}")


def main() -> None:
    args = parse_args()
    color_mapping = json.loads(args.mapping)
    prep_mesh_for_voxelizer(
        obj_name=args.object,
        color_mapping=color_mapping,
        export_path=args.output,
        export_format=args.format,
        default_color=args.default_color,
    )


if __name__ == "__main__":
    main()

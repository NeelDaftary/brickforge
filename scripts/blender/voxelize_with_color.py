"""
BrickForge — Voxelize a Blender mesh with color transfer using Geometry Nodes.

This script builds a complete Geometry Nodes setup that:
  1. Converts a mesh to a volume
  2. Distributes grid points within the volume
  3. Instances cubes at each point (voxelization)
  4. Transfers the original UV/material colors onto each voxel

The result is a voxelized version of the input object that preserves
the original texture colors — ready for export to the BrickForge pipeline.

Usage (Blender Python console or CLI):
  blender --background scene.blend --python scripts/blender/voxelize_with_color.py -- \
    --object Pikachu \
    --voxel-size 0.05 \
    --output /tmp/pikachu_voxelized.glb

Or call build_voxelizer() directly from another script / the MCP bridge.

Requirements:
  - Blender 3.6+ (Geometry Nodes with Mesh to Volume)
  - Input object should be a single mesh with one material
  - Apply all modifiers before running
  - Ensure the mesh has no major holes for best results
"""

import argparse
import sys
from typing import Optional

import bpy


# ---------------------------------------------------------------------------
# Step 1 — Model Preparation
# ---------------------------------------------------------------------------

def prepare_model(obj: bpy.types.Object) -> None:
    """Validate and prepare the target object for voxelization.

    Checks:
      - Object is a mesh
      - All modifiers are applied
      - Object is a single joined mesh

    Raises ValueError on unrecoverable issues.
    """
    if obj.type != "MESH":
        raise ValueError(f"Object '{obj.name}' is not a mesh (type={obj.type})")

    # Apply any pending modifiers (excluding the one we're about to add)
    bpy.context.view_layer.objects.active = obj
    for mod in list(obj.modifiers):
        if mod.type != "NODES":
            bpy.ops.object.modifier_apply(modifier=mod.name)


def remove_existing_brickforge_voxelizer(obj: bpy.types.Object) -> int:
    """Remove prior BrickForge voxelizer modifiers so prep can be re-run safely."""
    removed = 0
    for mod in list(obj.modifiers):
        node_group_name = mod.node_group.name if mod.type == "NODES" and mod.node_group else ""
        if mod.name == "BrickForge_Voxelizer" or node_group_name == "BF_Voxelizer":
            obj.modifiers.remove(mod)
            removed += 1
    return removed


# ---------------------------------------------------------------------------
# Step 2 & 3 — Build the Geometry Nodes voxelizer
# ---------------------------------------------------------------------------

def build_voxelizer(
    obj: bpy.types.Object,
    voxel_size: float = 0.05,
) -> bpy.types.NodesModifier:
    """Create a Geometry Nodes modifier that voxelizes *obj*.

    Node graph layout:

        Group Input ─► Mesh to Volume ─► Distribute Points in Volume ─► Instance on Points ─► ...
                                                                             ▲
                                                               Cube ─────────┘
        Value (voxel_size) ──► Voxel Size (Mesh to Volume)
                           ──► Interior Band Width (Mesh to Volume)
                           ──► Spacing (Distribute Points)  [via Combine XYZ]
                           ──► Size (Cube)                  [via Combine XYZ]

    Returns the modifier so callers can further adjust settings.
    """
    # --- modifier + node tree -------------------------------------------------
    mod = obj.modifiers.new(name="BrickForge_Voxelizer", type="NODES")
    tree = bpy.data.node_groups.new(name="BF_Voxelizer", type="GeometryNodeTree")
    mod.node_group = tree

    # Clear any auto-generated nodes
    for node in tree.nodes:
        tree.nodes.remove(node)

    # Interface sockets
    tree.interface.new_socket(name="Geometry", in_out="INPUT", socket_type="NodeSocketGeometry")
    tree.interface.new_socket(name="Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry")

    # --- create nodes ---------------------------------------------------------
    group_in = tree.nodes.new("NodeGroupInput")
    group_in.location = (-800, 0)

    group_out = tree.nodes.new("NodeGroupOutput")
    group_out.location = (1000, 0)

    # Mesh to Volume
    mesh_to_vol = tree.nodes.new("GeometryNodeMeshToVolume")
    mesh_to_vol.location = (-400, 0)
    mesh_to_vol.inputs["Resolution Mode"].default_value = "Size"

    # Distribute Points in Volume
    dist_pts = tree.nodes.new("GeometryNodeDistributePointsInVolume")
    dist_pts.location = (-100, 0)
    dist_pts.inputs["Mode"].default_value = "Grid"

    # Instance on Points
    inst_on_pts = tree.nodes.new("GeometryNodeInstanceOnPoints")
    inst_on_pts.location = (200, 0)

    # Cube primitive
    cube = tree.nodes.new("GeometryNodeMeshCube")
    cube.location = (0, -250)

    # Value node — single control for voxel resolution
    value = tree.nodes.new("ShaderNodeValue")
    value.location = (-800, -300)
    value.label = "Voxel Size"
    value.outputs[0].default_value = voxel_size

    # Combine XYZ helpers (Value → Vector for Spacing and Cube Size)
    combine_spacing = tree.nodes.new("ShaderNodeCombineXYZ")
    combine_spacing.location = (-550, -250)
    combine_spacing.label = "Spacing Vec"

    combine_cube = tree.nodes.new("ShaderNodeCombineXYZ")
    combine_cube.location = (-350, -350)
    combine_cube.label = "Cube Size Vec"

    # --- wiring ---------------------------------------------------------------
    L = tree.links

    # Main data chain
    L.new(group_in.outputs[0], mesh_to_vol.inputs["Mesh"])
    L.new(mesh_to_vol.outputs[0], dist_pts.inputs["Volume"])
    L.new(dist_pts.outputs[0], inst_on_pts.inputs["Points"])
    L.new(cube.outputs[0], inst_on_pts.inputs["Instance"])

    # Value → scalar inputs
    L.new(value.outputs[0], mesh_to_vol.inputs["Voxel Size"])
    L.new(value.outputs[0], mesh_to_vol.inputs["Interior Band Width"])

    # Value → vector inputs (via Combine XYZ)
    for comp in ("X", "Y", "Z"):
        L.new(value.outputs[0], combine_spacing.inputs[comp])
        L.new(value.outputs[0], combine_cube.inputs[comp])
    L.new(combine_spacing.outputs[0], dist_pts.inputs["Spacing"])
    L.new(combine_cube.outputs[0], cube.inputs["Size"])

    # Output — chain ends at Instance on Points for now;
    # color transfer nodes are appended below.
    # (temporary direct link; replaced if color transfer is added)
    L.new(inst_on_pts.outputs[0], group_out.inputs[0])

    return mod


# ---------------------------------------------------------------------------
# Step 4 — Color / UV Transfer
# ---------------------------------------------------------------------------

def add_color_transfer(
    tree: bpy.types.NodeGroup,
    material_name: Optional[str] = None,
) -> None:
    """Extend the voxelizer node tree with UV-based color transfer.

    Inserts these nodes between Instance on Points and Group Output:

        Instance on Points
            ↓
        Store Named Attribute ("UVMap", Vector, Instance domain)
            ↓
        Set Material (original material)
            ↓
        Group Output

    And a sampling sub-chain that reads the original UVMap:

        Group Input (Geometry) ─► Sample Nearest (Face Corner domain)
                                       ▲
        Named Attribute ("UVMap") ─────┘

    After applying, the user must also patch the Shader Editor:
      - Replace the UV Map node with an Attribute node
      - Set Attribute type to "Instancer"
      - Set Attribute name to "UVMap"
      - Connect Vector output → Image Texture Vector input

    This ensures each voxel cube samples the correct part of the texture.
    """
    # Find key existing nodes
    inst_on_pts = None
    group_in = None
    group_out = None
    for node in tree.nodes:
        if node.bl_idname == "GeometryNodeInstanceOnPoints":
            inst_on_pts = node
        elif node.type == "GROUP_INPUT":
            group_in = node
        elif node.type == "GROUP_OUTPUT":
            group_out = node

    if not all([inst_on_pts, group_in, group_out]):
        raise RuntimeError("Cannot find required nodes in the tree")

    L = tree.links

    # Remove existing link from inst_on_pts → group_out
    for link in list(tree.links):
        if link.from_node == inst_on_pts and link.to_node == group_out:
            tree.links.remove(link)

    # --- Named Attribute (reads original UVMap) --------------------------------
    named_attr = tree.nodes.new("GeometryNodeInputNamedAttribute")
    named_attr.location = (-100, -500)
    named_attr.inputs["Name"].default_value = "UVMap"
    # Set data type to Vector
    named_attr.data_type = "FLOAT_VECTOR"

    # --- Sample Nearest --------------------------------------------------------
    sample_nearest = tree.nodes.new("GeometryNodeSampleNearest")
    sample_nearest.location = (200, -450)
    sample_nearest.domain = "CORNER"  # Face Corner

    # Connect original geometry for sampling
    L.new(group_in.outputs[0], sample_nearest.inputs["Geometry"])

    # CRITICAL: Explicit Position → Sample Position connection.
    # Without this, finer voxel sizes (< 0.1) produce washed-out uniform
    # colors because the default evaluation position is incorrect in the
    # instance domain context.
    position_node = tree.nodes.new("GeometryNodeInputPosition")
    position_node.location = (0, -550)
    L.new(position_node.outputs[0], sample_nearest.inputs["Sample Position"])

    # --- Sample Index ----------------------------------------------------------
    sample_index = tree.nodes.new("GeometryNodeSampleIndex")
    sample_index.location = (400, -400)
    sample_index.data_type = "FLOAT_VECTOR"

    # Named Attribute value → Sample Index value
    L.new(named_attr.outputs["Attribute"], sample_index.inputs["Value"])
    # Original geometry → Sample Index geometry
    L.new(group_in.outputs[0], sample_index.inputs["Geometry"])
    # Sample Nearest index → Sample Index index
    L.new(sample_nearest.outputs["Index"], sample_index.inputs["Index"])

    # --- Store Named Attribute -------------------------------------------------
    store_attr = tree.nodes.new("GeometryNodeStoreNamedAttribute")
    store_attr.location = (600, 0)
    store_attr.data_type = "FLOAT_VECTOR"
    store_attr.domain = "INSTANCE"
    store_attr.inputs["Name"].default_value = "UVMap"

    # Instance on Points → Store Named Attribute (geometry)
    L.new(inst_on_pts.outputs[0], store_attr.inputs["Geometry"])
    # Sample Index value → Store Named Attribute value
    L.new(sample_index.outputs["Value"], store_attr.inputs["Value"])

    # --- Set Material ----------------------------------------------------------
    set_mat = tree.nodes.new("GeometryNodeSetMaterial")
    set_mat.location = (800, 0)

    if material_name:
        mat = bpy.data.materials.get(material_name)
        if mat:
            set_mat.inputs["Material"].default_value = mat

    # Store → Set Material → Group Output
    L.new(store_attr.outputs["Geometry"], set_mat.inputs["Geometry"])
    L.new(set_mat.outputs["Geometry"], group_out.inputs[0])


def patch_shader_for_voxels(material_name: str) -> None:
    """Patch the material's shader to read UVs from the Instancer attribute.

    Replaces any existing UV Map node with an Attribute node set to
    type=Instancer, name=UVMap, and wires it into the Image Texture.
    """
    mat = bpy.data.materials.get(material_name)
    if not mat or not mat.use_nodes:
        return

    tree = mat.node_tree

    # Find the Image Texture node
    img_tex = None
    for node in tree.nodes:
        if node.type == "TEX_IMAGE":
            img_tex = node
            break

    if not img_tex:
        return

    # Remove existing UV Map nodes
    for node in list(tree.nodes):
        if node.type == "UVMAP":
            tree.nodes.remove(node)

    # Add Attribute node
    attr_node = tree.nodes.new("ShaderNodeAttribute")
    attr_node.location = (img_tex.location.x - 300, img_tex.location.y)
    attr_node.attribute_type = "INSTANCER"
    attr_node.attribute_name = "UVMap"

    # Connect Vector → Image Texture Vector
    tree.links.new(attr_node.outputs["Vector"], img_tex.inputs["Vector"])


# ---------------------------------------------------------------------------
# Full pipeline
# ---------------------------------------------------------------------------

def voxelize_object(
    object_name: str,
    voxel_size: float = 0.05,
    with_color: bool = True,
) -> bpy.types.Object:
    """End-to-end voxelization of a named Blender object.

    Args:
        object_name: Name of the target mesh object.
        voxel_size: Edge length of each voxel cube (smaller = more detail).
                    WARNING: values below 0.03 on large meshes may cause
                    Blender to freeze or crash.
        with_color: If True, add UV color transfer nodes and patch the shader.

    Returns:
        The modified Blender object.
    """
    obj = bpy.data.objects.get(object_name)
    if obj is None:
        raise ValueError(f"Object not found: {object_name}")

    prepare_model(obj)
    removed = remove_existing_brickforge_voxelizer(obj)
    if removed:
        print(f"[LOG] Removed {removed} existing BrickForge voxelizer modifier(s) from '{obj.name}'")
    mod = build_voxelizer(obj, voxel_size=voxel_size)

    if with_color:
        mat_name = None
        if obj.data.materials:
            mat_name = obj.data.materials[0].name

        add_color_transfer(mod.node_group, material_name=mat_name)

        if mat_name:
            patch_shader_for_voxels(mat_name)

    return obj


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def parse_args() -> argparse.Namespace:
    argv = sys.argv
    if "--" in argv:
        argv = argv[argv.index("--") + 1:]
    else:
        argv = []

    parser = argparse.ArgumentParser(
        description="Voxelize a Blender mesh with color using Geometry Nodes"
    )
    parser.add_argument("--object", required=True, help="Object name in Blender")
    parser.add_argument(
        "--voxel-size", type=float, default=0.05,
        help="Voxel cube edge length (default: 0.05). Smaller = more detail but slower.",
    )
    parser.add_argument("--no-color", action="store_true", help="Skip UV color transfer")
    parser.add_argument("--output", help="Optional export path (.glb)")
    return parser.parse_args(argv)


def main() -> None:
    args = parse_args()
    obj = voxelize_object(
        object_name=args.object,
        voxel_size=args.voxel_size,
        with_color=not args.no_color,
    )

    if args.output:
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj

        # Apply the geometry nodes modifier so we export actual geometry
        for mod in list(obj.modifiers):
            if mod.type == "NODES":
                bpy.ops.object.modifier_apply(modifier=mod.name)

        bpy.ops.export_scene.gltf(
            filepath=args.output,
            export_format="GLB",
            use_selection=True,
            export_apply=True,
        )
        print(f"[OK] Exported voxelized '{obj.name}' to {args.output}")
    else:
        print(f"[OK] Voxelizer applied to '{obj.name}' — adjust in Blender viewport")


if __name__ == "__main__":
    main()

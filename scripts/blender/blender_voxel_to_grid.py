"""
BrickForge v3 — Bridge: Blender GN voxelizer → grid JSON.

Bridges the Blender Geometry Nodes voxelizer output to the grid JSON format
expected by the TypeScript brick optimizer.

Pipeline:
  1. Open .blend or import non-.blend mesh (GLB/OBJ/STL/PLY)
  2. Duplicate original mesh for color sampling
  3. Call voxelize_object() from voxelize_with_color.py (with_color=False)
  4. Apply GN modifier to realize cube instances
  5. Extract cube centers via BMesh island detection (BFS)
  6. Sample colors via BVHTree.find_nearest() on the original mesh copy
  7. Convert Blender linear RGB → OKLCH → nearest LEGO color
  8. Map world positions to grid indices
  9. Output {color_legend, grid[x][y][z]} JSON

Usage:
  # .blend file (object auto-detected or specified):
  blender --background scene.blend --python blender_voxel_to_grid.py -- \\
    --object MyMesh --voxel-size 0.06 --output /tmp/grid.json

  # Non-.blend file (imported into fresh Blender scene):
  blender --background --python blender_voxel_to_grid.py -- \\
    --import model.glb --voxel-size 0.06 --output /tmp/grid.json
"""

import argparse
import json
import os
import sys
from collections import deque
from typing import Dict, List, Optional, Tuple

import bpy
import bmesh
from mathutils import Vector
from mathutils.bvhtree import BVHTree

SCRIPTS_DIR = os.path.dirname(os.path.abspath(__file__))
if SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, SCRIPTS_DIR)

from color_quantization import (
    LEGO_COLORS,
    SYMBOL_TO_HEX,
    linear_rgb_to_nearest_lego_hex,
)


# ─── Import non-.blend files ─────────────────────────────────────────────────

def import_mesh_file(filepath: str) -> str:
    """Import a mesh file into Blender and return the imported object name."""
    ext = os.path.splitext(filepath)[1].lower()

    # Clear the default scene
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete()

    if ext == '.glb' or ext == '.gltf':
        bpy.ops.import_scene.gltf(filepath=filepath)
    elif ext == '.obj':
        bpy.ops.wm.obj_import(filepath=filepath)
    elif ext == '.stl':
        bpy.ops.wm.stl_import(filepath=filepath)
    elif ext == '.ply':
        bpy.ops.wm.ply_import(filepath=filepath)
    else:
        raise ValueError(f"Unsupported import format: {ext}")

    # Find all imported mesh objects
    mesh_objects = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']
    if not mesh_objects:
        raise ValueError(f"No mesh objects found after importing {filepath}")

    # If multiple objects, join them
    if len(mesh_objects) > 1:
        bpy.ops.object.select_all(action='DESELECT')
        for obj in mesh_objects:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = mesh_objects[0]
        bpy.ops.object.join()

    obj = bpy.context.view_layer.objects.active or mesh_objects[0]
    print(f"[LOG] Imported '{filepath}' as object '{obj.name}'")
    return obj.name


# ─── Determine target object ─────────────────────────────────────────────────

def find_target_object(object_name: Optional[str] = None) -> str:
    """Find the target mesh object in the scene."""
    if object_name:
        obj = bpy.data.objects.get(object_name)
        if obj and obj.type == 'MESH':
            return object_name
        raise ValueError(f"Object '{object_name}' not found or is not a mesh")

    # Auto-detect: pick the largest mesh object
    mesh_objects = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']
    if not mesh_objects:
        raise ValueError("No mesh objects found in scene")

    best = max(mesh_objects, key=lambda o: max(o.dimensions))
    print(f"[LOG] Auto-selected object '{best.name}' (largest mesh)")
    return best.name


# ─── BMesh island detection (BFS) ────────────────────────────────────────────

def extract_cube_centers(obj: bpy.types.Object) -> List[Vector]:
    """Extract cube centers from realized GN instances using BMesh BFS island detection.

    After applying the GN modifier, we have a single mesh where each former
    cube instance is a disconnected island of 8 vertices. We find each island
    via BFS over linked vertices and compute its center.
    """
    bm = bmesh.new()
    depsgraph = bpy.context.evaluated_depsgraph_get()
    obj_eval = obj.evaluated_get(depsgraph)
    bm.from_mesh(obj_eval.to_mesh())
    bm.verts.ensure_lookup_table()

    visited = set()
    centers = []
    world_matrix = obj.matrix_world

    for v in bm.verts:
        if v.index in visited:
            continue

        # BFS to find all vertices in this island
        island_verts = []
        queue = deque([v])
        visited.add(v.index)

        while queue:
            curr = queue.popleft()
            island_verts.append(curr.co.copy())
            for edge in curr.link_edges:
                other = edge.other_vert(curr)
                if other.index not in visited:
                    visited.add(other.index)
                    queue.append(other)

        # Compute island center (average of all vertices)
        if island_verts:
            center = sum(island_verts, Vector((0, 0, 0))) / len(island_verts)
            center = world_matrix @ center
            centers.append(center)

    bm.free()
    obj_eval.to_mesh_clear()

    print(f"[LOG] Extracted {len(centers)} cube centers from {len(bm.verts) if False else 'realized'} geometry")
    return centers


# ─── Color sampling ──────────────────────────────────────────────────────────

def sample_color_at_point(
    bvh: BVHTree,
    point: Vector,
    ref_mesh: bpy.types.Mesh,
    ref_obj: bpy.types.Object,
) -> str:
    """Sample color from the reference mesh at the given world point.

    Approach:
      1. If material has an Image Texture: compute barycentric coords on hit face,
         interpolate UVs, sample texture pixels.
      2. If no texture: use flat Base Color from Principled BSDF.
      3. If no material: default grey ("G").
    """
    # Transform point to local space of reference object
    local_point = ref_obj.matrix_world.inverted() @ point
    location, normal, face_index, distance = bvh.find_nearest(local_point)

    if face_index is None:
        return "G"

    mesh = ref_mesh
    face = mesh.polygons[face_index]

    # Get material for this face
    mat = None
    if mesh.materials and face.material_index < len(mesh.materials):
        mat = mesh.materials[face.material_index]

    if mat is None or not mat.use_nodes:
        return "G"

    # Try to find Image Texture node connected to Principled BSDF
    principled = None
    img_tex = None
    for node in mat.node_tree.nodes:
        if node.type == 'BSDF_PRINCIPLED':
            principled = node
        elif node.type == 'TEX_IMAGE' and node.image:
            img_tex = node

    # Path 1: Texture sampling via barycentric UV interpolation
    if img_tex and img_tex.image and mesh.uv_layers.active:
        uv_layer = mesh.uv_layers.active.data
        loop_indices = face.loop_indices
        verts = [mesh.vertices[mesh.loops[li].vertex_index].co for li in loop_indices]
        uvs = [uv_layer[li].uv for li in loop_indices]

        # Compute barycentric coordinates of the hit point
        bary = _barycentric_coords(location, verts)
        if bary is not None:
            # Interpolate UV
            u = sum(b * uv.x for b, uv in zip(bary, uvs))
            v = sum(b * uv.y for b, uv in zip(bary, uvs))

            # Sample the texture
            image = img_tex.image
            px = int(u * image.size[0]) % image.size[0]
            py = int(v * image.size[1]) % image.size[1]
            pixels = image.pixels
            stride = image.channels
            idx = (py * image.size[0] + px) * stride

            if idx + 2 < len(pixels):
                # Blender image pixels are already linear, so quantize directly
                # instead of round-tripping through sRGB before OKLCH matching.
                r_lin, g_lin, b_lin = pixels[idx], pixels[idx + 1], pixels[idx + 2]
                return linear_rgb_to_nearest_lego_hex((r_lin, g_lin, b_lin))

    # Path 2: Flat Base Color from Principled BSDF
    if principled:
        base_color_input = principled.inputs.get("Base Color")
        if base_color_input and not base_color_input.is_linked:
            rgba = base_color_input.default_value
            # Principled BSDF Base Color default_value is in linear space.
            return linear_rgb_to_nearest_lego_hex((rgba[0], rgba[1], rgba[2]))

    return "G"


def _barycentric_coords(
    point: Vector,
    verts: List[Vector],
) -> Optional[List[float]]:
    """Compute barycentric coordinates for a point on a polygon.

    For triangles, uses standard barycentric math.
    For quads/ngons, uses the first triangle that contains the point,
    with remaining weight distributed to other vertices.
    """
    if len(verts) < 3:
        return None

    # For triangles
    if len(verts) == 3:
        return _bary_triangle(point, verts[0], verts[1], verts[2])

    # For quads/ngons: triangulate from vertex 0 and find the triangle
    # that gives valid barycentric coords
    for i in range(1, len(verts) - 1):
        bary = _bary_triangle(point, verts[0], verts[i], verts[i + 1])
        if bary is not None and all(b >= -0.01 for b in bary):
            # Map back to polygon vertex indices
            result = [0.0] * len(verts)
            result[0] = bary[0]
            result[i] = bary[1]
            result[i + 1] = bary[2]
            return result

    # Fallback: equal weights
    n = len(verts)
    return [1.0 / n] * n


def _bary_triangle(
    p: Vector, a: Vector, b: Vector, c: Vector,
) -> Optional[List[float]]:
    """Barycentric coordinates of point p in triangle (a, b, c)."""
    v0 = c - a
    v1 = b - a
    v2 = p - a

    dot00 = v0.dot(v0)
    dot01 = v0.dot(v1)
    dot02 = v0.dot(v2)
    dot11 = v1.dot(v1)
    dot12 = v1.dot(v2)

    denom = dot00 * dot11 - dot01 * dot01
    if abs(denom) < 1e-10:
        return None

    inv_denom = 1.0 / denom
    u = (dot11 * dot02 - dot01 * dot12) * inv_denom
    v = (dot00 * dot12 - dot01 * dot02) * inv_denom
    w = 1.0 - u - v

    return [w, v, u]


# ─── Grid construction ───────────────────────────────────────────────────────

def build_grid(
    centers: List[Vector],
    colors: List[str],
    voxel_size: float,
) -> Tuple[List[List[List[str]]], Dict[str, str]]:
    """Convert world-space cube centers + colors into a [x][y][z] grid.

    Returns (grid, color_legend).
    """
    if not centers:
        raise ValueError("No voxel centers found — mesh may be empty or too small")

    # Find bounding box
    min_x = min(c.x for c in centers)
    min_y = min(c.y for c in centers)
    min_z = min(c.z for c in centers)

    # Map world positions to grid indices
    grid_points: List[Tuple[int, int, int, str]] = []
    for center, color in zip(centers, colors):
        gx = round((center.x - min_x) / voxel_size)
        gy = round((center.y - min_y) / voxel_size)
        gz = round((center.z - min_z) / voxel_size)
        grid_points.append((gx, gy, gz, color))

    # Determine grid dimensions
    max_gx = max(p[0] for p in grid_points) + 1
    max_gy = max(p[1] for p in grid_points) + 1
    max_gz = max(p[2] for p in grid_points) + 1

    # Build 3D grid [x][y][z]
    grid: List[List[List[str]]] = []
    for x in range(max_gx):
        plane: List[List[str]] = []
        for y in range(max_gy):
            col: List[str] = ["0"] * max_gz
            plane.append(col)
        grid.append(plane)

    # Fill grid with color symbols
    for gx, gy, gz, color in grid_points:
        symbol = LEGO_COLORS.get(color, "G")
        grid[gx][gy][gz] = symbol

    # Build color legend (only used symbols)
    used_symbols = set()
    for plane in grid:
        for row in plane:
            for cell in row:
                if cell != "0":
                    used_symbols.add(cell)

    color_legend = {sym: SYMBOL_TO_HEX[sym] for sym in used_symbols if sym in SYMBOL_TO_HEX}

    print(f"[LOG] Grid dimensions: {max_gx} x {max_gy} x {max_gz} = [x][y][z]")
    print(f"[LOG] Total voxels: {len(grid_points)}, colors used: {list(color_legend.keys())}")

    return grid, color_legend


# ─── Realize GN instances helper ─────────────────────────────────────────────

def _realize_gn_modifier(obj: bpy.types.Object) -> None:
    """Inject a Realize Instances node into each GN modifier and apply it.

    GN voxelizers output cube instances. Blender can't apply a modifier whose
    evaluated geometry is instances — we must realize them first.
    """
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj

    for mod in list(obj.modifiers):
        if mod.type != 'NODES' or not mod.node_group:
            continue
        tree = mod.node_group
        group_out = None
        for node in tree.nodes:
            if node.type == 'GROUP_OUTPUT':
                group_out = node
                break
        if group_out:
            for link in list(tree.links):
                if link.to_node == group_out and link.to_socket.type == 'GEOMETRY':
                    src_socket = link.from_socket
                    tree.links.remove(link)
                    realize = tree.nodes.new('GeometryNodeRealizeInstances')
                    realize.location = (group_out.location.x - 200, group_out.location.y)
                    tree.links.new(src_socket, realize.inputs[0])
                    tree.links.new(realize.outputs[0], group_out.inputs[0])
                    print(f"[LOG] Injected Realize Instances into '{mod.name}'")
                    break
        bpy.ops.object.modifier_apply(modifier=mod.name)


# ─── Create color-reference copy ─────────────────────────────────────────────

def _make_color_ref(obj: bpy.types.Object) -> bpy.types.Object:
    """Duplicate the object, strip GN modifiers, and return a clean mesh for color sampling."""
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.duplicate()
    ref_obj = bpy.context.active_object
    ref_obj.name = f"{obj.name}_color_ref"

    # Remove GN modifiers — we want the original surface, not voxels.
    # Apply other modifiers (Subdivision, Mirror, etc.) so the mesh is baked.
    for mod in list(ref_obj.modifiers):
        if mod.type == 'NODES':
            ref_obj.modifiers.remove(mod)
        else:
            try:
                bpy.ops.object.modifier_apply(modifier=mod.name)
            except RuntimeError:
                ref_obj.modifiers.remove(mod)

    print(f"[LOG] Created color reference '{ref_obj.name}'")
    return ref_obj


# ─── Main pipeline ───────────────────────────────────────────────────────────

def run_pipeline(
    object_name: str,
    voxel_size: float,
    output_path: str,
    already_voxelized: bool = False,
) -> None:
    """Full pipeline: (optionally voxelize) → extract centers → sample colors → output JSON.

    Args:
        object_name: Target Blender object name.
        voxel_size: Cube edge length — used for grid mapping and (if needed) voxelization.
        output_path: Where to write the grid JSON.
        already_voxelized: If True, the object already has a GN voxelizer modifier
                           (typical for .blend files). Skip running the voxelizer.
    """
    obj = bpy.data.objects.get(object_name)
    if obj is None:
        raise ValueError(f"Object not found: {object_name}")

    # Step 1: Create a clean copy for color sampling (before we touch modifiers)
    ref_obj = _make_color_ref(obj)
    ref_mesh = ref_obj.data
    bvh = BVHTree.FromObject(ref_obj, bpy.context.evaluated_depsgraph_get())

    # Step 2: Get a voxelized mesh
    obj = bpy.data.objects.get(object_name)

    has_gn = any(m.type == 'NODES' for m in obj.modifiers)

    if already_voxelized and has_gn:
        # .blend path with existing GN voxelizer — realize instances.
        print(f"[LOG] .blend path — realizing existing GN voxelizer on '{object_name}'")
        _realize_gn_modifier(obj)
    else:
        # Import path — run the voxelizer ourselves.
        # Remove any stale GN modifiers first.
        bpy.ops.object.select_all(action='DESELECT')
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        for mod in list(obj.modifiers):
            if mod.type == 'NODES':
                obj.modifiers.remove(mod)

        from voxelize_with_color import voxelize_object

        voxelize_object(object_name=object_name, voxel_size=voxel_size, with_color=False)
        print(f"[LOG] GN voxelizer applied to '{object_name}'")

        # Re-fetch and realize
        obj = bpy.data.objects.get(object_name)
        _realize_gn_modifier(obj)

    print(f"[LOG] Realized GN instances on '{object_name}'")

    # Step 3: Extract cube centers via BMesh island detection
    obj = bpy.data.objects.get(object_name)
    centers = extract_cube_centers(obj)
    print(f"[LOG] Found {len(centers)} voxel cubes")

    if len(centers) == 0:
        raise ValueError("No voxel cubes found — the GN modifier may not have produced geometry")

    # Step 4: Sample colors from reference mesh
    print(f"[LOG] Sampling colors from '{ref_obj.name}'...")
    colors: List[str] = []
    for i, center in enumerate(centers):
        color_hex = sample_color_at_point(bvh, center, ref_mesh, ref_obj)
        colors.append(color_hex)
        if (i + 1) % 500 == 0:
            print(f"[LOG] Sampled {i + 1}/{len(centers)} colors...")

    # Count color distribution
    color_dist: Dict[str, int] = {}
    for c in colors:
        sym = LEGO_COLORS.get(c, "G")
        color_dist[sym] = color_dist.get(sym, 0) + 1
    print(f"[LOG] Color distribution: {color_dist}")

    # Step 5: Build grid
    grid, color_legend = build_grid(centers, colors, voxel_size)

    # Step 6: Write output JSON
    output = {"color_legend": color_legend, "grid": grid}
    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    with open(output_path, "w") as f:
        json.dump(output, f)

    print(f"[OK] Grid written to {output_path}")

    # Cleanup reference object
    bpy.data.objects.remove(ref_obj, do_unlink=True)


# ─── CLI ─────────────────────────────────────────────────────────────────────

def parse_args() -> argparse.Namespace:
    argv = sys.argv
    if "--" in argv:
        argv = argv[argv.index("--") + 1:]
    else:
        argv = []

    parser = argparse.ArgumentParser(
        description="BrickForge v3: Blender GN voxelizer → grid JSON"
    )
    parser.add_argument("--object", help="Object name in Blender scene")
    parser.add_argument("--import", dest="import_path", help="Import mesh file (GLB/OBJ/STL/PLY)")
    parser.add_argument(
        "--voxel-size", type=float, default=0.06,
        help="Voxel cube edge length (default: 0.06)",
    )
    parser.add_argument("--output", required=True, help="Output JSON path")
    return parser.parse_args(argv)


def main() -> None:
    args = parse_args()

    # Import non-.blend file if requested
    if args.import_path:
        obj_name = import_mesh_file(args.import_path)
        already_voxelized = False
    else:
        # .blend file — object should already have GN voxelizer applied
        obj_name = find_target_object(args.object)
        already_voxelized = True

    print(f"[LOG] Target: '{obj_name}', voxel_size={args.voxel_size}, already_voxelized={already_voxelized}")

    run_pipeline(
        object_name=obj_name,
        voxel_size=args.voxel_size,
        output_path=args.output,
        already_voxelized=already_voxelized,
    )


if __name__ == "__main__":
    main()

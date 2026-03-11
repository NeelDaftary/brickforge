/**
 * Blender Service: Handles interaction with Blender MCP for generating
 * and exporting 3D models. This module defines the pipeline steps that
 * will be called from the API route (server-side) or orchestrated
 * via the Blender MCP tools.
 *
 * Since Blender MCP is invoked via Claude's tool system (not HTTP),
 * this module provides the Blender Python scripts that should be
 * executed via execute_blender_code, and the export logic.
 */

import { COLOR_PALETTE } from '@/lib/engine/color-palette';

export interface BlenderGenerationResult {
  exportPath: string;
  objectName: string;
  boundingBox: { x: number; y: number; z: number };
}

/**
 * Generate the Python script to clean the Blender scene.
 */
export function getCleanSceneScript(): string {
  return `
import bpy

# Delete all objects
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)

# Clear orphan data
for block in bpy.data.meshes:
    if block.users == 0:
        bpy.data.meshes.remove(block)
for block in bpy.data.materials:
    if block.users == 0:
        bpy.data.materials.remove(block)

print("Scene cleaned")
`.trim();
}

/**
 * Generate a Python script that creates all LEGO palette materials in Blender.
 * Each material uses a Principled BSDF with the exact hex Base Color.
 * Call this after cleaning the scene, before building the model.
 * The model-building script can then use: bpy.data.materials["LEGO_Red"] etc.
 */
export function getCreateLegoMaterialsScript(): string {
  const materialsCode = COLOR_PALETTE.map((c) => {
    const r = parseInt(c.hex.slice(1, 3), 16) / 255;
    const g = parseInt(c.hex.slice(3, 5), 16) / 255;
    const b = parseInt(c.hex.slice(5, 7), 16) / 255;
    const safeName = c.name.replace(/\s+/g, '_');
    return `create_lego_mat("LEGO_${safeName}", (${r.toFixed(4)}, ${g.toFixed(4)}, ${b.toFixed(4)}, 1.0))`;
  }).join('\n');

  return `
import bpy

def create_lego_mat(name, rgba):
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    mat.diffuse_color = rgba
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs['Base Color'].default_value = rgba
        bsdf.inputs['Roughness'].default_value = 0.8
        bsdf.inputs['Metallic'].default_value = 0.0

${materialsCode}

print("LEGO materials created:", [m.name for m in bpy.data.materials if m.name.startswith("LEGO_")])
`.trim();
}

/**
 * Returns a mapping of color name -> material name for use in Blender scripts.
 * e.g. { Red: 'LEGO_Red', Blue: 'LEGO_Blue', ... }
 */
export function getLegoMaterialNames(): Record<string, string> {
  const names: Record<string, string> = {};
  for (const c of COLOR_PALETTE) {
    names[c.name] = `LEGO_${c.name.replace(/\s+/g, '_')}`;
  }
  return names;
}

/**
 * Generate the Python script to apply simple LEGO-palette materials
 * to the active object in Blender.
 */
export function getSimplifyMaterialsScript(): string {
  // Build the palette dict directly from our canonical source
  const paletteEntries = COLOR_PALETTE.map((c) => {
    const r = parseInt(c.hex.slice(1, 3), 16) / 255;
    const g = parseInt(c.hex.slice(3, 5), 16) / 255;
    const b = parseInt(c.hex.slice(5, 7), 16) / 255;
    return `    "${c.hex}": ("${c.name.replace(/\s+/g, '_')}", (${r.toFixed(4)}, ${g.toFixed(4)}, ${b.toFixed(4)}))`;
  }).join(',\n');

  return `
import bpy

# Canonical LEGO palette: hex -> (name, (r, g, b))
LEGO_PALETTE = {
${paletteEntries}
}

import math

def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

def rgb_to_oklch(r, g, b):
    lr, lg, lb = srgb_to_linear(r), srgb_to_linear(g), srgb_to_linear(b)
    l_ = 0.4122214708*lr + 0.5363325363*lg + 0.0514459929*lb
    m_ = 0.2119034982*lr + 0.6806995451*lg + 0.1073969566*lb
    s_ = 0.0883024619*lr + 0.2817188376*lg + 0.6299787005*lb
    l = math.copysign(abs(l_)**(1/3), l_) if l_ else 0
    m = math.copysign(abs(m_)**(1/3), m_) if m_ else 0
    s = math.copysign(abs(s_)**(1/3), s_) if s_ else 0
    L = 0.2104542553*l + 0.7936177850*m - 0.0040720468*s
    a = 1.9779984951*l - 2.4285922050*m + 0.4505937099*s
    bv = 0.0259040371*l + 0.7827717662*m - 0.8086757660*s
    C = math.sqrt(a*a + bv*bv)
    h = math.degrees(math.atan2(bv, a)) % 360
    return (L, C, h)

def oklch_distance(a, b):
    dL = a[0]-b[0]; dC = a[1]-b[1]
    avgC = math.sqrt(a[1]*b[1])
    dh = a[2]-b[2]
    if dh > 180: dh -= 360
    if dh < -180: dh += 360
    dhc = 2*avgC*math.sin(math.radians(dh/2))
    return math.sqrt(dL*dL + 1.5*dC*dC + dhc*dhc)

_PALETTE_OKLCH = {h: rgb_to_oklch(*rgb) for h, (_, rgb) in LEGO_PALETTE.items()}

def nearest_lego(rgb):
    inp = rgb_to_oklch(*rgb)
    best_hex = None
    best_dist = float('inf')
    for hex_val, pal in _PALETTE_OKLCH.items():
        d = oklch_distance(inp, pal)
        if d < best_dist:
            best_dist = d
            best_hex = hex_val
    return best_hex

changed = 0
for obj in bpy.data.objects:
    if obj.type != 'MESH':
        continue
    for mat in obj.data.materials:
        if not mat or not mat.use_nodes:
            continue
        for node in mat.node_tree.nodes:
            if node.type == 'BSDF_PRINCIPLED':
                r, g, b = node.inputs['Base Color'].default_value[:3]
                hex_val = nearest_lego((r, g, b))
                if hex_val:
                    name, lego_rgb = LEGO_PALETTE[hex_val]
                    node.inputs['Base Color'].default_value = (*lego_rgb, 1.0)
                    node.inputs['Roughness'].default_value = 0.8
                    node.inputs['Metallic'].default_value = 0.0
                    mat.diffuse_color = (*lego_rgb, 1.0)
                    mat.name = f"LEGO_{name}"
                    changed += 1
                break

print(f"Simplified {changed} materials to LEGO palette")
`.trim();
}

/**
 * Generate a Python script that bakes LEGO palette colors directly into
 * mesh color attributes and exports a material-free PLY/GLB for voxelization.
 */
export function getPrepMeshForVoxelizerScript(
  objName: string,
  colorMapping: Record<number, string>,
  exportPath: string,
  format: 'ply' | 'glb' = 'glb',
): string {
  // Palette values are sRGB [0-1] — hex parsed directly, no gamma conversion.
  // Written to FLOAT_COLOR to avoid Blender's internal sRGB<->linear conversion.
  const paletteEntries = COLOR_PALETTE.map((c) => {
    const r = parseInt(c.hex.slice(1, 3), 16) / 255;
    const g = parseInt(c.hex.slice(3, 5), 16) / 255;
    const b = parseInt(c.hex.slice(5, 7), 16) / 255;
    return `    "${c.name}": (${r.toFixed(4)}, ${g.toFixed(4)}, ${b.toFixed(4)}, 1.0)`;
  }).join(',\n');

  const mappingEntries = Object.entries(colorMapping)
    .map(([slot, colorName]) => `    ${Number(slot)}: "${colorName}"`)
    .join(',\n');

  const blenderObjName = JSON.stringify(objName);
  const blenderExportPath = JSON.stringify(exportPath);
  const exportFormat = format === 'glb' ? 'glb' : 'ply';

  return `
import bpy

LEGO_PALETTE = {
${paletteEntries}
}

COLOR_MAPPING = {
${mappingEntries}
}

OBJ_NAME = ${blenderObjName}
EXPORT_PATH = ${blenderExportPath}
EXPORT_FORMAT = "${exportFormat}"

obj = bpy.data.objects.get(OBJ_NAME)
if obj is None:
    print(f"ERROR: object '{OBJ_NAME}' not found")
elif obj.type != 'MESH':
    print(f"ERROR: object '{OBJ_NAME}' is not a mesh")
else:
    mesh = obj.data

    color_attr = mesh.color_attributes.get("Lego_Voxel_Colors")
    if color_attr is None:
        color_attr = mesh.color_attributes.new(
            name="Lego_Voxel_Colors",
            type='FLOAT_COLOR',
            domain='CORNER',
        )
    mesh.color_attributes.active_color = color_attr
    mesh.color_attributes.render_color_index = mesh.color_attributes.find(color_attr.name)

    default_rgba = LEGO_PALETTE.get("Orange", (1.0, 1.0, 1.0, 1.0))
    colored_faces = 0
    for poly in mesh.polygons:
        lego_color_name = COLOR_MAPPING.get(poly.material_index, "Orange")
        target_rgba = LEGO_PALETTE.get(lego_color_name, default_rgba)
        for loop_index in poly.loop_indices:
            color_attr.data[loop_index].color = target_rgba
        colored_faces += 1

    # Strip materials so downstream import cannot drift from baked colors.
    mesh.materials.clear()

    bpy.ops.object.select_all(action='DESELECT')
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)

    if EXPORT_FORMAT == "glb":
        gltf_kwargs = dict(
            filepath=EXPORT_PATH,
            export_format='GLB',
            use_selection=True,
            export_apply=True,
            export_materials='NONE',
        )
        if bpy.app.version >= (5, 0, 0):
            gltf_kwargs['export_vertex_color'] = 'ACTIVE'
        else:
            gltf_kwargs['export_colors'] = 'ACTIVE'
        bpy.ops.export_scene.gltf(**gltf_kwargs)
    else:
        # Blender export API differs by version. Prefer wm.ply_export when available.
        if hasattr(bpy.ops.wm, "ply_export"):
            bpy.ops.wm.ply_export(
                filepath=EXPORT_PATH,
                export_selected_objects=True,
                export_colors='SRGB',
            )
        else:
            bpy.ops.export_mesh.ply(
                filepath=EXPORT_PATH,
                use_selection=True,
                use_colors=True,
            )

    print(f"Prepared '{OBJ_NAME}' with {colored_faces} colored faces for voxelizer export at {EXPORT_PATH}")
`.trim();
}

/**
 * Generate the Python script to export the active object as OBJ.
 */
export function getExportObjScript(exportPath: string): string {
  return `
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
    bpy.ops.wm.obj_export(
        filepath="${exportPath}",
        export_selected_objects=True,
        export_materials=True,
        export_colors=True,
        forward_axis='Y',
        up_axis='Z'
    )

    # Get bounding box info
    bbox = [obj.matrix_world @ mathutils.Vector(corner) for corner in obj.bound_box]
    min_co = [min(v[i] for v in bbox) for i in range(3)]
    max_co = [max(v[i] for v in bbox) for i in range(3)]
    dims = [max_co[i] - min_co[i] for i in range(3)]
    print(f"EXPORT_DIMS:{dims[0]:.4f},{dims[1]:.4f},{dims[2]:.4f}")
    print(f"EXPORT_NAME:{obj.name}")
    print(f"Exported to ${exportPath}")
else:
    print("ERROR: No mesh object found to export")
`.trim();
}

/**
 * Generate the Python script to get bounding box dimensions of the active mesh.
 */
export function getObjectDimensionsScript(): string {
  return `
import bpy
import mathutils

obj = None
for o in bpy.data.objects:
    if o.type == 'MESH':
        obj = o
        break

if obj:
    bbox = [obj.matrix_world @ mathutils.Vector(corner) for corner in obj.bound_box]
    min_co = [min(v[i] for v in bbox) for i in range(3)]
    max_co = [max(v[i] for v in bbox) for i in range(3)]
    dims = [max_co[i] - min_co[i] for i in range(3)]
    print(f"DIMS:{dims[0]:.4f},{dims[1]:.4f},{dims[2]:.4f}")
    print(f"MIN:{min_co[0]:.4f},{min_co[1]:.4f},{min_co[2]:.4f}")
    print(f"MAX:{max_co[0]:.4f},{max_co[1]:.4f},{max_co[2]:.4f}")
    print(f"NAME:{obj.name}")
else:
    print("ERROR: No mesh found")
`.trim();
}

# BrickForge — Blender Voxelization with Color Guide

**Purpose:** Step-by-step instructions for voxelizing any 3D model in Blender
while preserving its original texture colors. The output is a grid of cubes
that can be exported and fed into the BrickForge LEGO pipeline.

**Script:** `scripts/blender/voxelize_with_color.py` implements all steps
below as an automated Blender Python script.

---

## Overview

```
3D Model (textured mesh)
    │
    ▼
┌─────────────────────────┐
│  1. Prepare Model       │  Single object, one material, modifiers applied
│  2. Geometry Nodes      │  Mesh → Volume → Grid Points → Cube Instances
│  3. Voxel Size Control  │  Single Value node drives resolution everywhere
│  4. Color Transfer      │  UV sampling chain preserves original texture
│  5. Shader Patch        │  Attribute node reads instancer UVs
│  6. Export              │  Apply modifier → export GLB/PLY
└─────────────────────────┘
    │
    ▼
Voxelized mesh with colors → BrickForge pipeline
```

---

## Step 1 — Prepare the 3D Model

Before adding any Geometry Nodes:

1. **No holes** — The mesh surface should be watertight. The Mesh to Volume
   node needs a closed surface to generate a proper volume. Use
   *Mesh > Clean Up > Fill Holes* or the *Remesh* modifier if needed.

2. **Single material** — If the model has multiple materials, the color
   transfer step expects a single Image Texture feeding through a single UV
   map. Join materials or bake to a single atlas first.

3. **Single object** — All parts of the model should be one joined mesh.
   Select all parts → `Ctrl+J` to join.

4. **Apply all modifiers** — In the Modifier Properties tab, apply every
   existing modifier (Subdivision Surface, Mirror, Array, etc.) so the
   Geometry Nodes setup operates on final geometry.

---

## Step 2 — Set Up Geometry Nodes

1. Select your model object.
2. Switch to the **Geometry Nodes** workspace (top tab bar).
3. Click **"New"** to create a new node tree.
4. You'll see a default `Group Input → Group Output` chain.

---

## Step 3 — Add Core Voxelization Nodes

Add these four nodes and wire them in sequence:

### 3a. Mesh to Volume

`Add > Volume > Mesh to Volume`

| Setting             | Value   |
|---------------------|---------|
| Resolution Mode     | **Size** (change from default "Amount") |
| Fill Volume         | **Off** |
| Exterior Band Width | **0**   |

Connect: `Group Input [Geometry]` → `Mesh to Volume [Mesh]`

### 3b. Distribute Points in Volume

`Add > Point > Distribute Points in Volume`

| Setting             | Value   |
|---------------------|---------|
| Distribution Method | **Grid** (change from default "Random") |

Connect: `Mesh to Volume [Volume]` → `Distribute Points in Volume [Volume]`

### 3c. Instance on Points

`Add > Instances > Instance on Points`

Connect: `Distribute Points in Volume [Points]` → `Instance on Points [Points]`

### 3d. Cube Primitive

`Add > Mesh > Cube`

Connect: `Cube [Mesh]` → `Instance on Points [Instance]`

Then wire the output:
`Instance on Points [Instances]` → `Group Output [Geometry]`

At this point you should see a rough voxelized shape of your model made
of uniformly-sized cubes.

---

## Step 4 — Control Voxel Size with a Value Node

Add a **Value** node (`Add > Input > Value`). This single number controls
the resolution of the entire voxelization.

Connect the Value output to **all four** of these inputs:

| Target Node                    | Input               | Notes                          |
|-------------------------------|----------------------|--------------------------------|
| Mesh to Volume                | Voxel Size           | Scalar — direct connection     |
| Mesh to Volume                | Interior Band Width  | Scalar — direct connection     |
| Distribute Points in Volume   | Spacing              | **Vector** — use Combine XYZ*  |
| Cube                          | Size                 | **Vector** — use Combine XYZ*  |

*The Spacing and Size inputs expect a Vector (X, Y, Z). Add two **Combine
XYZ** nodes and connect the Value to all three (X, Y, Z) inputs of each,
then wire each Combine XYZ output to the respective target.*

### Choosing a Voxel Size

| Voxel Size | Detail    | Performance    | Use Case                        |
|-----------|-----------|----------------|---------------------------------|
| 0.15–0.2  | Low       | Very fast      | Quick preview, testing          |
| 0.08–0.1  | Medium    | Comfortable    | Standard builds                 |
| 0.04–0.06 | High      | Slow           | Detailed models, final export   |
| < 0.03    | Very high | May crash      | Only small/simple models        |

**Warning:** Start with a larger value (0.1+) and decrease gradually.
Very small values generate millions of cube instances and can freeze
or crash Blender.

---

## Step 5 — Color Transfer (UV-Based)

This is the key step that makes each voxel cube inherit the original
model's texture color. Without this, all cubes are a single flat color.

### 5a. Set Material Node

`Add > Material > Set Material`

Select your model's original material in the dropdown.

### 5b. Sample Nearest Node

`Add > Geometry > Sample Nearest`

| Setting | Value          |
|---------|----------------|
| Domain  | **Face Corner** (change from default "Point") |

Connect:
- `Group Input [Geometry]` → `Sample Nearest [Geometry]`
- **Add a `Position` node** (`Add > Input > Position`) and connect:
  `Position [Position]` → `Sample Nearest [Sample Position]`

> **CRITICAL:** The explicit Position connection is required. Without it,
> the sampling uses incorrect positions at finer voxel sizes, causing all
> cubes to sample the same UV region (washed-out uniform color). This was
> discovered during testing — at voxel size 0.1 colors appear roughly
> correct, but at 0.05 and below they break without this connection.

### 5c. Named Attribute Node

`Add > Input > Named Attribute`

| Setting    | Value                      |
|------------|----------------------------|
| Name       | **UVMap** (or your UV map name) |
| Data Type  | **Vector**                 |

### 5d. Sample Index Node

`Add > Geometry > Sample Index`

| Setting   | Value      |
|-----------|------------|
| Data Type | **Vector** |

Wire:
- `Named Attribute [Attribute]` → `Sample Index [Value]`
- `Group Input [Geometry]` → `Sample Index [Geometry]`
- `Sample Nearest [Index]` → `Sample Index [Index]`

### 5e. Store Named Attribute Node

`Add > Attribute > Store Named Attribute`

| Setting | Value        |
|---------|--------------|
| Name    | **UVMap**    |
| Type    | **Vector**   |
| Domain  | **Instance** |

Wire:
- `Instance on Points [Instances]` → `Store Named Attribute [Geometry]`
- `Sample Index [Value]` → `Store Named Attribute [Value]`

### 5f. Final Chain

`Store Named Attribute [Geometry]` → `Set Material [Geometry]` → `Group Output [Geometry]`

---

## Step 6 — Patch the Shader Editor

The original material's shader reads UVs from the mesh, but our voxel
cubes are instances — they need to read UVs from the **instancer**.

1. Switch to the **Shading** workspace.
2. Find the **UV Map** node connected to the Image Texture.
3. **Delete** the UV Map node.
4. Add an **Attribute** node (`Add > Input > Attribute`).
5. Change its type from **"Geometry"** to **"Instancer"**.
6. Set the Name field to **"UVMap"** (must match the Store Named Attribute name exactly).
7. Connect: `Attribute [Vector]` → `Image Texture [Vector]`

Each voxel cube now samples the correct texture color from the original model.

---

## Step 7 — Final Adjustments

### Rotation

- **Edit Mode rotation** — Rotates the underlying mesh; cubes stay
  axis-aligned (upright). Use this for reorienting the model.
- **Object Mode rotation** — Rotates the cubes too, creating a diagonal
  voxel look.

### Export for BrickForge Pipeline

1. Select the voxelized object.
2. Apply the Geometry Nodes modifier (`Ctrl+A` in Modifier Properties).
3. Export as GLB: `File > Export > glTF 2.0 (.glb)`
   - Enable "Selection Only"
   - Enable "Apply Modifiers"
4. The exported file can be fed into `prep_mesh_for_voxelizer.py` to bake
   LEGO palette colors, then into the BrickForge voxelization pipeline.

### Automated Script

Instead of building nodes manually, use the provided script:

```bash
# Basic voxelization (Geometry Nodes only, view in Blender)
blender --background scene.blend --python scripts/blender/voxelize_with_color.py -- \
  --object MyModel \
  --voxel-size 0.05

# With GLB export
blender --background scene.blend --python scripts/blender/voxelize_with_color.py -- \
  --object MyModel \
  --voxel-size 0.05 \
  --output /tmp/my_model_voxelized.glb

# Without color transfer (shape only)
blender --background scene.blend --python scripts/blender/voxelize_with_color.py -- \
  --object MyModel \
  --voxel-size 0.1 \
  --no-color
```

Or call from Python / Blender console:

```python
from scripts.blender.voxelize_with_color import voxelize_object

voxelize_object("Pikachu", voxel_size=0.05, with_color=True)
```

---

## Complete Node Graph Reference

```
                                    ┌─────────────────┐
                                    │   Value (0.05)   │
                                    └──┬──┬──┬──┬─────┘
                                       │  │  │  │
                          ┌────────────┘  │  │  └──────────────────┐
                          │  ┌────────────┘  └───────────┐         │
                          ▼  ▼                           ▼         ▼
                    ┌─Combine XYZ─┐               ┌─Combine XYZ─┐ │
                    │  (Spacing)  │               │ (Cube Size)  │ │
                    └──────┬──────┘               └──────┬───────┘ │
                           │                             │         │
┌────────────┐    ┌────────▼────────┐  ┌──────────▼──┐  │   ┌─────▼──────────┐
│ Group Input├───►│ Mesh to Volume  ├─►│ Dist Points  │  │   │                │
│ (Geometry) │    │ Mode=Size       │  │ Mode=Grid    │  │   │                │
└──┬─────────┘    │ Fill=Off        │  └──────┬───────┘  │   │                │
   │              │ ExtBand=0       │         │          │   │                │
   │              └─────────────────┘         ▼          │   │                │
   │                              ┌───────────────────┐  │   │                │
   │                              │ Instance on Points│◄─┘   │                │
   │                              │                   │◄─────┘                │
   │                              │         ▲ Instance│  Cube                 │
   │                              └────┬────┘─────────┘                       │
   │                                   │                                      │
   │                                   ▼                                      │
   │                     ┌──────────────────────────┐                         │
   │                     │ Store Named Attribute     │                         │
   │                     │ Name="UVMap"              │                         │
   │                     │ Type=Vector Domain=Inst   │                         │
   │                     └──────────┬───────────────┘                         │
   │                          ▲     │                                         │
   │              ┌───────────┘     ▼                                         │
   │    ┌─────────────────┐  ┌──────────────┐                                │
   │    │  Sample Index   │  │ Set Material │──────► Group Output             │
   │    │  Type=Vector    │  │ (original)   │                                 │
   │    └──▲──────▲───────┘  └──────────────┘                                │
   │       │      │                                                           │
   │       │  ┌───┴──────────┐                                               │
   │       │  │Sample Nearest│◄──────────────────────────────────────────────┘
   │       │  │Domain=Corner │
   │       │  └──────────────┘
   │       │
   │  ┌────┴───────────────┐
   └─►│  Named Attribute   │
      │  Name="UVMap"      │
      │  Type=Vector       │
      └────────────────────┘
```

---

## Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| Blender freezes/crashes | Voxel size too small | Increase voxel size (start at 0.1+) |
| No voxels visible | Fill Volume is on, or band widths are wrong | Turn off Fill Volume, set Exterior Band Width to 0 |
| All cubes are one color | Missing color transfer nodes | Follow Steps 5-6 |
| Cubes are white/pink | Material not assigned in Set Material | Select the correct material |
| UVs look wrong on cubes | Attribute node not set to Instancer | Check shader patch (Step 6) |
| Gaps between cubes | Cube size doesn't match spacing | Ensure both are driven by the same Value node |
| Model looks hollow | Interior Band Width too small | Connect Value to Interior Band Width too |

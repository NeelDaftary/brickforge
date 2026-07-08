# BrickForge v3 — Usage Guide

## Quick Start

### Web App
```bash
npx next dev --turbopack
# Open http://localhost:3000
```

1. **Generate** — Describe a build ("a medieval castle"), or upload a .blend/.glb/.obj/.stl/.ply mesh
2. **View** — Step through assembly instructions, rotate the 3D view
3. **Export** — Click Export dropdown:
   - **STL Print Files** (.zip) — enter a name, downloads print-ready STLs + parts list
   - **Build Data** (.brickforge.json) — save/share your build

### CLI Scripts

All scripts accept `.brickforge.json` or voxel grid JSON files.

```bash
# Print catalog — BOM + bed layout summary
npx tsx scripts/print-catalog.ts <model.json>
npx tsx scripts/print-catalog.ts <model.json> --bed-width 300 --bed-depth 300

# Export STL files
npx tsx scripts/export-stl.ts <model.json>
npx tsx scripts/export-stl.ts <model.json> --out-dir ./my-prints

# Stability check
npx tsx scripts/check-stability-quick.ts <model.json>

# Compare baseline vs refined stability
npx tsx scripts/compare-stability.ts <voxels.json>

# Visualize best-packed print bed as terminal matrix
npx tsx scripts/visualize-bed.ts <model.json>
```

---

## Pipeline Phases

The voxel-to-brick pipeline runs in this order:

| Phase | Name | What it does |
|-------|------|-------------|
| 0 | Shell | Removes deep-interior voxels (hollow shell) |
| 0.5 | Wildcards | Marks interior surface voxels as any-color (for bigger merges) |
| 1 | Greedy combiner | Merges cells into largest valid bricks, layer by layer |
| 2 | Stagger | Splits bricks to break aligned seams between layers |
| 2.5 | Refiner | Split-remerge local search — shuffles neighborhood tiling for better overlap |
| 2.75 | Gap-fill | Adds 1×1 support columns under critical/weak overhangs |
| 3 | Viewer format | Converts internal PlacedBrick format to BrickInstance for rendering |
| 4 | Stability check | Classifies every brick into critical/weak/marginal/stable tiers |

### Stability Tiers

| Tier | Support ratio | Meaning |
|------|--------------|---------|
| **Stable** | ≥50% studs supported below | Structurally sound |
| **Marginal** | <50% but locked from above | Held in place, but weak base |
| **Weak** | 25-49%, not locked | Clutch power holds it, but fragile |
| **Critical** | <25%, not locked | Will physically fall |

---

## Print Export System

### How Packing Works

BrickForge uses **MaxRects bin packing** (Jylänki 2010) to lay out bricks on print beds:

1. **Group by color** — each color gets its own bed(s)
2. **Sort by area descending** — place largest bricks first
3. **Dual heuristic** — tries both BSSF (Best Short Side Fit) and BAF (Best Area Fit) per bed, picks the better result
4. **Free rectangle splitting** — when a brick is placed, all overlapping free rectangles are split into up to 4 new rects, then pruned for containment

This achieves **85%+ utilization** on dense beds (vs ~58% with naive shelf packing).

### Bed Size

Default: **220 × 220 mm** (Ender 3 / Prusa MK3 bed size). Configurable via `--bed-width` and `--bed-depth` flags.

### Brick Dimensions

Real LEGO dimensions used for STL export:
- Stud pitch: 8.0 mm
- Brick height: 9.6 mm (3 plates)
- Plate height: 3.2 mm
- Stud height: 1.8 mm
- Stud diameter: 4.8 mm
- Tolerance: 0.1 mm per side (configurable)

### STL Files

Each STL file contains all bricks for one color on one print bed. Bricks are laid flat (studs up) with 2mm gaps. Meshes include:
- Hollow body (floor, ceiling, 4 walls)
- Top studs (cylindrical)
- Bottom anti-studs (tubes for 2×2+, ridge bars for 1×N)

Open in any slicer (Cura, PrusaSlicer, OrcaSlicer) — they're print-ready.

### Parts List

Every export zip includes a `parts_list.txt` with:
- Full bill of materials (part name, color, count, BrickLink part ID)
- Per-bed breakdown with utilization percentages

---

## Key Files

| File | Purpose |
|------|---------|
| `lib/pipeline/voxel-to-bricks.ts` | Core pipeline: voxel grid → brick model |
| `lib/pipeline/stability-refiner.ts` | Split-remerge local search |
| `lib/pipeline/stability-fill.ts` | Gap-fill with support columns |
| `lib/pipeline/brick-stability.ts` | Stability classification |
| `lib/export/maxrects.ts` | MaxRects bin packing engine |
| `lib/export/print-planner.ts` | Lightweight bed layout (no meshes) |
| `lib/export/bed-packer.ts` | Bed layout + mesh generation |
| `lib/export/brick-geometry.ts` | Real LEGO brick mesh generator |
| `lib/export/stl-writer.ts` | Binary STL format writer |
| `lib/engine/bom-generator.ts` | Bill of materials from model |
| `lib/engine/brick_catalog.ts` | All brick definitions + BrickLink IDs |
| `lib/engine/color-palette.ts` | 25 LEGO colors, OKLCH perceptual matching |
| `app/api/export-stl/route.ts` | Server-side STL zip generation |

---

## Testing

```bash
npx vitest run          # 90 tests across 8 files
npx tsc --noEmit        # Type check
```

Test files mirror source: `lib/pipeline/voxel-to-bricks.test.ts`, etc.

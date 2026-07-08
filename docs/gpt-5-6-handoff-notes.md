# BrickForge Handoff Notes for Next Model

Date: 2026-07-08

## Goal

Understand which parts of BrickForge's 3D object to LEGO-set process are reliable today, where confidence is weak, and what problem statement should be handed to a stronger model next.

The main suspected gap is correct: the fragile area is the transition from a voxelized object to a stable, buildable LEGO model. The current system preserves voxel coverage well and has good local bricking/diagnostic tools, but it does not yet have a strong shape-aware repair planner that can turn organic voxel forms into physically sensible LEGO builds while preserving the intended silhouette.

## Current End-to-End Process

### 3D object pipeline

1. Mesh intake and preflight
   - Accepts `.blend`, `.glb`, `.obj`, `.stl`, `.ply`.
   - Checks that the path exists and format is supported.
   - Confidence: 8/10.
   - Gap: preflight is mostly format/path validation, not deep mesh-quality validation. It does not yet score manifoldness, scale sanity, material graph quality, thin features, expected voxel density, or likely repair burden before voxelization.

2. Blender voxelization
   - Opens/imports mesh.
   - Duplicates original mesh for color sampling.
   - Applies Geometry Nodes voxelizer.
   - Realizes cube instances.
   - Extracts cube centers.
   - Samples nearest source-surface color.
   - Quantizes to LEGO palette.
   - Emits `grid[x][y][z]` plus `color_legend`.
   - Confidence: 7/10 for geometry, 5/10 for color.
   - Evidence: Squirtle preserved multiple colors, but Charmander voxelized entirely white because its GLB imported as a flat default material.

3. Voxel grid normalization and optional shelling
   - Removes deep interior voxels when shelling is enabled.
   - Marks interior voxels as wildcard colors to allow larger merges.
   - Confidence: 7/10.
   - Gap: shelling helps part count, but it changes the available internal support volume. Some support/repair logic depends on optional interior cells, so the system needs a clearer policy for what geometry may be removed, restored, or used as hidden support.

4. Voxel to bricks
   - Legacy path: greedy layer combiner, stagger, refinement, gap fill, stability check.
   - V2 path: layer solver, stability scoring, graph diagnostics, local/tree repair variants, optional oracle.
   - Confidence: 6/10 overall.
   - Strong at: covering the voxel grid without missing/overlapping cells.
   - Weak at: making organic shapes structurally buildable.

5. Diagnostics and readiness
   - Measures floating bricks, unsupported bricks, cantilevers, weak cantilevers, articulations, bridge edges, repeated seams, health score, and readiness status.
   - Confidence: 7/10.
   - Gap: diagnostics can identify weak regions, but the scoring is still heuristic rather than tied to true LEGO clutch/friction/torque constraints.

6. Guided repair
   - Generates candidate families: retile same voxels, recolor and retile, hidden internal brace, tapered support, strengthen attachment root, visible support/stand.
   - Scores candidates by stability gain, visible geometry cost, color cost, brick count delta, small-piece delta, column penalty, and patch size.
   - Confidence: 4/10.
   - Gap: candidate generation is local and template-like. It does not yet reason globally about model semantics, symmetry, base posture, load paths, acceptable silhouette edits, or whether a repair makes the model feel like a LEGO design rather than a voxel object with columns.

7. Mosaic pipeline
   - Converts image pixels to LEGO-color grid.
   - Combines same-color cells into plates with per-color greedy largest-plate-first search and multiple scan orders.
   - Confidence: 8/10.
   - Gap: this is intentionally flat and not a stability problem. It may need cost/design improvements, but it is not the critical blocker.

8. Export and print planning
   - Generates BOM, packs bricks by color on print beds, exports STL.
   - Confidence: 7/10 from tests/docs.
   - Gap: not deeply exercised in this evaluation. It depends on upstream brick quality; stable garbage still exports.

## Sample Runs

Cleanup note: after these evaluations, the experimental selectable V2 variants
(`v2_masks`, `v2_tree_repair`, `v2_lexicographic`, and `v2_oracle`) were retired
from the public engine list because they did not materially improve the target
repair metrics. The supported comparison surface is now `legacy` versus
`stability_v2`.

### Fixture evaluation

Command:

```bash
npx tsx scripts/eval-bricker.ts samples/fixtures/*.json --engines all --json
```

Summary for `stability_v2`:

| Fixture | V2 status | Key result |
|---|---:|---|
| bridge | pass | No floating, unsupported, weak, articulation, or bridge issues |
| color_stripe | pass | V2 improves compression from 4 bricks to 1 |
| hollow_shell | pass | V2 improves legacy warning to pass, health 1166 to 8 |
| solid_block | pass | V2 improves legacy warning to pass, health 454 to 4 |
| noisy_color_surface | pass | V2 reduces 9 legacy bricks to 5 |
| cantilever | warn | Still has 1 articulation and 1 bridge edge |
| tower | warn | Still has 3 articulations and 3 bridge edges |
| impossible_overhang | fail | Correctly remains needs repair: 1 floating, 1 unsupported |
| thin_appendage | fail | Still has 1 weak cantilever, 1 articulation, 2 bridge edges |

Interpretation:

- V2 is clearly better than legacy on clean local cases.
- The system can detect impossible or weak geometry.
- The system does not solve thin appendages, towers with weak joints, or organic overhang structure.

### Real mesh voxelization and bricking

Commands:

```bash
/Applications/Blender.app/Contents/MacOS/Blender --background \
  --python scripts/blender/blender_voxel_to_grid.py -- \
  --voxel-size 0.08 \
  --output /tmp/brickforge-charmander-v008.json \
  --import samples/source-assets/charmander.glb

/Applications/Blender.app/Contents/MacOS/Blender --background \
  --python scripts/blender/blender_voxel_to_grid.py -- \
  --voxel-size 0.08 \
  --output /tmp/brickforge-squirtle-v008.json \
  --import samples/source-assets/squirtle-1.glb

npx tsx scripts/eval-bricker.ts \
  /tmp/brickforge-charmander-v008.json \
  /tmp/brickforge-squirtle-v008.json \
  --engines all --json
```

Voxelization results:

| Model | Grid | Voxels | Colors |
|---|---:|---:|---|
| Charmander | 11 x 21 x 19 | 696 | all White |
| Squirtle | 17 x 23 x 18 | 1548 | Light Grey, Yellow, Tan, Bright Light Orange |

Bricking results with shell enabled:

| Model | Engine | Bricks | Health | Unsupported | Weak | Articulations | Bridges | Readiness |
|---|---|---:|---:|---:|---:|---:|---:|---|
| Charmander | legacy | 187 | 200457 | 31 | 5 | 49 | 64 | needs_repair |
| Charmander | stability_v2 | 179 | 144373 | 25 | 2 | 23 | 38 | needs_repair |
| Charmander | v2_tree_repair | 177 | 143911 | 25 | 2 | 22 | 37 | needs_repair |
| Squirtle | legacy | 457 | 599537 | 102 | 6 | 119 | 189 | needs_repair |
| Squirtle | stability_v2 | 365 | 220455 | 36 | 5 | 50 | 65 | needs_repair |
| Squirtle | v2_tree_repair | 361 | 189929 | 31 | 4 | 44 | 59 | needs_repair |

Coverage check with shell disabled:

| Model | Engine | Voxels | Occupied | Missing | Overlap |
|---|---|---:|---:|---:|---:|
| Charmander | stability_v2 | 696 | 696 | 0 | 0 |
| Squirtle | stability_v2 | 1548 | 1548 | 0 | 0 |

Interpretation:

- The bricker preserves voxel coverage. The weak point is not coverage.
- V2 materially improves organic models versus legacy, but it is not enough.
- Tree repair helps slightly, but it is still a local retile/patch approach rather than a real design repair.
- Organic meshes need high-level structural edits: stance/base changes, filled interior supports, widened attachments, simplified appendages, symmetry-aware thickening, and possibly scale/pose recommendations.

## Confidence Score by Process Area

| Process area | Score | Why |
|---|---:|---|
| Mosaic image to grid | 8/10 | Simple flat problem, tested, no 3D load paths |
| Mosaic plate merging | 8/10 | Purpose-built greedy combiner, deterministic, tested |
| Mesh format/path preflight | 8/10 | Basic intake is solid |
| Mesh quality/material preflight | 4/10 | Needs real manifold/material/scale/texture diagnostics |
| Blender voxel geometry | 7/10 | Real samples voxelize quickly and cleanly |
| Blender color fidelity | 5/10 | Squirtle worked, Charmander all white |
| Voxel coverage by bricker | 9/10 | Real samples with shell off had zero missing and zero overlaps |
| Part-count compression | 7/10 | V2 improves compression and fixture quality |
| Stability diagnostics | 7/10 | Finds many structural problems and supports gates |
| Automatic structural repair | 3/10 | Still fails thin appendage and organic models |
| Guided repair UX/data model | 5/10 | Good candidate vocabulary, but candidates are too local |
| Export/BOM/STL | 7/10 | Tested and documented, but depends on upstream build quality |

## Main Problem for Next Model

Design a robust voxel-to-buildable-LEGO repair planner.

Inputs:

- A voxel grid with color legend.
- A brick layout from the current v2 bricker.
- Graph diagnostics: floating, unsupported, weak cantilevers, critical cantilevers, articulations, bridges, seam runs, load estimates.
- Optional original voxel shell/interior information.

Outputs:

- A repaired voxel grid and/or brick layout.
- A ranked list of human-readable repair suggestions.
- A confidence score explaining whether the result is ready, prototype, or needs manual repair.
- A diff that distinguishes:
  - no-geometry retile
  - color simplification
  - hidden internal support
  - visible silhouette thickening
  - base/stand addition
  - rejected impossible geometry

Hard constraints:

- No missing or overlapping occupied source voxels unless the suggestion explicitly edits geometry.
- Preserve visible silhouette unless a visible repair is selected.
- Prefer hidden interior supports before visible columns.
- Penalize one-stud towers, long unsupported appendages, stacked vertical seams, articulation points, and bridge-edge bottlenecks.
- Support global repairs, not just local patches.

Useful objective:

Minimize:

```text
10000 * floating
+ 5000 * criticalCantileverRegions
+ 1500 * unsupportedWeightedByLoad
+ 500 * weakCantileversWeightedByLoad
+ 300 * articulationLoadRisk
+ 200 * bridgeLoadRisk
+ 100 * longVerticalSeamRuns
+ visibleGeometryCost
+ colorChangeCost
+ extraBrickCost
+ smallPieceCost
+ asymmetryCost
```

But do not rely only on scalar scoring. The repair planner should explicitly classify the failure mode first:

- detached island
- unsupported appendage
- weak attachment root
- narrow tower/neck
- shell with missing internal support
- color fragmentation causing weak tiling
- over-thin feature below printable/buildable thickness
- truly impossible silhouette without a stand

## Concrete Research/Implementation Directions

1. Build a "structural skeleton" from voxel components.
   - Identify body mass, appendages, necks, tails, ears, limbs, and bridges by connected-component and medial-axis style analysis.
   - Repair roots of appendages, not just the bricks currently flagged.

2. Add support-volume planning.
   - Treat removed interior shell cells as optional hidden support volume.
   - Search for minimal hidden braces from weak regions to stable mass.
   - Prefer diagonal/tapered buttresses and root thickening over vertical columns.

3. Add semantic repair templates.
   - Tail/arm/ear: strengthen root plus taper underside.
   - Tall tower/neck: staggered internal spine plus wider base.
   - Floating piece: either connect to nearest mass or label as requiring a stand.
   - Wide bridge: fill internal arch/beam or split into supported sections.

4. Improve candidate generation.
   - Current candidates are mostly retile, recolor, local brace, tapered support, root strip, column.
   - Need multi-step candidates that edit a region and its load path together.

5. Improve scoring with load path awareness.
   - Penalize a weak brick more if it carries a large subtree.
   - Penalize articulation at the root of an appendage more than articulation in a decorative surface.
   - Score torque/leverage from center of mass, not only direct support ratio.

6. Add preflight warnings before bricking.
   - Thin appendage risk.
   - Floating/near-floating components.
   - Severe overhangs.
   - Color fragmentation.
   - All-grey or all-white material collapse.
   - Voxel resolution too low/high for stable LEGO conversion.

7. Add benchmark cases.
   - Organic character with tail.
   - Quadruped standing pose.
   - Tall narrow neck/head.
   - Hollow shell with top overhang.
   - Multi-color surface detail on an appendage.
   - Symmetric ears/fins.
   - Impossible floating island.

## Suggested Prompt for Next Model

You are improving BrickForge, a system that converts voxelized 3D models into LEGO-like brick builds. The current v2 bricker preserves voxel coverage well but fails to make organic shapes structurally buildable. On real mesh samples, Charmander and Squirtle voxelize with zero missing/overlapping cells, but still produce many unsupported bricks, weak cantilevers, articulations, and bridge edges. The current repair system tries local/tree retiling, recoloring, hidden braces, tapered supports, root strengthening, and columns, but these candidates are too local and template-like.

Design and implement a stronger repair planner. It should classify weak regions by structural failure mode, reason about global load paths and appendage roots, use optional interior/shelled voxels for hidden supports, generate multi-step repair candidates, preserve visible silhouette unless visible edits are explicitly selected, and return ranked suggestions with before/after diagnostics. It must keep voxel coverage exact unless a suggestion explicitly edits geometry. Start with fixtures `thin_appendage`, `tower`, `cantilever`, and real voxelized Squirtle/Charmander as benchmarks.

## Best Current Interpretation

The build is good at:

- ingesting supported files
- voxelizing geometry
- converting voxel grids into complete brick coverage
- reducing part count locally
- diagnosing many structural problems
- building 2D mosaics

The build is not yet good at:

- deciding when the source shape itself must change
- choosing hidden vs visible structural edits
- repairing appendages and towers from the root/load path
- preserving visual intent while making LEGO-realistic compromises
- catching color/material failures early enough

The next model should spend most of its intelligence on "repair the model," but not merely by tweaking local bricker scores. The right target is a higher-level structural design layer between voxelization and final bricking.

# BrickForge Codebase Bloat Inventory

Date: 2026-07-08
Branch: `codex/stability-research-modes`

## Baseline Verification

Before refactor:

- `npm run lint`: pass
- `npx tsc --noEmit`: pass
- `npm test`: pass, 24 files / 187 tests
- `npm run build`: pass
- `curl -I http://127.0.0.1:3000/`: 200

Tracked TypeScript/TSX under `app`, `components`, `lib`, and `scripts`:

- `96` files
- `15,139` lines

## Largest Files

| Lines | File | Primary issue |
| ---: | --- | --- |
| 671 | `lib/pipeline_v2/brick-graph.ts` | graph construction, graph algorithms, summaries, ids, and scoring live together |
| 636 | `lib/pipeline/voxel-to-bricks.ts` | legacy bricker includes shelling, scoring, partitioning, model conversion |
| 607 | `components/viewer/LegoCanvas.tsx` | viewer tabs, edit state, voxel edits, rebrick API calls, overlay controls |
| 493 | `lib/pipeline_v2/repair.ts` | defect selection, patch extraction, support insertion, solving, acceptance |
| 479 | `lib/pipeline_v2/layer-solver.ts` | candidate generation, masks, scoring, beam search, owner maps |
| 419 | `lib/pipeline/stability-refiner.ts` | legacy stability improvement logic remains large but isolated |
| 411 | `lib/pipeline_v2/stability-bricker.ts` | variant orchestration, repair, oracle, diagnostics wiring |
| 403 | `app/page.tsx` | page owns input flow, result flow, import/export, save state |
| 401 | `lib/pipeline/run-voxel-pipeline.ts` | Blender execution, bricker selection, stability/color diagnostics, shadow compare |
| 380 | `lib/pipeline_v2/guided-repair.ts` | user repair suggestions, support geometry, diagnostics recompute |

## Import Graph Notes

Static local import scan:

- `96` TS/TSX files
- `230` local import/export edges
- One non-entry file with no inbound imports: `lib/export/index.ts`
- Highest inbound modules:
  - `lib/engine/types.ts`: 29
  - `lib/pipeline/voxel-to-bricks.ts`: 18
  - `lib/pipeline_v2/brick-graph.ts`: 14
  - `lib/pipeline/errors.ts`: 12
  - `lib/pipeline_v2/variants.ts`: 8

Interpretation: most bloat is not dead code. The main issue is mixed responsibilities and repeated concepts.

## Product Surface Map

| Flow | Status | Entry point | Notes |
| --- | --- | --- | --- |
| Mesh upload to build | Ship | `MeshUpload` -> `/api/upload` | Current primary workflow |
| Image to mosaic | Ship | `ImageMosaic` | Client-side model generation |
| Saved builds | Ship | `SavedBuilds` + local storage | Keep schema compatible |
| Import `.brickforge.json` | Ship | `app/page.tsx` import handler | Can move into extracted component/helper |
| Build health | Ship | `BuildHealth` | Uses diagnostics layout summary |
| Guided repair queue | Ship | `GuidedRepairQueue` | Applies one issue at a time through rebrick |
| Viewer paint/build/erase | Ship | `LegoCanvas` | Keep, but extract edit state/actions |
| Export build data/STL | Ship | `app/page.tsx` + `/api/export-stl` | Move UI/actions out of page |
| Text-to-3D generation | Remove | `/api/generate-model` | Hidden path; remove route, client, prompt refiner, tests |

## Duplicate Concept Map

| Concept | Current locations | Refactor target |
| --- | --- | --- |
| Diagnostic category ids/labels/order | `LegoCanvas`, `BrickScene`, `BuildHealth`, `GuidedRepairQueue`, eval scripts | shared diagnostic catalog |
| Layout summary response shape | `brick-graph`, `model-diagnostics`, route tests, eval scripts | shared diagnostics types/helpers |
| Readiness/prototype status | `build-readiness`, `BuildHealth`, `eval-bricker` | one formatter/classifier surface |
| Bricker variant validation | upload route, voxelize route, mesh UI | shared variant helpers already exist; use consistently |
| Voxelize diagnostics assembly | `/api/voxelize`, `run-voxel-pipeline` | shared diagnostics builder |
| Rebrick request construction | `LegoCanvas`, `GuidedRepairQueue` | shared client helper |
| Grid editing helpers | `LegoCanvas`, engine grid utils | extract to viewer edit hook/helpers |
| Hidden generation stages | pipeline types, progress component, generation route | remove generation-only stages |

## Dead Or Remove Candidates

| Candidate | Action | Risk |
| --- | --- | --- |
| `app/api/generate-model/route.ts` | delete | low; no product UI calls it |
| `app/api/generate-model/route.test.ts` | delete | low; tied only to removed route |
| `lib/pipeline/hyper3d-client.ts` | delete | low; only route imports it |
| `lib/pipeline/prompt-refiner.ts` | delete | low; only route/tests import it |
| `lib/pipeline/prompt-refiner.test.ts` | delete | low; tied only to removed module |
| generation-only `PipelineStage` values | delete | medium; update progress component/tests/types |
| docs describing in-app Hyper3D | update/archive wording | low; docs only |
| `lib/export/index.ts` | inspect/delete if unused by package consumers | low, but keep until export cleanup phase |

## First Refactor Commits

1. **Audit + generation removal**
   - Add this inventory.
   - Delete hidden generation route/client/refiner/tests.
   - Remove generation-only pipeline stages.
   - Update docs wording.

2. **Frontend product orchestration split**
   - Extract start screen and result workspace from `app/page.tsx`.
   - Extract import/export/save helpers.
   - Target `app/page.tsx < 200` lines.

3. **Diagnostics catalog**
   - Add shared diagnostic category catalog.
   - Use it in viewer overlay controls, `BrickScene`, `BuildHealth`, and eval output.
   - Add/adjust tests for id/category consistency.

4. **Viewer edit extraction**
   - Move voxel edit state/actions into a hook/helper module.
   - Move rebrick client request helper out of `LegoCanvas`.
   - Keep paint/build/erase behavior unchanged.

5. **API/pipeline boundary cleanup**
   - Extract diagnostics assembly shared by direct voxelize and mesh pipeline.
   - Thin routes to parsing + orchestration.
   - Split `brick-graph` and `repair` only after tests remain green.

## Risk Controls

- No algorithm behavior changes during extraction.
- API response shape remains backward-compatible.
- Each commit must pass lint, typecheck, tests, build, and route smoke.
- Build-generated `next-env.d.ts` churn must not be committed unless intentionally changed.

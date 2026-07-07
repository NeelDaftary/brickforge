# BrickForge Codebase Bloat Audit And Refactor Plan

## Goal
Reduce code size, duplication, and product confusion without removing shipped capabilities:

- mesh upload and voxelization
- stability v2 and experimental variants
- build health diagnostics and overlays
- guided repair queue
- mosaic generation
- saved/imported build workflow
- STL/build-data export
- existing CLI evaluation scripts and tests

The refactor should make the system easier to finish, not just smaller. Line count reduction is a useful signal, but correctness, stability diagnostics, and product clarity stay higher priority.

## Current Starting Point
Quick census from the repo:

- App TypeScript/TSX code under `app`, `components`, `lib`, and `scripts`: about `15,139` lines.
- Largest implementation files:
  - `lib/pipeline_v2/brick-graph.ts`: `671` lines
  - `lib/pipeline/voxel-to-bricks.ts`: `636` lines
  - `components/viewer/LegoCanvas.tsx`: `607` lines
  - `lib/pipeline_v2/repair.ts`: `493` lines
  - `lib/pipeline_v2/layer-solver.ts`: `479` lines
  - `lib/pipeline/stability-refiner.ts`: `419` lines
  - `lib/pipeline_v2/stability-bricker.ts`: `411` lines
  - `app/page.tsx`: `403` lines
  - `lib/pipeline/run-voxel-pipeline.ts`: `401` lines
- Most fragmented areas by file count:
  - `lib/pipeline`: `25` files
  - `lib/pipeline_v2`: `17` files
  - `lib/export`: `8` files
  - `components/viewer`: `8` files

## Non-Negotiables
- Keep behavior covered by tests before deleting or merging code.
- Do not mix speculative algorithm changes with cleanup refactors.
- Preserve public API response compatibility unless explicitly versioned.
- Keep `legacy`, `stability_v2`, and research variants available until we intentionally retire them.
- Every refactor phase must end with:
  - `npm run lint`
  - `npx tsc --noEmit`
  - `npm test`
  - `npm run build`
  - a local app smoke check

## Phase 1: Product Surface Audit
Purpose: separate real product paths from old prototype paths.

Tasks:
- Inventory all user-facing flows from `app/page.tsx` and components:
  - mesh upload
  - image mosaic
  - import saved build
  - build health
  - guided repair
  - viewer editing
  - export
- Tag each flow as:
  - `ship`
  - `keep hidden`
  - `experimental`
  - `remove candidate`
- Audit frontend text for overclaims:
  - generation promises
  - BrickLink/parts promises
  - “stable/buildable” claims that diagnostics cannot yet prove
- Confirm hidden text-to-model backend code has been removed from the product codebase.

Deliverable:
- A product surface map with every visible entry point and its backing API/module.

## Phase 2: Dependency And Call Graph Audit
Purpose: identify dead code, duplicate code, and code that exists only because boundaries are blurry.

Tasks:
- Generate import graph for `app`, `components`, `lib`, and `scripts`.
- Find modules with no inbound imports except tests.
- Find modules imported only by deprecated routes or hidden workflows.
- Find repeated concepts with different names:
  - stability tiers vs readiness status vs health score
  - diagnostics vs layout summary vs graph metrics
  - repair suggestions vs repair queue vs patch repair
  - candidate branches vs candidate count vs candidate masks
- Find utility logic embedded inside large components or routes.

Deliverable:
- A ranked bloat list:
  - dead/remove
  - duplicate/merge
  - large/split
  - unclear boundary/rename
  - keep as-is

## Phase 3: Frontend Refactor Audit
Purpose: make the UI smaller and easier to reason about while keeping the same behavior.

Likely targets:
- `app/page.tsx`
  - Extract start-screen orchestration into a small component.
  - Extract result actions into a small component.
  - Keep page as state coordinator only.
- `components/viewer/LegoCanvas.tsx`
  - Separate viewer state, diagnostic overlay state, and editing callbacks.
  - Move pure geometry/color helpers out of the component.
  - Confirm overlay modes and repair focus ids use one shared contract.
- `components/BuildHealth.tsx` and `components/GuidedRepairQueue.tsx`
  - Normalize shared labels and category definitions.
  - Avoid parallel UI-specific mappings for the same diagnostics.
- `MeshUpload` and `ImageMosaic`
  - Share file-drop, progress, and result lifecycle patterns.

Deliverable:
- Smaller frontend modules with one responsibility each, no feature changes.

## Phase 4: Backend/API Refactor Audit
Purpose: reduce route complexity and keep request/response behavior predictable.

Likely targets:
- `app/api/upload/route.ts`
  - Keep route as validation and orchestration only.
  - Move upload parsing and engine selection into tested helpers.
  - Ensure accepted file formats and docs stay aligned.
- `app/api/voxelize/route.ts`
  - Share bricker engine selection with upload.
  - Avoid route-specific diagnostics shaping if pipeline can own it.
- Removed text-to-3D route
  - Keep it deleted unless the product explicitly reintroduces generation as a separate feature.
- Error handling
  - Keep one error-to-response utility per API style.
  - Avoid ad hoc `try/catch` response shapes.

Deliverable:
- Routes that are thin adapters around tested pipeline services.

## Phase 5: Pipeline Methodology Audit
Purpose: prevent `legacy`, `stability_v2`, and research experiments from becoming a tangled pile.

Likely targets:
- `lib/pipeline/voxel-to-bricks.ts`
  - Identify what is true legacy behavior vs reusable grid/coverage logic.
  - Pull shared coverage validation into a common module if v2 duplicates it.
- `lib/pipeline/run-voxel-pipeline.ts`
  - Separate mesh/color/voxel orchestration from bricker selection.
- `lib/pipeline_v2/stability-bricker.ts`
  - Keep as variant orchestrator, move candidate/repair/diagnostics decisions to focused modules.
- `lib/pipeline_v2/brick-graph.ts`
  - Split graph construction, metrics, weak-region ranking, and id exports if they are independently testable.
- `lib/pipeline_v2/repair.ts`
  - Separate patch selection, patch solving, and acceptance scoring.
- `lib/pipeline_v2/guided-repair.ts`
  - Keep user-facing recommendations distinct from automatic bricker repair logic.

Deliverable:
- A clearer pipeline boundary:
  - input grid
  - candidate generation
  - solve
  - graph diagnostics
  - repair suggestions
  - exportable model

## Phase 6: Test And Fixture Audit
Purpose: make sure fewer lines does not mean less confidence.

Tasks:
- Identify tests that are repetitive snapshots of the same behavior.
- Consolidate fixture builders for voxel grids and brick models.
- Keep benchmark fixtures but make their purpose explicit.
- Add smoke tests for extracted orchestration helpers before deleting route-level logic.
- Ensure visual repair/overlay ids have tests at the contract level, not only via UI.

Deliverable:
- Leaner test helpers and clearer coverage for product-critical behavior.

## Phase 7: Documentation And Script Audit
Purpose: reduce stale docs and keep only docs/scripts that serve the current product or research loop.

Tasks:
- Mark old design docs as historical or archive them.
- Keep current pipeline specs near the code they describe.
- Consolidate evaluation scripts if they overlap:
  - `eval-bricker.ts`
  - `eval-bricker-gates.ts`
  - `compare-stability.ts`
  - `check-stability-quick.ts`
- Ensure CLI names match the current experiment modes.

Deliverable:
- A smaller docs/scripts surface with clear ownership.

## Execution Order
1. Establish baseline metrics and feature checklist.
2. Audit product surface and call graph.
3. Remove or hide only confirmed dead product surface.
4. Refactor frontend orchestration.
5. Refactor API orchestration.
6. Refactor pipeline internals behind stable tests.
7. Consolidate docs and scripts.
8. Re-run full test/build/eval gates.

## Refactor Rules
- Prefer deletion of truly dead code over abstraction.
- Prefer extraction when a file mixes UI, state orchestration, pure helpers, and network behavior.
- Prefer merging when two modules describe the same concept in different terms.
- Do not create “manager” or “service” files unless they replace concrete duplication.
- Each commit should be independently reversible.
- Each commit should have a before/after line-count note for touched areas.

## Success Metrics
- Fewer lines in top-level product files without feature loss.
- Fewer duplicate diagnostic category mappings.
- API routes below roughly `150` lines each unless there is a strong reason.
- `app/page.tsx` below roughly `200` lines.
- `LegoCanvas.tsx` split so viewer, overlays, and editing are not all in one component.
- Bricker pipeline modules named around stable concepts rather than experiment history.
- Full test/build suite passes after every phase.

## First Concrete Audit Pass
The first implementation pass should produce:

- `docs/audits/codebase-bloat-inventory.md`
- a table of top files by line count
- import/dependency map
- dead-code candidates
- duplicate concept map
- proposed first three refactor commits
- risk rating for each proposed deletion or extraction

No behavior-changing refactor should start until that audit inventory exists.

# Reusable Assets Freeze

This file freezes the set of TypeScript modules that remain authoritative while the
Python voxel pipeline is rebuilt.

## Keep And Reuse

- `lib/engine/brick_catalog.ts`
  - Source of canonical brick dimensions and BrickLink IDs.
- `lib/engine/bom-generator.ts`
  - BOM grouping logic and BrickLink color mapping behavior.
- `components/viewer/LegoCanvas.tsx`
- `components/viewer/BrickScene.tsx`
- `components/viewer/BuildStepsPanel.tsx`
  - Viewer scaffolding and build-step UI.
- `lib/engine/auto-fix.test.ts`
- `lib/engine/brick-packer.test.ts`
- `lib/voxels/voxel-import.test.ts`
  - Test scenarios to preserve as behavioral references.

## Retired As Primary Path

- `lib/ai/*`
- `app/api/generate/route.ts`
- `lib/engine/brick-packer.ts`
- `lib/engine/brick-consolidator.ts`

The retired modules are not the source of truth for the Blender-first pipeline and
should only be used as migration references until removal is complete.

# Model Repair Step: General Problem Brief

Date: 2026-07-08

## Purpose

The repair step is the process that turns a voxelized 3D object into a physically plausible, complete, buildable LEGO-style model.

This is not only a brick-packing problem. A voxel model can be perfectly covered by bricks and still be a bad build: it may contain unsupported appendages, weak necks, brittle overhangs, floating regions, bad load paths, too many tiny pieces, visually ugly support columns, or shapes that are impossible to preserve exactly at the chosen scale.

The repair step should decide what changes, if any, are necessary to make the model buildable while preserving as much of the intended object as possible.

## Input

The repair step may receive some or all of the following:

- A voxel grid representing the target object.
- Color information for each voxel or region.
- The physical scale of the model, such as voxel size, target stud width, target height, or intended display size.
- A preliminary brick layout, if one already exists.
- Diagnostics from the preliminary layout:
  - unsupported bricks or voxels
  - floating components
  - weak cantilevers
  - fragile appendages
  - narrow towers or necks
  - repeated vertical seams
  - articulation points
  - bridge/bottleneck connections
  - high piece count
  - excessive 1x1 usage
- Optional metadata about user intent:
  - preserve silhouette strictly
  - allow hidden internal support
  - allow visible supports
  - allow color simplification
  - allow thickening or reshaping
  - prioritize low part count
  - prioritize display accuracy
  - prioritize child-buildable robustness

## Output

The repair step should return a revised build plan, not just a pass/fail score.

Possible outputs:

- A repaired voxel grid.
- A repaired brick layout.
- A list of proposed repair options ranked by quality.
- A confidence/readiness classification:
  - ready to build
  - buildable but fragile
  - prototype only
  - needs manual review
  - impossible without visible support or shape changes
- A structured explanation of what changed.
- A diff between the original and repaired model:
  - added hidden support
  - added visible support
  - thickened geometry
  - removed or simplified fragile detail
  - recolored or merged regions
  - changed scale/resolution recommendation
  - changed brick layout only
- Metrics before and after repair:
  - unsupported count
  - floating count
  - weak-region count
  - estimated load-path quality
  - part count
  - small-piece count
  - visible shape deviation
  - color deviation
  - symmetry deviation

## What The Step Is Supposed To Do

At a high level, the repair step should answer:

1. Can this voxel object be built as-is?
2. If not, why not?
3. Is the problem caused by the brick layout, the voxel shape, the color/detail pattern, the chosen scale, or the object itself?
4. What is the least visually disruptive way to make it buildable?
5. If there are multiple valid repair strategies, what are the tradeoffs?

The ideal repair step behaves like a LEGO designer looking at a rough digital sculpture and asking:

- Which parts carry weight?
- Which parts are decorative?
- Which appendages are too thin?
- Where can internal structure be hidden?
- Where does the silhouette need to be modified?
- Should the model be scaled up?
- Should the color/detail be simplified?
- Does this need a display stand?
- Is the exact geometry impossible as a freestanding LEGO build?

## Where It Is Not Doing A Great Job Today

The current failure mode is not mainly voxel coverage. A system can often cover every voxel exactly once and still produce a poor LEGO build.

The hard failures are more like:

- Organic shapes produce many weak overhangs and fragile appendages.
- Thin features get preserved geometrically but are not buildable.
- Local fixes improve small areas but do not create a coherent global support structure.
- Support columns may be structurally valid but visually unacceptable.
- The system does not always distinguish between:
  - a bad brick tiling
  - a bad voxel shape
  - an underscaled model
  - a color-detail issue
  - an object that requires a stand
- The repair process lacks a strong notion of load paths through the whole model.
- The system may not know when to recommend scaling up instead of trying to repair at the current resolution.
- The system may not know when to intentionally simplify details to gain structural strength.
- The system can diagnose instability better than it can propose high-quality design edits.

## Important Distinctions

### Layout Repair vs Shape Repair

Some problems can be solved by changing only the brick layout:

- better staggering
- different brick sizes
- stronger overlap between layers
- fewer seam alignments
- reducing 1x1 fragments

Other problems require changing the voxel shape:

- adding support under an overhang
- thickening a thin appendage
- filling internal cavities
- widening a narrow neck
- changing a pose
- adding a base or display stand
- deleting or simplifying fragile details

The repair step should explicitly identify which category each issue belongs to.

### Hidden Repair vs Visible Repair

Some supports can be hidden inside the model. These should usually be preferred.

Visible supports may be acceptable when:

- the object naturally has a base
- the support can be styled as part of the model
- the user wants maximum buildability
- the original shape is impossible without support

The repair step should not treat every support voxel equally. A hidden internal brace and an external pillar have very different design costs.

### Exact Geometry vs Buildable Interpretation

The goal is not always to preserve every voxel exactly. For real LEGO-style building, the better output may be an interpretation of the object:

- smoother load paths
- cleaner silhouette
- chunkier appendages
- fewer unsupported details
- simplified color patches
- a stronger base

The repair step should know when exact geometry is hurting buildability.

## Broad Paths To Explore

These are intentionally general directions, not prescriptions.

### 1. Structural Analysis

Analyze the model as a physical object:

- find connected components
- identify load-bearing regions
- identify appendages and their attachment roots
- estimate center of mass
- estimate torque around weak joints
- detect long unsupported spans
- detect narrow towers, necks, bridges, and bottlenecks
- identify which failures are local and which are global

### 2. Buildability Classification

Classify the reason a model or region is weak:

- floating island
- unsupported overhang
- weak cantilever
- thin appendage
- narrow neck
- brittle tower
- color fragmentation
- hollow shell without internal support
- excessive small pieces
- bad seam alignment
- insufficient scale
- requires a base or stand

The classification should guide repair strategy.

### 3. Candidate Repair Generation

Generate multiple possible repairs instead of one answer:

- retile without changing geometry
- add hidden internal support
- thicken a weak region
- simplify fragile detail
- recolor small patches to enable stronger bricks
- add a base
- add a display stand
- scale the model up
- change voxel resolution
- split the model into subassemblies
- reject exact freestanding build and explain why

### 4. Global Load-Path Planning

Repair should reason about the whole model, not only the currently failing brick.

Questions to answer:

- How does weight travel from upper regions to the ground?
- Is a weak appendage carrying additional load?
- Are multiple weak regions connected to the same root?
- Can one internal spine solve many local issues?
- Would a base or wider stance fix multiple problems at once?

### 5. Scale And Resolution Decisions

Some models are impossible or poor at small scale but fine at larger scale.

The repair step should be able to say:

- this model needs more studs across
- this appendage is below minimum buildable thickness
- the color detail is too fine for this scale
- increasing resolution will help
- increasing resolution will make part count explode without solving stability

### 6. Visual-Fidelity Scoring

Repair should measure how much it changes the object:

- silhouette deviation
- color deviation
- symmetry deviation
- added visible support volume
- removed detail
- change to proportions

This lets the system compare a strong but ugly repair against a weaker but visually faithful repair.

### 7. Human-Reviewable Suggestions

The output should be understandable to a person.

Good repair suggestions should say:

- what is wrong
- where it is wrong
- why it matters
- what the repair changes
- what the visual tradeoff is
- how confident the system is

Example:

```text
The tail is attached by a one-stud-wide root and carries a long unsupported span.
Option A thickens the root by two hidden studs and keeps the silhouette nearly unchanged.
Option B adds a visible tapered underside support and is more robust.
Option C recommends scaling the model from 24 studs tall to 36 studs tall.
```

### 8. Acceptance And Rejection Criteria

The repair step should know when to stop.

A repaired model should not merely be "better"; it should meet a target quality bar.

Potential criteria:

- no floating components
- no unsupported load-bearing regions
- weak regions below a threshold
- no high-load articulation points
- acceptable part count
- acceptable small-piece count
- acceptable visible shape change
- no severe seam runs
- all intentionally changed geometry is explained

If no candidate meets the bar, the step should return a principled rejection:

```text
This object cannot be converted into a freestanding build at the requested size
without either adding a visible stand, thickening the appendage, or scaling up.
```

## Suggested General Prompt For A New Model

You are designing the repair stage for a system that converts voxelized 3D objects into LEGO-style builds.

The input is a colored voxel model and optionally an initial brick layout with diagnostics. The output should be a buildable repaired model or a ranked set of repair options. The repair stage must decide whether problems come from brick layout, voxel geometry, scale, color/detail fragmentation, or the object being impossible as a freestanding build.

Define an approach for making the model as complete and buildable as possible while preserving visual intent. Consider structural analysis, load paths, hidden supports, visible supports, shape edits, scale changes, color simplification, subassemblies, bases/stands, and principled rejection when needed. Avoid assuming any particular current algorithm. Propose the inputs, outputs, internal reasoning, scoring, repair types, acceptance criteria, and test cases that would make this repair stage reliable.

## Core Question

Given a voxelized object, what is the best buildable LEGO interpretation of it?

That is the real repair problem.

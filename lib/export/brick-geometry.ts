import type { IndexedMesh, PrintConfig } from './types';
import { getBrickDef } from '../engine/brick_catalog';

// ─── Real LEGO Dimensions (mm) ───────────────────────────────────────────────

const STUD_PITCH = 8.0;       // Center-to-center stud spacing
const BRICK_HEIGHT = 9.6;     // Full brick = 3 plates
const PLATE_HEIGHT = 3.2;     // 1 plate
const STUD_DIAMETER = 4.8;
const STUD_HEIGHT = 1.8;      // Protrusion above body
const TUBE_OUTER_D = 6.51;    // Anti-stud tube outer diameter
const TUBE_INNER_D = 4.8;     // Anti-stud tube inner diameter (= stud dia)
const WALL_THICKNESS = 1.2;   // Outer wall thickness
const FLOOR_THICKNESS = 1.0;  // Top/bottom slab thickness

const DEFAULT_CONFIG: PrintConfig = {
  tolerance: 0.1,
  cylinderSegments: 16,
};

// ─── Primitive Builders ──────────────────────────────────────────────────────

interface RawMesh {
  vertices: number[];
  indices: number[];
}

/**
 * Axis-aligned box. Origin at (x, y, z), extends to (x+w, y+h, z+d).
 * 8 verts, 12 tris. CCW winding (outward normals).
 */
function makeBox(x: number, y: number, z: number, w: number, h: number, d: number): RawMesh {
  const x1 = x + w, y1 = y + h, z1 = z + d;
  // prettier-ignore
  const vertices = [
    x,  y,  z,   // 0: left-bottom-front
    x1, y,  z,   // 1: right-bottom-front
    x1, y1, z,   // 2: right-top-front
    x,  y1, z,   // 3: left-top-front
    x,  y,  z1,  // 4: left-bottom-back
    x1, y,  z1,  // 5: right-bottom-back
    x1, y1, z1,  // 6: right-top-back
    x,  y1, z1,  // 7: left-top-back
  ];

  // CCW when viewed from outside
  // prettier-ignore
  const indices = [
    // Front face (z = z)
    0, 2, 1,  0, 3, 2,
    // Back face (z = z1)
    4, 5, 6,  4, 6, 7,
    // Top face (y = y1)
    3, 7, 6,  3, 6, 2,
    // Bottom face (y = y)
    0, 1, 5,  0, 5, 4,
    // Right face (x = x1)
    1, 2, 6,  1, 6, 5,
    // Left face (x = x)
    0, 4, 7,  0, 7, 3,
  ];

  return { vertices, indices };
}

/**
 * Solid cylinder with top + bottom caps.
 * Axis along Y. Base at (cx, cy, cz), extends upward by height.
 */
function makeCylinder(cx: number, cy: number, cz: number, radius: number, height: number, segs: number): RawMesh {
  const vertices: number[] = [];
  const indices: number[] = [];

  // Bottom center (0) and top center (1)
  vertices.push(cx, cy, cz);
  vertices.push(cx, cy + height, cz);

  // Bottom ring: indices 2..segs+1
  // Top ring: indices segs+2..2*segs+1
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    const px = cx + radius * Math.cos(a);
    const pz = cz + radius * Math.sin(a);
    vertices.push(px, cy, pz);           // bottom ring
  }
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    const px = cx + radius * Math.cos(a);
    const pz = cz + radius * Math.sin(a);
    vertices.push(px, cy + height, pz);  // top ring
  }

  const bStart = 2;
  const tStart = 2 + segs;

  for (let i = 0; i < segs; i++) {
    const next = (i + 1) % segs;

    // Bottom cap (CCW from below → CW from above, so reverse)
    indices.push(0, bStart + next, bStart + i);

    // Top cap (CCW from above)
    indices.push(1, tStart + i, tStart + next);

    // Side quad (2 tris)
    indices.push(bStart + i, bStart + next, tStart + next);
    indices.push(bStart + i, tStart + next, tStart + i);
  }

  return { vertices, indices };
}

/**
 * Hollow tube (annular cylinder) with outer wall, inner wall, top ring, bottom ring.
 * Axis along Y. Base at (cx, cy, cz).
 */
function makeTube(cx: number, cy: number, cz: number, outerR: number, innerR: number, height: number, segs: number): RawMesh {
  const vertices: number[] = [];
  const indices: number[] = [];

  // 4 rings: bottom-outer (0), bottom-inner (segs), top-outer (2*segs), top-inner (3*segs)
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    const cos = Math.cos(a), sin = Math.sin(a);
    vertices.push(cx + outerR * cos, cy, cz + outerR * sin);            // bottom-outer
  }
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    const cos = Math.cos(a), sin = Math.sin(a);
    vertices.push(cx + innerR * cos, cy, cz + innerR * sin);            // bottom-inner
  }
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    const cos = Math.cos(a), sin = Math.sin(a);
    vertices.push(cx + outerR * cos, cy + height, cz + outerR * sin);   // top-outer
  }
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    const cos = Math.cos(a), sin = Math.sin(a);
    vertices.push(cx + innerR * cos, cy + height, cz + innerR * sin);   // top-inner
  }

  const bo = 0, bi = segs, to = 2 * segs, ti = 3 * segs;

  for (let i = 0; i < segs; i++) {
    const next = (i + 1) % segs;

    // Outer wall (CCW from outside)
    indices.push(bo + i, bo + next, to + next);
    indices.push(bo + i, to + next, to + i);

    // Inner wall (CCW from inside → reversed winding)
    indices.push(bi + i, ti + next, bi + next);
    indices.push(bi + i, ti + i, ti + next);

    // Top annulus ring (CCW from above)
    indices.push(to + i, to + next, ti + next);
    indices.push(to + i, ti + next, ti + i);

    // Bottom annulus ring (CCW from below → reversed)
    indices.push(bo + i, bi + next, bo + next);
    indices.push(bo + i, bi + i, bi + next);
  }

  return { vertices, indices };
}

/** Concatenate multiple raw meshes into a single IndexedMesh. */
function mergeMeshes(parts: RawMesh[]): IndexedMesh {
  let totalVerts = 0;
  let totalIndices = 0;
  for (const p of parts) {
    totalVerts += p.vertices.length;
    totalIndices += p.indices.length;
  }

  const vertices = new Float32Array(totalVerts);
  const indices = new Uint32Array(totalIndices);
  let vOffset = 0;  // offset in floats
  let iOffset = 0;  // offset in index entries

  for (const p of parts) {
    vertices.set(p.vertices, vOffset);
    const baseVertex = vOffset / 3; // vertex index offset
    for (let i = 0; i < p.indices.length; i++) {
      indices[iOffset + i] = p.indices[i] + baseVertex;
    }
    vOffset += p.vertices.length;
    iOffset += p.indices.length;
  }

  return { vertices, indices };
}

// ─── Brick Assembly ──────────────────────────────────────────────────────────

/**
 * Build a standard brick or plate mesh (hollow body, studs on top, anti-studs on bottom).
 * Origin at (0, 0, 0). Studs point +Y.
 */
function buildStandardBrick(studW: number, studD: number, bodyHeight: number, config: PrintConfig): IndexedMesh {
  const segs = config.cylinderSegments;
  const tol = config.tolerance;

  const bodyW = studW * STUD_PITCH - 2 * tol;
  const bodyD = studD * STUD_PITCH - 2 * tol;
  const bodyH = bodyHeight;

  const parts: RawMesh[] = [];

  // ── Hollow body: floor, ceiling, 4 walls ──

  // Floor (bottom slab)
  parts.push(makeBox(0, 0, 0, bodyW, FLOOR_THICKNESS, bodyD));

  // Ceiling (top slab)
  parts.push(makeBox(0, bodyH - FLOOR_THICKNESS, 0, bodyW, FLOOR_THICKNESS, bodyD));

  // Left wall (x = 0)
  parts.push(makeBox(0, FLOOR_THICKNESS, 0, WALL_THICKNESS, bodyH - 2 * FLOOR_THICKNESS, bodyD));

  // Right wall (x = bodyW - WALL_THICKNESS)
  parts.push(makeBox(bodyW - WALL_THICKNESS, FLOOR_THICKNESS, 0, WALL_THICKNESS, bodyH - 2 * FLOOR_THICKNESS, bodyD));

  // Front wall (z = 0)
  parts.push(makeBox(WALL_THICKNESS, FLOOR_THICKNESS, 0, bodyW - 2 * WALL_THICKNESS, bodyH - 2 * FLOOR_THICKNESS, WALL_THICKNESS));

  // Back wall (z = bodyD - WALL_THICKNESS)
  parts.push(makeBox(WALL_THICKNESS, FLOOR_THICKNESS, bodyD - WALL_THICKNESS, bodyW - 2 * WALL_THICKNESS, bodyH - 2 * FLOOR_THICKNESS, WALL_THICKNESS));

  // ── Studs on top ──
  const studR = STUD_DIAMETER / 2;
  for (let sz = 0; sz < studD; sz++) {
    for (let sx = 0; sx < studW; sx++) {
      const cx = bodyW / 2 + (sx - (studW - 1) / 2) * STUD_PITCH;
      const cz = bodyD / 2 + (sz - (studD - 1) / 2) * STUD_PITCH;
      parts.push(makeCylinder(cx, bodyH, cz, studR, STUD_HEIGHT, segs));
    }
  }

  // ── Anti-studs on bottom ──
  if (studW >= 2 && studD >= 2) {
    // Tubes at grid intersections between studs
    const tubeOuterR = TUBE_OUTER_D / 2;
    const tubeInnerR = TUBE_INNER_D / 2;
    const tubeH = bodyH - FLOOR_THICKNESS; // from floor slab top to ceiling slab bottom
    for (let tz = 0; tz < studD - 1; tz++) {
      for (let tx = 0; tx < studW - 1; tx++) {
        const cx = bodyW / 2 + (tx - (studW - 2) / 2) * STUD_PITCH;
        const cz = bodyD / 2 + (tz - (studD - 2) / 2) * STUD_PITCH;
        parts.push(makeTube(cx, FLOOR_THICKNESS, cz, tubeOuterR, tubeInnerR, tubeH, segs));
      }
    }
  } else if (studW === 1 && studD > 1) {
    // 1xN: single ridge bar along the interior bottom
    const ridgeW = STUD_DIAMETER; // ridge width matches stud diameter
    const ridgeH = bodyH - 2 * FLOOR_THICKNESS;
    const ridgeD = (studD - 1) * STUD_PITCH;
    const ridgeX = (bodyW - ridgeW) / 2;
    const ridgeZ = (bodyD - ridgeD) / 2;
    parts.push(makeBox(ridgeX, FLOOR_THICKNESS, ridgeZ, ridgeW, ridgeH, ridgeD));
  } else if (studD === 1 && studW > 1) {
    // Nx1 (rotated 1xN): single ridge bar along the other axis
    const ridgeD = STUD_DIAMETER;
    const ridgeH = bodyH - 2 * FLOOR_THICKNESS;
    const ridgeW = (studW - 1) * STUD_PITCH;
    const ridgeX = (bodyW - ridgeW) / 2;
    const ridgeZ = (bodyD - ridgeD) / 2;
    parts.push(makeBox(ridgeX, FLOOR_THICKNESS, ridgeZ, ridgeW, ridgeH, ridgeD));
  }
  // 1x1: no interior features (walls provide interference fit)

  return mergeMeshes(parts);
}

/**
 * Build slope mesh (s_2x2_45).
 * Full 2x2 base, back row at full height with 2 studs, front row slopes down.
 * Anti-stud: 1 tube on the 2x2 bottom.
 */
function buildSlope2x2(config: PrintConfig): IndexedMesh {
  const segs = config.cylinderSegments;
  const tol = config.tolerance;

  const studW = 2, studD = 2;
  const bodyW = studW * STUD_PITCH - 2 * tol;
  const bodyD = studD * STUD_PITCH - 2 * tol;
  const bodyH = BRICK_HEIGHT;

  const parts: RawMesh[] = [];

  // Full-height back half (z from bodyD/2 to bodyD)
  const backZ = bodyD / 2;
  const backD = bodyD / 2;

  // Floor across full footprint
  parts.push(makeBox(0, 0, 0, bodyW, FLOOR_THICKNESS, bodyD));

  // Back section: full-height box (walls + ceiling for back half)
  // Left wall (back)
  parts.push(makeBox(0, FLOOR_THICKNESS, backZ, WALL_THICKNESS, bodyH - FLOOR_THICKNESS, backD));
  // Right wall (back)
  parts.push(makeBox(bodyW - WALL_THICKNESS, FLOOR_THICKNESS, backZ, WALL_THICKNESS, bodyH - FLOOR_THICKNESS, backD));
  // Back wall (z = bodyD)
  parts.push(makeBox(0, FLOOR_THICKNESS, bodyD - WALL_THICKNESS, bodyW, bodyH - FLOOR_THICKNESS, WALL_THICKNESS));
  // Ceiling (back half only)
  parts.push(makeBox(0, bodyH - FLOOR_THICKNESS, backZ, bodyW, FLOOR_THICKNESS, backD));

  // Front section lower walls (z from 0 to bodyD/2)
  const frontD = bodyD / 2;
  // Left wall (front, shorter)
  parts.push(makeBox(0, FLOOR_THICKNESS, 0, WALL_THICKNESS, bodyH - FLOOR_THICKNESS, frontD));
  // Right wall (front, shorter)
  parts.push(makeBox(bodyW - WALL_THICKNESS, FLOOR_THICKNESS, 0, WALL_THICKNESS, bodyH - FLOOR_THICKNESS, frontD));
  // Front wall (z = 0) — just the lower portion
  parts.push(makeBox(0, FLOOR_THICKNESS, 0, bodyW, WALL_THICKNESS, WALL_THICKNESS));

  // ── Sloped face ──
  // Wedge from front-top-of-front-wall to back-top-of-ceiling
  // Front edge: y = FLOOR_THICKNESS + WALL_THICKNESS at z = WALL_THICKNESS
  // Back edge:  y = bodyH at z = backZ
  // We approximate the slope as two triangular prism faces (left and right triangles)
  // plus the slope surface itself.

  const slopeY0 = FLOOR_THICKNESS + WALL_THICKNESS; // front edge height
  const slopeY1 = bodyH;                             // back edge height
  const slopeZ0 = WALL_THICKNESS;                    // front edge z
  const slopeZ1 = backZ;                             // back edge z

  // Slope surface: a quad from front-low to back-high, full width
  const slopeVerts: number[] = [
    WALL_THICKNESS,            slopeY0, slopeZ0,  // 0: front-left
    bodyW - WALL_THICKNESS,    slopeY0, slopeZ0,  // 1: front-right
    bodyW - WALL_THICKNESS,    slopeY1, slopeZ1,  // 2: back-right
    WALL_THICKNESS,            slopeY1, slopeZ1,  // 3: back-left
  ];
  // CCW from above/outside the slope surface (normal points up-and-forward)
  const slopeIdx = [0, 2, 1, 0, 3, 2];
  parts.push({ vertices: slopeVerts, indices: slopeIdx });

  // Left triangular fill (close the gap between left wall and slope)
  const leftTriVerts: number[] = [
    WALL_THICKNESS, slopeY0, slopeZ0,  // 0: front-low
    WALL_THICKNESS, slopeY1, slopeZ1,  // 1: back-high
    WALL_THICKNESS, slopeY1, slopeZ0,  // 2: back-low (top of left wall at backZ)
  ];
  parts.push({ vertices: leftTriVerts, indices: [0, 1, 2] });

  // Right triangular fill
  const rightTriVerts: number[] = [
    bodyW - WALL_THICKNESS, slopeY0, slopeZ0,  // 0: front-low
    bodyW - WALL_THICKNESS, slopeY1, slopeZ1,  // 1: back-high
    bodyW - WALL_THICKNESS, slopeY1, slopeZ0,  // 2: back-low
  ];
  parts.push({ vertices: rightTriVerts, indices: [0, 2, 1] });

  // ── Studs on back row only (2 studs) ──
  const studR = STUD_DIAMETER / 2;
  for (let sx = 0; sx < studW; sx++) {
    const cx = bodyW / 2 + (sx - (studW - 1) / 2) * STUD_PITCH;
    // Back row studs: centered in back half
    const cz = bodyD / 2 + (bodyD / 2) / 2;
    parts.push(makeCylinder(cx, bodyH, cz, studR, STUD_HEIGHT, segs));
  }

  // ── Anti-stud tube (1 tube at center of 2x2 bottom) ──
  const tubeOuterR = TUBE_OUTER_D / 2;
  const tubeInnerR = TUBE_INNER_D / 2;
  const tubeH = bodyH - FLOOR_THICKNESS;
  parts.push(makeTube(bodyW / 2, FLOOR_THICKNESS, bodyD / 2, tubeOuterR, tubeInnerR, tubeH, segs));

  return mergeMeshes(parts);
}

/**
 * Generate a printable mesh for any brick in the catalog.
 * Returns geometry in mm with origin at (0, 0, 0), studs pointing +Y.
 */
export function generateBrickMesh(brickId: string, config?: Partial<PrintConfig>): IndexedMesh {
  const cfg: PrintConfig = { ...DEFAULT_CONFIG, ...config };
  const def = getBrickDef(brickId);
  if (!def) {
    throw new Error(`Unknown brick ID: ${brickId}`);
  }

  if (def.type === 'slope' && brickId === 's_2x2_45') {
    return buildSlope2x2(cfg);
  }

  // Standard brick or plate
  const bodyHeight = def.height * PLATE_HEIGHT; // height is in plate units
  return buildStandardBrick(def.width, def.depth, bodyHeight, cfg);
}

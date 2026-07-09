/** Indexed triangle mesh — all dimensions in millimeters. */
export interface IndexedMesh {
  vertices: Float32Array; // [x0,y0,z0, x1,y1,z1, ...]
  indices: Uint32Array; // [i0,i1,i2, ...] triangle indices
}

export interface PrintConfig {
  tolerance: number; // Extra clearance per side in mm (default 0.1)
  cylinderSegments: number; // Tessellation for studs/tubes (default 16)
}

export interface BedBrick {
  brickId: string;
  bedPosition: [number, number]; // x, z offset on bed (mm)
  mesh: IndexedMesh;
  rotated?: boolean; // true when packed footprint is rotated 90 degrees on the bed
}

export interface PrintPlate {
  color: string; // hex
  colorName: string;
  bricks: BedBrick[];
  bounds: [number, number, number]; // maxX, maxY, maxZ in mm
}

export interface BedPackingResult {
  plates: PrintPlate[];
  bedSize: { width: number; depth: number };
}

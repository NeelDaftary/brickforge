export type Vector3 = [number, number, number]; // x, y, z coordinates

export interface VoxelData {
  grid: string[][][];                    // [x][y][z] color symbols
  colorLegend: Record<string, string>;   // symbol → hex
  gridSize: number;
}

export type BrickType = 'brick' | 'plate' | 'tile' | 'slope' | 'round';

export interface BrickDefinition {
  id: string;          // Internal ID (e.g., "b_2x4")
  name: string;        // Human readable (e.g., "2x4 Brick")
  bricklinkId: string; // For export later
  type: BrickType;
  width: number;       // In stud units
  depth: number;       // In stud units
  height: number;      // In plate units (1 brick = 3 plates)
}

export interface BrickInstance {
  id: string;          // Unique UUID for this specific brick in the model
  brickId: string;     // Reference to BrickDefinition (e.g., "b_2x4")
  position: Vector3;   // Position in grid units
  rotation: 0 | 90 | 180 | 270;
  /** Actual stud width (viewer X-axis) from grid placement. Use for rendering. */
  studWidth?: number;
  /** Actual stud depth (viewer Z-axis) from grid placement. Use for rendering. */
  studDepth?: number;
  color: string;       // Hex code
  step: number;        // Which step this brick is added
  metadata?: {
    gx?: number; gy?: number; gz?: number; // Grid origin
    gw?: number; gd?: number;              // Grid extent (studs)
  };
}

export interface BrickModelData {
  name: string;
  description: string;
  totalBricks: number;
  bricks: BrickInstance[];
  voxelData?: VoxelData;
}


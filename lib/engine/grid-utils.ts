/**
 * Grid expansion utility for voxel editing.
 *
 * When users add voxels beyond the current grid bounds,
 * this expands the 3D grid in the required direction(s).
 */

const MAX_GRID_SIZE = 64;

export interface ExpandResult {
  grid: string[][][];
  offsetX: number;
  offsetY: number;
  offsetZ: number;
}

/**
 * Expand the grid if `(targetX, targetY, targetZ)` falls outside current bounds.
 * Returns the (possibly enlarged) grid and the offsets applied to existing data.
 *
 * - Pads by 1 cell in each direction that overflows.
 * - Caps total size at 64x64x64.
 * - If target is already in bounds, returns the grid unchanged (offsets = 0).
 */
export function expandGridIfNeeded(
  grid: string[][][],
  targetX: number,
  targetY: number,
  targetZ: number,
): ExpandResult {
  const sizeX = grid.length;
  const sizeY = sizeX > 0 ? grid[0].length : 0;
  const sizeZ = sizeY > 0 ? grid[0][0].length : 0;

  // Check if target is already within bounds
  if (
    targetX >= 0 && targetX < sizeX &&
    targetY >= 0 && targetY < sizeY &&
    targetZ >= 0 && targetZ < sizeZ
  ) {
    return { grid, offsetX: 0, offsetY: 0, offsetZ: 0 };
  }

  // Compute padding needed in each direction
  const padXBefore = targetX < 0 ? -targetX : 0;
  const padXAfter = targetX >= sizeX ? targetX - sizeX + 1 : 0;
  const padYBefore = targetY < 0 ? -targetY : 0;
  const padYAfter = targetY >= sizeY ? targetY - sizeY + 1 : 0;
  const padZBefore = targetZ < 0 ? -targetZ : 0;
  const padZAfter = targetZ >= sizeZ ? targetZ - sizeZ + 1 : 0;

  const newSizeX = Math.min(sizeX + padXBefore + padXAfter, MAX_GRID_SIZE);
  const newSizeY = Math.min(sizeY + padYBefore + padYAfter, MAX_GRID_SIZE);
  const newSizeZ = Math.min(sizeZ + padZBefore + padZAfter, MAX_GRID_SIZE);

  // Create new grid filled with '0'
  const newGrid: string[][][] = [];
  for (let x = 0; x < newSizeX; x++) {
    const plane: string[][] = [];
    for (let y = 0; y < newSizeY; y++) {
      plane.push(new Array(newSizeZ).fill('0'));
    }
    newGrid.push(plane);
  }

  // Copy existing data at the offset
  for (let x = 0; x < sizeX; x++) {
    for (let y = 0; y < sizeY; y++) {
      for (let z = 0; z < sizeZ; z++) {
        const nx = x + padXBefore;
        const ny = y + padYBefore;
        const nz = z + padZBefore;
        if (nx < newSizeX && ny < newSizeY && nz < newSizeZ) {
          newGrid[nx][ny][nz] = grid[x][y][z];
        }
      }
    }
  }

  return {
    grid: newGrid,
    offsetX: padXBefore,
    offsetY: padYBefore,
    offsetZ: padZBefore,
  };
}

/**
 * BFS flood fill on a voxel grid.
 *
 * Starting from (startX, startY, startZ), finds all 6-connected voxels
 * that share the same color symbol. Skips empty ('0') and wildcard ('*')
 * voxels — only boundary voxels participate in the fill.
 *
 * Returns a Set of "x,y,z" coordinate keys that should be repainted.
 */

const WILDCARD = '*';

export function floodFill(
  grid: string[][][],
  startX: number,
  startY: number,
  startZ: number,
): Set<string> {
  const sizeX = grid.length;
  const sizeY = sizeX > 0 ? grid[0].length : 0;
  const sizeZ = sizeY > 0 ? grid[0][0].length : 0;

  const targetSymbol = grid[startX]?.[startY]?.[startZ];
  if (!targetSymbol || targetSymbol === '0' || targetSymbol === WILDCARD) {
    return new Set();
  }

  const result = new Set<string>();
  const visited = new Set<string>();
  const queue: [number, number, number][] = [[startX, startY, startZ]];
  const startKey = `${startX},${startY},${startZ}`;
  visited.add(startKey);

  const DX = [1, -1, 0, 0, 0, 0];
  const DY = [0, 0, 1, -1, 0, 0];
  const DZ = [0, 0, 0, 0, 1, -1];

  let head = 0;
  while (head < queue.length) {
    const [cx, cy, cz] = queue[head++];
    result.add(`${cx},${cy},${cz}`);

    for (let d = 0; d < 6; d++) {
      const nx = cx + DX[d];
      const ny = cy + DY[d];
      const nz = cz + DZ[d];
      if (nx < 0 || nx >= sizeX || ny < 0 || ny >= sizeY || nz < 0 || nz >= sizeZ) continue;
      const key = `${nx},${ny},${nz}`;
      if (visited.has(key)) continue;
      visited.add(key);
      const sym = grid[nx][ny][nz];
      if (sym === targetSymbol) {
        queue.push([nx, ny, nz]);
      }
    }
  }

  return result;
}

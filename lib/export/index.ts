export type {
  IndexedMesh,
  PrintConfig,
  BedBrick,
  PrintPlate,
  BedPackingResult,
} from './types';

export { generateBrickMesh } from './brick-geometry';
export { packBed } from './bed-packer';
export type { BedPackerOptions } from './bed-packer';
export { meshToSTL, plateToSTL } from './stl-writer';

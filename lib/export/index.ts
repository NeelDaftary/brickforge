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
export { planPrintBeds } from './print-planner';
export type { PrintBedConfig, PrintBed, PrintPlan } from './print-planner';

import { access } from 'node:fs/promises';
import path from 'node:path';

export type MeshFormat = 'blend' | 'glb' | 'obj' | 'stl' | 'ply' | 'unknown';

export interface MeshPreflightResult {
  inputPath: string;
  resolvedPath: string;
  format: MeshFormat;
  isSupported: boolean;
  shouldProceed: boolean;
  warnings: string[];
  errors: string[];
}

const SUPPORTED_FORMATS: MeshFormat[] = ['blend', 'glb', 'obj', 'stl', 'ply'];

function detectFormat(filePath: string): MeshFormat {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, MeshFormat> = {
    '.blend': 'blend',
    '.glb': 'glb',
    '.obj': 'obj',
    '.stl': 'stl',
    '.ply': 'ply',
  };
  return map[ext] ?? 'unknown';
}

export async function preflightMeshPath(inputPath: string): Promise<MeshPreflightResult> {
  const resolvedPath = path.isAbsolute(inputPath)
    ? path.normalize(inputPath)
    : path.resolve(process.cwd(), inputPath);
  const format = detectFormat(resolvedPath);
  const warnings: string[] = [];
  const errors: string[] = [];

  try {
    await access(resolvedPath);
  } catch {
    errors.push(`Mesh file does not exist or is not readable: ${resolvedPath}`);
  }

  const isSupported = SUPPORTED_FORMATS.includes(format);
  if (!isSupported) {
    errors.push('Unsupported format. Supported: .blend, .glb, .obj, .stl, .ply.');
  }

  return {
    inputPath,
    resolvedPath,
    format,
    isSupported,
    shouldProceed: errors.length === 0 && isSupported,
    warnings,
    errors,
  };
}

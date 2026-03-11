import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

export type MeshFormat = 'obj' | 'stl' | 'ply' | 'glb' | 'blend' | 'unknown';

export interface MeshPreflightResult {
  inputPath: string;
  resolvedPath: string;
  format: MeshFormat;
  isSupported: boolean;
  shouldProceed: boolean;
  warnings: string[];
  errors: string[];
  recommendations: string[];
  objMeta?: {
    hasMtllib: boolean;
    hasUseMtl: boolean;
    declaredMtlFiles: string[];
    missingMtlFiles: string[];
  };
}

function detectFormat(filePath: string): MeshFormat {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.obj') return 'obj';
  if (ext === '.stl') return 'stl';
  if (ext === '.ply') return 'ply';
  if (ext === '.glb') return 'glb';
  if (ext === '.blend') return 'blend';
  return 'unknown';
}

function baseRecommendations(): string[] {
  return [
    'Best format: .blend file with UV-mapped textures for native Blender Geometry Nodes voxelization.',
    'GLB with baked vertex colors also works well (imported into Blender automatically).',
    'Keep the mesh watertight/manifold for accurate inside/outside voxel tests.',
  ];
}

export async function preflightMeshPath(inputPath: string): Promise<MeshPreflightResult> {
  const resolvedPath = path.isAbsolute(inputPath)
    ? path.normalize(inputPath)
    : path.resolve(process.cwd(), inputPath);
  const format = detectFormat(resolvedPath);
  const warnings: string[] = [];
  const errors: string[] = [];
  const recommendations = baseRecommendations();

  try {
    await access(resolvedPath);
  } catch {
    errors.push(`Mesh file does not exist or is not readable: ${resolvedPath}`);
  }

  const isSupported = format === 'obj' || format === 'stl' || format === 'ply' || format === 'glb' || format === 'blend';
  if (!isSupported) {
    errors.push('Unsupported mesh format. Current pipeline supports .blend, .obj, .stl, .ply, and .glb.');
    recommendations.unshift('Best quality path: use a .blend file with UV-mapped textures. GLB with baked vertex colors also works well.');
  }

  let objMeta: MeshPreflightResult['objMeta'];
  if (errors.length === 0 && format === 'obj') {
    const objRaw = await readFile(resolvedPath, 'utf8');
    const mtllibMatches = objRaw.match(/^mtllib\s+(.+)$/gm) ?? [];
    const useMtlMatches = objRaw.match(/^usemtl\s+(.+)$/gm) ?? [];

    const declaredMtlFiles = mtllibMatches
      .map((line) => line.replace(/^mtllib\s+/i, '').trim())
      .filter(Boolean);

    const missingMtlFiles: string[] = [];
    for (const mtlFile of declaredMtlFiles) {
      const mtlPath = path.resolve(path.dirname(resolvedPath), mtlFile);
      try {
        await access(mtlPath);
      } catch {
        missingMtlFiles.push(mtlFile);
      }
    }

    objMeta = {
      hasMtllib: declaredMtlFiles.length > 0,
      hasUseMtl: useMtlMatches.length > 0,
      declaredMtlFiles,
      missingMtlFiles,
    };

    if (!objMeta.hasMtllib) {
      warnings.push('OBJ does not reference an MTL file. Geometry voxelization will work, but color fidelity may be reduced.');
    }
    if (objMeta.hasMtllib && objMeta.missingMtlFiles.length > 0) {
      warnings.push(`Missing MTL file(s): ${objMeta.missingMtlFiles.join(', ')}. Model may voxelize as mostly grey.`);
    }
    if (!objMeta.hasUseMtl) {
      warnings.push('OBJ does not use per-face materials (`usemtl`). Color palette mapping may collapse to a single color.');
    }
  }

  if (format === 'stl') {
    warnings.push('STL contains geometry only (no material colors). Result will use fallback LEGO colors.');
    recommendations.unshift('For best color results, prefer .blend files with UV-mapped textures.');
  } else if (format === 'ply') {
    warnings.push('PLY averages vertex colors at shared vertices, which can blur color boundaries. .blend files are preferred.');
  } else if (format === 'obj') {
    recommendations.unshift('OBJ+MTL is supported but .blend files with UV textures give better color fidelity.');
  }

  return {
    inputPath,
    resolvedPath,
    format,
    isSupported,
    shouldProceed: errors.length === 0 && isSupported,
    warnings,
    errors,
    recommendations,
    objMeta,
  };
}

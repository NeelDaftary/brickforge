import type { PipelineErrorCode } from './errors';

export type BuildNoteTone = 'info' | 'warning' | 'danger';

export interface BuildNote {
  category: 'stability' | 'color' | 'file' | 'export' | 'general';
  tone: BuildNoteTone;
  title: string;
  message: string;
  details?: string[];
}

export interface ErrorPayloadLike {
  code?: PipelineErrorCode | string;
  error?: string;
}

function cleanTechnicalText(text: string): string {
  return text
    .replaceAll('stability_v2', 'the stability engine')
    .replaceAll('Stability V2:', 'Stability:')
    .trim();
}

function noteForWarning(warning: string): BuildNote {
  const lower = warning.toLowerCase();
  const details = cleanTechnicalText(warning);

  if (lower.startsWith('color:') || lower.includes('color') || lower.includes('material')) {
    return {
      category: 'color',
      tone: 'info',
      title: 'Colors may be simplified',
      message: 'The source file may not expose all material or texture data. Review the colors before exporting.',
      details: [details],
    };
  }

  if (lower.includes('unsupported') || lower.includes('cantilever') || lower.includes('floating') || lower.includes('stability')) {
    return {
      category: 'stability',
      tone: lower.includes('critical') || lower.includes('floating') ? 'danger' : 'warning',
      title: 'Some areas need support',
      message: 'Inspect the highlighted areas, then use Repair, Retile, or manual Build tools before printing.',
      details: [details],
    };
  }

  if (lower.includes('file') || lower.includes('mesh') || lower.includes('upload') || lower.includes('blender')) {
    return {
      category: 'file',
      tone: 'warning',
      title: 'This file may need cleanup',
      message: 'The source model may need a simpler mesh, clearer materials, or a different object selection.',
      details: [details],
    };
  }

  if (lower.includes('export') || lower.includes('stl') || lower.includes('print')) {
    return {
      category: 'export',
      tone: 'warning',
      title: 'Print export needs attention',
      message: 'Check the exported plate in your slicer before starting a print.',
      details: [details],
    };
  }

  return {
    category: 'general',
    tone: 'info',
    title: 'Build note',
    message: cleanTechnicalText(warning),
  };
}

export function buildNotesFromWarnings(warnings: string[]): BuildNote[] {
  const byCategory = new Map<BuildNote['category'], BuildNote>();
  for (const warning of warnings) {
    const note = noteForWarning(warning);
    const existing = byCategory.get(note.category);
    if (!existing) {
      byCategory.set(note.category, note);
      continue;
    }
    byCategory.set(note.category, {
      ...existing,
      tone: existing.tone === 'danger' || note.tone === 'danger'
        ? 'danger'
        : existing.tone === 'warning' || note.tone === 'warning'
          ? 'warning'
          : 'info',
      details: [...(existing.details ?? []), ...(note.details ?? [])],
    });
  }
  return [...byCategory.values()];
}

export function userFacingErrorMessage(payload: ErrorPayloadLike | string | null | undefined, fallback = 'Something went wrong.'): string {
  const error = typeof payload === 'string' ? payload : payload?.error;
  const code = typeof payload === 'string' ? undefined : payload?.code;

  if (code === 'BLENDER_UNAVAILABLE') return 'Blender is not available. Install Blender 3.6+ or set BLENDER_PATH, then try again.';
  if (code === 'UPLOAD_TOO_LARGE') return 'That file is too large for this workspace. Try a simplified mesh under the upload limit.';
  if (code === 'UPLOAD_INVALID_FILE') return 'That file type or file contents are not supported. Use .blend, .glb, .obj, .stl, or .ply.';
  if (code === 'MESH_PREFLIGHT_FAILED') return 'The mesh could not be read cleanly. Check that the file opens in Blender and try again.';
  if (code === 'VOXELIZATION_FAILED') return 'BrickForge could not voxelize this model. Try a larger scale, simpler mesh, or a different object name.';
  if (code === 'EXPORT_FAILED') return 'The print export failed. Save the build, refresh, and try exporting again.';
  if (code === 'INVALID_INPUT') return cleanTechnicalText(error ?? 'The input was incomplete. Check the file or selection and try again.');
  if (error) return cleanTechnicalText(error);
  return fallback;
}

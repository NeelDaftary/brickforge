export interface MeshBoundsLike {
  width: number;
  depth: number;
  height: number;
  maxExtent: number;
}

export type UploadGuardrailTone = 'info' | 'warning';

export interface UploadGuardrail {
  tone: UploadGuardrailTone;
  message: string;
}

function extensionOf(fileName: string): string {
  const index = fileName.lastIndexOf('.');
  return index >= 0 ? fileName.slice(index).toLowerCase() : '';
}

function formatMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function fileGuardrails(fileName: string, fileSizeBytes: number): UploadGuardrail[] {
  const ext = extensionOf(fileName);
  const guardrails: UploadGuardrail[] = [];

  if (fileSizeBytes > 35 * 1024 * 1024) {
    guardrails.push({
      tone: 'warning',
      message: `Large file (${formatMb(fileSizeBytes)}). Build time may be slow; decimating the mesh first usually helps.`,
    });
  }

  if (ext === '.stl') {
    guardrails.push({
      tone: 'warning',
      message: 'STL has no material or color data, so this will likely import as a single-color build.',
    });
  } else if (ext === '.obj') {
    guardrails.push({
      tone: 'info',
      message: 'OBJ colors depend on its companion .mtl/textures. If they are missing, the build may come in grey.',
    });
  } else if (ext === '.glb') {
    guardrails.push({
      tone: 'info',
      message: 'GLB color quality depends on embedded materials. If colors look flat, try the original .blend when possible.',
    });
  } else if (ext === '.blend') {
    guardrails.push({
      tone: 'info',
      message: 'Blend files usually preserve materials best. Choose the exact object name if the scene contains multiple objects.',
    });
  }

  return guardrails;
}

export function buildGuardrails(bounds: MeshBoundsLike, voxelSize: number): UploadGuardrail[] {
  const widthStuds = Math.ceil(bounds.width / voxelSize);
  const depthStuds = Math.ceil(bounds.depth / voxelSize);
  const heightStuds = Math.ceil(bounds.height / voxelSize);
  const maxStuds = Math.max(widthStuds, depthStuds, heightStuds);
  const minStuds = Math.min(widthStuds, depthStuds, heightStuds);
  const estimatedCells = widthStuds * depthStuds * heightStuds;
  const guardrails: UploadGuardrail[] = [];

  if (maxStuds >= 80 || estimatedCells > 350_000) {
    guardrails.push({
      tone: 'warning',
      message: `Large voxel grid estimate (${widthStuds} x ${depthStuds} x ${heightStuds}). Expect slower processing and a high brick count.`,
    });
  }

  if (maxStuds < 24) {
    guardrails.push({
      tone: 'info',
      message: 'This is a compact build. Small color regions, fingers, horns, and thin features may collapse into simpler bricks.',
    });
  }

  if (minStuds > 0 && minStuds <= 2) {
    guardrails.push({
      tone: 'warning',
      message: 'One dimension is very thin at this scale. Thin shells or fins may disappear during voxelization.',
    });
  }

  if (minStuds > 0 && maxStuds / minStuds >= 6) {
    guardrails.push({
      tone: 'info',
      message: 'The model is very elongated. A different pose or orientation may produce a more stable LEGO build.',
    });
  }

  return guardrails;
}

import { NextRequest, NextResponse } from 'next/server';
import { zipSync } from 'fflate';
import type { BrickModelData } from '@/lib/engine/types';
import { generateBOM } from '@/lib/engine/bom-generator';
import { packBed } from '@/lib/export/bed-packer';
import { plateToSTL } from '@/lib/export/stl-writer';
import { planPrintBeds } from '@/lib/export/print-planner';

export async function POST(req: NextRequest) {
  try {
    const { model, exportName } = (await req.json()) as {
      model: BrickModelData;
      exportName: string;
    };

    if (!model?.bricks?.length) {
      return NextResponse.json({ error: 'No bricks in model' }, { status: 400 });
    }

    const safeName = (exportName || model.name || 'build')
      .replace(/[^a-zA-Z0-9_\- ]/g, '')
      .trim()
      .replace(/\s+/g, '_');

    // Pack beds + generate meshes
    const result = packBed(model);

    // Generate STL buffers
    const files: Record<string, Uint8Array> = {};

    for (let i = 0; i < result.plates.length; i++) {
      const plate = result.plates[i];
      const stlBuffer = plateToSTL(plate);
      const colorSafe = plate.colorName.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
      const fileName = `${safeName}/plate_${String(i + 1).padStart(2, '0')}_${colorSafe}.stl`;
      files[fileName] = new Uint8Array(stlBuffer);
    }

    // Generate BOM summary as text file
    const bom = generateBOM(model);
    const plan = planPrintBeds(bom);
    const bomLines: string[] = [
      `BrickForge Export: ${exportName || model.name}`,
      `Total bricks: ${model.totalBricks}`,
      `Print beds: ${plan.totalBeds}`,
      `Colors: ${plan.colorSummary.length}`,
      '',
      '── Bill of Materials ──',
      '',
      'Part             Color            Count   BrickLink',
      '─'.repeat(55),
    ];
    for (const item of bom) {
      bomLines.push(
        `${item.displayName.padEnd(17)}${item.colorName.padEnd(17)}${String(item.count).padStart(5)}   ${item.bricklinkPartId}`,
      );
    }
    bomLines.push('', '── Print Beds ──', '');
    for (const bed of plan.beds) {
      const label = plan.colorSummary.find(c => c.color === bed.color);
      const bedLabel = label && label.beds > 1 ? ` (bed ${bed.bedIndex + 1}/${label.beds})` : '';
      bomLines.push(`${bed.colorName}${bedLabel}  —  ${bed.brickCount} bricks  —  ${(bed.utilization * 100).toFixed(0)}% utilization`);
    }

    files[`${safeName}/parts_list.txt`] = new TextEncoder().encode(bomLines.join('\n'));

    // Zip everything
    const zipped = zipSync(files, { level: 6 });

    return new NextResponse(Buffer.from(zipped), {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${safeName}.zip"`,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Export failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

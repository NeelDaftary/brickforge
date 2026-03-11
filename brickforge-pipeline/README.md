# BrickForge Pipeline (Python Core)

Python implementation of the voxel optimization pipeline used by the Next.js app.

## CLI

```bash
python3 "brickforge-pipeline/src/cli.py" optimize \
  --input "house_voxels_25.json" \
  --output ".tmp/optimized.json"
```

The output JSON includes optimized brick placements, layer data, and diagnostics.

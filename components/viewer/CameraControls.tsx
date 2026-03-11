'use client';

import { OrbitControls } from '@react-three/drei';

interface CameraControlsProps {
  autoRotate?: boolean;
}

export function CameraControls({ autoRotate = false }: CameraControlsProps) {
  return (
    <OrbitControls
      makeDefault
      enablePan
      enableZoom
      screenSpacePanning
      minPolarAngle={0.05}
      maxPolarAngle={Math.PI / 1.8}
      autoRotate={autoRotate}
      autoRotateSpeed={0.8}
    />
  );
}

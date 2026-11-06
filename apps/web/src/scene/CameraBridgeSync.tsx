import { useFrame } from '@react-three/fiber';
import { cameraBridge } from './cameraBridge';

export function CameraBridgeSync() {
  useFrame(({ camera, size }) => {
    cameraBridge.camera = camera;
    cameraBridge.width = size.width;
    cameraBridge.height = size.height;
  });
  return null;
}

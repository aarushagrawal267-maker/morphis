/**
 * Scene graph root.
 *
 * City
 *  ├── Environment (sky, lights, fog, weather)
 *  ├── Ground / Parks
 *  ├── Roads (+ traffic lights)
 *  ├── Buildings (+ JARVIS HQ, signs)
 *  ├── Props
 *  ├── Citizens
 *  ├── Vehicles
 *  ├── District pins / highlights
 *  └── Selection, debug, effects
 */
import { Suspense } from 'react';
import { useUI } from '../state/uiStore';
import { Buildings } from './buildings/Buildings';
import { HQ } from './buildings/HQ';
import { CameraRig } from './camera/CameraRig';
import { CameraBridgeSync } from './CameraBridgeSync';
import { PerfProbe } from './PerfProbe';
import { Citizens } from './citizens/Citizens';
import { DebugLayers } from './debug/DebugLayers';
import { DistrictPins } from './districts/DistrictPins';
import { Effects } from './effects/Effects';
import { EnvironmentController, Ground, Rain, SkyDome } from './environment/Environment';
import { Skyline } from './environment/Skyline';
import { Interior } from './interiors/Interior';
import { Props } from './props/Props';
import { Signs } from './props/Signs';
import { Roads } from './roads/Roads';
import { SelectionOverlay } from './Selection';
import { Vehicles } from './vehicles/Vehicles';

export function CityScene() {
  const interior = useUI((s) => s.interior);
  return (
    <>
      <Suspense fallback={null}>
        <EnvironmentController />
      </Suspense>
      <CameraRig />
      <CameraBridgeSync />
      <PerfProbe />
      {interior ? (
        <Interior buildingId={interior.buildingId} />
      ) : (
        <>
          <SkyDome />
          <Ground />
          <Roads />
          <Buildings />
          <HQ />
          <Signs />
          <Props />
          <Skyline />
          <Citizens />
          <Vehicles />
          <DistrictPins />
          <SelectionOverlay />
          <Rain />
          <DebugLayers />
        </>
      )}
      <Suspense fallback={null}>
        <Effects />
      </Suspense>
    </>
  );
}

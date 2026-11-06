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
import { useGuest } from '../state/guestStore';
import { AudioDirector } from '../audio/AudioDirector';
import { useUI } from '../state/uiStore';
import { usePostcard } from './guest/actions';
import { GuestController } from './guest/Guest';
import { InteriorGuest } from './guest/InteriorGuest';
import { OtherVisitors, PresenceSender } from './guest/Visitors';
import { PostcardCapture } from './guest/PostcardCapture';
import { Skyrail } from './rail/Skyrail';
import { VentureSites } from './buildings/VentureSites';
import { Fireflies } from './props/Fireflies';
import { StreetGlow } from './props/StreetGlow';
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
import { IslandWorld } from './environment/Island';
import { useSim } from '../state/simStore';
import { Interior } from './interiors/Interior';
import { Props } from './props/Props';
import { Signs } from './props/Signs';
import { Roads } from './roads/Roads';
import { SelectionOverlay } from './Selection';
import { Vehicles } from './vehicles/Vehicles';

export function CityScene() {
  const interior = useUI((s) => s.interior);
  const walking = useGuest((s) => s.active);
  const postcard = usePostcard((s) => s.pending);
  const island = useSim((s) => !!s.world?.island);
  return (
    <>
      <Suspense fallback={null}>
        <EnvironmentController />
      </Suspense>
      {walking ? interior ? <InteriorGuest buildingId={interior.buildingId} /> : <GuestController /> : <CameraRig />}
      {postcard && <PostcardCapture />}
      <AudioDirector />
      <PresenceSender />
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
          <Fireflies />
          <StreetGlow />
          {island ? <IslandWorld /> : <Skyline />}
          <Skyrail />
          <VentureSites />
          <Citizens />
          <OtherVisitors />
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

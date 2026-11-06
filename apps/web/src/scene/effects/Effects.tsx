/** Post-processing: selective-feeling bloom (only bright emissives pass the threshold), tone mapping, vignette. */
import { Bloom, EffectComposer, N8AO, SMAA, ToneMapping, Vignette } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import { useUI } from '../../state/uiStore';

export function Effects() {
  const q = useUI((s) => s.quality);
  if (!q.bloom && !q.ao) return null;
  return (
    <EffectComposer multisampling={0}>
      <>{q.ao ? <N8AO halfRes aoRadius={4} intensity={1.6} distanceFalloff={1} /> : null}</>
      <>{q.bloom ? <Bloom mipmapBlur intensity={0.85} luminanceThreshold={0.9} luminanceSmoothing={0.25} radius={0.7} /> : null}</>
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      <SMAA />
      <Vignette offset={0.28} darkness={0.55} />
    </EffectComposer>
  );
}

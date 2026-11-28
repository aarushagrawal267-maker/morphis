/** Small mono tag that says who produced an agent's words: a connected AI model or the simulation. */
export function SourceTag({ by }: { by?: 'ai' | 'sim' }) {
  const ai = by === 'ai';
  return (
    <em className={`src-tag ${ai ? 'src-tag--ai' : ''}`} title={ai ? 'Written by the connected AI model' : 'Written by the simulation'}>
      {ai ? 'AI' : 'SIM'}
    </em>
  );
}

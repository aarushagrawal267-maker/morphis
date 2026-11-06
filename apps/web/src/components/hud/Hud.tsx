/** 2D product interface layered over the 3D city. */
import { useSim } from '../../state/simStore';
import { useUI } from '../../state/uiStore';
import { useGuest } from '../../state/guestStore';
import { InteriorPanel } from '../panels/InteriorPanel';
import { AgentsPanel, JournalPanel, LookPanel, Welcome } from '../panels/Life';
import { GuestHud } from './GuestHud';
import { SelectionPanel } from '../panels/SelectionPanel';
import { JarvisConsole, ProfileModal, ProjectsPanel, TaskModal } from '../panels/Workforce';
import { AgentStream, BottomBar, KeyFeatures, NewsFeed, Toasts } from './Feeds';
import { Minimap } from './Minimap';
import { CityStory, ClockPanel, DebugOverlay, SavesPanel, SettingsPanel } from './Panels';
import { PinOverlay } from './PinOverlay';
import { CityInfo, NavBar, TopHeader } from './TopBar';

export function Hud() {
  const ready = useSim((s) => s.ready);
  const fading = useUI((s) => s.fading);
  const walking = useGuest((s) => s.active);
  if (!ready) return null;
  return (
    <div className={`hud ${walking ? 'hud--walking' : ''}`}>
      {!walking && <PinOverlay />}
      <TopHeader />
      {!walking && <NavBar />}
      <GuestHud />
      <div className="col-left">
        {!walking && <CityInfo />}
        <JournalPanel />
        <LookPanel />
        <AgentsPanel />
        <KeyFeatures />
        <CityStory />
        <NewsFeed />
        <ClockPanel />
        <SettingsPanel />
        <SavesPanel />
        {!walking && <AgentStream />}
      </div>
      <div className="col-right">
        <SelectionPanel />
        <InteriorPanel />
        <Minimap />
      </div>
      <div className="col-wide">
        <JarvisConsole />
        <ProjectsPanel />
        <ProfileModal />
        <TaskModal />
      </div>
      <DebugOverlay />
      {!walking && <BottomBar />}
      <Toasts />
      <Welcome />
      <div className={`fade ${fading ? 'on' : ''}`} />
    </div>
  );
}

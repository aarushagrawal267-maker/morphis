/** 2D product interface layered over the 3D city. */
import { useSim } from '../../state/simStore';
import { useUI } from '../../state/uiStore';
import { InteriorPanel } from '../panels/InteriorPanel';
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
  if (!ready) return null;
  return (
    <div className="hud">
      <PinOverlay />
      <TopHeader />
      <NavBar />
      <div className="col-left">
        <CityInfo />
        <KeyFeatures />
        <CityStory />
        <NewsFeed />
        <ClockPanel />
        <SettingsPanel />
        <SavesPanel />
        <AgentStream />
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
      <BottomBar />
      <Toasts />
      <div className={`fade ${fading ? 'on' : ''}`} />
    </div>
  );
}

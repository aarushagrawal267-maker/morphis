import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import './styles/global.css';
import './styles/hud.css';

// StrictMode is intentionally not used: its double-mount breaks drei <Html> portals in React 19.
createRoot(document.getElementById('root')!).render(<App />);

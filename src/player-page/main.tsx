import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
// Inter — same text font as the animecix.tv website (bundled locally, no CDN)
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/700.css';
import '@vidstack/react/player/styles/base.css';
import './components/EmbedPlayer.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MediaPlayer, MediaProvider } from '@vidstack/react';

import { GlassControls } from '../../src/player-page/components/GlassControls';
import { useAnnouncementsPref } from '../../src/player-page/components/playerPrefs';
import '@vidstack/react/player/styles/base.css';
import '../../src/player-page/components/EmbedPlayer.css';

function Harness() {
  const [announcements, setAnnouncements] = useAnnouncementsPref();
  const [panelOpen, setPanelOpen] = useState(false);

  return (
    <MediaPlayer src="./test.mp4" storage="harness" style={{ height: '100vh' }}>
      <MediaProvider />
      <GlassControls
        announcements={announcements}
        onAnnouncementsChange={setAnnouncements}
        hasNext
        enhancement={{
          preset: 'off',
          onPresetChange: () => {},
          filters: { brightness: 1, contrast: 1, saturate: 1 },
          onFiltersChange: () => {},
          stats: { outputLabel: '', fps: 0, performance: null },
          isActive: false,
          panelOpen,
          onPanelToggle: () => setPanelOpen((open) => !open),
        }}
      />
    </MediaPlayer>
  );
}

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('harness mount point #root missing');
createRoot(rootEl).render(<Harness />);

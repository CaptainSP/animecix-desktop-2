import React from 'react';
import { createRoot } from 'react-dom/client';
import { MediaPlayer, MediaProvider } from '@vidstack/react';
import { DefaultVideoLayout, defaultLayoutIcons } from '@vidstack/react/player/layouts/default';

import { FlatSettingsMenu } from '../../src/player-page/components/FlatSettingsMenu';
import { CaptionStylesMenu } from '../../src/player-page/components/CaptionStylesMenu';
import { CaptionsMenu } from '../../src/player-page/components/CaptionsMenu';
import { QualityMenu } from '../../src/player-page/components/QualityMenu';
import { SpeedMenu } from '../../src/player-page/components/SpeedMenu';
import { turkishTranslations } from '../../src/player-page/components/translations';
import '@vidstack/react/player/styles/default/theme.css';
import '@vidstack/react/player/styles/default/layouts/video.css';
import '../../src/player-page/components/EmbedPlayer.css';

function Harness() {
  return (
    <MediaPlayer src="./test.mp4" style={{ height: '100vh' }}>
      <MediaProvider>
        <video src="./test.mp4" />
      </MediaProvider>
      <DefaultVideoLayout
        icons={defaultLayoutIcons}
        translations={turkishTranslations}
        playbackRates={[0.25, 0.5, 1, 1.25, 1.5, 2]}
        slots={{
          settingsMenuItemsStart: <FlatSettingsMenu />,
          settingsMenuItemsEnd: (
            <>
              <CaptionStylesMenu />
              <CaptionsMenu />
              <QualityMenu />
              <SpeedMenu />
            </>
          ),
        }}
      />
    </MediaPlayer>
  );
}

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('harness mount point #root missing');
createRoot(rootEl).render(<Harness />);

import { powerSaveBlocker } from 'electron';

/**
 * Holds the display awake while an episode is playing.
 *
 * Chromium takes a wake lock of its own whenever a <video> plays, but it ties
 * that lock to the element staying *visible*, and the observer it uses is
 * clipped by the embedding page's viewport. The player lives in an iframe inside
 * the website's scrollable watch page, so scrolling down to the comments drops
 * the lock while playback carries on — the screen dims mid-episode. Holding the
 * blocker against playback instead of against layout is the fix.
 *
 * The main process owns it rather than the renderer because `powerSaveBlocker`
 * is the Electron-supported path to the OS, and because the player iframe has no
 * `ipcRenderer` of its own (see CLAUDE.md "Critical rule") — the website bridges
 * play/pause postMessages to `power:setKeepAwake`.
 *
 * 'prevent-display-sleep' is deliberate: 'prevent-app-suspension' only keeps the
 * CPU alive and still lets the screen go dark, which is the symptom being fixed.
 */
export class PowerService {
  private blockerId: number | null = null;

  setKeepAwake(enabled: boolean): void {
    if (enabled) {
      this.start();
    } else {
      this.stop();
    }
  }

  /** True while the display is being held awake. */
  isKeepingAwake(): boolean {
    return this.blockerId !== null && powerSaveBlocker.isStarted(this.blockerId);
  }

  /** Releases the blocker. Safe to call when nothing is held. */
  dispose(): void {
    this.stop();
  }

  private start(): void {
    // isStarted() rather than a plain null check: Electron can report a blocker
    // as stopped without us asking (it is dropped when the process loses it
    // across a suspend/resume cycle), and starting a second one then would leak
    // the first id with nothing able to stop it.
    if (this.blockerId !== null && powerSaveBlocker.isStarted(this.blockerId)) {
      return;
    }
    this.blockerId = powerSaveBlocker.start('prevent-display-sleep');
  }

  private stop(): void {
    if (this.blockerId === null) {
      return;
    }
    const id = this.blockerId;
    // Cleared first so a throwing stop() cannot strand us holding an id we
    // believe is live.
    this.blockerId = null;
    if (powerSaveBlocker.isStarted(id)) {
      powerSaveBlocker.stop(id);
    }
  }
}

/**
 * What's-new announcement — a self-contained box injected into animecix.tv that
 * greets users who UPDATED the app (never fresh installs) with a summary of the
 * latest additions (currently: "Toplu İndir" / batch downloads).
 *
 * Version gating: the app version is stored in the settings table after the box
 * is shown (or on first install), so the announcement appears exactly once per
 * version bump. Fresh installs are detected by the absence of the SQLite file
 * BEFORE StorageService creates it.
 *
 * Injected as a self-contained script run via webContents.executeJavaScript on
 * did-finish-load. The box lives in the page DOM (fixed position, top-right)
 * with CSS slide-in / slide-out animations. Injection is the right tool here
 * because the announcement is about the app's own version, which the website
 * knows nothing about — the batch download picker it advertises, by contrast,
 * lives in animecix-angular.
 */

import { app, type BrowserWindow } from 'electron';
import log from 'electron-log';
import type { StorageService } from '../storage/StorageService.js';

const ANNOUNCEMENT_VERSION_KEY = 'last_announced_version';

/** True when the announcement must be shown for this launch. */
export function shouldAnnounce(
  isFreshInstall: boolean,
  lastAnnouncedVersion: string | null,
  currentVersion: string,
): boolean {
  if (isFreshInstall) return false;
  return lastAnnouncedVersion !== currentVersion;
}

// CRITICAL: this string is passed to webContents.executeJavaScript. It runs in
// the page's main world. It must be fully self-contained (no imports) and must
// NOT contain backticks or ${...} sequences — the outer TS template literal
// would interpolate them.
export const WHATS_NEW_SCRIPT = `
(function () {
  if (window.__animecixWhatsNewShown) return;
  window.__animecixWhatsNewShown = true;

  var style = document.createElement('style');
  style.textContent = [
    '#animecix-wn{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.55);opacity:0;transition:opacity 0.3s ease}',
    '#animecix-wn.wn-in{opacity:1}',
    '#animecix-wn.wn-out{opacity:0}',
    '.wn-card{position:relative;width:400px;max-width:calc(100vw - 40px);margin:16px;padding:26px 28px;border-radius:16px;background:#111216;border:1px solid rgba(255,255,255,0.14);box-shadow:0 30px 70px rgba(0,0,0,0.65),0 0 0 1px rgba(255,255,255,0.05) inset,0 1px 0 rgba(255,255,255,0.09) inset;font-family:Inter,Helvetica,Arial,sans-serif;color:#f5f6f8;transform:scale(0.9);opacity:0;transition:transform 0.35s cubic-bezier(0.16,1.1,0.3,1),opacity 0.3s ease}',
    '#animecix-wn.wn-in .wn-card{transform:scale(1);opacity:1}',
    '#animecix-wn.wn-out .wn-card{transform:scale(0.94);opacity:0}',
    '.wn-close{position:absolute;top:14px;right:14px;width:30px;height:30px;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:50%;color:#a8adb8;font-size:17px;line-height:1;cursor:pointer;transition:background 0.15s ease,color 0.15s ease}',
    '.wn-close:hover{background:rgba(255,255,255,0.14);color:#fff}',
    '.wn-badge{display:inline-flex;align-items:center;gap:6px;padding:4px 14px;border-radius:999px;background:#f5f6f8;color:#111216;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase}',
    '.wn-title{margin:16px 0 8px;font-size:20px;font-weight:700;line-height:1.25;color:#fff}',
    '.wn-sub{margin:0 0 18px;font-size:13.5px;line-height:1.55;color:#9aa1b5}',
    '.wn-list{margin:0 0 20px;padding:0;list-style:none;display:flex;flex-direction:column;gap:14px}',
    '.wn-item{display:flex;gap:13px;align-items:flex-start}',
    '.wn-item-icon{flex:none;width:36px;height:36px;display:flex;align-items:center;justify-content:center;border-radius:10px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.14)}',
    '.wn-item-title{display:block;font-size:13.5px;font-weight:600;color:#f2f4f9;margin-bottom:2px}',
    '.wn-item-desc{display:block;font-size:12.5px;line-height:1.45;color:#8e95aa}',
    '.wn-done{width:100%;padding:12px 16px;border:0;border-radius:12px;background:#f5f6f8;color:#111216;font-size:14px;font-weight:700;font-family:inherit;cursor:pointer;transition:background 0.15s ease,transform 0.1s ease}',
    '.wn-done:hover{background:#fff}',
    '.wn-done:active{transform:scale(0.98)}'
  ].join('');
  document.head.appendChild(style);

  var box = document.createElement('div');
  box.id = 'animecix-wn';
  box.innerHTML =
    '<div class="wn-card">' +
      '<button class="wn-close" aria-label="Kapat" title="Kapat">&times;</button>' +
      '<span class="wn-badge">Yeni</span>' +
      '<h2 class="wn-title">AnimeciX g\u00fcncellendi</h2>' +
      '<p class="wn-sub">Bu s\u00fcr\u00fcmle birlikte gelen yenilikler:</p>' +
      '<ul class="wn-list">' +
        '<li class="wn-item">' +
          '<span class="wn-item-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f5f6f8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></span>' +
          '<span><span class="wn-item-title">Toplu \u0130ndir</span><span class="wn-item-desc">Anime sayfalar\u0131ndaki yeni "Toplu \u0130ndir" butonuyla sezonlar\u0131n tamam\u0131n\u0131 tek seferde indirin.</span></span>' +
        '</li>' +
        '<li class="wn-item">' +
          '<span class="wn-item-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f5f6f8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span>' +
          '<span><span class="wn-item-title">Sezon Se\u00e7imi</span><span class="wn-item-desc">Her sezon i\u00e7in ayr\u0131 b\u00f6l\u00fcm se\u00e7imi ve tek t\u0131kla "t\u00fcm\u00fcn\u00fc se\u00e7" kolayl\u0131\u011f\u0131.</span></span>' +
        '</li>' +
        '<li class="wn-item">' +
          '<span class="wn-item-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f5f6f8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg></span>' +
          '<span><span class="wn-item-title">Otomatik Kalite</span><span class="wn-item-desc">En iyi MP4 kalitesi otomatik se\u00e7ilir; indirmeler s\u0131rayla kuyru\u011fa eklenir.</span></span>' +
        '</li>' +
      '</ul>' +
      '<button class="wn-done">Harika, anlad\u0131m</button>' +
    '</div>';

  document.body.appendChild(box);
  requestAnimationFrame(function () { box.classList.add('wn-in'); });

  function close() {
    if (box.classList.contains('wn-out')) return;
    box.classList.replace('wn-in', 'wn-out');
    setTimeout(function () {
      if (box.parentNode) box.parentNode.removeChild(box);
    }, 360);
  }

  box.querySelector('.wn-close').onclick = close;
  box.querySelector('.wn-done').onclick = close;
  box.addEventListener('mousedown', function (e) { if (e.target === box) close(); });
})();
`;

/**
 * Wires the one-time announcement. Call once after the main window exists.
 * - Fresh install: records the version, shows nothing.
 * - Updated install: records the version, injects the announcement box on the
 *   next page load (non-fatal on failure).
 */
export function setupWhatsNewAnnouncement(
  win: BrowserWindow,
  storage: StorageService,
  isFreshInstall: boolean,
): void {
  const currentVersion = app.getVersion();
  const lastAnnounced = storage.getSetting(ANNOUNCEMENT_VERSION_KEY);

  if (!shouldAnnounce(isFreshInstall, lastAnnounced, currentVersion)) return;

  storage.setSetting(ANNOUNCEMENT_VERSION_KEY, currentVersion);

  win.webContents.once('did-finish-load', () => {
    if (win.isDestroyed()) return;
    win.webContents.executeJavaScript(WHATS_NEW_SCRIPT, true).catch((err) => {
      // Non-fatal: announcement is cosmetic — the version is already recorded.
      log.warn('[whats-new] injection failed:', (err as Error)?.message);
    });
  });
}

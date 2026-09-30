/**
 * What's-new announcement — a box injected into animecix.tv that greets users
 * who UPDATED the app (never fresh installs) with what the new version brings.
 *
 * The copy used to be hardcoded in this file, which meant changing a single
 * word required a new build, and the box kept advertising whatever the last
 * release added regardless of which version the user had just moved to. The
 * card's design is unchanged; only its content now comes from
 * /secure/windows-release-notes?version=<app version>, authored in the admin
 * panel (animecix-angular → /admin/windows-release-notes).
 *
 * Version gating: the app version is stored in the settings table once the
 * announcement has been resolved, so the box appears at most once per version
 * bump. Fresh installs are detected by the absence of the SQLite file BEFORE
 * StorageService creates it.
 *
 * Injection is still the right tool: the announcement is about the app's own
 * version, which the website knows nothing about.
 */

import { app, type BrowserWindow } from 'electron';
import log from 'electron-log';
import type { StorageService } from '../storage/StorageService.js';

const ANNOUNCEMENT_VERSION_KEY = 'last_announced_version';

/** What the injected script reports back about this launch. */
export type AnnounceOutcome = 'shown' | 'none' | 'error';

/** True when the announcement must be resolved for this launch. */
export function shouldAnnounce(
  isFreshInstall: boolean,
  lastAnnouncedVersion: string | null,
  currentVersion: string,
): boolean {
  if (isFreshInstall) return false;
  return lastAnnouncedVersion !== currentVersion;
}

/**
 * Whether to mark this version as announced.
 *
 * A version with no note authored still counts as handled — there is nothing
 * to show and re-asking every launch would be pointless. A failed lookup does
 * NOT: the user was most likely offline, and burning the version there would
 * silently swallow the announcement for good.
 */
export function shouldRecordVersion(outcome: AnnounceOutcome): boolean {
  return outcome !== 'error';
}

// CRITICAL: this string is passed to webContents.executeJavaScript. It runs in
// the page's main world. It must be fully self-contained (no imports) and must
// NOT contain backticks or ${...} sequences — the outer TS template literal
// would interpolate them. The app version is prepended as a separate statement
// by buildWhatsNewScript rather than interpolated in here.
export const WHATS_NEW_SCRIPT = `
(async function () {
  if (window.__animecixWhatsNewShown) return 'none';
  window.__animecixWhatsNewShown = true;

  var version = window.__animecixAppVersion;
  if (!version) return 'error';

  // Same-origin, so this works against the dev proxy and production alike.
  var note;
  try {
    var res = await fetch(
      '/secure/windows-release-notes?version=' + encodeURIComponent(version),
      { credentials: 'same-origin' }
    );
    if (!res.ok) return 'error';
    note = await res.json();
  } catch (e) {
    return 'error';
  }

  var items = (note && note.items) || [];
  if (!items.length) return 'none';

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
    '.wn-item-icon .material-icons{font-size:18px;line-height:1;color:#f5f6f8}',
    '.wn-item-title{display:block;font-size:13.5px;font-weight:600;color:#f2f4f9;margin-bottom:2px}',
    '.wn-item-desc{display:block;font-size:12.5px;line-height:1.45;color:#8e95aa}',
    '.wn-done{width:100%;padding:12px 16px;border:0;border-radius:12px;background:#f5f6f8;color:#111216;font-size:14px;font-weight:700;font-family:inherit;cursor:pointer;transition:background 0.15s ease,transform 0.1s ease}',
    '.wn-done:hover{background:#fff}',
    '.wn-done:active{transform:scale(0.98)}'
  ].join('');
  document.head.appendChild(style);

  // Built with DOM calls, never by assigning markup: every string below is
  // authored in the admin panel, and textContent keeps a stray angle bracket
  // from turning into elements in the page we are injected into.
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  var card = el('div', 'wn-card');

  var closeBtn = el('button', 'wn-close', '\u00d7');
  closeBtn.setAttribute('aria-label', 'Kapat');
  closeBtn.title = 'Kapat';
  card.appendChild(closeBtn);

  card.appendChild(el('span', 'wn-badge', 'Yeni'));
  card.appendChild(el('h2', 'wn-title', note.headline || 'AnimeciX g\u00fcncellendi'));
  card.appendChild(
    el('p', 'wn-sub', note.subtitle || 'Bu s\u00fcr\u00fcmle birlikte gelen yenilikler:')
  );

  var list = el('ul', 'wn-list');
  for (var i = 0; i < items.length; i++) {
    var item = items[i] || {};
    if (!item.title) continue;

    var li = el('li', 'wn-item');
    var iconWrap = el('span', 'wn-item-icon');
    // Material Icons ligature — animecix.tv already loads the font.
    iconWrap.appendChild(el('span', 'material-icons', item.icon || 'auto_awesome'));
    li.appendChild(iconWrap);

    var textWrap = el('span', null);
    textWrap.appendChild(el('span', 'wn-item-title', item.title));
    textWrap.appendChild(el('span', 'wn-item-desc', item.description || ''));
    li.appendChild(textWrap);

    list.appendChild(li);
  }
  if (!list.childNodes.length) return 'none';
  card.appendChild(list);

  var doneBtn = el('button', 'wn-done', 'Harika, anlad\u0131m');
  card.appendChild(doneBtn);

  var box = el('div', null);
  box.id = 'animecix-wn';
  box.appendChild(card);

  document.body.appendChild(box);
  requestAnimationFrame(function () { box.classList.add('wn-in'); });

  function close() {
    if (box.classList.contains('wn-out')) return;
    box.classList.replace('wn-in', 'wn-out');
    setTimeout(function () {
      if (box.parentNode) box.parentNode.removeChild(box);
    }, 360);
  }

  closeBtn.onclick = close;
  doneBtn.onclick = close;
  box.addEventListener('mousedown', function (e) { if (e.target === box) close(); });

  return 'shown';
})()
`;

/**
 * Prepends the app version as its own statement. Interpolating it into the
 * script template literal is not an option (see the note above it), and a
 * JSON-encoded assignment is also the safest way to hand a value across.
 */
export function buildWhatsNewScript(version: string): string {
  return 'window.__animecixAppVersion = ' + JSON.stringify(version) + ';\n' + WHATS_NEW_SCRIPT;
}

/**
 * Wires the one-time announcement. Call once after the main window exists.
 * - Fresh install: records the version, shows nothing.
 * - Updated install: looks up the version's note on the next page load and
 *   shows it if one was authored.
 */
export function setupWhatsNewAnnouncement(
  win: BrowserWindow,
  storage: StorageService,
  isFreshInstall: boolean,
): void {
  const currentVersion = app.getVersion();
  const lastAnnounced = storage.getSetting(ANNOUNCEMENT_VERSION_KEY);

  // Record the version a fresh install starts on, so the first thing it ever
  // announces is the next bump. Without this the install shows nothing on its
  // first launch (correct) and then greets the user on the second one, because
  // by then the DB exists and no version has been recorded.
  if (isFreshInstall) {
    storage.setSetting(ANNOUNCEMENT_VERSION_KEY, currentVersion);
    return;
  }

  if (!shouldAnnounce(isFreshInstall, lastAnnounced, currentVersion)) return;

  win.webContents.once('did-finish-load', async () => {
    if (win.isDestroyed()) return;

    let outcome: AnnounceOutcome = 'error';
    try {
      const result = await win.webContents.executeJavaScript(
        buildWhatsNewScript(currentVersion),
        true,
      );
      outcome = result === 'shown' || result === 'none' ? result : 'error';
    } catch (err) {
      // Non-fatal: the announcement is cosmetic. Leaving the version
      // unrecorded means the next launch tries again.
      log.warn('[whats-new] injection failed:', (err as Error)?.message);
    }

    if (shouldRecordVersion(outcome)) {
      storage.setSetting(ANNOUNCEMENT_VERSION_KEY, currentVersion);
    }
  });
}

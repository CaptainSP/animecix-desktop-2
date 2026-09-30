import { spawn } from 'child_process';
import { chromium } from 'playwright-core';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const PORT = 9228;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const proc = spawn(path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe'), [
    '--disable-gpu', `--remote-debugging-port=${PORT}`, 'docs/scripts/inspect-main.mjs',
  ], { cwd: root, stdio: 'ignore' });
  try {
    let target = null;
    for (let i = 0; i < 60 && !target; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
        target = (await res.json()).find((t) => t.type === 'page');
      } catch {}
      if (!target) await sleep(500);
    }
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
    const pg = browser.contexts()[0].pages().find((p) => p.url().startsWith('tau-player://'));
    await pg.evaluate((v) => { window._fakeVideo = v; }, {
      _id: 'x', duration: 60, title_id: 'x', season_number: '1', episode_number: '1',
      hls: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
      urls: [{ label: '1080p', url: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4', size: 0 }],
      subs: [], translator: 'x',
    });
    for (let i = 0; i < 40; i++) {
      await pg.evaluate(() => window.postMessage({ action: 'initVideoData', video: window._fakeVideo, meta: null }, '*'));
      if (await pg.locator('.vds-video-layout').count()) break;
      await sleep(500);
    }
    await sleep(2000);
    await pg.mouse.move(640, 360);
    await sleep(1500);
    const btn = pg.locator('.vds-menu-button[aria-label="Ayarlar"]');
    await btn.click({ force: true });
    await sleep(800);
    await pg.locator('.vds-menu-item:visible', { hasText: 'Hız' }).first().click({ force: true });
    await sleep(900);
    const dump = await pg.evaluate(() => {
      const sub = document.querySelector('.vds-menu-items[data-submenu][data-open]');
      const exp = document.querySelectorAll('.vds-settings-menu-items[data-root] [aria-expanded]');
      const triggers = [];
      for (const el of exp) {
        triggers.push({
          cls: (el.className || '').toString(),
          expanded: el.getAttribute('aria-expanded'),
          text: (el.textContent || '').trim().slice(0, 30),
          h: Math.round(el.getBoundingClientRect().height),
          y: Math.round(el.getBoundingClientRect().y),
        });
      }
      const control = document.querySelector('.vds-settings-menu-items[data-root] [aria-controls]');
      return {
        subId: sub?.id,
        triggers,
        control: control
          ? { cls: (control.className || '').toString(), text: (control.textContent || '').trim().slice(0, 30) }
          : null,
        anyExpanded: exp.length > 0,
      };
    });
    console.log('[dump]', JSON.stringify(dump));
    await browser.close();
  } finally {
    proc.kill();
  }
}

main().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});

// Dumps the ancestor chain of every submenu panel with computed styles.
import { spawn } from 'child_process';
import { chromium } from 'playwright-core';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const PORT = 9222;

const FAKE_VIDEO = {
  _id: 'inspect-123', duration: 60, title_id: 'inspect',
  season_number: '1', episode_number: '1',
  hls: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
  urls: [{ label: '1080p', url: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4', size: 0 }],
  subs: [{ id: 1, language: 'tr', url: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/friday.vtt', name: 'Síntesis' }],
  translator: 'inspect',
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForPage() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const targets = await res.json();
      const page = targets.find((t) => t.type === 'page');
      if (page) return page;
    } catch {}
    await sleep(500);
  }
  throw new Error('no page');
}

async function main() {
  const proc = spawn('node_modules/electron/dist/electron.exe', ['--disable-gpu', `--remote-debugging-port=${PORT}`, 'docs/scripts/inspect-main.mjs'], {
    cwd: root, stdio: 'ignore',
  });
  try {
    await waitForPage();
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
    const context = browser.contexts()[0];
    const page = context.pages().find((p) => p.url().startsWith('tau-player://')) || context.pages()[0];
    page.setDefaultTimeout(10000);

    await page.evaluate((video) => { window._fakeVideo = video; }, FAKE_VIDEO);
    for (let i = 0; i < 40; i++) {
      await page.evaluate(() => window.postMessage({ action: 'initVideoData', video: window._fakeVideo, meta: null }, '*'));
      if (await page.locator('.vds-video-layout').count()) break;
      await sleep(500);
    }
    await page.waitForSelector('.vds-video-layout', { timeout: 20000 });
    await sleep(2500);
    await page.mouse.move(20, 20);
    await sleep(400);
    await page.mouse.move(640, 360);
    await sleep(1500);
    await page.locator('.vds-menu-button[aria-label="Ayarlar"]').click({ timeout: 8000, force: true });
    await sleep(1200);

    const dump = await page.evaluate(() => {
      const chain = (el) => {
        const out = [];
        let cur = el;
        while (cur) {
          const cs = getComputedStyle(cur);
          const b = cur.getBoundingClientRect();
          out.push({
            tag: cur.tagName.toLowerCase(),
            cls: (cur.className || '').toString().slice(0, 60),
            display: cs.display,
            visibility: cs.visibility,
            opacity: cs.opacity,
            rect: { w: Math.round(b.width), h: Math.round(b.height) },
            hidden: cur.hidden,
            ariaHidden: cur.getAttribute('aria-hidden'),
            inline: (cur.getAttribute('style') || '').slice(0, 120),
          });
          cur = cur.parentElement;
        }
        return out;
      };
      const rootPanel = document.querySelector('.vds-settings-menu-items');
      const allPanels = [...document.querySelectorAll('.vds-menu-items[data-submenu]')];
      const speedPanel = allPanels.find((p) => (p.textContent || '').includes('Hız'));
      const qualityPanel = allPanels.find((p) => (p.textContent || '').includes('1080p'));
      return {
        panelCount: allPanels.length,
        panelIds: allPanels.map((p) => ({ id: p.id, text: (p.textContent || '').trim().slice(0, 30) })),
        rootPanel: chain(rootPanel),
        speedPanel: speedPanel ? chain(speedPanel) : null,
        qualityPanel: qualityPanel ? chain(qualityPanel) : null,
      };
    });
    console.log(JSON.stringify(dump, null, 1));
    await browser.close();
  } finally {
    proc.kill();
  }
}
main().catch((e) => { console.error('FAILED', e); process.exit(1); });

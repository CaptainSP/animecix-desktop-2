// Verifies mutual exclusion between the settings menu and the enhancement
// panel, plus the panel's right-edge pinning.
// Run: node docs/scripts/inspect-exclusion.mjs
import { spawn } from 'child_process';
import { chromium } from 'playwright-core';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const electronBin = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const PORT = 9223;

const FAKE_VIDEO = {
  _id: 'inspect-123',
  duration: 60,
  title_id: 'inspect',
  season_number: '1',
  episode_number: '1',
  hls: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
  urls: [],
  subs: [{ id: 1, language: 'tr', url: 'x.vtt', name: 'Síntesis' }],
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
  throw new Error('No page target found');
}

async function main() {
  const proc = spawn(electronBin, ['--disable-gpu', `--remote-debugging-port=${PORT}`, 'docs/scripts/inspect-main.mjs'], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stderr.on('data', () => {});
  try {
    const target = await waitForPage();
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
    const context = browser.contexts()[0];
    const page = context.pages().find((p) => p.url().startsWith('tau-player://')) || context.pages()[0];
    page.setDefaultTimeout(10000);
    page.on('pageerror', (err) => console.log('[pageerror]', String(err).slice(0, 200)));

    await page.evaluate((video) => {
      window._fakeVideo = video;
      const origClose = window.close.bind(window);
      window.close = () => {
        console.log('WINDOW.CLOSE intercepted');
      };
    }, FAKE_VIDEO);
    for (let i = 0; i < 40; i++) {
      await page.evaluate(() => {
        window.postMessage({ action: 'initVideoData', video: window._fakeVideo, meta: null }, '*');
      });
      if (await page.locator('.vds-video-layout').count()) break;
      await sleep(500);
    }
    await page.waitForSelector('.vds-video-layout', { timeout: 20000 });
    await sleep(2500);

    await page.mouse.move(20, 20);
    await sleep(400);
    await page.mouse.move(640, 360);
    await sleep(1500);

    const settingsBtn = page.locator('.vds-menu-button[aria-label="Ayarlar"]');
    const veToggle = page.locator('.ve-toggle-btn');
    const state = () =>
      page.evaluate(() => {
        const settings = document.querySelector('.vds-settings-menu-items');
        const panel = document.querySelector('.ve-panel');
        const b = panel?.getBoundingClientRect();
        return {
          settingsOpen: settings?.getAttribute('data-open') != null,
          panelOpen: !!panel,
          panelRect: b ? { left: Math.round(b.left), right: Math.round(b.right), w: Math.round(b.width) } : null,
          viewportW: window.innerWidth,
        };
      });

    await settingsBtn.click({ force: true });
    await sleep(800);
    console.log('[1 settings open]', JSON.stringify(await state()));

    await veToggle.click({ force: true });
    await sleep(800);
    console.log('[2 toggle clicked while settings open]', JSON.stringify(await state()));

    await settingsBtn.click({ force: true });
    await sleep(800);
    console.log('[3 settings clicked while panel open]', JSON.stringify(await state()));

    await veToggle.click({ force: true });
    await sleep(800);
    console.log('[4 panel toggled closed]', JSON.stringify(await state()));

    await browser.close();
  } finally {
    proc.kill();
  }
}

main().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});

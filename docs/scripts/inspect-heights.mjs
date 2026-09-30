// Measures the vertical positions of the settings menu and the enhancement
// panel (bottom edges) to align them. Run: node docs/scripts/inspect-heights.mjs
import { spawn } from 'child_process';
import { chromium } from 'playwright-core';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const electronBin = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const PORT = 9224;

const FAKE_VIDEO = {
  _id: 'inspect-123',
  duration: 60,
  title_id: 'inspect',
  season_number: '1',
  episode_number: '1',
  hls: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
  urls: [
    { label: '1080p', url: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4', size: 0 },
    { label: '720p', url: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4', size: 0 },
  ],
  subs: [{ id: 1, language: 'tr', url: 'x.vtt', name: 'SÃ­ntesis' }],
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
      window.close = () => {};
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

    const rectOf = (sel) =>
      page.evaluate((s) => {
        const el = document.querySelector(s);
        if (!el) return null;
        const b = el.getBoundingClientRect();
        const c = getComputedStyle(el);
        return {
          top: Math.round(b.top), bottom: Math.round(b.bottom), h: Math.round(b.height),
          maxHeight: c.maxHeight, position: c.position,
        };
      }, sel);

    await settingsBtn.click({ force: true });
    await sleep(900);
    console.log('[settings root]', JSON.stringify(await rectOf('.vds-settings-menu-items[data-open]')));
    const slider = await page.evaluate(() => {
      const el = document.querySelector('.vds-time-slider');
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { top: Math.round(b.top), bottom: Math.round(b.bottom) };
    });
    console.log('[time slider]', JSON.stringify(slider));
    await page.keyboard.press('Escape');
    await sleep(600);
    await veToggle.click({ force: true });
    for (const t of [0, 80, 160, 320]) {
      await sleep(t === 0 ? 30 : t - (t === 80 ? 30 : 0));
      const a = await page.evaluate(() => {
        const el = document.querySelector('.ve-panel');
        if (!el) return null;
        const c = getComputedStyle(el);
        return { opacity: c.opacity, transform: c.transform, animName: c.animationName };
      });
      console.log(`[anim t=+${t}ms]`, JSON.stringify(a));
    }
    await sleep(600);
    console.log('[ve-panel]', JSON.stringify(await rectOf('.ve-panel')));

    await browser.close();
  } finally {
    proc.kill();
  }
}

main().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});


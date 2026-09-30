// Dumps the raw HTML of my custom menu wrappers (Speed/Quality/Captions) to
// verify the submenu panel classes.
import { spawn } from 'child_process';
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'url';
import path from 'path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PORT = 9335;

const proc = spawn('node_modules/electron/dist/electron.exe', ['--disable-gpu', `--remote-debugging-port=${PORT}`, 'docs/scripts/inspect-main.mjs'], {
  cwd: root, stdio: 'ignore',
});

const FAKE = {
  _id: 'x', duration: 60, title_id: 'x', season_number: '1', episode_number: '1',
  hls: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
  urls: [{ label: '1080p', url: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4', size: 0 }],
  subs: [{ id: 1, language: 'tr', url: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/friday.vtt', name: 'S' }],
  translator: 'i',
};

(async () => {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      if ((await r.json()).some((t) => t.type === 'page')) break;
    } catch {}
    await sleep(500);
  }
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  const page = browser.contexts()[0].pages().find((p) => p.url().startsWith('tau-player://'));
  page.setDefaultTimeout(10000);

  await page.evaluate((video) => { window._fakeVideo = video; }, FAKE);
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
    const out = {};
    const wrappers = [...document.querySelectorAll('.vds-settings-menu-items > div')];
    for (const w of wrappers) {
      const text = (w.textContent || '').trim().slice(0, 20);
      const btn = w.querySelector(':scope > button');
      const items = w.querySelector(':scope > div');
      out[text] = {
        wrapperClass: JSON.stringify(w.className),
        wrapperStyle: w.getAttribute('style'),
        buttonClass: btn?.className,
        buttonText: (btn?.textContent || '').slice(0, 25),
        itemsClass: JSON.stringify(items?.className),
        itemsAttrs: items ? [...items.attributes].map((a) => `${a.name}="${a.value}"`).join(' ') : null,
      };
    }
    return out;
  });
  console.log(JSON.stringify(dump, null, 1));
  await browser.close();
  proc.kill();
})().catch((e) => { console.error('ERR', e.message); proc.kill(); process.exit(1); });

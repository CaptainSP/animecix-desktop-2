// Measures root menu vs submenu vertical alignment (top edges) for each submenu.
// Run: node docs/scripts/inspect-submenu-pos.mjs
import { spawn } from 'child_process';
import { chromium } from 'playwright-core';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const electronBin = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const PORT = 9225;

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
  subs: [
    { id: 1, language: 'tr', url: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/friday.vtt', name: 'Síntesis' },
  ],
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
  proc.stderr.on('data', (d) => process.stdout.write('[main-err] ' + d.toString()));

  try {
    const target = await waitForPage();
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
    const context = browser.contexts()[0];
    const page = context.pages().find((p) => p.url().startsWith('tau-player://')) || context.pages()[0];
    page.setDefaultTimeout(10000);

    await page.evaluate((video) => {
      window._fakeVideo = video;
    }, FAKE_VIDEO);
    for (let i = 0; i < 40; i++) {
      await page.evaluate(() => {
        window.postMessage({ action: 'initVideoData', video: window._fakeVideo, meta: null }, '*');
      });
      if (await page.locator('.vds-video-layout').count()) break;
      await sleep(500);
    }
    await sleep(2000);
    await page.waitForSelector('.vds-video-layout', { timeout: 20000 });

    // Wake controls
    await page.mouse.move(20, 20);
    await sleep(400);
    await page.mouse.move(640, 360);
    await sleep(1500);

    const settingsBtn = page.locator('.vds-menu-button[aria-label="Ayarlar"]');

    const isOpen = () =>
      page.evaluate(() => !!document.querySelector('.vds-settings-menu-items[data-root][data-open]'));

    const openSettings = async () => {
      for (let attempt = 0; attempt < 5; attempt++) {
        await settingsBtn.click({ timeout: 8000, force: true });
        for (let i = 0; i < 10; i++) {
          if (await isOpen()) return true;
          await sleep(300);
        }
      }
      return false;
    };

    const closeAll = async () => {
      for (let i = 0; i < 10; i++) {
        if (!(await isOpen())) return true;
        await page.keyboard.press('Escape');
        await sleep(250);
      }
      return !(await isOpen());
    };

    await openSettings();
    await sleep(900);

    const rects = async () =>
      page.evaluate(() => {
        const root = document.querySelector('.vds-settings-menu-items[data-root][data-open]');
        const sub = document.querySelector('.vds-menu-items[data-submenu][data-open]');
        const rb = root?.getBoundingClientRect();
        const sb = sub?.getBoundingClientRect();
        const cs = sub ? getComputedStyle(sub) : null;
        const rc2 = root ? getComputedStyle(root) : null;
        const chain = [];
        let el = sub;
        for (let i = 0; el && i < 5; i++) {
          const b = el.getBoundingClientRect();
          chain.push({
            cls: (el.className || '').toString().slice(0, 60),
            display: getComputedStyle(el).display,
            position: getComputedStyle(el).position,
            h: Math.round(b.height),
            inline: (el.getAttribute('style') || '').slice(0, 80),
          });
          el = el.parentElement;
        }
        return {
          root: rb ? { x: Math.round(rb.x), y: Math.round(rb.y), w: Math.round(rb.width), h: Math.round(rb.height) } : null,
          sub: sb ? { x: Math.round(sb.x), y: Math.round(sb.y), w: Math.round(sb.width), h: Math.round(sb.height) } : null,
          subCss: cs ? { position: cs.position, top: cs.top, left: cs.left, transform: cs.transform, overflowY: cs.overflowY } : null,
          subInline: sub?.getAttribute('style'),
          rootCss: root ? { height: rc2.height, overflow: rc2.overflow, padding: rc2.padding, border: `${rc2.borderTopWidth} ${rc2.borderBottomWidth}` } : null,
          subDetails: cs ? { height: cs.height, maxHeight: cs.maxHeight, padding: cs.padding, border: `${cs.borderTopWidth} ${cs.borderBottomWidth}`, minHeight: cs.minHeight, justify: cs.justifyContent } : null,
          chain,
        };
      });

    console.log('[baseline]', JSON.stringify(await rects()));

    const dumpRows = async (tag) => {
      const d = await page.evaluate(() => {
        const root = document.querySelector('.vds-settings-menu-items[data-root]');
        const out = [];
        for (const el of root.children) {
          const b = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          out.push({
            cls: (el.className || '').toString().slice(0, 50),
            y: Math.round(b.y), h: Math.round(b.height),
            display: cs.display,
          });
        }
        const sub = root?.querySelector('.vds-quick-submenu[data-open]');
        const subRows = [];
        for (const el of sub?.children ?? []) {
          const b = el.getBoundingClientRect();
          subRows.push({ cls: (el.className || '').toString().slice(0, 50), y: Math.round(b.y), h: Math.round(b.height) });
        }
        return {
          rows: out,
          subRows,
          menuHeight: root?.style.getPropertyValue('--menu-height'),
          subInline: sub?.getAttribute('style'),
        };
      });
      console.log(`[rows ${tag}]`, JSON.stringify(d));
    };

    await dumpRows('open');

    for (const label of ['Kalite', 'Hız', 'Altyazı Tarzları']) {
      await closeAll();
      await sleep(300);
      const opened = await openSettings();
      await sleep(400);
      if (!opened) {
        console.log(`[open ${label}] FAILED`);
        continue;
      }
      const item = page.locator('.vds-menu-item:visible', { hasText: label }).first();
      await item.click({ timeout: 8000, force: true });
      console.log(`[click ${label}] true`);
      for (let i = 0; i < 10; i++) {
        const subOpen = await page.evaluate(
          () => !!document.querySelector('.vds-menu-items[data-submenu][data-open]'),
        );
        if (subOpen) break;
        await sleep(250);
      }
      await sleep(900);
      const m = await rects();
      const yDelta = m.root && m.sub ? m.sub.y - m.root.y : null;
      const hDelta = m.root && m.sub ? m.sub.h - m.root.h : null;
      console.log(`[${label}]`, JSON.stringify({ ...m, yDelta, hDelta }));
      const rows = await page.evaluate(() => {
        const sub = document.querySelector('.vds-menu-items[data-submenu][data-open]');
        const root = document.querySelector('.vds-settings-menu-items[data-root][data-open]');
        const list = [];
        for (const el of sub?.children ?? []) {
          for (const row of el.children ?? []) {
            const b = row.getBoundingClientRect();
            list.push({ cls: (row.className || '').toString().slice(0, 40), y: Math.round(b.y), h: Math.round(b.height) });
          }
        }
        const sticky = [];
        for (const el of root?.children ?? []) {
          if ((el.className || '').toString().includes('vds-menu-item')) {
            const b = el.getBoundingClientRect();
            sticky.push({ y: Math.round(b.y), h: Math.round(b.height), text: (el.textContent || '').slice(0, 40) });
          }
        }
        return { list, sticky };
      });
      console.log(`[rows ${label}]`, JSON.stringify(rows));
      const clip = { x: m.root?.x - 20 ?? 900, y: m.root?.y - 40 ?? 420, width: 340, height: 360 };
      await page.screenshot({ path: path.join(__dirname, 'shots', `submenu-${label.toLowerCase()}.png`), clip });
      await dumpRows(`after-${label}`);
    }

    await browser.close();
  } finally {
    proc.kill();
  }
}

main().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});

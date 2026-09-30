// Dumps the submenu's DOM ancestor chain + rects to decide the positioning fix.
// Run: node docs/scripts/inspect-submenu-dom.mjs
import { spawn } from 'child_process';
import { chromium } from 'playwright-core';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const electronBin = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const PORT = 9226;

const FAKE_VIDEO = {
  _id: 'inspect-123', duration: 60, title_id: 'inspect', season_number: '1', episode_number: '1',
  hls: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
  urls: [
    { label: '1080p', url: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4', size: 0 },
    { label: '720p', url: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4', size: 0 },
  ],
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
  throw new Error('No page target found');
}

async function main() {
  const proc = spawn(electronBin, ['--disable-gpu', `--remote-debugging-port=${PORT}`, 'docs/scripts/inspect-main.mjs'], {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stderr.on('data', (d) => process.stdout.write('[main-err] ' + d.toString()));

  try {
    const target = await waitForPage();
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
    const context = browser.contexts()[0];
    const page = context.pages().find((p) => p.url().startsWith('tau-player://')) || context.pages()[0];
    page.setDefaultTimeout(10000);

    await page.evaluate((video) => { window._fakeVideo = video; }, FAKE_VIDEO);
    for (let i = 0; i < 40; i++) {
      await page.evaluate(() => {
        window.postMessage({ action: 'initVideoData', video: window._fakeVideo, meta: null }, '*');
      });
      if (await page.locator('.vds-video-layout').count()) break;
      await sleep(500);
    }
    await sleep(2000);
    await page.waitForSelector('.vds-video-layout', { timeout: 20000 });

    await page.mouse.move(20, 20);
    await sleep(400);
    await page.mouse.move(640, 360);
    await sleep(1500);

    const settingsBtn = page.locator('.vds-menu-button[aria-label="Ayarlar"]');
    await settingsBtn.click({ timeout: 8000, force: true });
    for (let i = 0; i < 10; i++) {
      if (await page.evaluate(() => !!document.querySelector('.vds-settings-menu-items[data-open]'))) break;
      await sleep(300);
    }
    const item = page.locator('.vds-menu-item:visible', { hasText: 'Kalite' }).first();
    await item.click({ timeout: 8000, force: true });
    await sleep(900);

    const dump = await page.evaluate(() => {
      const sub = document.querySelector('.vds-menu-items[data-submenu][data-open]');
      const root = document.querySelector('.vds-settings-menu-items[data-root][data-open]');
      const sb = sub?.getBoundingClientRect();
      const rb = root?.getBoundingClientRect();
      const rc = root ? getComputedStyle(root) : null;
      const children = [];
      if (root) {
        const walker = (node) => {
          for (const el of node.children) {
            const b = el.getBoundingClientRect();
            const cs = getComputedStyle(el);
            children.push({
              cls: (el.className || '').toString().slice(0, 60),
              y: Math.round(b.y),
              h: Math.round(b.height),
              display: cs.display,
              flex: cs.flex,
              order: cs.order,
              position: cs.position,
            });
            if (cs.display === 'contents') walker(el);
          }
        };
        walker(root);
      }
      return {
        subRect: sb ? { x: Math.round(sb.x), y: Math.round(sb.y), w: Math.round(sb.width), h: Math.round(sb.height) } : null,
        rootRect: rb ? { x: Math.round(rb.x), y: Math.round(rb.y), w: Math.round(rb.width), h: Math.round(rb.height) } : null,
        rootCss: rc ? { flexDirection: rc.flexDirection, flexWrap: rc.flexWrap, alignItems: rc.alignItems, justifyContent: rc.justifyContent, gap: rc.gap, padding: rc.padding, overflow: rc.overflow, height: rc.height, position: rc.position } : null,
        subCss: sub ? { position: getComputedStyle(sub).position, flex: getComputedStyle(sub).flex, order: getComputedStyle(sub).order, alignSelf: getComputedStyle(sub).alignSelf, top: getComputedStyle(sub).top } : null,
        children,
      };
    });
    console.log(JSON.stringify(dump, null, 1));
    await browser.close();
  } finally {
    proc.kill();
  }
}

main().catch((err) => { console.error('FAILED:', err); process.exit(1); });

// Force-opens every submenu panel in the settings menu and measures layout:
// panel width vs root width, inner sections/radios/sliders and paddings.
// Run: node docs/scripts/inspect-submenus.mjs
import { spawn } from 'child_process';
import { chromium } from 'playwright-core';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { writeFileSync, mkdirSync } from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const shots = path.join(__dirname, 'shots');
mkdirSync(shots, { recursive: true });

const electronBin = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const PORT = 9222;

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
    stdio: 'ignore',
  });

  try {
    await waitForPage();
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
    await page.waitForSelector('.vds-video-layout', { timeout: 20000 });
    await sleep(2500);

    await page.mouse.move(20, 20);
    await sleep(400);
    await page.mouse.move(640, 360);
    await sleep(1500);

    const settingsBtn = page.locator('.vds-menu-button[aria-label="Ayarlar"]');
    await settingsBtn.click({ timeout: 8000, force: true });
    await sleep(1200);

    // Open the settings menu root so the submenu panels resolve widths against it.
    // Then force-open each submenu panel and measure.
    const report = await page.evaluate(() => {
      const rootPanel = document.querySelector('.vds-settings-menu-items');
      const rootRect = rootPanel.getBoundingClientRect();
      const rootCs = getComputedStyle(rootPanel);
      const out = {
        root: {
          width: Math.round(rootRect.width),
          padding: rootCs.padding,
          minWidth: rootCs.minWidth,
        },
        submenus: [],
      };

      const panels = [...document.querySelectorAll('.vds-menu-items[data-submenu]')];
      for (const panel of panels) {
        const wrapper = panel.parentElement;
        const wrapperText = (wrapper?.textContent || '').trim().slice(0, 40);
        const btn = wrapper?.querySelector('button.vds-menu-item');
        const btnText = (btn?.textContent || '').trim().slice(0, 40);

        // Force open
        const prev = { open: panel.getAttribute('data-open'), display: panel.style.display };
        panel.setAttribute('data-open', '');
        panel.style.display = 'flex';
        panel.style.visibility = 'visible';

        const b = panel.getBoundingClientRect();
        const cs = getComputedStyle(panel);
        const entry = {
          id: panel.id,
          cls: panel.className,
          buttonText: btnText,
          wrapperText,
          width: Math.round(b.width),
          height: Math.round(b.height),
          minWidth: cs.minWidth,
          padding: cs.padding,
          position: cs.position,
          inlineStyle: panel.getAttribute('style'),
          rows: [],
        };

        for (const el of panel.querySelectorAll('.vds-menu-section, .vds-menu-section-body, .vds-menu-section-title, .vds-radio, .vds-menu-item, .vds-radio-group')) {
          const bb = el.getBoundingClientRect();
          const cc = getComputedStyle(el);
          entry.rows.push({
            cls: el.className.split(' ').slice(0, 3).join('.'),
            text: (el.textContent || '').trim().slice(0, 30),
            x: Math.round(bb.x), w: Math.round(bb.width), h: Math.round(bb.height),
            padding: cc.padding, paddingLeft: cc.paddingLeft,
            bg: cc.backgroundColor,
          });
        }

        out.submenus.push(entry);

        // Restore
        if (prev.open === null) panel.removeAttribute('data-open');
        else panel.setAttribute('data-open', prev.open);
        panel.style.display = prev.display;
        panel.style.visibility = '';
      }
      return out;
    });

    writeFileSync(path.join(shots, 'submenu-report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 1));
    await browser.close();
  } finally {
    proc.kill();
  }
}

main().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});

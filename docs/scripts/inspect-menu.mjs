// Drives the player page via CDP (remote debugging port) and measures the
// settings menu layout: panel widths, paddings, section/radio rects.
// Run: node docs/scripts/inspect-menu.mjs
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
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', (d) => process.stdout.write('[main] ' + d.toString()));
  proc.stderr.on('data', (d) => process.stdout.write('[main-err] ' + d.toString()));
  proc.on('exit', (code, signal) => console.log('[main] EXITED', code, signal));

  try {
    const target = await waitForPage();
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
    const context = browser.contexts()[0];
    const page = context.pages().find((p) => p.url().startsWith('tau-player://')) || context.pages()[0];
    page.setDefaultTimeout(10000);
    page.on('console', (msg) => console.log(`[console] ${msg.type()}: ${msg.text().slice(0, 200)}`));
    page.on('pageerror', (err) => console.log('[pageerror]', err.stack || JSON.stringify(err)));
    page.on('crash', () => console.log('[page] CRASHED'));
    page.on('close', () => console.log('[page] CLOSED'));
    browser.on('disconnected', () => console.log('[browser] DISCONNECTED'));
    console.log('PAGE URL:', page.url());

    // Fake video bridge — the parent frame normally sends this. Retry until
    // React mounts (the listener is registered in a useEffect).
    // Intercept window.close to find who closes the window.
    await page.evaluate((video) => {
      window._fakeVideo = video;
      window.__closeInfo = null;
      const origClose = window.close.bind(window);
      window.close = () => {
        window.__closeInfo = new Error('window.close called').stack;
        console.log('WINDOW.CLOSE intercepted');
      };
      const origOpen = window.open.bind(window);
      window.open = (...args) => {
        console.log('WINDOW.OPEN intercepted:', args[0]);
        return null;
      };
    }, FAKE_VIDEO);
    page.on('framenavigated', (f) => console.log('[frame] NAVIGATED:', f.url()));
    page.on('close', async () => {
      console.log('[page] CLOSED');
      const info = await page.evaluate(() => window.__closeInfo).catch(() => 'n/a (page gone)');
      console.log('[page] closeInfo:', info);
    });
    for (let i = 0; i < 40; i++) {
      await page.evaluate(() => {
        window.postMessage({ action: 'initVideoData', video: window._fakeVideo, meta: null }, '*');
      });
      if (await page.locator('.vds-video-layout').count()) break;
      await sleep(500);
    }
    await sleep(2000);
    const closeInfo = await page.evaluate(() => window.__closeInfo).catch((e) => 'ERR: ' + e.message);
    console.log('closeInfo after bridge:', closeInfo);
    await page.waitForSelector('.vds-video-layout', { timeout: 20000 }).catch(async () => {
      const state = await page.evaluate(() => ({
        body: document.body.innerText.slice(0, 300),
        loading: !!document.querySelector('.loading'),
        encoding: !!document.querySelector('.encoding'),
        rootChildren: document.getElementById('root')?.children.length,
        url: location.href,
        vdsLayouts: document.querySelectorAll('.vds-video-layout, .vds-layout').length,
      }));
      console.log('PAGE STATE:', JSON.stringify(state, null, 1));
      await page.screenshot({ path: path.join(shots, '0-debug.png') });
      throw new Error('video layout never appeared');
    });
    await sleep(2500);
    if (process.argv.includes('--css-off')) {
      await page.evaluate(() => {
        for (const el of document.querySelectorAll('style, link[rel="stylesheet"]')) {
          el.disabled = true;
        }
      });
      console.log('[css] ALL STYLESHEETS DISABLED');
      await sleep(500);
    }
    const domDump = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')].map((b) => ({
        cls: b.className,
        label: b.getAttribute('aria-label'),
        hidden: b.hidden,
        display: getComputedStyle(b).display,
      }));
      const menus = [...document.querySelectorAll('.vds-menu, .vds-menu-items')].map((m) => ({
        cls: (m.className || '').split(' ').filter((c) => c.startsWith('vds')).join('.'),
        open: m.getAttribute('data-open'),
      }));
      return { btns, menus };
    });
    console.log('DOM DUMP:', JSON.stringify(domDump, null, 1));

    // Wake controls
    await page.mouse.move(20, 20);
    await sleep(400);
    await page.mouse.move(640, 360);
    await sleep(1500);

    const measures = {};
    const rootMenu = page.locator('.vds-menu-items[data-root][data-open]');
    const settingsBtn = page.locator('.vds-menu-button[aria-label="Ayarlar"]');

    await settingsBtn.click({ timeout: 8000, force: true });
    await sleep(1000);
    measures['1-settings-root'] = await measureMenu(page, '1-settings-root');

    const openSubmenu = async (text, label, pressEscapeFirst) => {
      if (pressEscapeFirst) {
        await page.keyboard.press('Escape');
        await sleep(600);
        await settingsBtn.click({ timeout: 8000, force: true });
        await sleep(800);
      }
      const state = await page.evaluate(() => {
        const el = document.querySelector('.vds-settings-menu-items');
        if (!el) return { found: false };
        const b = el.getBoundingClientRect();
        return {
          found: true,
          open: el.getAttribute('data-open'),
          hidden: el.hidden,
          display: getComputedStyle(el).display,
          opacity: getComputedStyle(el).opacity,
          rect: { w: Math.round(b.width), h: Math.round(b.height) },
        };
      });
      console.log(`[pre-click ${text}]`, JSON.stringify(state));
      const item = page.locator('.vds-menu-item:visible', { hasText: text }).first();
      const itemRect = await item.evaluate((el) => {
        const b = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return {
          rect: { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) },
          display: cs.display, visibility: cs.visibility, opacity: cs.opacity,
          offsetParent: !!el.offsetParent,
        };
      }).catch((e) => 'ERR ' + e.message);
      console.log(`[item-rect ${text}]`, JSON.stringify(itemRect));
      const panelHtml = await page.evaluate(() => {
        const el = document.querySelector('.vds-settings-menu-items');
        if (!el) return 'no panel';
        const out = [];
        for (const child of el.children) {
          out.push({
            cls: child.className,
            tag: child.tagName.toLowerCase(),
            text: (child.textContent || '').trim().slice(0, 30),
            inlineStyle: child.getAttribute('style'),
          });
        }
        return JSON.stringify(out);
      }).catch((e) => 'ERR ' + e.message);
      console.log('[panel-children]', panelHtml);
      await item.click({ timeout: 8000, force: true });
      for (let i = 0; i < 8; i++) {
        await sleep(400);
        const st = await page.evaluate(() => {
          const sub = document.querySelector('.vds-menu-items[data-submenu][data-open]');
          const root = document.querySelector('.vds-settings-menu-items');
          const b = sub?.getBoundingClientRect();
          const r = root?.getBoundingClientRect();
          return {
            subOpen: !!sub,
            subRect: b ? { w: Math.round(b.width), h: Math.round(b.height), x: Math.round(b.x) } : null,
            subStyle: sub?.getAttribute('style'),
            rootDisplay: root ? getComputedStyle(root).display : 'none',
          };
        });
        console.log(`[sub-poll ${text} t=${(i + 1) * 400}ms]`, JSON.stringify(st));
      }
      await sleep(1000);
      measures[label] = await measureMenu(page, label);
    };

    await openSubmenu('Kalite', '2-quality-submenu', false);
    await openSubmenu('Hız', '3-speed-submenu', true);
    await openSubmenu('Altyazı Tarzları', '4-captionstyles-submenu', true);
    await openSubmenu('Altyazılar', '5-captions-submenu', true);

    console.log(JSON.stringify(measures, null, 1));
    await browser.close();
  } finally {
    proc.kill();
  }
}

async function measureMenu(page, name) {
  const data = await page.evaluate(() => {
    const out = {};
    const root = document.querySelector('.vds-menu-items[data-root][data-open]');
    if (!root) return { error: 'root not found' };
    const r = root.getBoundingClientRect();
    const cs = getComputedStyle(root);
    out.root = {
      left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width),
      padding: cs.padding, minWidth: cs.minWidth, widthCSS: cs.width, position: cs.position,
      inlineStyle: root.getAttribute('style'),
    };
    const children = [];
    for (const el of root.children) {
      if (el.offsetParent === null) continue;
      const b = el.getBoundingClientRect();
      const c = getComputedStyle(el);
      children.push({
        cls: (el.className || '').split(' ').slice(0, 3).join('.'),
        hidden: el.hidden,
        left: Math.round(b.left), right: Math.round(b.right), width: Math.round(b.width),
        bg: c.backgroundColor,
        text: (el.textContent || '').trim().slice(0, 50),
      });
    }
    out.children = children;
    const sub = document.querySelector('.vds-menu-items[data-submenu][data-open]');
    if (sub) {
      const b = sub.getBoundingClientRect();
      const c = getComputedStyle(sub);
      out.submenu = {
        left: Math.round(b.left), right: Math.round(b.right), width: Math.round(b.width),
        padding: c.padding, minWidth: c.minWidth, widthCSS: c.width, position: c.position,
        inlineStyle: sub.getAttribute('style'),
      };
      const rows = [];
      for (const el of sub.querySelectorAll('.vds-radio, .vds-menu-item')) {
        if (el.offsetParent === null) continue;
        const bb = el.getBoundingClientRect();
        const cc = getComputedStyle(el);
        rows.push({
          cls: el.className.split(' ').slice(0, 2).join('.'),
          left: Math.round(bb.left), right: Math.round(bb.right), width: Math.round(bb.width),
          paddingLeft: cc.paddingLeft,
          text: (el.textContent || '').trim().slice(0, 50),
        });
      }
      out.submenuRows = rows;
      const sections = [];
      for (const s of sub.querySelectorAll('.vds-menu-section, .vds-menu-section-body')) {
        if (s.offsetParent === null) continue;
        const b = s.getBoundingClientRect();
        sections.push({
          cls: s.className,
          left: Math.round(b.left), right: Math.round(b.right), width: Math.round(b.width),
        });
      }
      out.sections = sections;
    }
    return out;
  });

  writeFileSync(path.join(shots, name + '.json'), JSON.stringify(data, null, 2));
  await page.screenshot({ path: path.join(shots, name + '.png') });
  return data;
}

main().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});

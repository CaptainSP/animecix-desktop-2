const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const DIST = path.join(__dirname, 'dist');
fs.copyFileSync(path.join(__dirname, 'test.mp4'), path.join(DIST, 'test.mp4'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(predicate, { timeout = 30000, every = 250 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await predicate()) return true;
    await sleep(every);
  }
  return false;
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    show: true,
    webPreferences: { contextIsolation: true, webSecurity: true, backgroundThrottling: false },
  });
  await win.loadFile(path.join(DIST, 'index.html'));
  const wc = win.webContents;

  const js = (code) => wc.executeJavaScript(code, true);
  const ready = await waitFor(() =>
    js(`(function(){ var p = document.querySelector('[data-media-player]'); return !!(p && p.dataset.canPlay !== undefined); })()`)
  );
  console.log('player ready:', ready);
  await sleep(500);

  const settingsBtnClicked = await js(`(function(){
    var b = document.querySelector('.vds-settings-menu .vds-menu-button');
    if (!b) return 'no-button';
    var r = b.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), display: getComputedStyle(b).display, visible: b.offsetParent !== null };
  })()`);
  console.log('settings button:', JSON.stringify(settingsBtnClicked));
  if (settingsBtnClicked && settingsBtnClicked.x !== undefined) {
    const { x, y } = settingsBtnClicked;
    wc.sendInputEvent({ type: 'mouseMove', x, y });
    await sleep(60);
    wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
    await sleep(60);
    wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
  }
  const opened = await waitFor(() => js(`!!document.querySelector('.vds-settings-menu-items[data-open]')`), { timeout: 10000 });
  console.log('settings menu opened:', opened);
  await sleep(300);

  const speedRow = await js(`(function(){
    var items = [...document.querySelectorAll('.vds-settings-menu-items[data-open] .vds-menu-item')];
    var texts = items.map((el) => el.textContent.trim().slice(0, 40));
    var visible = items.filter((el) => el.offsetParent !== null);
    var row = visible.find((el) => {
      var t = el.textContent.trim();
      return t.startsWith('H\\u0131z') && t !== 'H\\u0131z ve Kalite';
    }) || null;
    if (row) {
      var r = row.getBoundingClientRect();
      var opts = { bubbles: true, cancelable: true, composed: true, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 };
      row.dispatchEvent(new PointerEvent('pointerdown', opts));
      row.dispatchEvent(new PointerEvent('pointerup', opts));
      row.dispatchEvent(new MouseEvent('click', opts));
      return { dispatched: true, texts, visible: visible.map((el) => el.textContent.trim().slice(0, 30)) };
    }
    return { dispatched: false, texts, visible: visible.map((el) => el.textContent.trim().slice(0, 30)) };
  })()`);
  console.log('root rows:', JSON.stringify(speedRow));
  const subOpened = await waitFor(() => js(`!!document.querySelector('.vds-quick-submenu[data-open]')`), { timeout: 10000 });
  console.log('submenu opened:', subOpened);
  await sleep(900);
  const afterDump = await js(`(function(){
    var header = document.querySelector('.vds-menu:has(> .vds-menu-items.vds-quick-submenu[data-open]) > .vds-menu-item');
    var root = document.querySelector('.vds-settings-menu-items[data-root]');
    var hr = header.getBoundingClientRect();
    var rr = root.getBoundingClientRect();
    return {
      headerRect: { left: hr.left, right: hr.right, top: hr.top, width: hr.width },
      rootRect: { left: rr.left, right: rr.right, top: rr.top, width: rr.width },
      ancestors: (function(){
        var out = []; var el = header.parentElement;
        while (el) {
          var cs = getComputedStyle(el);
          out.push({ tag: el.tagName, cls: String(el.className).slice(0, 40), display: cs.display, position: cs.position });
          el = el.parentElement;
          if (out.length > 5) break;
        }
        return out;
      })(),
    };
  })()`);
  console.log('HEADER-DETAIL:', JSON.stringify(afterDump, null, 1));
  await sleep(400);

  const dump = await js(`(function(){
    function rect(el){ if(!el) return null; var r = el.getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height), width: Math.round(r.width) }; }
    var header = document.querySelector('.vds-menu:has(> .vds-menu-items.vds-quick-submenu[data-open]) > .vds-menu-item');
    var sub = document.querySelector('.vds-quick-submenu[data-open]');
    var cs = header ? getComputedStyle(header) : null;
    var scs = sub ? getComputedStyle(sub) : null;
    return {
      headerRect: rect(header),
      headerStyle: cs ? { position: cs.position, zIndex: cs.zIndex, background: cs.backgroundColor, display: cs.display } : null,
      subRect: rect(sub),
      subStyle: scs ? { overflowY: scs.overflowY, paddingTop: scs.paddingTop, justifyContent: scs.justifyContent, position: scs.position, height: scs.height, top: scs.top, bottom: scs.bottom } : null,
      radios: sub ? [...sub.querySelectorAll('.vds-radio')].map((el) => ({ label: el.textContent.trim(), rect: rect(el) })) : null,
    };
  })()`);
  console.log(JSON.stringify(dump, null, 1));

  const img = await wc.capturePage();
  fs.writeFileSync(path.join(__dirname, 'speed-open-fixed.png'), img.toPNG());
  console.log('screenshot written');

  const clickEl = (sel) => js(`(function(){
    var el = document.querySelector(${JSON.stringify(sel)});
    if (!el) return false;
    var r = el.getBoundingClientRect();
    var opts = { bubbles: true, cancelable: true, composed: true, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 };
    el.dispatchEvent(new PointerEvent('pointerdown', opts));
    el.dispatchEvent(new PointerEvent('pointerup', opts));
    el.dispatchEvent(new MouseEvent('click', opts));
    return true;
  })()`);

  const radioClicked = await clickEl('.vds-quick-submenu[data-open] .vds-radio:nth-child(2)');
  console.log('radio clicked:', radioClicked);
  await sleep(300);
  const rate = await js(`document.querySelector('[data-media-player]') ? (window.__vds ? null : null) : null`);
  console.log('rate after click (via state attr):', await js(`(function(){
    var p = document.querySelector('[data-media-player]');
    return { rateAttr: p ? p.dataset.playbackRate : null, subOpen: !!document.querySelector('.vds-quick-submenu[data-open]') };
  })()`));

  const backClicked = await clickEl('.vds-menu:has(> .vds-menu-items.vds-quick-submenu[data-open]) > .vds-menu-item');
  console.log('back clicked:', backClicked);
  await sleep(300);
  const backState = await js(`(function(){
    return {
      subOpen: !!document.querySelector('.vds-quick-submenu[data-open]'),
      rootOpen: !!document.querySelector('.vds-settings-menu-items[data-root][aria-hidden="false"]'),
      speedExpanded: (function(){ var b = [...document.querySelectorAll('.vds-settings-menu-items[data-root] [data-menu-button]')].find((el) => el.textContent.includes('H\\u0131z')); return b ? b.getAttribute('aria-expanded') : null; })(),
    };
  })()`);
  console.log('BACK STATE:', JSON.stringify(backState));

  const controlsDump = await js(`(function(){
    var controls = document.querySelector('.vds-controls');
    if (!controls) return null;
    var groups = [...controls.querySelectorAll(':scope > .vds-controls-group')];
    return groups.map((g, i) => {
      var children = [...g.children].map((c) => ({ tag: c.tagName, cls: String(c.className).slice(0, 50) }));
      var r = g.getBoundingClientRect();
      return { index: i, top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height), childCount: children.length, children: children.slice(0, 6) };
    });
  })()`);
  console.log('CONTROLS:', JSON.stringify(controlsDump, null, 1));

  await sleep(200);
  app.exit(0);
}).catch((err) => {
  console.error('HARNESS ERROR', err);
  app.exit(1);
});

// Self-contained script injected into animecix.tv title pages for batch
// downloads ("Toplu İndir"). See batch-download.ts for the injection logic.
//
// CRITICAL: this string is passed to webContents.executeJavaScript. It runs in
// the page's main world where contextBridge exposes window.animecix. It must
// be fully self-contained (no imports) and must NOT contain backticks or
// ${...} sequences — the outer TS template literal would interpolate them.
export const BATCH_DOWNLOAD_SCRIPT = `
(function () {
  if (window.__animecixBatchDownload) return;
  var m = location.pathname.match(/^\\/titles\\/(\\d+)/);
  if (!m || location.pathname.indexOf('/edit') !== -1) return;
  window.__animecixBatchDownload = true;
  var titleId = m[1];

  // --- API helpers ---
  // Both calls go to /secure/batch-download, the endpoint pair the backend
  // added for this feature. The site's signed-request middleware only guards
  // GETs whose URL contains "titles", so a dedicated path needs no signature —
  // which is why this script no longer carries a copy of the site's signing
  // key. See tests/network/batch-download.test.ts, which asserts it stays out.
  var API_BASE = '/secure/batch-download/';

  // How many episodes to resolve per POST. Matches the backend's per-request
  // cap, which in turn matches tau-video's batch limit.
  var RESOLVE_CHUNK = 100;

  async function apiGet(path) {
    var res = await fetch(API_BASE + path, { credentials: 'same-origin' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  // Every /secure write is behind the site's double-submit CSRF check: the
  // XSRF-TOKEN cookie has to be echoed back in the X-XSRF-TOKEN header, or the
  // request comes back 403. The cookie is readable (httpOnly is off precisely
  // so the SPA can do this), and the episodes GET above seeds it if the page
  // does not have one yet.
  function readXsrfToken() {
    var parts = document.cookie.split(';');
    for (var i = 0; i < parts.length; i++) {
      var part = parts[i].trim();
      if (part.indexOf('XSRF-TOKEN=') === 0) {
        return decodeURIComponent(part.substring('XSRF-TOKEN='.length));
      }
    }
    return '';
  }

  async function apiPost(path, payload) {
    var res = await fetch(API_BASE + path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'X-XSRF-TOKEN': readXsrfToken()
      },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  var style = document.createElement('style');
  style.id = 'animecix-batch-style';
  style.textContent = [
    // Button mirrors the site's app-btn--md primary look (measured from the
    // live site; --dyn-accent keeps it theme-aware like the real button).
    '#animecix-batch-btn{display:inline-flex;align-items:center;justify-content:center;height:44px;padding:0 24px;border-radius:10px;font-size:15px;font-weight:500;font-family:Inter,sans-serif;border:none;cursor:pointer;white-space:nowrap}',
    '#animecix-batch-btn:hover:not([disabled]){background-color:var(--dyn-accent-light,#1a8fff)}',
    '#animecix-batch-btn .app-btn__content{display:flex;align-items:center;gap:8px}',
    '#animecix-batch-btn mat-icon{font-size:20px;width:20px;height:20px}',
    '#animecix-batch-modal{position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.65);display:flex;align-items:center;justify-content:center}',
    '#animecix-batch-panel{position:relative;background:#121212;color:#e0e0e0;width:560px;max-width:92vw;max-height:86vh;border-radius:12px;display:flex;flex-direction:column;overflow:hidden;font:14px Inter,sans-serif}',
    '#animecix-batch-header{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid #2a2a2a;background:#1a1a1a}',
    '#animecix-batch-header h3{margin:0;font-size:16px;font-weight:600}',
    '#animecix-batch-close{background:none;border:none;color:#aaa;font-size:20px;cursor:pointer;line-height:1;padding:4px 8px}',
    '#animecix-batch-close:hover{color:#fff}',
    '#animecix-batch-body{flex:1;overflow-y:auto;padding:8px 0}',
    '#animecix-batch-status{padding:12px 20px;color:#aaa;text-align:center;font-size:13px}',
    '#animecix-batch-season{border-bottom:1px solid #1f1f1f}',
    '#animecix-batch-season-head{display:flex;align-items:center;gap:10px;padding:10px 20px;background:#181818;cursor:pointer;font-weight:600;color:#fff}',
    '#animecix-batch-season-head:hover{background:#1f1f1f}',
    '.animecix-batch-ep{display:flex;align-items:center;gap:10px;padding:7px 20px 7px 44px;color:#cfcfcf;font-size:13px}',
    '.animecix-batch-ep:hover{background:#1a1a1a}',
    '.animecix-batch-ep.done{color:#4caf50;text-decoration:line-through}',
    '.animecix-batch-ep.failed{color:#f44336}',
    '.animecix-batch-ep input,.animecix-batch-season-head input{accent-color:#1976d2;cursor:pointer}',
    '.animecix-batch-ep-label{flex:1;cursor:pointer}',
    '.animecix-batch-ep-index{color:#8a8a8a;font-size:12px;white-space:nowrap}',
    '#animecix-batch-footer{display:flex;align-items:center;gap:12px;padding:14px 20px;border-top:1px solid #2a2a2a;background:#1a1a1a}',
    '#animecix-batch-select-all{display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;color:#bbb}',
    '#animecix-batch-select-all input{accent-color:#1976d2;cursor:pointer}',
    '#animecix-batch-download{margin-left:auto;background:#1976d2;color:#fff;border:none;border-radius:8px;padding:10px 18px;font-weight:600;font-size:14px;cursor:pointer}',
    '#animecix-batch-download:hover{background:#1565c0}',
    '#animecix-batch-download:disabled{background:#555;cursor:default}',
    // Full-panel confirmation overlay for large batches (>50 episodes)
    '#animecix-batch-confirm{position:absolute;inset:0;z-index:20;background:rgba(0,0,0,.9);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:24px;text-align:center;font-size:14px;color:#e0e0e0}',
    '#animecix-batch-confirm-btns{display:flex;gap:10px}',
    '#animecix-batch-confirm-yes,#animecix-batch-confirm-no{padding:9px 20px;border:none;border-radius:8px;font-weight:600;cursor:pointer}',
    '#animecix-batch-confirm-yes{background:#1976d2;color:#fff}',
    '#animecix-batch-confirm-no{background:#444;color:#eee}'
  ].join('');
  document.head.appendChild(style);

  var btn = document.createElement('button');
  btn.id = 'animecix-batch-btn';
  btn.type = 'button';
  btn.title = 'Toplu \u0130ndir';
  // Reuse the site's own button classes (.app-btn--primary provides the
  // themed accent background/color/hover) so it looks identical to "Şimdi İzle".
  btn.className = 'app-btn app-btn--primary';
  btn.innerHTML =
    '<span class="app-btn__content">' +
    '<mat-icon role="img" icon-left="" class="mat-icon notranslate material-icons mat-ligature-font mat-icon-no-color" aria-hidden="true" data-mat-icon-type="font">download</mat-icon>' +
    '<span class="app-btn__label"><span>Toplu \u0130ndir</span></span>' +
    '</span>';
  document.body.appendChild(btn);

  // Place the button right after the site's "Şimdi İzle" button (an app-button
  // with the t-button class). The Angular app renders asynchronously and
  // re-renders on navigation, so keep repositioning it while on the title page.
  function placeButton() {
    var target =
      document.querySelector('app-button.t-button[matTooltip="\u015Eimdi \u0130zle"]') ||
      document.querySelector('app-button.t-button');
    if (target && btn.previousElementSibling !== target) {
      target.insertAdjacentElement('afterend', btn);
    }
  }

  // SPA cleanup: Angular router uses pushState (same document). When the URL
  // leaves the title page, remove the injected UI so it never lingers, and
  // clear the guard so re-entering a title page re-injects it. While on the
  // page, keep the button anchored next to "Şimdi İzle".
  var watcher = setInterval(function () {
    if (!location.pathname.match(/^\\/titles\\/\\d+/)) {
      clearInterval(watcher);
      window.__animecixBatchDownload = false;
      if (btn.parentNode) btn.parentNode.removeChild(btn);
      if (style.parentNode) style.parentNode.removeChild(style);
      if (modal) closeModal();
      return;
    }
    placeButton();
  }, 800);
  placeButton();

  var modal = null;
  var bodyEl = null;
  var statusEl = null;
  var selectAllEl = null;
  var downloadBtn = null;
  var episodesBySeason = {};
  var seasonNames = {};
  var animeName = '';
  var posterUrl = '';
  var pendingConfirm = null;

  btn.addEventListener('click', openModal);

  function openModal() {
    if (modal) return;
    modal = document.createElement('div');
    modal.id = 'animecix-batch-modal';
    modal.innerHTML = [
      '<div id="animecix-batch-panel">',
      '  <div id="animecix-batch-header"><h3>Toplu \u0130ndir</h3><button id="animecix-batch-close" type="button" title="Kapat">\u00D7</button></div>',
      '  <div id="animecix-batch-body"><div id="animecix-batch-status">Y\u00FCkleniyor...</div></div>',
      '  <div id="animecix-batch-footer">',
      '    <label id="animecix-batch-select-all"><input type="checkbox" id="animecix-batch-all"> T\u00FCm\u00FCn\u00FC Se\u00E7</label>',
      '    <button id="animecix-batch-download" type="button">\u0130ndir (0)</button>',
      '  </div>',
      '</div>'
    ].join('');
    document.body.appendChild(modal);
    bodyEl = modal.querySelector('#animecix-batch-body');
    statusEl = modal.querySelector('#animecix-batch-status');
    selectAllEl = modal.querySelector('#animecix-batch-all');
    downloadBtn = modal.querySelector('#animecix-batch-download');
    modal.querySelector('#animecix-batch-close').addEventListener('click', closeModal);
    modal.addEventListener('click', function (e) { if (e.target === modal) closeModal(); });
    selectAllEl.addEventListener('change', onSelectAll);
    downloadBtn.addEventListener('click', startDownload);
    loadTitle();
  }

  function closeModal() {
    // If a large-batch confirmation is pending, treat closing as "cancel" so
    // the awaiting startDownload() never hangs.
    if (pendingConfirm) { pendingConfirm(false); pendingConfirm = null; }
    if (modal) { modal.parentNode.removeChild(modal); modal = null; }
  }

  async function loadTitle() {
    statusEl.textContent = 'Y\u00FCkleniyor...';
    // Reset state — the modal can be opened/closed repeatedly, and these
    // closures persist across opens (previous bug: episodes duplicated).
    episodesBySeason = {};
    seasonNames = {};
    animeName = '';
    posterUrl = '';
    try {
      // One request for the whole tree. The backend only lists episodes that
      // actually have a video, so every row rendered below is downloadable.
      var meta = await apiGet(titleId + '/episodes');
      if (!meta || !meta.success) throw new Error('Veri bulunamad\u0131');
      animeName = (meta.title && meta.title.name) || '';
      posterUrl = (meta.title && meta.title.poster) || '';
      var seasons = meta.seasons || [];
      for (var i = 0; i < seasons.length; i++) {
        var season = seasons[i];
        seasonNames[season.number] = season.name || (season.number + '. Sezon');
        episodesBySeason[season.number] = season.episodes || [];
      }
      renderSeasons();
    } catch (err) {
      statusEl.textContent = 'B\u00F6l\u00FCmler y\u00FCklenemedi: ' + (err && err.message ? err.message : 'bilinmeyen hata');
    }
  }

  function renderSeasons() {
    bodyEl.innerHTML = '';
    if (statusEl && statusEl.parentNode) statusEl.parentNode.removeChild(statusEl);
    statusEl = null;
    var seasonNumbers = Object.keys(episodesBySeason).sort(function (a, b) { return parseInt(a, 10) - parseInt(b, 10); });
    if (!seasonNumbers.length) {
      bodyEl.innerHTML = '<div id="animecix-batch-status">Bu anime i\u00E7in indirilebilir b\u00F6l\u00FCm bulunamad\u0131.</div>';
      statusEl = bodyEl.querySelector('#animecix-batch-status');
      return;
    }
    for (var i = 0; i < seasonNumbers.length; i++) {
      var s = seasonNumbers[i];
      var seasonDiv = document.createElement('div');
      seasonDiv.id = 'animecix-batch-season';
      seasonDiv.dataset.season = s;
      var head = document.createElement('div');
      head.className = 'animecix-batch-season-head';
      head.innerHTML = '<input type="checkbox" class="animecix-batch-season-all"> <span>' + (seasonNames[s] || s + '. Sezon') + '</span>';
      var eps = episodesBySeason[s].slice().sort(function (a, b) { return (a.episode || 0) - (b.episode || 0); });
      head.querySelector('input').addEventListener('change', function (e) {
        var rows = e.target.closest('#animecix-batch-season').querySelectorAll('.animecix-batch-ep input');
        for (var r = 0; r < rows.length; r++) rows[r].checked = e.target.checked;
        updateCount();
      });
      for (var j = 0; j < eps.length; j++) {
        var ep = eps[j];
        var row = document.createElement('label');
        row.className = 'animecix-batch-ep';
        // The checkbox value is the backend's episodeId, which is also the key
        // the download queue and the offline library use.
        row.innerHTML = '<input type="checkbox" value="' + ep.episodeId + '"> <span class="animecix-batch-ep-label">' +
          (ep.name && ep.name.length > 2 ? ep.name : (ep.episode || '') + '. B\u00F6l\u00FCm') + '</span>' +
          '<span class="animecix-batch-ep-index">S' + (ep.season || '') + ' E' + (ep.episode || '') + '</span>';
        row.querySelector('input').addEventListener('change', updateCount);
        seasonDiv.appendChild(row);
      }
      bodyEl.appendChild(seasonDiv);
    }
    updateCount();
  }

  function selectedEpisodes() {
    var out = [];
    if (!modal) return out;
    var rows = modal.querySelectorAll('.animecix-batch-ep input:checked');
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i].closest('.animecix-batch-ep');
      var seasonDiv = row.closest('#animecix-batch-season');
      var seasonNum = parseInt(seasonDiv.dataset.season, 10);
      var eps = episodesBySeason[seasonNum] || [];
      var idx = eps.findIndex(function (ep) { return ep.episodeId === rows[i].value; });
      if (idx !== -1) out.push(eps[idx]);
    }
    return out;
  }

  function updateCount() {
    if (!modal) return;
    var n = modal.querySelectorAll('.animecix-batch-ep input:checked').length;
    downloadBtn.textContent = '\u0130ndir (' + n + ')';
    selectAllEl.checked = n > 0 && n === modal.querySelectorAll('.animecix-batch-ep input').length;
  }

  function onSelectAll(e) {
    var rows = modal.querySelectorAll('.animecix-batch-ep input');
    for (var i = 0; i < rows.length; i++) rows[i].checked = e.target.checked;
    updateCount();
  }

  function pickBestUrl(video) {
    var urls = (video && video.urls) || [];
    if (!urls.length) return null;
    var best = null;
    var bestRes = -1;
    for (var i = 0; i < urls.length; i++) {
      var res = parseInt(urls[i].label, 10) || 0;
      if (res > bestRes) { bestRes = res; best = urls[i]; }
    }
    return best ? best.url : null;
  }

  async function startDownload() {
    var eps = selectedEpisodes();
    if (!eps.length) return;
    // Large batches take a long time per episode — confirm before starting.
    if (eps.length > 50) {
      var ok = await askContinue();
      if (!ok) return;
    }
    downloadBtn.disabled = true;
    var done = 0, failed = 0, total = eps.length;
    statusEl = document.createElement('div');
    statusEl.id = 'animecix-batch-status';
    statusEl.textContent = 'Kuyru\u011Fa ekleniyor...';
    bodyEl.insertBefore(statusEl, bodyEl.firstChild);
    // NOTE: the loop keeps running if the modal is closed mid-batch — all DOM
    // references below are null-safe on detached nodes (see findRow guard).
    for (var start = 0; start < eps.length; start += RESOLVE_CHUNK) {
      var chunk = eps.slice(start, start + RESOLVE_CHUNK);
      statusEl.textContent = 'Kaynaklar \u00E7\u00F6z\u00FCml\u00FCyor (' +
        (start + 1) + '-' + (start + chunk.length) + '/' + total + ')...';

      var resolved = null;
      try {
        resolved = await resolveEpisodes(chunk);
      } catch (err) {
        // A whole chunk failing is a network or server problem rather than a
        // per-episode one, so mark them all and try the next chunk.
        for (var f = 0; f < chunk.length; f++) {
          failed++;
          var failedRow = findRow(chunk[f]);
          if (failedRow) failedRow.classList.add('failed');
        }
        continue;
      }

      for (var i = 0; i < chunk.length; i++) {
        var ep = chunk[i];
        var row = findRow(ep);
        statusEl.textContent = (start + i + 1) + '/' + total + ' \u2014 ' +
          (ep.name || (ep.episode || '') + '. B\u00F6l\u00FCm');
        try {
          await enqueueEpisode(resolved[ep.episodeId]);
          done++;
          if (row) row.classList.add('done');
        } catch (err) {
          failed++;
          if (row) row.classList.add('failed');
        }
      }
    }
    statusEl.textContent = 'Tamamland\u0131: ' + done + ' eklendi' + (failed ? ', ' + failed + ' hata' : '');
    downloadBtn.disabled = false;
  }

  // Resolves true/false. If the modal is closed while asking, closeModal()
  // resolves false via pendingConfirm so the awaiting loop exits cleanly.
  function askContinue() {
    return new Promise(function (resolve) {
      if (!modal) { resolve(false); return; }
      pendingConfirm = resolve;
      var bar = document.createElement('div');
      bar.id = 'animecix-batch-confirm';
      bar.innerHTML =
        '<div>Fazla b\u00F6l\u00FCm se\u00E7ti\u011Fin i\u00E7in bu biraz uzun s\u00FCrebilir.<br>Yine de devam etmek ister misin?</div>' +
        '<div id="animecix-batch-confirm-btns">' +
        '<button type="button" id="animecix-batch-confirm-yes">Devam Et</button>' +
        '<button type="button" id="animecix-batch-confirm-no">Vazge\u00E7</button>' +
        '</div>';
      var finish = function (val) {
        pendingConfirm = null;
        bar.remove();
        resolve(val);
      };
      bar.querySelector('#animecix-batch-confirm-yes').addEventListener('click', function () { finish(true); });
      bar.querySelector('#animecix-batch-confirm-no').addEventListener('click', function () { finish(false); });
      modal.querySelector('#animecix-batch-panel').appendChild(bar);
    });
  }

  function findRow(ep) {
    // Modal may have been closed mid-batch — the download loop keeps running
    // detached, so missing rows are simply skipped.
    if (!modal) return null;
    var key = ep.episodeId;
    var rows = modal.querySelectorAll('.animecix-batch-ep');
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].querySelector('input').value === key) return rows[i];
    }
    return null;
  }

  // Resolves a batch of episodes to downloadable sources in one request and
  // returns them keyed by episodeId. Episodes the backend could not resolve
  // are simply absent from the map, so enqueueEpisode fails just that row.
  async function resolveEpisodes(chunk) {
    var payload = { episodes: [] };
    for (var i = 0; i < chunk.length; i++) {
      payload.episodes.push({ season: chunk[i].season, episode: chunk[i].episode });
    }
    var response = await apiPost(titleId + '/videos', payload);
    if (!response || !response.success) throw new Error('Kaynaklar al\u0131namad\u0131');

    var byEpisodeId = {};
    var items = response.data || [];
    for (var j = 0; j < items.length; j++) {
      byEpisodeId[items[j].episodeId] = items[j];
    }
    return byEpisodeId;
  }

  async function enqueueEpisode(item) {
    if (!item) throw new Error('Video bulunamad\u0131');
    var url = pickBestUrl(item);
    if (!url) throw new Error('Kalite bulunamad\u0131');
    var subs = (item.subs || []).map(function (s) { return { language: s.language, url: s.url }; });
    // episodeId and downloadTitle come from the backend so a batch download and
    // a single download of the same episode share one library record.
    await window.animecix.downloadVideo(item.episodeId, url, item.downloadTitle, subs, {
      animeTitle: animeName,
      seasonNumber: String(item.season || ''),
      episodeNumber: String(item.episode || ''),
      translator: item.translator || '',
      posterUrl: posterUrl
    });
  }
})();
`;

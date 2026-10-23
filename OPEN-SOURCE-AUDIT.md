# AnimeciX Desktop — Open-Source Readiness Audit

**Date:** 2026-05-04
**Branch:** release-dry-run
**Files reviewed:** 55 source files in src/

---

## Status Legend

- [x] Fixed
- [ ] TODO
- [!] Intentional — do NOT change (documented below)

---

## CRITICAL

- [x] **C1. LICENSE file missing** — No LICENSE file at repo root despite MIT in package.json
- [x] **C2. README.md empty** — Only contains `# animecix-desktop-2`
- [x] **C3. tau-video.xyz API URLs hardcoded** — Exposed in 7+ files → moved to env vars
- [x] **C4. CDN Referer-based auth recipe exposed** — header-rules.ts → moved to env vars
- [x] **C5. Discord Client ID hardcoded** → moved to env var (note: not actually secret)
- [x] **C6. GitHub repo coordinates hardcoded** — forge.config.ts, app-update.yml

## HIGH

### Security
- [x] **H1. Downloader accepts HTTP** — Now HTTPS-only (http: allowed only for localhost/127.0.0.1).
- [x] **H2. Redirect following without URL validation (SSRF)** — Added HTTPS validation + MAX_REDIRECTS=5 depth limit.
- [x] **H3. `shell.openExternal` without URL validation** — Now validates https:/http: scheme before opening.
- [x] **H4. No `will-navigate` handler** — Added trusted-origin restriction (site host, localhost, custom protocols).
- [x] **H5. `webSecurity: false`** — Re-enabled: it broke Cloudflare Turnstile. See Intentional Bypasses §1.

### Bugs
- [x] **H6. Duplicate `window-all-closed` handler** — Removed from WindowService.ts. main.ts handler is now the single point.
- [x] **H7. URL mutation race condition** — URL is now passed as parameter to downloadChunk, no more this.url mutation.
- [!] **H8. Dual `DISMISS_BANNER` IPC listeners** — `UpdaterBanner.ts:36` (hides UI) + `updater.ipc.ts:11` (suppresses re-show). **INTENTIONAL**: different concerns — one removes the BrowserView, the other sets `bannerDismissedThisSession`. Both fire via `ipcMain.on` which supports multiple listeners.

### Code Quality
- [ ] **H9. `any` types in 6+ locations** — `library.ipc.ts:22`, `useVideoData.ts:86-87`, `EmbedPlayer.tsx:212+`. Define interfaces or use `unknown`.
- [ ] **H10. IPC handlers inline in main.ts** — `video:fetch`, `subtitle:*`, `episode:*`, `cache:setCurrentEpisode`. Move to dedicated `.ipc.ts` files.

### Test & CI
- [x] **H11. 26 test failures** — Fixed with `pretest` script that rebuilds better-sqlite3 for Node ABI.
- [ ] **H12. 14 source files have no tests** — All IPC handlers untested. Write tests for at least IPC handlers.
- [x] **H13. No CI workflow for PRs** — Added `ci.yml` for lint + test on push/PR to main.
- [x] **H14. jassub LGPL components** — NOTICE file created with jassub (LGPL-2.1) and abp-filter-parser (MPL-2.0).
- [ ] **H15. Linting stack outdated** — `@typescript-eslint/*` 5.x (latest 8.x), `eslint` 8.x (latest 10.x).

## MEDIUM

- [x] **M1. `abp-filter-parser` MPL-2.0** — Documented in NOTICE file
- [x] **M2. No CONTRIBUTING.md** — Created with dev setup, code style, architecture rules, PR process
- [x] **M3. No CODE_OF_CONDUCT.md** — Added Contributor Covenant v2.1
- [x] **M4. No GitHub issue/PR templates** — Added bug report, feature request, and PR templates
- [ ] **M5. `electron-rebuild` deprecated** — Replace with `@electron/rebuild`
- [ ] **M6. `vite` 3 major versions behind**
- [!] **M7. `sandbox: false` in UpdaterBanner** — `UpdaterBanner.ts:53`. Test with `sandbox: true` on Electron 41.
- [x] **M8. `.gitignore` incomplete** — Added `.env*`, `*.db`, `coverage/`, `.DS_Store`, `assets/library/` etc.
- [ ] **M9. 37 lint errors** — Mostly `any` in test files
- [x] **M10. No `.editorconfig`** — Added with 2-space indent, LF, UTF-8
- [x] **M11. `package.json` description is placeholder** — Updated with real description + keywords
- [ ] **M12. Turkish UI strings inconsistent diacritics** — `Yukleniyor` vs `Yükleniyor`
- [ ] **M13. `postMessage` without origin validation** — `useParentMessages.ts:8`. Low risk in Electron but add check as defense-in-depth.
- [ ] **M14. No IPC rate limiting** — Sensitive handlers could be flooded if website is compromised.

## LOW (18 items)

- [ ] Magic numbers in `useParentMessages.ts` (5+ inline timeouts), `useColorExtraction.ts`, `Downloader.ts`
- [ ] Dead code: `useParentMessages.ts:146-148` — "inactive" validation timeout
- [ ] Duplicate code: `tau-protocol.ts` and `library-protocol.ts` share `resolveAssetPath`/`getMimeType`
- [ ] Duplicate constant: `MAX_DOWNLOAD_SIZE` defined in both `Downloader.ts` and `DownloadQueue.ts`
- [ ] Empty catch blocks missing comments in a few places
- [ ] 47 tests marked as `todo`
- [ ] `app.setAsDefaultProtocolClient` without user consent
- [ ] Repo URL typo: `dekstop` → `desktop`
- [ ] `keywords: []` empty in package.json
- [ ] `StorageService.updateDownloadStatus` types `status` as `string` instead of `DownloadStatus`
- [ ] `sources as never` type escape in EmbedPlayer.tsx
- [ ] Design spec references (D-06, T-03-13) in comments — contributors won't understand

---

## INTENTIONAL BYPASSES — DO NOT "FIX"

These are architectural decisions, not bugs. Changing them will break the app.

### 1. `webSecurity: false` — REVERTED (2026-10-23)
**Was:** kept off for cross-origin canvas color extraction (`useColorExtraction.ts`).
**Now on (default):** with it off, Chromium terminates the Cloudflare Turnstile iframe's
renderer ("Terminating renderer for bad IPC message, reason 1") and the widget stays grey;
reproduced in an isolated harness where `webSecurity: false` was the only variable.
Color extraction works without it because the player's `<video>` is
`crossOrigin="anonymous"` and header-rewriter forces ACAO `*` on CDN/R2 responses.
Offline (`animecix-offline://`) frames may taint the canvas; extraction skips those ticks.

### 2. Player iframe offline IPC via `(window as any).animecix` (EmbedPlayer.tsx, useVideoData.ts)
**Why:** The player page runs under `tau-player://` protocol in an iframe. It has NO access
to Electron's `ipcRenderer` or the preload bridge. For online playback, all communication
goes through postMessage to the parent (animecix.tv website). But for OFFLINE playback,
the main window navigates directly to `animecix-library://` (not animecix.tv), so the
postMessage bridge doesn't exist. The `(window as any).animecix` calls are the ONLY way
for the offline player to communicate with the main process. The `any` casts exist because
the full `AnimecixAPI` type is not available in the player page's TypeScript context.

### 3. `sandbox: false` on UpdaterBanner BrowserView (UpdaterBanner.ts:53)
**Why:** The updater banner BrowserView uses a preload script with `contextBridge`. While
modern Electron supports sandbox with contextBridge, this specific BrowserView loads
inline HTML and needs the preload to expose the updater API. Test before changing.

### 4. `TARGET_ORIGIN = '*'` in useParentMessages.ts
**Why:** The player iframe runs under `tau-player://` custom protocol inside Electron.
`postMessage` origin restrictions don't add security in this context because:
(a) the iframe is local, not web-served, and (b) the custom protocol origin string
varies. Restricting to a specific origin would break the postMessage bridge.

### 5. CDN header rewriting (header-rules.ts, header-rewriter.ts)
**Why:** The video CDN requires specific Referer and User-Agent headers to authorize
segment delivery. Electron's `session.webRequest.onBeforeSendHeaders` rewrites these
headers transparently. This is not a hack — it's the designed authentication mechanism
for the CDN. Without it, video playback fails with 403.

---

## POSITIVE PATTERNS (keep doing these)

1. Protocol handler 2-phase registration (scheme at top-level, handler after app.ready)
2. Preload bridge discipline — ipcRenderer never exposed directly
3. Path traversal protection in all 3 protocol handlers
4. Clean shutdown with ordered service disposal in before-quit
5. IPC naming consistency (domain:action pattern)
6. Security fuses enabled (ASAR integrity, cookie encryption)
7. npm audit clean — 0 known vulnerabilities
8. Git history clean — no secrets ever committed

---

## COMPLETED ACTIONS (this session)

1. [x] Created `.env` + `.env.example` with build-time env var injection
2. [x] Updated `.gitignore` (`.env*`, `*.db`, `coverage/`, `.DS_Store`, `assets/library/` etc.)
3. [x] Added `ImportMetaEnv` TypeScript types in `forge.env.d.ts`
4. [x] Updated `vite.player.config.mts` + `vite.library.config.mts` with `envDir`
5. [x] Replaced all hardcoded `tau-video.xyz` references with `import.meta.env.VITE_API_BASE_URL` / `VITE_CDN_DOMAIN`
6. [x] Replaced all hardcoded `animecix.tv` references with `import.meta.env.VITE_SITE_URL`
7. [x] Replaced Discord Client ID with `import.meta.env.VITE_DISCORD_CLIENT_ID`
8. [x] Added 4 GitHub Actions secrets: `VITE_API_BASE_URL`, `VITE_CDN_DOMAIN`, `VITE_SITE_URL`, `VITE_DISCORD_CLIENT_ID`
9. [x] Updated `release.yml` to inject env vars at workflow level

---

## PRIORITY ORDER FOR REMAINING WORK

### Phase 1 — Blockers (before open-source)
1. Create `LICENSE` file (MIT)
2. Write proper `README.md`
3. Create `NOTICE` file (jassub LGPL, abp-filter-parser MPL)
4. Fix duplicate `window-all-closed` handler (H6 — actual bug)
5. Fix Downloader URL race condition (H7 — actual bug)

### Phase 2 — Security hardening
6. Add `shell.openExternal` URL validation (H3)
7. Add `will-navigate` trusted-origin handler (H4)
8. Add redirect URL validation + depth limit (H2)
9. Make Downloader HTTPS-only to match IPC layer (H1)

### Phase 3 — Contributor experience
10. Create `CONTRIBUTING.md`
11. Create `CODE_OF_CONDUCT.md`
12. Add CI workflow for PRs (`ci.yml`)
13. Fix test failures (pretest script)
14. Add issue/PR templates
15. Add `.editorconfig`

### Phase 4 — Code quality
16. Move inline IPC handlers to dedicated files (H10)
17. Fix `any` types (H9)
18. Fix lint errors (M9)
19. Write missing tests (H12)
20. Extract magic numbers to named constants

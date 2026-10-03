# AnimeciX Desktop App

Electron desktop application for AnimeciX — anime streaming, downloading, and offline playback.

## Tech Stack

- **Runtime:** Electron 41 + Electron Forge 7 (Vite plugin)
- **Language:** TypeScript 5.9 (strict mode, `noImplicitAny: true`)
- **UI:** React 19 (player page + library page), Angular (website shell via animecix.tv)
- **Video:** Vidstack React + hls.js + JASSUB (ASS/SSA subtitle rendering)
- **Database:** better-sqlite3 (synchronous SQLite, WAL mode)
- **Build:** 5 Vite configs (main, preload, renderer, player, library)
- **Testing:** Vitest 4
- **Linting:** ESLint with TypeScript + import plugins

## Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│  Main Process (src/main.ts)                         │
│  ┌───────────┐ ┌──────────┐ ┌───────────────────┐  │
│  │ Storage   │ │ Download │ │ StreamCache       │  │
│  │ (SQLite)  │ │ Queue    │ │ (transparent +    │  │
│  │           │ │          │ │  explicit caching) │  │
│  └───────────┘ └──────────┘ └───────────────────┘  │
│  ┌───────────┐ ┌──────────┐ ┌───────────────────┐  │
│  │ Discord   │ │ Updater  │ │ Library Manager   │  │
│  │ RPC       │ │ Service  │ │ (BrowserView)     │  │
│  └───────────┘ └──────────┘ └───────────────────┘  │
│  ┌───────────┐ ┌──────────┐ ┌───────────────────┐  │
│  │ AdBlocker │ │ Header   │ │ TrayManager       │  │
│  │           │ │ Rewriter │ │                   │  │
│  └───────────┘ └──────────┘ └───────────────────┘  │
├─────────────────────────────────────────────────────┤
│  Preload (src/preload.ts)                           │
│  contextBridge → window.animecix + window.animecixAPI│
├─────────────────────────────────────────────────────┤
│  Renderer: animecix.tv (Angular website)            │
│  ┌─────────────────────────────────────────────┐    │
│  │  Player iframe (tau-player://)  — React     │    │
│  │  Library overlay (animecix-library://) — React│   │
│  └─────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────┘
```

### Custom Protocol Schemes

| Protocol | Purpose | Handler |
|---|---|---|
| `tau-player://` | Serves local video player assets (Vidstack + JASSUB) | `src/player/tau-protocol.ts` |
| `animecix-offline://` | Serves cached/downloaded video files | `src/offline/offline-protocol.ts` |
| `animecix-library://` | Serves library overlay React app | `src/library/library-protocol.ts` |
| `animecix://` | Deep link protocol for Google auth callback | `src/auth/deep-link.ts` |

### IPC Communication Pattern

```
animecix.tv (renderer)
    │
    ├─ window.animecix.*  ──────► ipcRenderer.invoke() ──► ipcMain.handle()
    │   (preload bridge)
    │
    ├─ postMessage ◄────────────► Player iframe (tau-player://)
    │   (player iframe CANNOT access window.animecix — only postMessage)
    │
    └─ window.animecixAPI.updater ──► ipcRenderer (updater channels)
```

**Critical rule:** The player iframe runs under `tau-player://` origin. It has NO access to
Electron's `ipcRenderer`. All player↔main communication goes through the website as a bridge:
`player iframe → postMessage → animecix.tv → IPC → main process`.

## Directory Structure

```
src/
├── main.ts              # Electron main process entry point
├── preload.ts           # contextBridge API (AnimecixAPI contract)
├── renderer.ts          # Renderer process entry
├── auth/                # Deep link protocol (Google login callback)
├── cache/               # StreamCache (transparent + explicit), HlsMuxer, CacheEvictor
├── download/            # Multi-threaded downloader, queue, tray, IPC handlers
├── integrations/        # Discord Rich Presence
├── library/             # Offline library manager (BrowserView overlay)
├── library-page/        # React app for offline library UI
├── network/             # Ad blocker, request interception, CDN header rewriting
├── offline/             # animecix-offline:// protocol handler
├── player/              # tau-player:// protocol handler
├── player-page/         # React app for video player (Vidstack + JASSUB)
├── power/               # Display keep-awake (powerSaveBlocker) during playback
├── storage/             # SQLite StorageService + schema
├── types/               # TypeScript type definitions
├── updater/             # Auto-update service + in-app banner
└── window/              # BrowserWindow creation, lifecycle, IPC
```

## Code Rules

### Language

- All code (variables, functions, classes, comments, commit messages) MUST be in **English**.
- Turkish is ONLY allowed in user-facing UI strings (button labels, notifications, messages).
- JSDoc comments and inline comments must be in English.

### File Organization

- Each domain has its own directory: `download/`, `cache/`, `storage/`, etc.
- IPC handlers go in `<domain>.ipc.ts` files (e.g., `download.ipc.ts`).
- Type definitions go in `<domain>.types.ts` or `src/types/`.
- Protocol handlers go in `<domain>-protocol.ts` files.
- React pages (player, library) are self-contained in `<name>-page/` directories.

### IPC Rules

1. **Never expose `ipcRenderer` directly.** All IPC must go through `preload.ts` → `contextBridge`.
2. IPC channel names follow `domain:action` pattern (e.g., `download:start`, `window:minimize`).
3. Use `ipcMain.handle()` for request-response, `ipcMain.on()` for fire-and-forget events.
4. Event subscriptions in preload MUST return an unsubscribe function.
5. IPC handler functions receive all dependencies as parameters (for testability).

### Protocol Handler Rules

1. Protocol schemes MUST be registered at module top-level (before `app.whenReady()`).
2. The side-effect import (e.g., `import './player/tau-protocol'`) registers the scheme.
3. The named export (e.g., `registerTauProtocol()`) installs the actual handler after app ready.
4. Protocol imports MUST be the first imports in `main.ts`.

### Error Handling

1. Network failures are **non-fatal** — log and continue. Skip markers, metadata, subtitles, Discord RPC, and filter lists all fail gracefully.
2. Use `try/catch` with empty catch blocks ONLY for genuinely ignorable failures (e.g., cleanup of temp files). Comment `/* ignore */` or `/* non-fatal */` in these cases.
3. **Never swallow errors silently** for operations that affect data integrity (downloads, database writes, file I/O for user content).
4. Validate at system boundaries: URL schemes (HTTPS-only for downloads), episode IDs from storage, IPC channel inputs.
5. Return `null` (not throw) when querying for optional data that may not exist.

### Constants & Magic Numbers

1. Name all numeric constants: `const MAX_DOWNLOAD_SIZE = 10 * 1024 * 1024 * 1024` not `10737418240`.
2. Use descriptive expressions: `4 * 60 * 60 * 1000` not `14400000`.
3. Constants go at module top-level, above the class/function that uses them.
4. HTTP status codes (200, 206, 301, 302) are acceptable as literals — they are universally understood.

### Security

1. **HTTPS-only downloads.** Validate URL scheme before any download operation.
2. **Never log raw video URLs** or user tokens beyond debug level.
3. **Path traversal prevention:** Always derive file paths from database lookups (episodeId → storage path), never from user input.
4. `webSecurity: false` is intentional (required for cross-origin video canvas color extraction). Do not change without understanding the implications.
5. Electron security fuses are enabled — do not disable ASAR integrity or cookie encryption.

### Testing

- Test files live in `tests/<domain>/` mirroring `src/<domain>/`.
- Run tests: `npm test` (vitest run).
- Tests use the `node` environment (no DOM).
- Mock Electron APIs when testing main process code.
- Every new service class or IPC handler MUST have corresponding tests.

### Comments

- Write comments that explain **WHY**, not WHAT.
- Reference design spec identifiers where applicable (e.g., `D-06`, `T-03-13`, `PLAY-05`).
- Document cross-file dependencies and architectural decisions.
- Mark fallback/workaround code with the reason it exists.

### Git & Commits

- Commit messages in English, conventional commits style: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`.
- One logical change per commit.
- Never commit `.env`, credentials, or API keys.

## Common Commands

```bash
npm start                    # Start in development mode (loads localhost:4200)
npm test                     # Run test suite
npm run lint                 # Run ESLint
npm run package              # Package for current platform
npm run make                 # Make distributable
npm run build:player         # Build player React app to assets/player/
npm run build:library        # Build library React app to assets/library/
npm run postinstall          # Rebuild native modules (better-sqlite3)
```

## Agent Usage

This project includes two Claude Code skills for contributors:

### Electron Agent (`/electron-agent`)

Use this agent when writing any Electron-related code. It enforces the project's architectural
patterns and prevents common Electron pitfalls. Invoke it before writing code that touches:
- Main process logic
- IPC handlers
- Protocol handlers
- Preload bridge
- BrowserWindow management
- Native module integration

### Code Review Agent (`/code-review-agent`)

Run this agent after completing any code changes. It performs a strict review against the
project's code rules and catches issues before they reach PR review. It checks:
- Code style and naming conventions
- IPC pattern compliance
- Security rules
- Error handling patterns
- Test coverage requirements
- Comment quality

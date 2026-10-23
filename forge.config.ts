import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
// eslint-disable-next-line import/default -- @reforged/maker-appimage uses module.exports (CJS default), no named export
import MakerAppImage from '@reforged/maker-appimage';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import * as fs from 'node:fs';
import * as path from 'node:path';

// External-to-Vite native deps that must remain in the packaged app's
// node_modules/ so require() resolves them at runtime. plugin-vite's
// ignore filter excludes everything except .vite/ from the copy step,
// so node_modules never makes it into the build directory. We physically
// copy these modules (and their transitive runtime deps) in afterCopy.
const EXTERNAL_NATIVE_DEPS = ['better-sqlite3', 'bufferutil', 'utf-8-validate'];

const config: ForgeConfig = {
  packagerConfig: {
    appBundleId: 'com.onmuapps.animecix',              // D-26
    executableName: 'AnimeciX',                         // Linux makers need this to find the binary
    asar: true,
    icon: 'assets/icon',                                // Forge appends .icns/.ico per platform
    extraResource: [
      'assets/player',
      'assets/library',
      'resources/app-update.yml',
      // AdBlocker filter lists (src/network/ad-blocker.ts resolves
      // process.resourcesPath/filter-lists with a __dirname fallback).
      'src/network/filter-lists',
      // Tray icon source: TrayManager reads resourcesPath/tray-icon.png,
      // falling back to resourcesPath/icon.png (assets/tray-icon.png
      // never existed — the app icon is reused instead).
      'assets/icon.png',
    ],
    osxUniversal: {
      x64ArchFiles: '**/*.node',                        // D-05 + Pitfall 3 — prevent double-lipo of better-sqlite3
    },
    osxSign: {
      optionsForFile: (_filePath: string) => ({
        entitlements: 'build/entitlements.mac.plist',   // D-06 — hardened runtime entitlements
        hardenedRuntime: true,
      }),
    },
    // D-08 — notarize gate:
    //  skip locally (no APPLE_API_KEY), or
    //  skip temporarily when SKIP_NOTARIZE=true (Apple team config issue — support ticket pending).
    //  To re-enable, remove SKIP_NOTARIZE from the workflow env.
    osxNotarize: (process.env.APPLE_API_KEY && process.env.SKIP_NOTARIZE !== 'true') ? {
      appleApiKey: process.env.APPLE_API_KEY,           // FILE PATH to .p8 (Pitfall 4 — not base64 content)
      appleApiKeyId: process.env.APPLE_API_KEY_ID!,     // 10-char ASC key ID
      appleApiIssuer: process.env.APPLE_API_ISSUER!,    // ASC issuer UUID
    } : undefined,
    // plugin-vite's ignore filter excludes everything except .vite/ from
    // the Electron Packager copy step — node_modules never reaches the
    // build directory. We physically copy external native deps (and their
    // transitive runtime dependencies) so require() works at runtime.
    afterCopy: [
      (buildPath, _electronVersion, _platform, _arch, callback) => {
        try {
          const srcNM = path.resolve(__dirname, 'node_modules');
          const destNM = path.join(buildPath, 'node_modules');
          fs.mkdirSync(destNM, { recursive: true });

          const copied = new Set<string>();
          function copyDep(name: string) {
            if (copied.has(name)) return;
            copied.add(name);
            const src = path.join(srcNM, name);
            if (!fs.existsSync(src)) return;
            fs.cpSync(src, path.join(destNM, name), { recursive: true });
            // Recursively copy transitive production deps
            const depPkgPath = path.join(src, 'package.json');
            if (fs.existsSync(depPkgPath)) {
              const depPkg = JSON.parse(fs.readFileSync(depPkgPath, 'utf8'));
              for (const transDep of Object.keys(depPkg.dependencies || {})) {
                copyDep(transDep);
              }
            }
          }

          for (const dep of EXTERNAL_NATIVE_DEPS) {
            copyDep(dep);
          }
          console.log(`[afterCopy] Copied native deps to build: ${[...copied].join(', ')}`);
          callback();
        } catch (err) {
          callback(err as Error);
        }
      },
    ],
  },
  // Defaults let Forge auto-detect native deps and use prebuilt binaries
  // when available. better-sqlite3 publishes prebuilts for darwin-x64,
  // darwin-arm64, win32-x64 matching Electron's ABI — no need for
  // buildFromSource. The previous config (force + buildFromSource +
  // onlyModules) caused silent failure on the arm64 slice of universal
  // builds, after which prune removed the module entirely.
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({
      name: 'AnimeciX',                                 // D-27 — installer name
      setupIcon: 'assets/icon.ico',
      iconUrl: 'https://raw.githubusercontent.com/CaptainSP/animecix-desktop-2/main/assets/icon.ico',
    }),
    new MakerZIP({}, ['darwin']),                       // D-03 — update channel
    new MakerDMG({
      icon: 'assets/icon.icns',
      name: 'AnimeciX',
    }, ['darwin']),                                     // D-04 — first-install UX
    new MakerDeb({
      options: {
        name: 'animecix',
        productName: 'AnimeciX',
        bin: 'AnimeciX',
        genericName: 'Anime Player',
        description: 'AnimeciX desktop app — anime streaming, downloading, and offline playback',
        categories: ['Video', 'AudioVideo'],
        icon: 'assets/icon.png',
        mimeType: ['x-scheme-handler/animecix'],
      },
    }),
    new MakerRpm({
      options: {
        name: 'animecix',
        productName: 'AnimeciX',
        bin: 'AnimeciX',
        genericName: 'Anime Player',
        description: 'AnimeciX desktop app — anime streaming, downloading, and offline playback',
        categories: ['Video', 'AudioVideo'],
        icon: 'assets/icon.png',
        mimeType: ['x-scheme-handler/animecix'],
      },
    }),
    new MakerAppImage({
      options: {
        bin: 'AnimeciX',
        icon: 'assets/icon.png',
        categories: ['Video'],
      },
    }),
  ],
  publishers: [
    {
      name: '@electron-forge/publisher-github',
      config: {
        repository: {
          owner: 'CaptainSP',
          name: 'animecix-desktop-2',
        },
        draft: true,                                     // D-21 — manual "Publish release" gate; no accidental ships
        prerelease: false,                               // D-12 — single stable channel
        generateReleaseNotes: true,                      // D-22 — GitHub auto-populates changelog
        tagPrefix: 'v',                                  // D-24 — semver tags are vMAJOR.MINOR.PATCH
        authToken: process.env.GITHUB_TOKEN,
      },
    },
  ],
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new VitePlugin({
      // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
      build: [
        {
          entry: 'src/main.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/preload.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
      ],
    }),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;

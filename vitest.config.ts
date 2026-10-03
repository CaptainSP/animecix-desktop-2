import { defineConfig } from 'vitest/config';

// Public, non-secret defaults injected into import.meta.env for the test run.
// The suite asserts these exact values (animecix.tv, tau-video.xyz, the public
// Discord client id), so tests must stay deterministic regardless of whether a
// local .env or CI secrets are present. This keeps the suite green on fork PRs,
// where GitHub does not expose repository secrets. Real .env / process.env
// values still win when they are set (Vite loads .env after this).
const TEST_ENV = {
  VITE_API_BASE_URL: 'https://tau-video.xyz',
  VITE_CDN_DOMAIN: 'tau-video.xyz',
  VITE_SITE_URL: 'https://animecix.tv',
  VITE_DISCORD_CLIENT_ID: '921684324141641728',
  // Push config is only asserted as "present vs absent" by the suite, so these
  // are placeholders rather than the real project's values.
  VITE_FCM_PROJECT_ID: 'animecix-test',
  VITE_FCM_APP_ID: '1:000000000000:web:0000000000000000000000',
  VITE_FCM_API_KEY: 'test-api-key',
  VITE_FCM_SENDER_ID: '000000000000',
  VITE_FCM_VAPID_KEY: 'test-vapid-key',
};

export default defineConfig({
  test: {
    root: '.',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
    globals: true,
    env: TEST_ENV,
  },
});

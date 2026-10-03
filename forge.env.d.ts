/// <reference types="@electron-forge/plugin-vite/forge-vite-env" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
  readonly VITE_CDN_DOMAIN: string;
  readonly VITE_SITE_URL: string;
  readonly VITE_DISCORD_CLIENT_ID: string;
  // Firebase Web App config for push notifications (src/notifications/PushService.ts).
  // Push stays disabled when any of these is missing.
  readonly VITE_FCM_PROJECT_ID: string;
  readonly VITE_FCM_APP_ID: string;
  readonly VITE_FCM_API_KEY: string;
  readonly VITE_FCM_SENDER_ID: string;
  readonly VITE_FCM_VAPID_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

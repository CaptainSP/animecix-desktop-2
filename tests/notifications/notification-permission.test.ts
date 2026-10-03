import { describe, expect, it } from 'vitest';
import { shouldPromptForPermission } from '../../src/notifications/notification-permission';

const base = {
  platform: 'darwin' as NodeJS.Platform,
  displayConfirmed: false,
  hintShown: false,
};

describe('shouldPromptForPermission', () => {
  it('prompts on macOS when no notification was ever displayed', () => {
    expect(shouldPromptForPermission(base)).toBe(true);
  });

  it('never prompts twice', () => {
    expect(shouldPromptForPermission({ ...base, hintShown: true })).toBe(false);
  });

  it('stops prompting once a notification was confirmed on screen', () => {
    // Do Not Disturb also suppresses a notification; the confirmation flag is
    // what keeps a quiet afternoon from being mistaken for revoked permission.
    expect(
      shouldPromptForPermission({ ...base, displayConfirmed: true }),
    ).toBe(false);
    expect(
      shouldPromptForPermission({ ...base, displayConfirmed: true, hintShown: true }),
    ).toBe(false);
  });

  it('stays silent off macOS', () => {
    // Windows suppression is Focus Assist, not a per-app permission, and the
    // remedy differs — macOS wording would be actively misleading there.
    expect(shouldPromptForPermission({ ...base, platform: 'win32' })).toBe(false);
    expect(shouldPromptForPermission({ ...base, platform: 'linux' })).toBe(false);
  });
});

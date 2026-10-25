/**
 * Whether the main window uses the OS's own frame and title bar instead of the
 * frameless window the website draws its chrome into. Linux only: Window
 * Controls Overlay is not reliably supported by Linux window managers
 * (especially Wayland compositors), and a frameless window there can leave
 * users with no close/min/max buttons at all.
 *
 * Shared by WindowService (which builds the window) and preload (which tells
 * the website, so it stops drawing its own caption buttons next to the OS's).
 * Pure and Electron-free so preload can import it.
 */
export function usesNativeFrame(platform: NodeJS.Platform = process.platform): boolean {
  return platform === 'linux';
}

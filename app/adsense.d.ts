/**
 * The AdSense loader (`adsbygoogle.js`, injected in `root.tsx`) exposes a global
 * push-queue array: pushes made before the script finishes loading are queued
 * and processed on load, so we can `push({})` right after mounting an `<ins>`.
 */
interface Window {
  adsbygoogle?: unknown[];
}

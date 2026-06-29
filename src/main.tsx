import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { UpdateBanner, SplashScreen } from 'digital-boardgame-framework/client';
import { App } from './App';

// This app never registers a service worker. But a leftover SW from a PRIOR app
// served on the same localhost origin can hijack it — intercepting requests and
// serving a stale cached page so new code never loads. Defensively unregister any
// SW for this origin and drop its caches on startup. (Runs as soon as this bundle
// executes, so once a fresh load gets through, future loads stay clean.)
if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((regs) => {
    if (regs.length) {
      regs.forEach((r) => r.unregister());
      if ('caches' in window) caches.keys().then((ks) => ks.forEach((k) => caches.delete(k)));
    }
  }).catch(() => { /* best-effort */ });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* "A new version is available — Reload" when a fresh build is deployed.
        Polls /version.json (written by the versionStamp plugin) vs this bundle. */}
    <UpdateBanner currentBuild={__DBF_BUILD_ID__} />
    <SplashScreen title="War of the Ring" appId="war-of-the-ring" />
    <App />
  </StrictMode>,
);

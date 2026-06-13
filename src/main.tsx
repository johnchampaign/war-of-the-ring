import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { UpdateBanner } from 'digital-boardgame-framework/client';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* "A new version is available — Reload" when a fresh build is deployed.
        Polls /version.json (written by the versionStamp plugin) vs this bundle. */}
    <UpdateBanner currentBuild={__DBF_BUILD_ID__} />
    <App />
  </StrictMode>,
);

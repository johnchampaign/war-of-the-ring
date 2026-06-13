// Entry point. The game UI doesn't exist yet (Phase 1 is the headless engine).
// For now this hosts the DEV-ONLY polygon/token-layout audit overlay — WotR is
// the first consumer proving the framework's geo module (v0.9.0). Once the real
// app lands this becomes a gated dev route (e.g. #/dev/audit).
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PolygonAudit } from './devtabs/PolygonAudit';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PolygonAudit />
  </StrictMode>,
);

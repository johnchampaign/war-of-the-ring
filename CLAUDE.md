# War of the Ring (2nd Ed.) — Notes for Claude

Project-local conventions for the unofficial digital port. Skim before each
session. This is **digital boardgame project #6** on the
[Digital Boardgame Framework](../Digital%20Boardgame%20Framework). Read that
project's `docs/new-game-playbook.md` once; this file is the game-specific brief.

## What this is

- **Game:** War of the Ring, 2nd Edition (Ares Games), **base game only**,
  **2-player** (Free Peoples vs Shadow). Expansions and 3–4 player rules are
  deferred. The full plan lives at
  `C:\Users\johnc\.claude\plans\linear-wobbling-beaver.md`.
- **Closest prior port:** Star Wars Rebellion (`../Star Wars Rebellion`) — same
  asymmetric-2-player-with-hidden-info shape. Mirror its
  `src/engine → src/adapter → src/online → functions/api` structure.

## Architecture (the seams that matter)

- `src/engine/` is **pure** — no React, no `Date.now()`/`Math.random()` (use
  `rng.ts`), no framework imports. State is plain JSON-able data.
- `src/adapter/wotrAdapter.ts` is the **only** engine-side file that imports
  `digital-boardgame-framework`. It implements the `GameAdapter`
  (`applyAction`/`tryApplyAction`/`currentActor`/`legalActions`/`viewFor`/
  `result`, `schemaVersion: 1`, throwing `migrate()`).
- `src/adapter/redact.ts` (`viewFor`) must hide, per seat: the **Fellowship's
  hidden position**, the opponent's **event-card hand**, the **Hunt-tile bag**,
  and the **RNG state**; the turn log is **default-deny** (public kinds + the
  viewer's own side-tagged entries only). Keep a leak-check test.

## Hard rules (inherited from the framework playbook)

- **Backups before anything.** Private remote `johnchampaign/war-of-the-ring`.
  Commit + push before the second hour. New commits, never `--amend`/force-push.
- **Never `git add -A`** — stage files by name.
- **Never commit or deploy publisher art or rulebook PDFs.** `.gitignore`
  enforces it. The repo ships **metadata + URLs only** (`assets/asset-urls.json`
  points at the Steam CDN sheets from the TTS mod). Art is fetched/sliced/cached
  client-side on first run (IndexedDB); the game is fully playable with text
  placeholders. README states attribution.
- **Supabase:** shared framework project, schema with **RLS enabled** — verify
  Security Advisor is clean before calling online "done".
- **Don't start the UI until the headless soak passes** (Phase 1 gate).
- **Multiplayer-first.** Online async PvP is primary; hotseat is a preset of the
  same transport, not a separate code path. The UI never drives the opponent.

## Fidelity decision: prompt for every player choice

Per the user (2026-06-13): be **faithful to tabletop** — every genuine player
choice is a real async prompt; do **not** auto-resolve strategic choices the way
the framework's default recipe suggests. Only *purely mechanical* steps with no
decision (deck shuffles, forced single-legal-option resolutions) are
auto-resolved deterministically under the seeded RNG. **Document every such
deviation** in `docs/rules-spec.md` next to the rule it departs from.

## AI opponent

Part of v1. Built as an `IPlayerController` (`src/ai/wotrAI.ts`) over the **same
action vocabulary** as humans, consuming the **redacted view**. A `RandomAI`
comes first (Phase 1, for the soak); the heuristic AI lands before v1 is "done".

## Rules sources (gitignored — local only)

`WOTR001-Rulebook-EN-v24_1-web.pdf` (authority), `WOTR001-Rulebook-Reference-EN-web.pdf`,
`WOTR001-FAQ_V1.2-EN-web.pdf`. The rulebook map is the authority on region
borders/adjacency. `docs/rules-spec.md` is the living rules-as-spec with page
cites; the engine implements that, not the PDF directly.

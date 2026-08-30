# WotR online AI worker (Linode) — future home of the multistep AI

The Linode box (`champaignj@172.232.14.119`) is the **runtime** home for the
deployed game's strong AI, exactly like Star Wars Rebellion's
`deploy/ai-worker/`: Cloudflare's per-request CPU limit can't run a real
search, so once the multistep AI (1-ply evaluator, later deeper search) ships,
a worker on this box will poll the deployed API for games waiting on an AI
seat, compute the move locally, and post it back.

**This box is NOT for development** — A/B tournament soaks and experiments run
on the dev machine as always (John, 2026-08-29). The box hosts a live
tutor/forum; anything here runs `nice -19`.

## Already in place (2026-08-30)
- `~/wotr-ai/` — `--depth 1` read-only clone (GitHub deploy key
  `linode-wotr-readonly`). No secrets, no write access, no deploys from here.
- node v20 present; the engine runs (`npx vite-node scripts/tournament.mjs
  --games 30` verified, output identical to the dev machine).

## Still to build (when the multistep AI lands)
Mirroring SWR's `deploy/ai-worker/`:
- admin endpoints on the Pages Functions (`ai-due` / `ai-move`, token-gated,
  optimistic concurrency on the turn number);
- `scripts/ai-worker.mjs` polling loop with an env file (`~/wotr-worker.env`,
  perms 600, outside the repo);
- `tick.sh` cron supervisor (+ `@reboot`) for pull-to-deploy and self-healing —
  SWR's version documents the setsid/nohup detach pitfall.

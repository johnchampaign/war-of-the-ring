# WotR AI processing on the Linode (172.232.14.119)

Heavy AI work — A/B tournament soaks, gamelog mining, future search-AI
evaluation — runs on the Linode box, **not** the dev machine (which may be
powered off or rebooted into Windows). Same box and root-free conventions as
Star Wars Rebellion's `deploy/ai-worker/`.

## Layout on the box (`champaignj@172.232.14.119`)
- `~/wotr-ai/` — `--depth 1` clone via the read-only GitHub deploy key
  `linode-wotr-readonly` (added 2026-08-30). `git pull --ff-only` before
  measuring; the box never pushes.
- `~/wotr-soaks/` — soak outputs: `<name>.log` (tournament output) and
  `<name>.exit` (exit code, written on completion — poll THIS, not the process).

## Running an A/B (from any session)
```bash
ssh champaignj@172.232.14.119 'cd ~/wotr-ai && git pull --ff-only -q && ./deploy/linode/run-soak.sh base_f1 --games 2000'
# poll:  ssh ... 'cat ~/wotr-soaks/base_f1.exit 2>/dev/null || echo running'
# fetch: ssh ... 'cat ~/wotr-soaks/base_f1.log'
```
Sequential-soak discipline still applies (never two at once — 1 vCPU, and the
box hosts a live tutor/forum; everything runs `nice -19`). ~16 min per
2000-game soak measured 2026-08-30. For a treatment run, push the change to a
branch and check it out on the box, or push to main and pull — the clone is
read-only either way.

## Not on this box
Secrets, service-role keys, deploys. The box holds a read-only clone only.

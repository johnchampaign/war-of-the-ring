#!/usr/bin/env bash
# Detached tournament soak on the Linode box (champaignj@172.232.14.119) — the
# same box and root-free pattern as SWR's deploy/ai-worker. Heavy AI processing
# (A/B soaks, log mining) runs HERE, not on the dev machine, which may be off or
# rebooted into Windows (John, 2026-08-29).
#
#   ~/wotr-ai        read-only clone (GitHub deploy key "linode-wotr-readonly");
#                    run `git pull --ff-only` before a soak to measure HEAD.
#   ~/wotr-soaks/    one <name>.log + <name>.exit per run.
#
# Usage (on the box):   deploy/linode/run-soak.sh <name> [tournament args...]
#   e.g.  ./deploy/linode/run-soak.sh base_f1 --games 2000
#         ./deploy/linode/run-soak.sh base_f2 --games 2000 --seed-offset 100000
# Detaches with setsid (survives the SSH channel closing — see SWR's tick.sh for
# why plain nohup doesn't); nice -19 so the live tutor/forum pre-empt it.
# Poll from anywhere:   ssh champaignj@172.232.14.119 'cat ~/wotr-soaks/<name>.exit 2>/dev/null || echo running'
set -euo pipefail
NAME="${1:?usage: run-soak.sh <name> [tournament args...]}"; shift
REPO="$HOME/wotr-ai"; OUT="$HOME/wotr-soaks"; mkdir -p "$OUT"
cd "$REPO"
setsid nice -n 19 bash -c "npx vite-node scripts/tournament.mjs $* > '$OUT/$NAME.log' 2>&1; echo \$? > '$OUT/$NAME.exit'" </dev/null &
echo "started $NAME (pid $!) — $OUT/$NAME.log"

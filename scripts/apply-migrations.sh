#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a
for f in migrations/*.sql; do
  echo "== applying $f"
  psql -v ON_ERROR_STOP=1 -f "$f"
done
echo "== done"

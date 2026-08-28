#!/usr/bin/env bash
# 사용: scripts/apply-migrations.sh [env파일]  — 기본 .env(프로덕션), 스테이징은 .env.staging
set -euo pipefail
cd "$(dirname "$0")/.."
ENV_FILE="${1:-.env}"
[ -f "$ENV_FILE" ] || { echo "env 파일이 없어요: $ENV_FILE" >&2; exit 1; }
set -a; source "$ENV_FILE"; set +a
echo "== target: ${PGHOST:-?} ($ENV_FILE)"
for f in migrations/*.sql; do
  echo "== applying $f"
  psql -v ON_ERROR_STOP=1 -f "$f"
done
echo "== done"

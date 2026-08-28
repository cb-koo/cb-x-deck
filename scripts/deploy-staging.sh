#!/usr/bin/env bash
# 스테이징 배포 — 링크 파일(.vercel/project.json)에 의존하지 않고 프로젝트 ID를 env로 고정한다(엉뚱한 프로젝트 배포 방지, 스펙 §3-2).
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env.staging; set +a
: "${STAGING_VERCEL_PROJECT_ID:?.env.staging에 STAGING_VERCEL_PROJECT_ID가 필요해요}"
: "${STAGING_VERCEL_ORG_ID:?.env.staging에 STAGING_VERCEL_ORG_ID가 필요해요}"
if [ "$STAGING_VERCEL_PROJECT_ID" = "prj_CoEqjNZytAqwaXXdgAxw2SgiEL34" ]; then echo "프로덕션 프로젝트 ID예요 — 중단" >&2; exit 2; fi
export VERCEL_ORG_ID="$STAGING_VERCEL_ORG_ID" VERCEL_PROJECT_ID="$STAGING_VERCEL_PROJECT_ID"
echo "== deploy → staging project $VERCEL_PROJECT_ID"
npx vercel@58.9.1 --prod --yes --scope clinic-bridge

#!/bin/zsh
# 완전 사이클 — 시술 키를 순서대로: 자동완성(기본 무료 Google 주소, 차단 응답이면 즉시 멈춤) → DB 검색어(읽기 전용) → 키워드 플래너 → 비교. 결과는 data/cycle-results.txt에 쌓는다.
# SerpAPI 한도가 끝나면(429) 그 시술에서 멈춘다(받은 입력은 남아 다음에 이어 받는다).
# 실행: SERPAPI_ACCOUNT=cb scripts/intent-audit/cycle.sh lipolysis p167 p25 …
cd "$(dirname "$0")/../.."
ENV=../trends-taxonomy/.env
for k in "$@"; do
  out=$(python3 scripts/intent-audit/collect_autocomplete.py $AC_FLAGS "$k" 2>&1)
  if echo "$out" | grep -q "^BLOCKED"; then echo "$out" | grep "^BLOCKED"; exit 3; fi
  if echo "$out" | grep -q "run out of searches"; then echo "STOP $k: SerpAPI 한도 소진 — $(python3 -c "import json;print(len(json.load(open('scripts/intent-audit/data/autocomplete-$k.json'))))" 2>/dev/null)/18 받음"; exit 2; fi
  echo "$out" | grep -E "^$k|이번 호출" | tr '\n' ' '; echo
  node --env-file=$ENV scripts/intent-audit/read_keywords.mjs "$k" | tail -1
  python3 -I scripts/intent-audit/collect_kp.py "$k" | tail -1
  python3 -I scripts/intent-audit/analyze.py scripts/intent-audit/data/view-intent.json "$k" | grep -v "^  띄어" >> scripts/intent-audit/data/cycle-results.txt
done

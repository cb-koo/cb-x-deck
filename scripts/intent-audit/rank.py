# 주요 시술 후보 — 대시보드 완성본(trend_view 스냅샷)에서 최근 12개월 검색량 순으로 뽑고, 의도 비율과 붙여 쓴 「とは」 의존도를 함께 본다.
# 입력: b2b-marketing data/trends_snapshot.json · trends_intent.json (운영 DB 읽기 전용으로 받은 것)
import json, sys
from pathlib import Path
D = Path(sys.argv[1])
snap = json.loads((D / 'trends_snapshot.json').read_text()); intent = json.loads((D / 'trends_intent.json').read_text())
names = {p['id']: (p['kr'], p['jp'], p.get('major', '')) for p in snap['procedures']}
in_bundle = {m['id'] for v in intent.values() for m in v.get('members', [])}
rows = []
for k, v in intent.items():
    t = v['total'][-12:]
    tags = v['top']; prof = v['profile']
    info_top = tags.get('info', [])
    toha = sum(x[1] for x in info_top if x[0].endswith('とは'))
    tagged = sum(x[1] for xs in tags.values() for x in xs)
    if 'members' in v:
        kr, jp = v['members'][0]['kr'] + f" 묶음({len(v['members'])})", v['members'][0]['jp']; major = names.get(v['members'][0]['id'], ('', '', ''))[2]
    elif k in in_bundle: continue  # 묶음에 들어간 시술은 묶음으로만 센다
    else: kr, jp, major = names.get(k, (k, '', ''))
    rows.append((sum(t), k, kr + (f' [{major}]' if major else ''), jp, v['keywords'], v['stage'], prof, toha))
rows.sort(reverse=True)
print('rank|id|시술|일본어|12개월 검색량|검색어 수|단계|효과|불안|가격|지역|한국|정보|とは(붙여씀, top3 기준)')
for n, r in enumerate(rows[:int(sys.argv[2]) if len(sys.argv) > 2 else 15], 1):
    s, k, kr, jp, kw, st, p, toha = r
    f = lambda x: f"{p.get(x, 0)*100:.0f}%"
    print(f"{n}|{k}|{kr}|{jp}|{s:,}|{kw}|{st}|{f('effect')}|{f('worry')}|{f('cost')}|{f('place')}|{f('korea')}|{f('info')}|{toha:,}")

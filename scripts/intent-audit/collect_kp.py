# 시범 시술 검색어 월별 검색량 — 키워드 플래너(일본·일본어, Google 검색, 2022-10~2026-09) generateKeywordHistoricalMetrics.
# 대상 = DB 검색어(read_keywords.mjs) ∪ 자동완성(collect_autocomplete.py) 중 시술 표기가 들어간 것. b2b-marketing collect_thermage_kp.py 일반화.
# 실행: python3 -I collect_kp.py [시술키…]  (Composio CLI googleads 프록시, DB 쓰기 없음) → data/kp-{시술키}.json
import json, subprocess, sys
from pathlib import Path

DATA = Path(__file__).resolve().parent / 'data'
CUSTOMER = '5852853331'
BASE = {'geoTargetConstants': ['geoTargetConstants/2392'], 'language': 'languageConstants/1005', 'keywordPlanNetwork': 'GOOGLE_SEARCH',
        'historicalMetricsOptions': {'yearMonthRange': {'start': {'year': 2022, 'month': 'OCTOBER'}, 'end': {'year': 2026, 'month': 'SEPTEMBER'}}}}
MARKS = {'rejuran': ('リジュラン', 'りじゅらん', 'rejuran'), 'hifu': ('ハイフ', 'はいふ', 'hifu'),
         'potenza': ('ポテンツァ', 'ぽてんつぁ', 'potenza', 'マックーム'),
         'botox': ('ボトックス', 'ぼとっくす', 'botox'), 'threadlift': ('糸リフト', 'いとリフト', 'スレッドリフト'),
         'dermapen': ('ダーマペン', 'だーまぺん', 'dermapen'), 'picotoning': ('ピコトーニング', 'ピコ トーニング'), 'lipolysis': ('脂肪溶解注射', '脂肪溶解')}

# procs.json(make_registry.mts) 등록분 — 키 = 대시보드 id
_REG = json.loads((Path(__file__).resolve().parent / 'procs.json').read_text()) if (Path(__file__).resolve().parent / 'procs.json').exists() else {}
MARKS.update({k: tuple(v['marks']) for k, v in _REG.items()})


def terms(key: str) -> list[str]:
    s = {r['text'] for r in json.loads((DATA / f'db-{key}.json').read_text())}
    s |= {x for v in json.loads((DATA / f'autocomplete-{key}.json').read_text()).values() for x in v}
    return sorted(t for t in s if any(m.lower().replace(' ', '') in t.lower().replace(' ', '').replace('\u3000', '') for m in MARKS[key]))  # 키워드 플래너가 띄어 쓴 글자(糸 リフト)로 돌려준 것도


def call(key: str, body: dict) -> dict:
    f = DATA / f'_req-{key}.json'
    f.write_text(json.dumps({**BASE, **body}, ensure_ascii=False))
    p = subprocess.run(['composio', 'proxy', f'https://googleads.googleapis.com/v25/customers/{CUSTOMER}:generateKeywordHistoricalMetrics',
                        '--toolkit', 'googleads', '-X', 'POST', '-H', 'content-type: application/json', '-d', f'@{f}'],
                       capture_output=True, text=True, cwd='/tmp')
    f.unlink()
    d = json.loads(p.stdout)
    if 'results' not in d:
        raise RuntimeError(p.stdout[:300])
    return d


def main(keys: list[str]) -> None:
    for key in keys:
        asked = terms(key)
        d = call(key, {'keywords': asked})
        (DATA / f'kp-{key}.json').write_text(json.dumps({'asked': asked, 'results': d['results']}, ensure_ascii=False))
        print(key, 'asked', len(asked), 'results', len(d['results']))


if __name__ == '__main__':
    main(sys.argv[1:] or list(MARKS))

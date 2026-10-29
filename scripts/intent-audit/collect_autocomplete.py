# 실제 검색어 찾기 — 일본 Google 자동완성(gl=jp·hl=ja). b2b-marketing collect_*_autocomplete.py를 시술 여러 개로 일반화.
# 시술당 입력 18개 = 시술명 + 가나 행 11개 + 시술별 추가 7개(--efficient면 시술명 + 추가 7개 = 8개). 호출 1회 = 입력 1개.
# 받는 곳: 기본 = Google 자동완성 주소(무료, client=chrome — SerpAPI 결과와 15/15 같음, 10-29 확인). AUTOCOMPLETE_SOURCE=serpapi면 예전처럼 SerpAPI.
# 차단 막기: 호출 사이 1.5~3초 무작위로 쉼 · 한 번 실행에 최대 MAX_CALLS회 · 429·403·5xx·이상한 응답이 한 번이라도 오면 즉시 멈춤(다시 시도 안 함, 종료 코드 3).
# 실행: python3 -I collect_autocomplete.py [--efficient] [--limit=N] [시술키…] → data/autocomplete-{시술키}.json {입력: [제안…]} (이미 받은 입력은 건너뜀)
import json, os, random, subprocess, sys, time, urllib.error, urllib.parse, urllib.request
from pathlib import Path

DATA = Path(__file__).resolve().parent / 'data'
KANA = ['', 'あ', 'か', 'さ', 'た', 'な', 'は', 'ま', 'や', 'ら', 'わ']
PROCS = {
    'rejuran': ('リジュラン', ['リジュラン 効果 ', 'リジュラン ダウンタイム ', 'リジュラン 違い', 'リジュランアイ ', 'リジュランHB ', 'リジュラン 何', 'リジュラン と']),
    'hifu': ('ハイフ', ['ハイフ 効果 ', 'ハイフ ダウンタイム ', 'ハイフ 違い', '医療ハイフ ', 'hifu ', 'ハイフ 何', 'ハイフ と']),
    'potenza': ('ポテンツァ', ['ポテンツァ 効果 ', 'ポテンツァ ダウンタイム ', 'ポテンツァ 違い', 'ポテンツァ チップ', 'マックーム ', 'ポテンツァ 何', 'ポテンツァ と']),
    'botox': ('ボトックス', ['ボトックス 効果 ', 'ボトックス ダウンタイム ', 'ボトックス 違い', 'ボトックス 何', 'ボトックス と', 'ボトックス 注射 ', 'ボトックス 打つ']),
    'threadlift': ('糸リフト', ['糸リフト 効果 ', '糸リフト ダウンタイム ', '糸リフト 違い', '糸リフト 何', '糸リフト と', '糸リフト 失敗 ', '糸リフト 本数']),
    'dermapen': ('ダーマペン', ['ダーマペン 効果 ', 'ダーマペン ダウンタイム ', 'ダーマペン 違い', 'ダーマペン 何', 'ダーマペン と', 'ダーマペン4 ', 'ダーマペン ヴェルベット']),
    'picotoning': ('ピコトーニング', ['ピコトーニング 効果 ', 'ピコトーニング ダウンタイム ', 'ピコトーニング 違い', 'ピコトーニング 何', 'ピコトーニング と', 'ピコトーニング 肝斑', 'ピコトーニング 回数']),
    'lipolysis': ('脂肪溶解注射', ['脂肪溶解注射 効果 ', '脂肪溶解注射 ダウンタイム ', '脂肪溶解注射 違い', '脂肪溶解注射 何', '脂肪溶解注射 と', '脂肪溶解注射 顔 ', '脂肪溶解注射 回数']),
}

# procs.json(make_registry.mts) 등록분 — 키 = 대시보드 id
_REG = json.loads((Path(__file__).resolve().parent / 'procs.json').read_text()) if (Path(__file__).resolve().parent / 'procs.json').exists() else {}
PROCS.update({k: (v['name'], v['extras']) for k, v in _REG.items()})


EFFICIENT = '--efficient' in sys.argv  # 효율형: 시술명 + 추가 입력만(가나 행 10개 생략 — 1회당 수확이 가장 낮음, 10-29)


def prefixes(key: str) -> list[str]:
    name, extra = PROCS[key]
    return [f'{name} '] + extra if EFFICIENT else [f'{name} {k}' for k in KANA] + extra


SOURCE = os.environ.get('AUTOCOMPLETE_SOURCE', 'google')
MAX_CALLS = 300  # 한 번 실행 상한 — 더 받으려면 시간을 두고 다시 실행
DELAY = (1.5, 3.0)


class Blocked(Exception):
    pass


def suggest_google(q: str) -> list[str]:
    u = 'https://suggestqueries.google.com/complete/search?' + urllib.parse.urlencode({'client': 'chrome', 'hl': 'ja', 'gl': 'jp', 'ie': 'utf-8', 'oe': 'utf-8', 'q': q})
    req = urllib.request.Request(u, headers={'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            raw = r.read()
    except urllib.error.HTTPError as e:
        raise Blocked(f'HTTP {e.code} ({q!r})') from None
    except urllib.error.URLError as e:
        raise Blocked(f'연결 실패 {e.reason} ({q!r})') from None
    try:
        d = json.loads(raw.decode('utf-8'))
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise Blocked(f'JSON이 아닌 응답(확인 페이지일 수 있음) ({q!r}): {raw[:120]!r}') from None
    if not (isinstance(d, list) and len(d) >= 2 and isinstance(d[1], list)):
        raise Blocked(f'예상과 다른 응답 모양 ({q!r}): {str(d)[:120]}')
    return [x for x in d[1] if isinstance(x, str)]


def suggest(q: str) -> list[str]:
    if SOURCE == 'google':
        return suggest_google(q)
    acct = ['--account', os.environ['SERPAPI_ACCOUNT']] if os.environ.get('SERPAPI_ACCOUNT') else []  # Composio 연결 별칭(10-29 새 계정 = cb)
    p = subprocess.run(['composio', 'execute', 'SERPAPI_GOOGLE_LIGHT_SEARCH', *acct, '-d',
                        json.dumps({'q': q, 'engine': 'google_autocomplete', 'gl': 'jp', 'hl': 'ja'}, ensure_ascii=False)],
                       capture_output=True, text=True, cwd='/tmp')
    d = json.loads(p.stdout)
    if not d.get('successful'):
        raise RuntimeError(d.get('error'))
    if d.get('storedInFile'):
        d = json.load(open(d['outputFilePath']))
    data = d.get('data', d)
    s = data.get('suggestions') or data.get('data', {}).get('suggestions') or []
    return [x['value'] for x in s if x.get('value')]


def main(keys: list[str], limit: int | None) -> None:
    DATA.mkdir(exist_ok=True)
    calls = 0
    limit = min(limit, MAX_CALLS) if limit is not None else MAX_CALLS
    for key in keys:
        out = DATA / f'autocomplete-{key}.json'
        got = json.loads(out.read_text()) if out.exists() else {}
        for q in prefixes(key):
            if q in got:
                continue
            if calls >= limit:
                print(f'상한 {limit}회 도달 — 멈춤(받은 것은 저장됨)')
                return
            if calls:
                time.sleep(random.uniform(*DELAY) if SOURCE == 'google' else 1)
            try:
                got[q] = suggest(q)
            except Blocked as e:
                print(f'BLOCKED {key}: {e} — 즉시 멈춤, 이번 호출 {calls}회(받은 것은 저장됨). 몇 시간 뒤 다시 실행하거나 AUTOCOMPLETE_SOURCE=serpapi')
                sys.exit(3)
            calls += 1
            out.write_text(json.dumps(got, ensure_ascii=False, indent=1))
        print(key, '입력', len(got), '제안', sum(len(v) for v in got.values()), '고유', len({s for v in got.values() for s in v}))
    print('이번 호출', calls)


if __name__ == '__main__':
    lim = next((int(a.split('=')[1]) for a in sys.argv[1:] if a.startswith('--limit=')), None)
    main([a for a in sys.argv[1:] if not a.startswith('--')] or list(PROCS), lim)

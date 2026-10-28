# 실제 검색어 찾기 — 일본 Google 자동완성(SerpAPI google_autocomplete, gl=jp·hl=ja). b2b-marketing collect_*_autocomplete.py를 시술 여러 개로 일반화.
# 시술당 입력 18개 = 시술명 + 가나 행 11개 + 시술별 추가 7개. SerpAPI 1회 = 입력 1개.
# 실행: python3 -I collect_autocomplete.py [시술키…] → data/autocomplete-{시술키}.json {입력: [제안…]} (이미 받은 입력은 건너뜀)
import json, subprocess, sys, time
from pathlib import Path

DATA = Path(__file__).resolve().parent / 'data'
KANA = ['', 'あ', 'か', 'さ', 'た', 'な', 'は', 'ま', 'や', 'ら', 'わ']
PROCS = {
    'rejuran': ('リジュラン', ['リジュラン 効果 ', 'リジュラン ダウンタイム ', 'リジュラン 違い', 'リジュランアイ ', 'リジュランHB ', 'リジュラン 何', 'リジュラン と']),
    'hifu': ('ハイフ', ['ハイフ 効果 ', 'ハイフ ダウンタイム ', 'ハイフ 違い', '医療ハイフ ', 'hifu ', 'ハイフ 何', 'ハイフ と']),
    'potenza': ('ポテンツァ', ['ポテンツァ 効果 ', 'ポテンツァ ダウンタイム ', 'ポテンツァ 違い', 'ポテンツァ チップ', 'マックーム ', 'ポテンツァ 何', 'ポテンツァ と']),
}


def prefixes(key: str) -> list[str]:
    name, extra = PROCS[key]
    return [f'{name} {k}' for k in KANA] + extra


def suggest(q: str) -> list[str]:
    p = subprocess.run(['composio', 'execute', 'SERPAPI_GOOGLE_LIGHT_SEARCH', '-d',
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
    for key in keys:
        out = DATA / f'autocomplete-{key}.json'
        got = json.loads(out.read_text()) if out.exists() else {}
        for q in prefixes(key):
            if q in got:
                continue
            if limit is not None and calls >= limit:
                return
            got[q] = suggest(q)
            calls += 1
            out.write_text(json.dumps(got, ensure_ascii=False, indent=1))
            time.sleep(1)
        print(key, '입력', len(got), '제안', sum(len(v) for v in got.values()), '고유', len({s for v in got.values() for s in v}))
    print('이번 호출', calls)


if __name__ == '__main__':
    lim = next((int(a.split('=')[1]) for a in sys.argv[1:] if a.startswith('--limit=')), None)
    main([a for a in sys.argv[1:] if not a.startswith('--')] or list(PROCS), lim)

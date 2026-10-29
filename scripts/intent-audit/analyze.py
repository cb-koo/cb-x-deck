# 시범 시술 검색 의도 보정 — 키워드 플래너 검색량(data/kp-{키}.json)을 공통 규칙으로 분류해 대시보드 의도 비율과 나란히 놓는다.
# b2b-marketing analyze_juvelook_intent.py · analyze_thermage_intent.py의 단어 목록을 합친 공통 규칙 + 시술별 노이즈만 따로.
# 실행: python3 -I analyze.py <trends_intent.json 경로> [시술키…]
#   → data/rows-{키}.csv(분류 검토용), data/unmatched-{키}.csv(규칙에 안 걸린 검색어), 표준출력은 요약만.
# 기준: 2022-10~2026-09(48개월) 중 최근 12개월(2025-10~2026-09) 합.
import csv, json, re, sys
from pathlib import Path

DATA = Path(__file__).resolve().parent / 'data'

PROCS = {  # 대시보드 id(묶음 대표), 시술 표기, 노이즈(시술 검색이 아닌 것)
    'rejuran': ('p28', 'リジュラン', ['パック', 'トナー', '美容液', '化粧品', 'クリーム', '化粧水', 'マスク', 'セラム', 'コスメ', 'シートマスク', '楽天', 'ドンキ',
                                       'qoo10', 'Qoo10', 'アットコスメ', 'メガ割', 'エガ割', 'amazon', 'Amazon', '薬局', '取扱店', '取り扱い店', '販売店', '公式', 'アンプル', 'ターンオーバー', '使い方', 'スキンケア', 'ミスト', 'アイクリーム', 'オイル', 'サンクリーム', '日焼け止め']),
    'hifu': ('p49', 'ハイフ', ['家庭用', '美顔器', 'セルフ', 'エステ', '機器', 'ハイフ脱毛', '脱毛', 'カートリッジ', 'ヤーマン', 'アマゾン', 'amazon', 'Amazon',
                               '楽天', 'ドンキ', 'メディリフト', 'ハイフシャワー', 'シャワー', 'ドライヤー', '求人', '資格', 'スクール', '開業']),
    'potenza': ('p127', 'ポテンツァ', ['求人', '機器', '購入', '開業']),
    'botox': ('p11', 'ボトックス', ['塗る', '化粧品', 'クリーム', '美容液', 'シャンプー', 'コスメ', '求人', '株', '映画']),
    'threadlift': ('p78', '糸リフト', ['求人', 'セルフ', 'テープ']),
    'dermapen': ('p64', 'ダーマペン', ['求人', '購入', '家庭用', 'セルフ', 'アマゾン', 'amazon', '楽天']),
    'picotoning': ('p187', 'ピコトーニング', ['求人', '家庭用', 'セルフ']),
    'lipolysis': ('p72', '脂肪溶解注射', ['求人', '家庭用', 'セルフ', '通販', '個人輸入']),
}

# procs.json(make_registry.mts) 등록분 — 키 = 대시보드 id
_REG = json.loads((Path(__file__).resolve().parent / 'procs.json').read_text()) if (Path(__file__).resolve().parent / 'procs.json').exists() else {}
PROCS.update({k: (v['pid'], v['name'], v['noise']) for k, v in _REG.items()})
ALT = {v['name']: sorted({re.sub(r'\s', '', m) for m in v['marks']}, key=len, reverse=True) for v in _REG.values()}

KOREA = ['韓国', 'ソウル', '江南', '明洞', '新沙']
WORRY = {
    'downtime': ['ダウンタイム', '当日', '過ごし方', 'メイク', '洗顔', 'サウナ', '飲酒', '運動', 'タバコ', 'マスク', 'アフターケア', '翌日', '直後', '何日'],
    'pain': ['痛み', '痛い', '痛く', '麻酔'],
    'side': ['しこり', '内出血', '腫れ', 'アレルギー', '副作用', '針跡', 'ボコボコ', '凸凹', 'あざ', '老け', '火傷', 'やけど', 'ヤケド', 'こけ', '凹み', 'へこみ',
             '水ぶくれ', '神経', '赤み', 'かさぶた', '針の跡'],
    'safety': ['危険', '危ない', 'やばい', 'やめた方', 'やめたほう', 'やめとけ', '怖い', 'デメリット', '安全', 'リスク', '後遺症', '失明', 'やりすぎ', '大丈夫'],
    'fail': ['失敗', '効果ない', '効果なし', '効かない', '意味ない', '意味がない', '後悔', 'なくなる'],
}
PRICE = ['金額', '格安', 'クーポン', '値段', '価格', '料金', '安い', '最安', '高い', '費用', '相場', 'モニター', 'キャンペーン', '円', '万', '割引', '保険']
COMPARE = ['違い', '比較', 'どっち', 'vs', 'VS', 'リジュラン', 'ポテンツァ', 'ジュベルック', 'サーマクール', 'ウルセラ', 'ハイフ', 'HIFU', 'ソフウェーブ',
           'ウルトラセル', 'ウルトラフォーマー', 'シュリンク', 'デンシティ', 'オリジオ', 'テノール', 'インモード', 'ダーマペン', 'フラクショナル', 'ピコ',
           'ヴェルヴェット', 'ベルベット', 'ハイドラ', 'スカルプトラ', 'エクソソーム', 'マックーム', 'ボトックス', 'ヒアルロン酸', '糸リフト',
           'スレッド', 'レーザー', 'ララピール', 'シルファーム', 'ジェネシス', 'トーニング', 'フォトフェイシャル', 'ルメッカ', 'スネコス', 'プロファイロ',
           'ハイコックス', 'ボライト', 'ケナコルト', 'ダーマ']
COMBO = ['併用', '同日', '同時', '順番', '組み合わせ', 'セット', '後に']
PLACE = ['大阪', '東京', '名古屋', '福岡', '札幌', '京都', '神戸', '横浜', '湘南', '高須', 'クリニック', '皮膚科', '美容外科', '都内', '関西', '博多', '埼玉', '愛知',
         '奈良', '千葉', '仙台', '広島', '岡山', '金沢', '梅田', '心斎橋', '新宿', '銀座', '渋谷', '池袋', '表参道', '品川', '六本木', '恵比寿', '天神', '難波',
         'なんば', '静岡', '浜松', '熊本', '鹿児島', '沖縄', '那覇', '新潟', '長野', '群馬', '栃木', '茨城', '宇都宮', '高崎', '大宮', '川崎', '町田', '立川',
         '吉祥寺', '柏', '船橋', '岐阜', '三重', '滋賀', '和歌山', '姫路', '堺', '高松', '松山', '徳島', '高知', '大分', '宮崎', '長崎', '佐賀', '北九州',
         '小倉', '青森', '盛岡', '秋田', '山形', '福島', '郡山', '富山', '石川', '福井', '山梨', '甲府', '鳥取', '島根', '山口', '下関', '豊橋', '岡崎', '豊田',
         '北海道', '旭川', '函館', '横須賀', '藤沢', '相模原', '八王子', '所沢', '川越', '越谷', '松戸', '津田沼', '上野', '池袋', '秋葉原', '有楽町', '赤坂',
         '麻布', '自由が丘', '二子玉川', '中目黒', '代官山', '原宿', '京橋', '日本橋', '丸の内', '神田', '錦糸町', '北千住', '亀戸', '蒲田', '五反田', '目黒',
         '大井町', '中野', '高円寺', '荻窪', '国分寺', '府中', '調布', '多摩', '本厚木', '海老名', '大船', '戸塚', 'あおば', 'sbc', 'SBC', '品川美容', 'TCB',
         'tcb', '東京中央', 'リゼ', 'エミナル', 'フレイア', 'ゴリラ', '共立', 'ガーデン', '城本', '聖心', '水の森', 'オラクル', 'ルシアクリニック', 'エルムクリニック',
         'BIANCA', 'ビアンカ', 'ヴェリテ', '銀座ケイスキン', 'メディアージュ', 'トイトイトイ', 'ミルクリニック', 'クレアージュ', '近く', '近所', '近い', 'おすすめ',
         'オススメ', '人気', 'ランキング', '駅', '市', '県', '区', '町']
EFFECT = ['効果', '経過', 'ビフォー', 'アフター', '口コミ', 'ブログ', '知恵袋', 'いつから', '持続', 'ピーク', '実感', '変化', 'レビュー', '体験', '芸能人', '写真',
          'すごい', '何ヶ月', '期間', '何年', 'どのくらい', 'どれくらい', '結果', '画像', 'ブログ', 'インスタ', 'ガルちゃん', 'がるちゃん']
CONCERN = ['毛穴', 'たるみ', 'ニキビ', 'にきび', 'クレーター', '傷跡', 'ハリ', '若返り', '乾燥', '肝斑', 'シミ', 'しみ', 'ほうれい線', '頬', '目の下', 'ゴルゴ',
           'まぶた', '瞼', '鼻', '額', 'おでこ', '頭皮', 'ちりめん', 'じわ', 'シワ', 'しわ', '肌', '酒さ', 'クマ', 'くま', 'こめかみ', '首', 'デコルテ', '手の甲',
           '目元', '小顔', 'フェイスライン', '二重あご', '二重顎', 'あご', '顎', 'リフトアップ', 'くすみ', 'マリオネット', '眼瞼下垂', 'ボディ', 'お腹', '二の腕',
           '太もも', '赤ら顔', '傷', '妊娠線', '肉割れ', '美白', 'ツヤ', '艶', 'キメ', '脂肪', '輪郭', 'エラ', 'リフト']
METHOD = ['手打ち', '水光', 'cc', '単位', 'ショット', 'shot', '回数', '頻度', '間隔', '何回', '回目', '1回', '一回', '2回', '3回', '5回', 'ワンクール', '毎月',
          '月1', 'おき', 'やり方', '針', 'アンプル', 'チップ', 'ドラッグデリバリー', 'デリバリー', 'ダイヤモンド', 'ポンピング', '機械', '範囲', '全顔', '何分',
          '時間', '施術', 'mm', 'ミリ', '深さ', 'ライン', 'カートリッジ', '冷却', '打ち方', '注射', '点滴', '種類', '何本', '薬剤']
LEARN = ['とは', 'って何', 'ってなに', '何に効く', '仕組み', '原理', '成分', '作用', '日本', '承認', 'メーカー', '英語', '読み方', '意味', 'なに', '新型', '最新', 'PN',
         'サーモン', 'DNA', '鮭']

STAGES = ['korea', 'worry', 'price', 'compare', 'place', 'effect', 'concern', 'method', 'learn']
KO = {'korea': '한국', 'worry': '불안', 'price': '가격', 'compare': '비교', 'place': '지역', 'effect': '효과', 'concern': '고민 부위', 'method': '방식',
      'learn': '정보'}
DASH = {'effect': 'effect', 'worry': 'worry', 'cost': 'price', 'place': 'place', 'korea': 'korea', 'info': 'learn', 'concern': 'concern'}  # 대시보드 키 → 여기 키
PARTICLES = {'の', 'と', 'は', 'で', 'に', 'を', 'が', 'って'}


# 시술명에 붙는 제품 이름(リジュランアイ·HB 등)·'주사' — 떼고 나서 남는 말로 판정한다(제품 이름만 치면 시술명 검색)
VARIANTS = {'リジュラン': ['アイ', 'ヒーラー', 'HB', 'hb', 'S', 's', 'i', '注射']}


def stage(t: str, name: str) -> tuple[str, str]:
    rest = t.replace(name, '', 1) if name in t else t  # 시술명 자체가 비교 대상 목록에 걸리지 않게(ハイフ 자신 등)
    for alt in ALT.get(name, []):  # 묶음에 든 다른 이름(クールウェーブ 묶음의 オンダリフト)도 시술명으로 뗀다
        if alt != name and alt in rest: rest = rest.replace(alt, '', 1)
    for v in VARIANTS.get(name, []):
        if rest.startswith(v) or rest.endswith(v): rest = rest.replace(v, '', 1)
    if not rest: return 'name', ''
    if any(k in rest for k in KOREA): return 'korea', ''
    for sub, ks in WORRY.items():
        if any(k in rest for k in ks): return 'worry', sub
    if any(k in rest for k in PRICE): return 'price', ''
    if any(k in rest for k in COMPARE) or any(k in rest for k in COMBO):
        return 'compare', ('combo' if any(k in rest for k in COMBO) else '')
    if any(k in rest for k in PLACE): return 'place', ''
    if any(k in rest for k in EFFECT): return 'effect', ''
    if any(k in rest for k in CONCERN): return 'concern', ''
    if any(k in rest for k in METHOD): return 'method', ''
    if any(k in rest for k in LEARN) or rest.endswith('何'): return 'learn', ''
    return 'name', ''


def canon(text: str) -> tuple:
    return tuple(sorted(w for w in text.split() if w not in PARTICLES))


SNAP = Path('/Users/koo/orca/projects/b2b-marketing/reports/search-trends/data/trends_snapshot.json')
ALL_NAMES = sorted({re.sub(r'\s', '', p['jp']).lower() for p in json.loads(SNAP.read_text())['procedures'] if p.get('jp')}, key=len, reverse=True)


def other_owner(t: str, name: str) -> bool:
    # 대시보드 ownerOf와 같은 규칙 — 이름이 여럿 들어 있으면 가장 긴 시술 것(승모근 보톡스는 보톡스가 아니라 승모근보톡스)
    t, n = t.lower(), name.lower()
    best = next((m for m in ALL_NAMES if m in t), None)
    return best is not None and best != n and n in best


def run(key: str, dash: dict) -> None:
    pid, name, noise = PROCS[key]
    raw = json.loads((DATA / f'kp-{key}.json').read_text())
    seen, rows, merged, dropped, anomalies, others = {}, [], [], [], [], []
    for r in raw['results']:
        mv = (r.get('keywordMetrics') or {}).get('monthlySearchVolumes') or []
        if len(mv) != 48: continue
        text = r['text']
        s = [int(x.get('monthlySearches', 0)) for x in mv]
        t = re.sub(r'\s', '', text)
        # 문제 2 — 붙여 쓴 「〇〇とは」: 키워드 플래너가 'X と は'로 되돌려 주며 큰 값을 준다. 띄어 쓴 'X とは'만 남긴다
        if t.endswith('とは') and ' と は' in text:
            anomalies.append((text, sum(s[36:]))); continue
        if any(k in t for k in noise):
            dropped.append((text, sum(s[36:]))); continue
        if other_owner(t, name):
            others.append((text, sum(s[36:]))); continue
        # 문제 3 — 같은 단어 조합 + 48개월 값이 완전히 같음 → 하나만 센다(대시보드와 달리 월평균 50 미만도 포함)
        ck = (canon(text), tuple(s))
        if ck in seen:
            merged.append((text, seen[ck], sum(s[36:]))); continue
        seen[ck] = text
        st, sub = stage(t, name)
        rows.append({'text': text, 'stage': st, 'sub': sub, 'y1': sum(s[36:]), 'y0': sum(s[24:36])})
    rows.sort(key=lambda x: -x['y1'])
    with open(DATA / f'rows-{key}.csv', 'w', newline='', encoding='utf-8-sig') as f:
        w = csv.writer(f); w.writerow(['text', 'stage', 'sub', 'monthly_avg_last12'])
        for x in rows: w.writerow([x['text'], x['stage'], x['sub'], x['y1'] // 12])
    with open(DATA / f'unmatched-{key}.csv', 'w', newline='', encoding='utf-8-sig') as f:
        w = csv.writer(f); w.writerow(['text', 'monthly_avg_last12'])
        for x in rows:
            if x['stage'] == 'name': w.writerow([x['text'], x['y1'] // 12])
    tot = {s: sum(x['y1'] for x in rows if x['stage'] == s) for s in STAGES}
    intent_sum = sum(tot.values())
    prof = dash[pid]['profile']
    dmap = {DASH[k]: v for k, v in prof.items()}
    dash_kw = dash[pid]['keywords']
    print(f'\n## {key} ({name}) 대시보드 검색어 {dash_kw}개 → 값 있는 검색어 {len(rows)}개 / 의도 드러난 검색 월 {intent_sum // 12:,}')
    print(f'붙여 쓴 とは 제외 {len(anomalies)}건: ' + ', '.join(f'{a}={v // 12:,}/월' for a, v in sorted(anomalies, key=lambda x: -x[1])[:4]))
    sp = [x for x in rows if re.sub(r'\s', '', x['text']) == name + 'とは']
    if sp: print(f'  띄어 쓴 쪽: {sp[0]["text"]}={sp[0]["y1"] // 12:,}/월')
    print(f'중복 합침 {len(merged)}건(월 {sum(m[2] for m in merged) // 12:,}), 노이즈 제외 {len(dropped)}건(월 {sum(d[1] for d in dropped) // 12:,}), 다른 시술 몫 {len(others)}건(월 {sum(o[1] for o in others) // 12:,})')
    print('의도|대시보드|보정')
    for s in STAGES:
        d = dmap.get(s)
        print(f"{KO[s]}|{'—' if d is None else f'{d * 100:.0f}%'}|{tot[s] / intent_sum * 100:.0f}% (월 {tot[s] // 12:,})")
    print(f"규칙에 안 걸림(시술명만 등) {sum(x['stage'] == 'name' for x in rows)}개, 월 {sum(x['y1'] for x in rows if x['stage'] == 'name') // 12:,}")


if __name__ == '__main__':
    dash = json.loads(Path(sys.argv[1]).read_text())
    for k in sys.argv[2:] or list(PROCS): run(k, dash)

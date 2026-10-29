// 검색 의도 — 시술 검색어 하나하나에 '왜 찾는지' 태그를 붙이고, 시술 단위로 모아 크기·방향·성격을 만든다. 스펙 2026-10-13 §2(2차 개정)
// 규칙은 위에서부터 먼저 맞는 태그 하나. '효과 없다'(効果ない)가 효과가 아니라 불안이 되도록 불안을 효과보다 먼저 본다.

export type Intent = 'noise' | 'exclude' | 'adjacent' | 'korea' | 'cost' | 'worry' | 'dose' | 'effect' | 'info' | 'place' | 'concern' | 'name' | 'other';

export const INTENT_LABEL: Record<Intent, string> = {
  korea: '한국', cost: '가격', worry: '부작용·통증', dose: '횟수·용량', effect: '효과·후기', info: '개념·비교', place: '병원·지역', concern: '부위·대상',
  name: '시술명 단독', other: '기타', adjacent: '시술 밖 관심(화장품·홈케어·영양제)', exclude: '제외(이상값)', noise: '동음이의',
};

// 성격 막대에 쓰는 순서(고객 여정: 알아보기 → 고민 → 고르기 → 한국)
export const PROFILE_INTENTS = ['info', 'effect', 'dose', 'worry', 'concern', 'cost', 'place', 'korea'] as const;
export type ProfileIntent = typeof PROFILE_INTENTS[number];

const RULES: Array<[Intent, RegExp]> = [
  // 다른 뜻 — 시술 이름이 게임·문구·생활용품·회사·사람 이름과 겹친 검색(10-13 실측: スカーレット→포켓몬, スターウォーカー→만년필,
  // エアジェット→욕실 세제, ハーモニーカ→건반 하모니카, アグネス→사람, インフィニ→결혼상담소). 비중이 크면 시술에 점검 표시가 붙는다.
  ['noise', /ポケモン|ボケモン|ポケットモンスター|ポケスペ|ネクサス|サガ|ゲーム|switch|ボールペン|万年筆|モンブラン|マジックリン|花王|お風呂|風呂|鍵盤|ピアニカ|アグネスラム|ユニセフ|カーペンター|加山雄三|宮崎美子|アメブロ|結婚|婚活|相談所|株式会社|トラベル|インフォメーション|塾|教室|xbox|プレステ|ps[45]|ダウンロード|スマホ|iphone|ギャラクシー|モバイル|会社|ホールディングス|企業|バスツアー|登山|ランバン|セイコー|rcb|株価|歌詞|タイヤ|半月板|血管腫れ|トームストーン|詩学|ログイン|講習/i],  // 血管腫れ = 혈관 부음(혈관종 아님)
  // 시술이 아닌 검색 — 화장품·쇼핑·집에서 하는 것(왁스·패치·가정용 기기)·다른 뜻
  // 시술 밖 관심 — 같은 성분·고민을 시술이 아닌 방법으로 찾는 검색(화장품·쇼핑·집에서·영양제). 시술 수요(전체·성격)에는 넣지 않고
  // 麻酔クリーム(시술 전 마취)·1アンプル·何アンプル(주사 용량)은 시술 검색이라 뺀다(10-29)
  // 따로 모아 '시술 대신 무엇을 찾나'를 본다(10-29 koo: 간접 인사이트는 남긴다 — 예전엔 제외로 버렸음)
  ['adjacent', /化粧水|美容液|(?<!麻酔)クリーム|パック|シートマスク|(?<![\d何])アンプル|セラム|トナー|ローション|乳液|オールインワン|コスメ|ドラッグストア|楽天|amazon|アマゾン|qoo10|メルカリ|市販|ワックス|パッチ|家庭用|脱毛器|除毛|セルフ|自分で|化粧品|塗る|サプリ|食べ物|食品|ドリンク|自宅|おうち|ホームケア|美顔器|ターンオーバー|メガ割|ドンキ|アヌア|anua|メディキューブ|medicube|使い方|ナイアシンアミド|ミスト|クレンジング|サンスクリーン|日焼け止め|リードルショット|メディヒール|mediheal|ランコム|アンレーベル|かずのすけ|マツキヨ|ダイソー|オリーブヤング|watsons|取扱店|取り扱い店|販売店|食べる|nmn/i],  // 10-29 검수 패턴 추가(使い方 = 제품 쓰는 법)
  ['korea', /韓国|ソウル|江南|カンナム|明洞|ミョンドン|釜山|プサン|狎鴎亭|弘大|ホンデ|korea|seoul/i],
  // 비용·구매 — 약은 개인 수입 사이트(オオサカ堂)·통판으로 사는 수요도 여기
  ['cost', /値段|料金|価格|相場|安い|格安|費用|モニター|キャンペーン|保険適用|保険|何円|万円|\d+円|オオサカ堂|個人輸入|通販|購入|処方/],
  // 10-29 추가: 後遺症·老ける(늙어 보임)·左右差·不自然·やらなきゃ良かった — 규칙에 없어 기타로 남던 걱정(ウルセラ 老ける 월 1,400).
  // 顔(の)左右差는 시술 결과가 아니라 고치려는 고민이라 빼고(부위로), 老けて見える도 고민 쪽이 많아 넣지 않는다
  ['worry', /ダウンタイム|痛み|痛い|麻酔|副作用|失敗|後悔|腫れ|内出血|効果ない|効果なし|意味ない|危険|リスク|しこり|やめた|やめて|デメリット|トラブル|怖い|初期脱毛|後遺症|老ける|老けた|(?<!顔の?)左右差|不自然|やらなきゃ|やらなければ|しなきゃよかった|しなければよかった/],
  // 횟수·용량 — 몇 cc·몇 단위·몇 개(실)·몇 번·얼마 간격으로 받나(10-29 koo). 걱정(효과 없다·다운타임 기간)이 먼저, 효과 지속(効果期間·持続)은 효과·후기.
  // 예전엔 何回·頻度·間隔이 효과·후기를 부풀리고 何cc·単位·何本은 기타로 빠졌다(월 7.9만)
  ['dose', /何cc|\dcc|cc|単位|何本|本数|ショット|shot|何回|回数|回目|\d回|一回|頻度|間隔|何ヶ月|ヶ月おき|か月おき|何日おき|ワンクール|何アンプル|(?<=\d)アンプル/i],
  ['effect', /効果|経過|ビフォーアフター|ビフォー|アフター|変化|持続|何回|回数|頻度|間隔|いつから|直後|翌日|結果|口コミ|ブログ|体験|レビュー|写真|画像|メリット/],
  ['info', /とは|違い|比較|vs|どっち|どれ|おすすめ|種類|仕組み|ランキング|人気|やり方|方法|何科|向いてる|原因|治し方|取り方|消し方|治る|なぜ|理由|効く薬/i],
  // 병원 고르기·지역. 10-29 추가: 도도부현 전부·都内·자주 나오는 도시(이름을 하나씩 — 市·駅 같은 넓은 말은 岡崎慎司·市原隼人이 걸려 쓰지 않는다)·名医·上手
  ['place', /東京|大阪|名古屋|福岡|札幌|横浜|神戸|京都|仙台|広島|千葉|埼玉|北海道|青森|岩手|宮城|秋田|山形|福島|茨城|栃木|群馬|神奈川|新潟|富山|石川|福井|山梨|長野|岐阜|静岡|愛知|三重|滋賀|兵庫|奈良|和歌山|鳥取|島根|岡山|山口|徳島|香川|愛媛|高知|佐賀|長崎|熊本|大分|宮崎|鹿児島|沖縄|都内|関東|関西|九州|大宮|浜松|豊橋|金沢|立川|町田|吉祥寺|恵比寿|六本木|上野|錦糸町|天王寺|三宮|小倉|北九州|川越|船橋|西宮|姫路|高崎|宇都宮|郡山|那覇|川崎|相模原|名医|上手|うまい|渋谷|新宿|銀座|表参道|池袋|梅田|心斎橋|難波|天神|博多|近く|近所|クリニック|皮膚科|美容外科|品川|湘南|tcb|sbc|聖心|共立|リゼ|ゴリラ|フレイア|湘南美容|品川美容|東京中央/i],
  // 부위·대상 — 어디에(얼굴·어깨·종아리…) 누가(남성·여성) 받나, 어떤 고민에 쓰나
  ['concern', /目の下|ほうれい線|ニキビ跡|ニキビ|毛穴|たるみ|シワ|しわ|クマ|肝斑|シミ|しみ|赤み|赤ら顔|首|おでこ|額|あご|顎|エラ|頬|鼻|口元|口周り|口角|唇|目元|目尻|目の周り|まぶた|眉|小顔|フェイスライン|顔|全身|肩|ふくらはぎ|脚|足首|背中|腕|手の甲|二の腕|太もも|お腹|脇|ワキ|vio|ひげ|ヒゲ|髭|ガミー|傷跡|妊娠線|肉割れ|薄毛|メンズ|男性|女性|妊娠|授乳/i],
];

export const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase();

// 이 시술의 검색어인가 — 이름(정규화)이 들어 있어야 한다. 연관 검색어엔 다른 시술 이름만 있는 것도 섞여 온다.
export function belongs(keyword: string, names: string[]): boolean {
  const k = norm(keyword);
  return names.some((n) => n && k.includes(norm(n)));
}

// 검색어 주인 — 이름이 여럿 들어 있으면 가장 긴(구체적인) 시술 것. 'スキンボトックス 効果'는 보톡스가 아니라 스킨보톡스.
export function ownerOf(keyword: string, allNames: string[]): string | null {
  const k = norm(keyword);
  let best: string | null = null;
  for (const n of allNames) { const m = norm(n); if (m && k.includes(m) && (!best || m.length > norm(best).length)) best = n; }
  return best;
}

// 시술 형태만 덧붙인 말(リジュラン 注射·ミノキシジル 内服)은 사실상 이름 검색이다
const FORM = /注射|治療|除去|施術|レーザー|医療|内服|外用薬|外用|塗り薬|飲み薬|錠|の|と/g;

// 이름만 치면 다른 뜻이 대부분인 시술 — 이름 단독 검색은 다른 뜻으로 보고 수식어 붙은 검색(효과·값·병원 등)만 센다(10-14 점검).
// フォトナ=포트나이트 약칭(6만), IPL=인도 크리켓 리그(13만), ジェネシス=회사, ジーニアス=학원, クラツー=여행사, ブルーローズ=꽃·상품,
// ヴィヴァーチェ=미용실, スカーレット=포켓몬 등. 값은 그 이름과 붙었을 때만 다른 뜻인 수식어(フォトナ ダウンタイム = 게임 서버 점검).
// 시술 맥락 말 — 이름 자체가 일반 단어·상품명인 시술은 이 말이 함께 있을 때만 시술 검색으로 센다(10-29 점검: 수식어가 붙어도
// 슈링크=수축 랩·포장, 지니어스=학원·영어사전, 포트나=포트나이트 상품, 스타워커=만년필, 제네시스=자동차·유희왕이 대부분이었다).
// 지역·값(東京·値段)은 학원·자동차 검색에도 붙어 넣지 않는다.
const TREATMENT_CONTEXT = 'ダウンタイム|効果|美容|皮膚科|クリニック|施術|レーザー|ハイフ|hifu|rf|ニードル|ニキビ|毛穴|たるみ|リフトアップ|シワ|しわ|シミ|肝斑|赤み|クレーター|傷跡|肌|顔|痩身|脂肪|痛み|痛い|副作用|経過|ビフォーアフター|湘南|tcb|sbc';
const ONLY_WITH = (extra = '') => new RegExp(`^(?!.*(${TREATMENT_CONTEXT}${extra}))`);

// 값: null = 이름만 친 검색만 다른 뜻 / 정규식 = 맞으면 다른 뜻(ONLY_WITH는 시술 맥락 말이 없으면 다른 뜻)
export const HOMONYM: Record<string, RegExp | null> = {
  'フォトナ': new RegExp(`ダウンタイム|${ONLY_WITH().source}`),  // フォトナ ダウンタイム = 게임 서버 점검
  'ジェネシス': ONLY_WITH(), 'ジーニアス': ONLY_WITH(), 'クラツー': ONLY_WITH(), 'ブルーローズ': ONLY_WITH(),
  'ヴィヴァーチェ': ONLY_WITH(), 'キャバーン': ONLY_WITH(), 'スターウォーカー': ONLY_WITH(), 'エアジェット': ONLY_WITH(),
  'ハーモニーカ': ONLY_WITH(), 'インフィニ': ONLY_WITH(), 'シュリンク': ONLY_WITH(),
  // スカーレット는 '効果'도 포켓몬(サンドイッチ 効果)에 붙어 맥락 말에서 뺀다
  'スカーレット': new RegExp(`^(?!.*(${TREATMENT_CONTEXT.replace('効果|', '')}|ポテンツァ|シルファーム))`),
  // 수식어는 거의 시술(10-29 자동완성 확인) — 이름 단독만 다른 뜻(IPL=인도 크리켓 리그, density)
  'ipl': null, 'デンシティ': null,
  // 10-29 자동완성: 파칭코 기계·미니언즈·웬즈데이 캐릭터·우마무스메(アグネスデジタル·タキオン)·아그네스 찬·아그네스 라무·徳島 케이크 가게
  'アグネス': /ラム|何歳|何 歳|パチンコ|パチスロ|新台|リーチ|止め打ち|確率|回転数|ミニオン|ウェンズデー|ケーキ|ランチ|徳島|声優|デジタル|タキオン|ウマ娘|チャン|ユニセフ|黒柳|モー|とび森|何語|何者|何話|死な|プレミアムエディション|衣装/,
};

// 붙여 쓴 「〇〇とは」 — 키워드 플래너가 'X と は'로 쪼개 돌려주며 띄어 쓴 'X とは'의 20~60배 값을 준다
// (リジュラン と は 21,241 vs リジュラン とは 350, ハイフ 23,425 vs 760, 10-28 실측). 시술명 단독 검색과 섞인 값으로 보고 뺀다.
// 쪼개진 글자는 원문에만 남으므로 정규화 전 원문으로 본다.
const SPLIT_TOHA = /\sと\sは$/;

// homonyms = 검색 결과로 확인한 '이름만 치면 다른 뜻' 시술명(정규화) — 수집 때 일본 사이트 이미지 검색 상위 20개 중 무관한 뜻이 10개 이상(10-14)
export function tagKeyword(keyword: string, names: string[], homonyms: ReadonlySet<string> = new Set()): Intent {
  if (SPLIT_TOHA.test(keyword.trim())) return 'exclude';
  const k = norm(keyword);
  if (names.some((n) => norm(n) === k)) return k in HOMONYM || homonyms.has(k) ? 'noise' : 'name';
  if (names.some((n) => HOMONYM[norm(n)]?.test(k))) return 'noise';
  // 규칙은 시술 이름을 뗀 나머지 말로 본다 — 이름에 든 부위(唇ヒアルロン酸·肩ボトックス·目の下ヒアルロン酸)가
  // 고민·부위 규칙에 걸려 '唇ヒアルロン酸 やりすぎ'(과하게 = 불안)까지 부위로 세던 것을 막는다(10-29)
  const bare = names.reduce((s, n) => s.replace(norm(n), ''), k);
  for (const [intent, re] of RULES) if (re.test(bare)) return intent;
  const rest = bare.replace(FORM, '');
  return rest === '' ? 'name' : 'other';
}

// 분류할 때 뗄 시술 이름들 — 대표 이름 + 합성 이름의 조각. 'エラボトックス'는 'ボトックス'+'エラ'로도 떼야
// 어순이 뒤집힌 'ボトックス エラ'에서 'エラ'가 부위로 남지 않는다(주인 규칙 ownerResolver의 합성 이름과 짝, 10-29)
export function tagNames(jp: string, allJps: string[]): string[] {
  const n = norm(jp);
  const base = allJps.map(norm).filter((b) => b && b !== n && n.includes(b)).sort((a, b) => b.length - a.length)[0];
  if (!base) return [jp];
  const x = n.replace(base, '');
  return x.length >= 2 || /[^\x00-\x7f]/.test(x) ? [jp, base, x] : [jp];
}

export interface KeywordSeries { text: string; intent: Intent; values: number[] }

const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

// 어순·표기만 다른 검색어는 키워드 플래너가 같은 수치를 준다 — 48개월이 완전히 같으면 하나만 남긴다.
// 작은 값(월평균 50 미만)은 우연히 같을 수 있어 건드리지 않는다.
export function dedupe(list: KeywordSeries[]): KeywordSeries[] {
  const seen = new Set<string>();
  return list.filter((k) => {
    if (k.intent === 'name' || avg(k.values) < 50) return true;
    const key = k.values.join(',');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export interface Aggregate {
  total: number[];                          // 제외·다른 뜻·시술 밖 관심을 뺀 전체(겹쳐 세진 최대치)
  byIntent: Record<Intent, number[]>;
  korea: number[];
}

export function aggregate(list: KeywordSeries[], months: number): Aggregate {
  const zero = () => Array(months).fill(0) as number[];
  const byIntent = Object.fromEntries((Object.keys(INTENT_LABEL) as Intent[]).map((i) => [i, zero()])) as Record<Intent, number[]>;
  const total = zero();
  for (const k of dedupe(list)) {
    for (let m = 0; m < months; m++) {
      const v = k.values[m] ?? 0;
      byIntent[k.intent][m] += v;
      if (k.intent !== 'exclude' && k.intent !== 'noise' && k.intent !== 'adjacent') total[m] += v;
    }
  }
  return { total, byIntent, korea: byIntent.korea };
}

// 성격 — 최근 window개월 태그 비중(이름만·기타·제외 제외). 수식어 붙은 검색이 너무 적으면 null(판단 보류).
export function profile(a: Aggregate, window = 12, from?: number): Record<ProfileIntent, number> | null {
  const n = a.total.length;
  const end = from === undefined ? n : from;
  const sums = PROFILE_INTENTS.map((i) => a.byIntent[i].slice(Math.max(0, end - window), end).reduce((s, x) => s + x, 0));
  const all = sums.reduce((s, x) => s + x, 0);
  if (all / window < 100) return null;
  return Object.fromEntries(PROFILE_INTENTS.map((i, k) => [i, sums[k] / all])) as Record<ProfileIntent, number>;
}

export type Stage = 'learning' | 'considering' | 'choosing';
// 관심 단계 — 고객 여정의 명사 이름(탐색 → 검토 → 결정)
export const STAGE_LABEL: Record<Stage, string> = { learning: '탐색', considering: '검토', choosing: '결정' };
export const STAGE_HINT: Record<Stage, string> = {
  learning: '탐색 단계 — 개념·비교 검색 중심',
  considering: '검토 단계 — 효과·후기, 부작용·통증, 횟수·용량 검색 중심',
  choosing: '결정 단계 — 가격, 병원·지역 검색 중심',
};

// 단계 — 알아보기(정보) · 고민(효과+불안+횟수·용량) · 고르기(비용+장소) 중 비중이 가장 큰 쪽.
// 한국은 따로 보는 숫자라, 부위·대상은 '어디에·누가'라 단계를 가리지 않아 뺀다(제모가 부위 검색만으로 '고민'이 되지 않게).
export function stage(p: Record<ProfileIntent, number> | null): Stage | null {
  if (!p) return null;
  const s: Record<Stage, number> = {
    learning: p.info,
    considering: p.effect + p.worry + (p.dose ?? 0),  // dose ?? 0 — 횟수·용량 칸 전에 저장된 완성본
    choosing: p.cost + p.place,
  };
  if (s.learning + s.considering + s.choosing < 0.2) return null;  // 부위·한국 말고는 거의 없음 → 판단 보류
  return (Object.keys(s) as Stage[]).sort((a, b) => s[b] - s[a])[0];
}

// 이름이 다른 뜻과 겹치는 시술 — 다른 뜻 검색이 (전체 + 다른 뜻)의 20% 이상이면 숫자를 시술 수요로 믿기 어렵다
export function ambiguous(a: Aggregate, window = 12): boolean {
  const n = a.total.length;
  const sum = (xs: number[]) => xs.slice(n - window).reduce((s, x) => s + x, 0);
  const noise = sum(a.byIntent.noise);
  return noise > 0 && noise / (sum(a.total) + noise) >= 0.2;
}

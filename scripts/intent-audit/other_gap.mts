// 규칙 빈틈 크기 — 운영 DB 검색어 중 규칙에 안 걸린(other) 것을 후보 단어별로 묶어 12개월 월평균 검색량을 잰다. 읽기만.
import postgres from 'postgres';
import { tagKeyword, norm } from '../../src/lib/searchIntent.ts';
const sql = postgres({ host: process.env.PGHOST, port: Number(process.env.PGPORT ?? 5432), username: process.env.PGUSER,
  password: process.env.PGPASSWORD, database: process.env.PGDATABASE, ssl: 'require', prepare: false, max: 1 });
const PREF = '北海道|青森|岩手|宮城|秋田|山形|福島|茨城|栃木|群馬|埼玉|千葉|神奈川|新潟|富山|石川|福井|山梨|長野|岐阜|静岡|愛知|三重|滋賀|兵庫|奈良|和歌山|鳥取|島根|岡山|山口|徳島|香川|愛媛|高知|佐賀|長崎|熊本|大分|宮崎|鹿児島|沖縄';
const GROUPS: Record<string, RegExp> = {
  '걱정(후유증·늙어 보임 등)': /後遺症|老け|こける|垂れ|たるむ|やつれ|不自然|違和感|左右差|変わらない|治る|知恵袋/,
  '지역(도도부현)': new RegExp(PREF),
  '지역(都内·시 이름 기타)': /都内|市|駅|浜松|豊橋|岡崎|金沢|姫路|高崎|宇都宮|柏|大宮|町田|立川|吉祥寺|錦糸町|上野|恵比寿|六本木|天王寺|三宮|小倉|熊谷|川越|船橋|西宮/,
  '병원 고르기(名医·上手)': /名医|上手|うまい|ランキング|有名/,
  '횟수·간격(何回·何ヶ月)': /何ヶ月|何か月|ヶ月おき|何回|何ショット|何単位|何cc|何本|期間|持ち|もつ/,
};
try {
  const rows = await sql<Array<{ text: string; jp: string | null; series: number[] | null }>>`
    select k.text, p.jp, k.series from trend_keyword k left join trend_procedure p on p.id = k.procedure_id where k.market = 'jp' and k.procedure_id is not null`;
  const v = (s: number[] | null) => ((s ?? []).slice(-12).reduce((a, b) => a + b, 0)) / 12;
  const other = rows.filter((r) => r.jp && tagKeyword(r.text, [r.jp]) === 'other');
  const all = rows.reduce((a, r) => a + v(r.series), 0), ov = other.reduce((a, r) => a + v(r.series), 0);
  console.log(`전체 ${rows.length}개 월 ${Math.round(all).toLocaleString()} · 규칙 안 걸림 ${other.length}개 월 ${Math.round(ov).toLocaleString()}`);
  for (const [g, re] of Object.entries(GROUPS)) {
    const hit = other.filter((r) => re.test(norm(r.text))).sort((a, b) => v(b.series) - v(a.series));
    console.log(`- ${g}: ${hit.length}개 월 ${Math.round(hit.reduce((a, r) => a + v(r.series), 0)).toLocaleString()} | ${hit.slice(0, 8).map((r) => `${norm(r.text)}=${Math.round(v(r.series))}`).join(', ')}`);
  }
} finally { await sql.end(); }

import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { callLLM } from '@/lib/llm';
import { kpFromComposio, runTrendCollect } from '@/lib/trendCollect';
import { runDiscover, CANDIDATE_CLASSIFY_SYSTEM, type Classified } from '@/lib/trendDiscover';

// 검색 트렌드 자동 수집(스펙 2026-10-13 §7) — DB 예약 실행(pg_cron + pg_net, scripts/search-trends-cron.sql)이 주 1회(월요일 04:23 서울) 부른다.
// 무엇을 할지는 runTrendCollect가 정한다(새 달 확인 → 있으면 전체 갱신, 남는 시간에 연관 검색어 넓히기·번역). 못 끝낸 건 다음 주에 이어 한다.
// 성과 자동 측정과 같은 시크릿(Vault 'measure_cron_secret')을 쓴다.
export const maxDuration = 300;

const MODEL = 'claude-sonnet-5-5';

async function translate(texts: string[], glossary: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (let i = 0; i < texts.length; i += 120) {
    const chunk = texts.slice(i, i + 120);
    const r = await callLLM('anthropic.trendTranslate', {
      model: MODEL, max_tokens: 8000,
      system: `일본 구글 검색어를 한국 피부과 마케터가 읽을 한국어로 옮긴다. 시술명은 아래 용어집의 한국어 표기를 쓰고, 용어집에 없으면 한국에서 통용되는 표기. 지명은 한국식(大阪=오사카, 明洞=명동, 江南=강남, 弘大/ホンデ=홍대). 병원 이름은 음역. 검색어처럼 짧게, 어순은 자연스러운 한국어로. 설명 붙이지 말 것.\n용어집: ${glossary}`,
      messages: [{ role: 'user', content: `JSON 배열의 각 검색어를 번역해 {"원문":"번역"} JSON 객체 하나로만 답해.\n${JSON.stringify(chunk)}` }],
    });
    const text = r.content.map((c) => (c as { text?: string }).text ?? '').join('');
    try { Object.assign(out, JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1))); } catch { /* 이 묶음은 다음 실행에 다시 */ }
  }
  return out;
}

// 새로 뜨는 검색 분류 — 새 시술·다른 표기·고민·화장품·병원·일반어
async function classify(texts: string[], glossary: string): Promise<Classified[]> {
  const out: Classified[] = [];
  for (let i = 0; i < texts.length; i += 80) {
    const r = await callLLM('anthropic.trendDiscover', {
      model: MODEL, max_tokens: 8000, system: CANDIDATE_CLASSIFY_SYSTEM(glossary),
      messages: [{ role: 'user', content: `각 검색어를 {"text","kind","term","of","ko"} JSON 배열로만. ko는 term의 한국어 표기, of는 variant일 때만.\n${JSON.stringify(texts.slice(i, i + 80))}` }],
    });
    const t = r.content.map((c) => (c as { text?: string }).text ?? '').join('');
    try { out.push(...JSON.parse(t.slice(t.indexOf('['), t.lastIndexOf(']') + 1))); } catch { /* 이 묶음은 빠짐 — 다음 달에 다시 */ }
  }
  return out;
}

async function handle(req: Request): Promise<NextResponse> {
  // 시크릿 미설정이면 전부 거부 — "Bearer undefined" 비교로 뚫리는 fail-open 방지(auto-measure와 같은 계약)
  const secret = process.env.MEASURE_CRON_SECRET;
  if (!secret) return NextResponse.json({ error: 'MEASURE_CRON_SECRET not configured' }, { status: 401 });
  if (req.headers.get('authorization') !== `Bearer ${secret}`)
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const sql = getSql(), kp = kpFromComposio();
  const r = await runTrendCollect(sql, kp, { deadlineMs: 270_000, translate, discover: (latest) => runDiscover(sql, kp, 'jp', latest, classify) });
  return NextResponse.json(r);
}

export async function POST(req: Request) { return handle(req); }
export async function GET(req: Request) { return handle(req); }

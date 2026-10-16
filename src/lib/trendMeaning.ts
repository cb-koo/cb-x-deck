// 뜻 확인 — 검색어의 일본 사이트 이미지 검색 상위 20개를 피부과·미용 / 다른 진료과 / 화장품·셀프 / 무관한 뜻으로 센다(10-14 시술에 쓴 방식을 서버로).
// Composio 기본 도구(COMPOSIO_SEARCH_IMAGE, 무료)는 나라를 고를 수 없어 'site:jp'로 일본 사이트만 본다.
import { composioFromEnv } from './composio';
import { callLLM } from './llm';
import { ALT_GENERATE_SYSTEM, SAME_CHECK_SYSTEM } from './trendAltSpell';

const IMAGE_TOOL = { slug: 'COMPOSIO_SEARCH_IMAGE', version: '20260903_00' };
const SYSTEM = '일본 구글 이미지 검색(일본 사이트) 상위 결과의 출처·제목을 보고 각 결과를 분류한다. derm = 피부과·미용의료·미용외과·미용 클리닉/미용 시술 정보. '
  + 'med = 다른 진료과(정형외과·치과·내과·비만/당뇨 내과·산부인과·비뇨기과·암 치료·소아과 등 미용 목적이 아닌 진료). '
  + 'self = 같은 개념이지만 시술이 아닌 것(화장품·스킨케어·가정용 미용기기·에스테 살롱·셀프케어). unrelated = 의료·미용과 무관한 다른 뜻. unclear = 판단 불가.';

export type Meaning = { derm: number; med: number; self: number; unrelated: number; note: string };

export async function checkMeaning(term: string): Promise<Meaning | null> {
  const c = composioFromEnv();
  const d = await c.tool<{ images_results?: Array<{ source?: string; title?: string }>; results?: { images_results?: Array<{ source?: string; title?: string }> } }>(
    IMAGE_TOOL.slug, IMAGE_TOOL.version, { query: `${term} site:jp`, num: 20 });
  const items = (d.images_results ?? d.results?.images_results ?? []).slice(0, 20);
  if (!items.length) return null;
  const r = await callLLM('anthropic.trendMeaning', {
    model: 'claude-sonnet-5-5', max_tokens: 1000, system: SYSTEM,
    messages: [{ role: 'user', content: `검색어 "${term}"의 결과를 세어 {"derm","med","self","unrelated","unclear","note":"derm 외에 무엇이 섞였는지 한국어로 짧게"} JSON 하나로만.\n${items.map((x, i) => `${i + 1}. ${x.source ?? ''} | ${x.title ?? ''}`).join('\n')}` }],
  });
  const t = r.content.map((x) => (x as { text?: string }).text ?? '').join('');
  const o = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)) as Partial<Meaning>;
  return { derm: o.derm ?? 0, med: o.med ?? 0, self: o.self ?? 0, unrelated: o.unrelated ?? 0, note: o.note ?? '' };
}

const parseJson = <T>(t: string, open: '{' | '['): T | null => {
  const close = open === '{' ? '}' : ']';
  try { return JSON.parse(t.slice(t.indexOf(open), t.lastIndexOf(close) + 1)) as T; } catch { return null; }
};
const textOf = (r: { content: unknown[] }) => r.content.map((x) => (x as { text?: string }).text ?? '').join('');

async function imageItems(term: string) {
  const d = await composioFromEnv().tool<{ images_results?: Array<{ source?: string; title?: string }>; results?: { images_results?: Array<{ source?: string; title?: string }> } }>(
    IMAGE_TOOL.slug, IMAGE_TOOL.version, { query: `${term} site:jp`, num: 20 });
  return (d.images_results ?? d.results?.images_results ?? []).slice(0, 20);
}

// '값 없음' 시술의 다른 표기 만들기(시술 15개씩)
export async function generateAlts(procs: Array<{ jp: string; kr: string }>): Promise<Record<string, string[]>> {
  for (let k = 0; k < 2; k++) {
    const r = await callLLM('anthropic.trendAltSpell', {
      model: 'claude-sonnet-5-5', max_tokens: 6000, system: ALT_GENERATE_SYSTEM,
      messages: [{ role: 'user', content: `각 시술(일본어=한국어)마다 다른 말 10개. {"원래 일본어":["표기",...]} JSON 하나로만.\n${JSON.stringify(procs.map((p) => `${p.jp}=${p.kr}`))}` }],
    });
    const o = parseJson<Record<string, string[]>>(textOf(r), '{');
    if (o) return Object.fromEntries(Object.entries(o).map(([k2, v]) => [k2.split('=')[0], v]));
  }
  return {};
}

// 같은 시술 확인 — 상위 결과가 원래 시술 그 자체를 다루는지(피부과인지보다 좁은 질문)
export async function checkSameProcedure(alt: string, orig: string, ko: string) {
  const items = await imageItems(alt);
  if (!items.length) return null;
  for (let k = 0; k < 3; k++) {
    const r = await callLLM('anthropic.trendAltSpell', {
      model: 'claude-sonnet-5-5', max_tokens: 1500, system: SAME_CHECK_SYSTEM,
      messages: [{ role: 'user', content: `기준 시술: ${ko}(${orig}). 검색어: ${alt}.\n{"same","other","self","unrelated","unclear","note":"same 외에 무엇이 섞였는지 한국어 짧게"} JSON 하나로만(숫자는 개수).\n${items.map((x, i) => `${i + 1}. ${x.source ?? ''} | ${x.title ?? ''}`).join('\n')}` }],
    });
    const o = parseJson<{ same?: unknown; other?: unknown; self?: unknown; unrelated?: unknown; note?: string }>(textOf(r), '{');
    const num = (x: unknown) => (typeof x === 'number' ? x : Array.isArray(x) ? x.length : Number(x) || 0);  // 번호 목록으로 답할 때도 있다
    if (o) return { same: num(o.same), other: num(o.other), self: num(o.self), unrelated: num(o.unrelated), total: items.length, note: o.note ?? '' };
  }
  return null;
}

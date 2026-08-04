// 薬機法(일본 의약품·화장품 광고 규제) 리스크 용어 힌트. 법률 자문이 아니라 담당자 확인용 표식이며,
// 매칭돼도 차단·필터링하지 않는다(카드에 ⚠️ 배지만). 오탐 위험 높은 체험담 단정형은 v1 제외.
const RISK_TERMS = [
  '効果がある', '効く', '治る', '治療', '完治', '医薬品', '副作用',
  'シミが消える', 'シワがなくなる', '美白効果', '痩せる',
];

export function flagYakkiho(text: string): string[] {
  if (!text) return [];
  return RISK_TERMS.filter((term) => text.includes(term));
}

// ── 초안 검수 플래그 ──────────────────────────────────────────────
// 기존 flagYakkiho와 같은 원칙: 법률 자문이 아니라 담당자 확인용 표식이며 차단·필터링하지 않는다.
export interface DraftFlag { term: string; reason: string; kind: 'yakkiho' | 'medical_ad' | 'banned' }

// dismissed_flags 매칭 키
export const flagKey = (f: DraftFlag): string => `${f.kind}:${f.term}`;

// 医療広告ガイドライン 힌트(체험담·비포애프터) — 시드로 시작해 운영하며 보강
const MEDICAL_AD_TERMS: Array<{ term: string; reason: string }> = [
  { term: 'してみた', reason: '체험담 성격 — 의료광고 가이드라인 확인 필요' },
  { term: '行ってきた', reason: '체험담 성격 — 의료광고 가이드라인 확인 필요' },
  { term: '受けてみた', reason: '체험담 성격 — 의료광고 가이드라인 확인 필요' },
  { term: '体験', reason: '체험담 성격 — 의료광고 가이드라인 확인 필요' },
  { term: 'ビフォー', reason: '비포애프터 언급 — 시술 내용·비용·리스크 병기 필요(의료광고)' },
  { term: 'アフター', reason: '비포애프터 언급 — 시술 내용·비용·리스크 병기 필요(의료광고)' },
  { term: 'before', reason: '비포애프터 언급 — 시술 내용·비용·리스크 병기 필요(의료광고)' },
  { term: 'after', reason: '비포애프터 언급 — 시술 내용·비용·리스크 병기 필요(의료광고)' },
];

export function draftFlags(text: string, banned: string[] = []): DraftFlag[] {
  if (!text) return [];
  const flags: DraftFlag[] = flagYakkiho(text).map((term) => ({
    term, reason: '효과 단정 표현 — 약기법', kind: 'yakkiho' as const,
  }));
  for (const { term, reason } of MEDICAL_AD_TERMS) {
    if (text.includes(term)) flags.push({ term, reason, kind: 'medical_ad' });
  }
  for (const p of banned) {
    if (p && text.includes(p)) flags.push({ term: p, reason: '클라이언트 금지 표현', kind: 'banned' });
  }
  return flags;
}

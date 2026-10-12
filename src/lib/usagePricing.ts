// API 단가 (공식, 2026-07-20 확인). USD.
// - Anthropic: platform.claude.com 모델 가격표 (per 1M tokens)
// - getxapi: getxapi.com/pricing — 표준 read 콜 $0.001/콜 (앱은 프리미엄 미사용)
// - Exa: exa.ai/pricing — 검색 $0.007/콜($7/1k). 본문(contents)은 상위 10개까지 무료이고
//   앱은 numResults:8이라 본문비 없음. numResults를 11+로 올리면 본문비 $1/1k 추가됨.
function envNum(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) ? v : fallback;
}
export const GETXAPI_PER_CALL = envNum('PRICE_GETXAPI_PER_CALL', 0.001);
export const EXA_PER_SEARCH = envNum('PRICE_EXA_PER_SEARCH', 0.007);

export const ANTHROPIC_PRICES: Record<string, { in: number; out: number }> = {
  // Haiku 5.5(2026-10-12 확인)는 프롬프트 10만 토큰 초과 요청만 5배($0.50/$2.50)다. 집계 행은 요청별 길이를 모르므로 기본 단가로 계산한다 —
  // 넘길 수 있는 호출은 주제 분석(pillar derive, 트윗 500개×200자)뿐이고 그마저 상한에 가까울 때만이라, 그 건은 실제보다 적게 잡힐 수 있다.
  'claude-haiku-5-5': { in: 0.1, out: 0.5 },
  'claude-haiku-4-5': { in: 1, out: 5 },
  'claude-sonnet-5': { in: 3, out: 15 },
  'claude-opus-4-8': { in: 5, out: 25 },
  'claude-opus-5': { in: 5, out: 25 },
};
const DEFAULT_ANTHROPIC = ANTHROPIC_PRICES['claude-haiku-5-5']; // 앱 기본 모델(suggest.ts MODEL)

interface AggRow {
  api: string; operation: string; model: string | null;
  calls: number; inputTokens: number; outputTokens: number;
}

function anthropicPrice(model: string | null): { in: number; out: number } {
  if (!model) return DEFAULT_ANTHROPIC;
  const key = Object.keys(ANTHROPIC_PRICES).find((k) => model.startsWith(k));
  return key ? ANTHROPIC_PRICES[key] : DEFAULT_ANTHROPIC;
}

export function rowCostUsd(row: AggRow): number {
  if (row.api === 'anthropic') {
    const p = anthropicPrice(row.model);
    return (row.inputTokens / 1e6) * p.in + (row.outputTokens / 1e6) * p.out;
  }
  if (row.api === 'getxapi') return row.calls * GETXAPI_PER_CALL;
  if (row.api === 'exa') return row.calls * EXA_PER_SEARCH;
  return 0;
}

export function formatMoney(usd: number): string {
  return `$${usd.toFixed(usd < 1 ? 4 : 2)}`;
}

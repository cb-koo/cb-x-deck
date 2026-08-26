// 원고 라우트가 공유하는 캠페인 3필드 검증 — 단건 PATCH·bulk PATCH·생성 POST·직접 쓰기 POST 네 곳이 같은 규칙을 써야 한다
// (influencerPatch.ts와 같은 이유: 복사해 두면 한쪽만 고쳐지는 드리프트). DB 접근 없음.
// undefined = 건드리지 않음 · null = 지움 · 값 = 설정(스펙 §2-3) — 결과 객체엔 '온 키'만 실려 라우트가 그대로 spread한다.
import { parseDraftCost, type DraftCost, type Parsed } from './campaignCost.ts';
import { isDateOnlyString } from './campaignJudgment.ts';
import { isUuidLike } from './uuid.ts';

export interface DraftFieldPatch { campaignId?: string | null; scheduledOn?: string | null; cost?: DraftCost | null }

export const CAMPAIGN_ID_MESSAGE = '캠페인 값이 올바르지 않아요';
export const SCHEDULED_ON_MESSAGE = '예정일은 YYYY-MM-DD 날짜여야 해요';
// 라우트가 존재 확인(getCampaign) 실패 시 쓰는 문구 — FK 위반(23503)을 500으로 흘리지 않는다
export const CAMPAIGN_NOT_FOUND_MESSAGE = '캠페인을 찾을 수 없어요 — 삭제됐을 수 있어요. 목록을 새로고침해 주세요';

export function parseDraftFieldPatch(body: unknown): Parsed<DraftFieldPatch> {
  const out: DraftFieldPatch = {};
  if (!body || typeof body !== 'object') return { ok: true, value: out };
  const b = body as { campaignId?: unknown; scheduledOn?: unknown; cost?: unknown };
  if (b.campaignId !== undefined) {
    // uuid 형식이 아니면 DB에서 22P02(캐스팅 오류)로 터진다 — 여기서 400으로 끊는다(uuid.ts 관례)
    if (b.campaignId !== null && !(typeof b.campaignId === 'string' && isUuidLike(b.campaignId))) {
      return { ok: false, message: CAMPAIGN_ID_MESSAGE };
    }
    out.campaignId = b.campaignId as string | null;
  }
  if (b.scheduledOn !== undefined) {
    // date 컬럼엔 달력일만 — 시각이 붙으면 서울 자정 전후로 하루가 민다. ''는 null로 바꿔주지 않는다(지움은 명시적으로)
    if (b.scheduledOn !== null && !isDateOnlyString(b.scheduledOn)) return { ok: false, message: SCHEDULED_ON_MESSAGE };
    out.scheduledOn = b.scheduledOn as string | null;
  }
  if (b.cost !== undefined) {
    const c = parseDraftCost(b.cost);
    if (!c.ok) return { ok: false, message: c.message };
    out.cost = c.value;
  }
  return { ok: true, value: out };
}

// 정산 계산(스펙 2026-08-28 §3) — 순수. 화면·확인 창·서버 저장이 같은 함수를 부른다(화면 3,158 / 저장 3,157 같은 일이 없게).
import type { Currency } from './influencerPricing.ts';
import { TASK_TYPE_LABEL, type TaskType, type CampaignKind } from './campaignJudgment.ts';
import type { TaskCost } from './campaignCost.ts';
import { PAYMENT_TYPE_LABEL, type PaymentMethod, type PaymentFee } from './influencerPayment.ts';
import { defaultCategoryFor, visibleCategories, CATEGORY_ID_FEE, CATEGORY_ID_INFO, type SettlementSettings } from './settlementSettings.ts';
import type { TaskProof } from './taskProofGuard.ts';

// ── 금액(§3-1·3-2) ──
export interface MoneyCalc {
  costAmount: number; costCurrency: Currency;   // 작업 비용 그대로(화면 '원가' 표시용)
  amountKrw: number; payoutCurrency: Currency; rateKrwPerJpy: number;
  amountNet: number; fee: PaymentFee | null; feeAmount: number; amountGross: number;
}
export function computeMoney(cost: TaskCost, payoutCurrency: Currency, fee: PaymentFee | undefined, rateKrwPerJpy: number): MoneyCalc {
  const rate = rateKrwPerJpy;
  let net: number;
  if (cost.currency === payoutCurrency) net = cost.amount;
  else if (cost.currency === 'KRW') net = Math.round(cost.amount / rate);
  else net = cost.amount * rate;
  const amountKrw = cost.currency === 'KRW' ? cost.amount : cost.amount * rate;
  let feeAmount = 0;
  if (fee?.mode === 'grossUp') feeAmount = Math.round(net / (1 - fee.percent / 100)) - net;
  else if (fee?.mode === 'fixed') feeAmount = fee.amount;
  return { costAmount: cost.amount, costCurrency: cost.currency, amountKrw, payoutCurrency, rateKrwPerJpy: rate, amountNet: net, fee: fee ?? null, feeAmount, amountGross: net + feeAmount };
}

// ── 데드라인(§3-4) — 월~금 그 주 금요일, 토 다음 금요일, 일 다음날 월요일. 문자열 날짜만 다룬다(UTC 정오로 계산해 시프트 없음).
export function defaultDeadline(today: string): string {
  const d = new Date(today + 'T12:00:00Z');
  const dow = d.getUTCDay(); // 0 일 … 6 토
  const add = dow === 0 ? 1 : dow === 6 ? 6 : 5 - dow;
  d.setUTCDate(d.getUTCDate() + add);
  return d.toISOString().slice(0, 10);
}

// ── 분류 기본값(§3-3) — 반환은 sendAs(스냅샷 값) ──
export function defaultCategory(i: { type: TaskType; campaignKind: CampaignKind | null; settings: SettlementSettings; lastQuoteRtCategory: string | null }): string | null {
  const byType = defaultCategoryFor(i.settings, i.type);
  if (byType) return byType.sendAs;
  const visible = visibleCategories(i.settings);
  if (i.type === 'post' || i.type === 'visit') {
    const id = i.campaignKind === 'visit' ? CATEGORY_ID_FEE : CATEGORY_ID_INFO;
    return visible.find((c) => c.id === id)?.sendAs ?? null;
  }
  if (i.type === 'quoteRt' && i.lastQuoteRtCategory) {
    return visible.find((c) => c.sendAs === i.lastQuoteRtCategory)?.sendAs ?? null;
  }
  return null;
}

// ── 문구(§3-5) ──
export function itemText(handle: string, type: TaskType): string {
  return `@${handle} ${TASK_TYPE_LABEL[type]} 1건 정산`;
}
export function purposeText(clientName: string, kind: CampaignKind | null, type: TaskType): string {
  let p: string;
  if (kind === 'content') p = '정보성 콘텐츠 Viral 협찬';
  else if (kind === 'visit') p = type === 'rt' || type === 'quoteRt' ? '방문협찬 리뷰 바이럴 목적' : '방문협찬 원고료';
  else if (kind === 'seeding') p = '제품협찬 바이럴 목적';
  else p = '콘텐츠 협찬';
  return `${clientName} ${p}`;
}

// ── 참고자료(§3-6) ──
export function referenceUrlFor(t: { type: TaskType; postUrl: string | null; targetTweetUrl: string | null; targetPostUrl: string | null }): string | null {
  if (t.type === 'rt') return t.targetTweetUrl ?? t.targetPostUrl ?? null;
  return t.postUrl ?? null;
}

// ── 신호등(§3-7) ──
export type ReadinessLevel = 'ready' | 'warn' | 'blocked';
export type IssueCode = 'no-influencer' | 'no-payment-method' | 'no-category' | 'no-reference' | 'removed' | 'paypay-no-identifier' | 'no-client' | 'no-proof';
export interface ReadinessIssue { level: 'warn' | 'blocked'; code: IssueCode; text: string }
// 클릭 전에 미리 보여준다(UX 원칙 ②) — createRequests의 거절 사유(settlementStore)와 문구를 맞춘다(042)
// 클라이언트 지정은 캠페인 생성 시점에만 가능(수정 UI 없음·parseCampaignPatch가 clientId를 의도적으로 무시) — 클라이언트가 삭제되면
// campaign.client_id가 on delete set null로 비고, 그때부터는 고칠 수 없다. 그래서 문구는 "다시 지정"이 아니라 실제로 남은 유일한 조치를 말한다.
export const NO_CLIENT_TEXT = '이 캠페인의 클라이언트가 삭제돼 비어 있어요 — 클라이언트를 다시 만들고 캠페인을 새로 만들어야 정산할 수 있어요';
export const NO_INFLUENCER_TEXT = '명부에 없는 인플루언서예요 — 명부에 추가하고 결제 수단을 등록해 주세요';
const monthDay = (ymd: string) => `${Number(ymd.slice(5, 7))}-${Number(ymd.slice(8, 10))}`;
// 09-02 koo: 정산 프로덕트가 지급 전 확인에 쓰는 자료가 없으면 그쪽이 요청을 받지 않는다(보류로 돌려보냄) → 우리가 요청 단계에서 막는다.
//  · RT → 증빙 스크린샷(원본 트윗 링크는 증거가 아니다)  · 투고·인용RT·방문 → 인플루언서 본인 게시물 링크(reference_url)
// 이 두 이슈는 화면(effectiveIssues)과 서버(createRequests)가 같은 객체를 쓴다 — 문구·수준이 한 곳에서만 바뀌게.
const NO_CATEGORY_ISSUE: ReadinessIssue = { level: 'blocked', code: 'no-category', text: '분류를 골라 주세요' };
const NO_PROOF_ISSUE: ReadinessIssue = { level: 'blocked', code: 'no-proof', text: '증빙 스크린샷을 넣어야 요청할 수 있어요 — 정산 쪽이 지급 전에 확인해요' };
function referenceIssue(required: boolean): ReadinessIssue {
  return required
    ? { level: 'blocked', code: 'no-reference', text: '참고 링크를 넣어 주세요 — 정산 쪽이 이 링크로 게시를 확인해요' }
    : { level: 'warn', code: 'no-reference', text: '참고 링크 없음' };
}
// 참고 링크가 확인 자료인 유형 — RT만 아니다(RT의 링크는 클리닉 원본 트윗; 스펙 3-6, 슬랙 RT 405건 중 350건이 링크 없이 갔다)
export const referenceRequiredFor = (type: TaskType): boolean => type !== 'rt';

export function assessReadiness(i: { inRoster: boolean; method: PaymentMethod | null; category: string | null; referenceUrl: string | null; referenceRequired: boolean; removedAt: string | null; removedReason: string; clientId: string | null; proofMissing: boolean }): { level: ReadinessLevel; issues: ReadinessIssue[] } {
  const issues: ReadinessIssue[] = [];
  if (!i.inRoster) issues.push({ level: 'blocked', code: 'no-influencer', text: NO_INFLUENCER_TEXT });
  else if (!i.method) issues.push({ level: 'blocked', code: 'no-payment-method', text: '결제 수단이 없어요 — 프로필에서 등록해 주세요' });
  if (i.clientId === null) issues.push({ level: 'blocked', code: 'no-client', text: NO_CLIENT_TEXT });
  if (!i.category) issues.push(NO_CATEGORY_ISSUE);
  if (!i.referenceUrl) issues.push(referenceIssue(i.referenceRequired));
  if (i.proofMissing) issues.push(NO_PROOF_ISSUE);
  if (i.removedAt) issues.push({ level: 'warn', code: 'removed', text: `게시 내려짐 ${monthDay(i.removedAt)}${i.removedReason ? ` · ${i.removedReason}` : ''}` });
  // 09-03 koo: 그쪽이 "PayPay 수취 식별값 없으면 송금을 시작할 수 없다"로 확정 → 🔴. 채우는 곳은 인플루언서 프로필의 결제 수단.
  if (i.method?.type === 'paypay' && !i.method.identifier) issues.push({ level: 'blocked', code: 'paypay-no-identifier', text: 'PayPay 수취 정보를 넣어야 요청할 수 있어요 — 정산 쪽이 이 값 없이는 송금하지 못해요' });
  const level: ReadinessLevel = issues.some((x) => x.level === 'blocked') ? 'blocked' : issues.length ? 'warn' : 'ready';
  return { level, issues };
}

// ── 화면의 실제 신호등(§4) — 서버 값에 "사람이 지금 채운 값"만 얹는다.
// · 분류: 서버가 채워 보낸 no-category는 늘 버리고, 지금 edit.category가 비어 있으면 다시 얹는다 — 분류를 지우면
//   즉시 🔴로 떨어져야 한다(비웠는데도 🟢로 남아 체크 가능한 비대칭 버그, 08-28 리뷰).
// · 참고 링크(09-02): edit에 referenceUrl이 있으면 같은 방식 — 행의 입력칸에 링크를 넣으면 즉시 풀리고 지우면 다시 막힌다.
//   edit에 referenceUrl 키가 없으면(옛 호출) 서버 판정을 그대로 둔다.
// 서버(createRequests)도 아이템의 분류·링크를 넣어 이 함수를 부른다 — 화면이 🔴로 막는 것과 서버가 거절하는 것이 한 판정.
export interface ReadinessEdit { category: string | null; referenceUrl?: string | null }
export function effectiveIssues(c: SettlementCandidate, e: ReadinessEdit | undefined): ReadinessIssue[] {
  const editsReference = e !== undefined && 'referenceUrl' in e;
  const issues = c.issues.filter((i) => i.code !== 'no-category' && !(editsReference && i.code === 'no-reference'));
  if (!e?.category) issues.push(NO_CATEGORY_ISSUE);
  if (editsReference && !e.referenceUrl) issues.push(referenceIssue(referenceRequiredFor(c.taskType)));
  return issues;
}
export function effectiveReadiness(c: SettlementCandidate, e: ReadinessEdit | undefined): ReadinessLevel {
  const issues = effectiveIssues(c, e);
  if (issues.some((i) => i.level === 'blocked')) return 'blocked';
  return issues.length ? 'warn' : 'ready';
}

// ── 결제 수단 스냅샷(§2-1 payment_method) ──
export interface PaymentMethodSnapshot {
  type: PaymentMethod['type']; holder: string; currency: Currency;
  email?: string; paypalId?: string; identifier?: string; bank?: string; branch?: string; account?: string;
}
export function toMethodSnapshot(m: PaymentMethod): PaymentMethodSnapshot {
  const s: PaymentMethodSnapshot = { type: m.type, holder: m.holder, currency: m.currency };
  for (const k of ['email', 'paypalId', 'identifier', 'bank', 'branch', 'account'] as const) {
    if (m[k]) s[k] = m[k];
  }
  return s;
}
// 슬랙 양식 8번 `수단 | 수취인 | 식별정보` — 실데이터 형식 그대로(계좌는 은행 / 지점 / 번호, 지점 없으면 빈칸 유지)
export function describeSnapshot(m: PaymentMethodSnapshot): string {
  let ident = '';
  if (m.type === 'paypal') ident = m.email ?? (m.paypalId ? `paypal.me/${m.paypalId}` : '');
  else if (m.type === 'paypay') ident = m.identifier ?? '';
  else ident = `${m.bank ?? ''} / ${m.branch ?? ''} / ${m.account ?? ''}`;
  return `${PAYMENT_TYPE_LABEL[m.type]} | ${m.holder} | ${ident}`;
}

// ── 후보 한 건(§2-4 + §3 전부) ──
export interface CandidateInput {
  task: { id: string; type: TaskType; influencerHandle: string; cost: TaskCost; postUrl: string | null; targetTweetUrl: string | null; targetPostUrl: string | null; postedAt: string; removedAt: string | null; removedReason: string; draftLabel: string | null; proof: TaskProof | null };
  campaign: { id: string; name: string; kind: CampaignKind | null; clientId: string | null; clientName: string };
  influencer: { inRoster: boolean; method: PaymentMethod | null };
  settings: SettlementSettings; lastQuoteRtCategory: string | null; today: string;
}
export interface SettlementCandidate {
  taskId: string; campaignId: string; campaignName: string; clientId: string | null; clientName: string; campaignKind: CampaignKind | null;
  influencerHandle: string; taskType: TaskType; postedAt: string; removedAt: string | null; removedReason: string; draftLabel: string | null;
  cost: TaskCost;   // 결제 수단이 없어 money가 null이어도 화면에 원가는 보여준다(§4-1 "막힌 행에도 금액")
  money: MoneyCalc | null; method: PaymentMethod | null; proof: TaskProof | null;
  categoryDefault: string | null; deadlineDefault: string; referenceDefault: string | null; itemText: string; purposeText: string;
  readiness: ReadinessLevel; issues: ReadinessIssue[];
}
export function computeCandidate(i: CandidateInput): SettlementCandidate {
  const { task, campaign, influencer } = i;
  const method = influencer.method;
  const money = method ? computeMoney(task.cost, method.currency, method.fee, i.settings.rateKrwPerJpy) : null;
  const categoryDefault = defaultCategory({ type: task.type, campaignKind: campaign.kind, settings: i.settings, lastQuoteRtCategory: i.lastQuoteRtCategory });
  const referenceDefault = referenceUrlFor(task);
  // RT만 증빙을 요구한다(RT 증빙 스펙 결정 3) — 투고·인용RT는 post_url이 증거다. 없으면 🔴(09-02, 그쪽이 받지 않는 요청은 만들지 않는다)
  const proofMissing = task.type === 'rt' && !task.proof;
  const r = assessReadiness({ inRoster: influencer.inRoster, method, category: categoryDefault, referenceUrl: referenceDefault, referenceRequired: referenceRequiredFor(task.type), removedAt: task.removedAt, removedReason: task.removedReason, clientId: campaign.clientId, proofMissing });
  return {
    taskId: task.id, campaignId: campaign.id, campaignName: campaign.name, clientId: campaign.clientId, clientName: campaign.clientName, campaignKind: campaign.kind,
    influencerHandle: task.influencerHandle, taskType: task.type, postedAt: task.postedAt, removedAt: task.removedAt, removedReason: task.removedReason, draftLabel: task.draftLabel,
    cost: task.cost, money, method, proof: task.proof,
    categoryDefault, deadlineDefault: defaultDeadline(i.today), referenceDefault,
    itemText: itemText(task.influencerHandle, task.type), purposeText: purposeText(campaign.clientName, campaign.kind, task.type),
    readiness: r.level, issues: r.issues,
  };
}

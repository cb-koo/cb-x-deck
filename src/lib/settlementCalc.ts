// 정산 계산(스펙 2026-08-28 §3) — 순수. 화면·확인 창·서버 저장이 같은 함수를 부른다(화면 3,158 / 저장 3,157 같은 일이 없게).
import type { Currency } from './influencerPricing.ts';
import { TASK_TYPE_LABEL, type TaskType, type CampaignKind } from './campaignJudgment.ts';
import type { TaskCost } from './campaignCost.ts';
import { PAYMENT_TYPE_LABEL, type PaymentMethod, type PaymentFee } from './influencerPayment.ts';
import { defaultCategoryFor, visibleCategories, CATEGORY_ID_FEE, CATEGORY_ID_INFO, type SettlementSettings } from './settlementSettings.ts';

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
export type IssueCode = 'no-influencer' | 'no-payment-method' | 'no-category' | 'no-reference' | 'removed' | 'paypay-no-identifier' | 'no-client';
export interface ReadinessIssue { level: 'warn' | 'blocked'; code: IssueCode; text: string }
// 클릭 전에 미리 보여준다(UX 원칙 ②) — createRequests의 거절 사유(settlementStore)와 문구를 맞춘다(042)
export const NO_CLIENT_TEXT = '캠페인에 클라이언트가 없어요 — 캠페인에서 클라이언트를 지정해 주세요';
const monthDay = (ymd: string) => `${Number(ymd.slice(5, 7))}-${Number(ymd.slice(8, 10))}`;
export function assessReadiness(i: { inRoster: boolean; method: PaymentMethod | null; category: string | null; referenceUrl: string | null; removedAt: string | null; removedReason: string; clientId: string | null }): { level: ReadinessLevel; issues: ReadinessIssue[] } {
  const issues: ReadinessIssue[] = [];
  if (!i.inRoster) issues.push({ level: 'blocked', code: 'no-influencer', text: '명부에 없는 인플루언서예요 — 명부에 추가하고 결제 수단을 등록해 주세요' });
  else if (!i.method) issues.push({ level: 'blocked', code: 'no-payment-method', text: '결제 수단이 없어요 — 프로필에서 등록해 주세요' });
  if (i.clientId === null) issues.push({ level: 'blocked', code: 'no-client', text: NO_CLIENT_TEXT });
  if (!i.category) issues.push({ level: 'blocked', code: 'no-category', text: '분류를 골라 주세요' });
  if (!i.referenceUrl) issues.push({ level: 'warn', code: 'no-reference', text: '참고 링크 없음' });
  if (i.removedAt) issues.push({ level: 'warn', code: 'removed', text: `게시 내려짐 ${monthDay(i.removedAt)}${i.removedReason ? ` · ${i.removedReason}` : ''}` });
  if (i.method?.type === 'paypay' && !i.method.identifier) issues.push({ level: 'warn', code: 'paypay-no-identifier', text: 'PayPay 수취 정보 미입력' });
  const level: ReadinessLevel = issues.some((x) => x.level === 'blocked') ? 'blocked' : issues.length ? 'warn' : 'ready';
  return { level, issues };
}

// ── 화면의 실제 신호등(§4) — 서버 값에 "사람이 지금 분류를 골랐는지"만 얹는다.
// 서버가 채워 보낸 no-category는 늘 버리고, 지금 edit.category가 비어 있으면 다시 얹는다 — 분류를 지우면
// 즉시 🔴로 떨어져야 한다(비웠는데도 🟢로 남아 체크 가능한 비대칭 버그, 08-28 리뷰).
export function effectiveIssues(c: SettlementCandidate, e: { category: string | null } | undefined): ReadinessIssue[] {
  const issues = c.issues.filter((i) => i.code !== 'no-category');
  if (!e?.category) issues.push({ level: 'blocked', code: 'no-category', text: '분류를 골라 주세요' });
  return issues;
}
export function effectiveReadiness(c: SettlementCandidate, e: { category: string | null } | undefined): ReadinessLevel {
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
  task: { id: string; type: TaskType; influencerHandle: string; cost: TaskCost; postUrl: string | null; targetTweetUrl: string | null; targetPostUrl: string | null; postedAt: string; removedAt: string | null; removedReason: string; draftLabel: string | null };
  campaign: { id: string; name: string; kind: CampaignKind | null; clientId: string | null; clientName: string };
  influencer: { inRoster: boolean; method: PaymentMethod | null };
  settings: SettlementSettings; lastQuoteRtCategory: string | null; today: string;
}
export interface SettlementCandidate {
  taskId: string; campaignId: string; campaignName: string; clientId: string | null; clientName: string; campaignKind: CampaignKind | null;
  influencerHandle: string; taskType: TaskType; postedAt: string; removedAt: string | null; removedReason: string; draftLabel: string | null;
  cost: TaskCost;   // 결제 수단이 없어 money가 null이어도 화면에 원가는 보여준다(§4-1 "막힌 행에도 금액")
  money: MoneyCalc | null; method: PaymentMethod | null;
  categoryDefault: string | null; deadlineDefault: string; referenceDefault: string | null; itemText: string; purposeText: string;
  readiness: ReadinessLevel; issues: ReadinessIssue[];
}
export function computeCandidate(i: CandidateInput): SettlementCandidate {
  const { task, campaign, influencer } = i;
  const method = influencer.method;
  const money = method ? computeMoney(task.cost, method.currency, method.fee, i.settings.rateKrwPerJpy) : null;
  const categoryDefault = defaultCategory({ type: task.type, campaignKind: campaign.kind, settings: i.settings, lastQuoteRtCategory: i.lastQuoteRtCategory });
  const referenceDefault = referenceUrlFor(task);
  const r = assessReadiness({ inRoster: influencer.inRoster, method, category: categoryDefault, referenceUrl: referenceDefault, removedAt: task.removedAt, removedReason: task.removedReason, clientId: campaign.clientId });
  return {
    taskId: task.id, campaignId: campaign.id, campaignName: campaign.name, clientId: campaign.clientId, clientName: campaign.clientName, campaignKind: campaign.kind,
    influencerHandle: task.influencerHandle, taskType: task.type, postedAt: task.postedAt, removedAt: task.removedAt, removedReason: task.removedReason, draftLabel: task.draftLabel,
    cost: task.cost, money, method,
    categoryDefault, deadlineDefault: defaultDeadline(i.today), referenceDefault,
    itemText: itemText(task.influencerHandle, task.type), purposeText: purposeText(campaign.clientName, campaign.kind, task.type),
    readiness: r.level, issues: r.issues,
  };
}

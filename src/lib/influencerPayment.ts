// 정산 결제 수단 — 유형·검증·연산(add/update/remove/setDefault)·표시 도우미. DB 접근 없음.
// influencerPricing.ts와 같은 문법: 검증은 실패 시 사용자 문구를 그대로 반환, 연산은 배열 전체를 새로 만든다.
import { type Currency, CURRENCY_LABEL, CURRENCY_SYMBOL, formatMoney } from './influencerPricing.ts';

export type PaymentMethodType = 'paypal' | 'paypay' | 'bank';

export const PAYMENT_TYPES: readonly PaymentMethodType[] = ['paypal', 'paypay', 'bank'];

export const PAYMENT_TYPE_LABEL: Record<PaymentMethodType, string> = {
  paypal: 'PayPal',
  paypay: 'PayPay',
  bank: '계좌이체',
};

// 타임라인 "결제 수단 수정 — {필드라벨} {from} → {to}"에서 쓰는 사전. type도 포함(유형 변경 diff용).
export const PAYMENT_FIELD_LABEL: Record<string, string> = {
  type: '유형',
  holder: '수취인명',
  currency: '통화',
  email: '이메일',
  paypalId: 'PayPal.me 아이디',
  identifier: '수취 식별 정보',
  qr: 'QR 이미지',
  bank: '은행',
  branch: '지점',
  account: '계좌번호',
  fee: '수수료 처리',
  memo: '메모',
};

export type PaymentFee =
  | { mode: 'grossUp'; percent: number } // CB 부담(비율) — 총액 = 순액 ÷ (1 - percent/100), 인플이 순액을 그대로 받는다
  | { mode: 'fixed'; amount: number };   // CB 부담(고정액) — 총액 = 순액 + amount(통화는 수단 통화)

export interface PaymentMethod {
  id: string;
  type: PaymentMethodType;
  isDefault: boolean;         // 배열이 비어 있지 않으면 정확히 1개가 true
  holder: string;              // 수취인명/예금주
  currency: Currency;          // paypay는 JPY 고정
  email?: string;               // paypal: email 또는 paypalId 중 하나 필수
  paypalId?: string;            // PayPal.me 아이디(paypal.me/<id>) — 이메일 대신 아이디로 받는 인플이 있다
  identifier?: string;          // paypay 수취 식별 정보 — 선택(미확정)
  qr?: string;                  // paypay QR 이미지의 저장소 경로 — 선택. 절대 URL이 아니다(059)
  bank?: string;
  branch?: string;
  account?: string;
  fee?: PaymentFee;             // 부재 = 수수료 없음
  memo?: string;
  updatedAt: string;            // ISO
}

export type PaymentMethodInput = Omit<PaymentMethod, 'id' | 'isDefault' | 'updatedAt'>;

export type PaymentOp =
  | { kind: 'add'; input: PaymentMethodInput; makeDefault?: boolean }
  | { kind: 'update'; id: string; input: PaymentMethodInput }
  | { kind: 'remove'; id: string }
  | { kind: 'setDefault'; id: string };

export interface PaymentMethodChange {
  action: 'added' | 'updated' | 'removed' | 'default_changed';
  type: PaymentMethodType;
  label: string; // describeMethod(m)
  fields?: Array<{ field: string; from: string | null; to: string | null }>; // updated일 때만
}

// 라우트가 404로 매핑하는 문구 — update/remove/setDefault에서 모르는 id에 던진다.
export const PAYMENT_NOT_FOUND = '결제 수단을 찾을 수 없어요 — 화면을 새로고침해 주세요';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PAYPAL_ID_RE = /^[A-Za-z0-9._-]{3,50}$/;

function trimmedString(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

// 입력 검증 — 통과하면 정규화된 입력(유형에 없는 필드는 버림), 실패하면 사용자에게 보일 오류 문구.
export function parsePaymentMethodInput(v: unknown): PaymentMethodInput | string {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return '입력을 확인해 주세요';
  const obj = v as Record<string, unknown>;

  const type = obj.type;
  if (type !== 'paypal' && type !== 'paypay' && type !== 'bank') return '결제 수단 유형을 선택해 주세요';

  const holder = trimmedString(obj.holder);
  if (holder.length < 1 || holder.length > 80) return '수취인명을 입력해 주세요';

  let currency: Currency;
  if (type === 'paypay') {
    currency = 'JPY'; // paypay는 무엇이 오든 JPY 고정
  } else {
    if (obj.currency !== 'KRW' && obj.currency !== 'JPY') return '통화를 선택해 주세요';
    currency = obj.currency;
  }

  const out: PaymentMethodInput = { type, holder, currency };

  if (type === 'paypal') {
    // 이메일과 PayPal.me 아이디 중 하나만 있어도 보낼 수 있다 — 둘 다 없으면 못 보낸다.
    const email = trimmedString(obj.email);
    const paypalId = trimmedString(obj.paypalId).replace(/^@/, '').replace(/^(https?:\/\/)?(www\.)?paypal\.me\//i, '');
    if (!email && !paypalId) return '이메일 또는 PayPal.me 아이디를 입력해 주세요';
    if (email) {
      if (!EMAIL_RE.test(email)) return '이메일 형식을 확인해 주세요';
      out.email = email;
    }
    if (paypalId) {
      if (!PAYPAL_ID_RE.test(paypalId)) return 'PayPal.me 아이디는 영문·숫자·._- 3~50자예요';
      out.paypalId = paypalId;
    }
  } else if (type === 'paypay') {
    const identifier = trimmedString(obj.identifier);
    if (identifier) out.identifier = identifier;   // 선택
    const qr = trimmedString(obj.qr);
    if (qr) out.qr = qr;                            // 선택 — 식별 정보와 둘 다 없어도 된다(koo 결정 1)
  } else {
    const bank = trimmedString(obj.bank);
    const account = trimmedString(obj.account);
    if (!bank || !account) return '은행과 계좌번호를 입력해 주세요';
    out.bank = bank;
    out.account = account;
    const branch = trimmedString(obj.branch);
    if (branch) out.branch = branch; // 선택
  }

  if (obj.fee !== undefined && obj.fee !== null) {
    if (typeof obj.fee !== 'object' || Array.isArray(obj.fee)) return '수수료 처리 방식이 올바르지 않아요';
    const feeObj = obj.fee as Record<string, unknown>;
    if (feeObj.mode === 'grossUp') {
      const percent = feeObj.percent;
      if (typeof percent !== 'number' || !Number.isFinite(percent) || !(percent > 0 && percent < 100)) {
        return '수수료 비율은 0보다 크고 100보다 작아야 해요';
      }
      out.fee = { mode: 'grossUp', percent };
    } else if (feeObj.mode === 'fixed') {
      const amount = feeObj.amount;
      if (typeof amount !== 'number' || !Number.isInteger(amount) || amount < 0) {
        return '금액은 0 이상 정수예요';
      }
      out.fee = { mode: 'fixed', amount };
    } else {
      return '수수료 처리 방식이 올바르지 않아요';
    }
  }

  if (obj.memo !== undefined && obj.memo !== null) {
    const memo = trimmedString(obj.memo);
    if (memo.length > 200) return '메모는 200자 이내로 적어 주세요';
    if (memo) out.memo = memo;
  }

  return out;
}

// 유형별 짧은 식별 표시 — 타임라인·목록 라벨에 그대로 쓴다.
export function describeMethod(m: PaymentMethod | PaymentMethodInput): string {
  const identifying = m.type === 'bank' ? [m.bank, m.account].filter(Boolean).join(' ') : m.holder;
  return `${PAYMENT_TYPE_LABEL[m.type]} · ${identifying}`;
}

export function formatFee(fee: PaymentFee | undefined, currency: Currency): string | null {
  if (!fee) return null;
  // 폼 옵션명(인플 부담 / CB 부담 (비율) / CB 부담 (고정액))과 같은 말 — 카드·타임라인이 다른 말을 쓰면 같은 값인지 헷갈린다
  if (fee.mode === 'grossUp') return `송금 수수료 CB 부담 · ${fee.percent}%`;
  return `송금 수수료 CB 부담 · ${formatMoney(fee.amount, currency)}`;
}

// 작업 패널 수수료 칩 — formatFee와 같은 말에서 '송금 수수료 '만 뺀 짧은 판(§8-1). cb=true면 화면이 주황으로.
export function feeShortLabel(fee: PaymentFee | null | undefined, currency: Currency): { text: string; cb: boolean } {
  const long = formatFee(fee ?? undefined, currency);
  if (!long) return { text: '인플 부담', cb: false };
  return { text: long.replace(/^송금 수수료 /, '').replace(' · ', ' '), cb: true };
}

export function getDefaultPaymentMethod(list: PaymentMethod[]): PaymentMethod | null {
  return list.find((m) => m.isDefault) ?? null;
}

// 이 작업에 쓸 결제 수단(설계 §8-2) — 작업이 고른 id가 지금 목록에 있으면 그것, 없으면(null이거나 그 사이 지워짐) 기본 수단.
// 정산 후보·제자리 수정(reviseRequest)·캠페인 수수료 합계·작업 패널 표시가 이 하나를 쓴다 — 판정을 두 벌로 두지 않는다.
// 제네릭인 이유: 패널은 계좌번호를 뺀 요약(PaymentChoice, paymentChoice.ts)에 같은 규칙을 적용한다.
export function taskPaymentMethod<T extends { id: string; isDefault: boolean }>(list: T[], chosenId: string | null | undefined): T | null {
  if (chosenId) {
    const hit = list.find((m) => m.id === chosenId);
    if (hit) return hit;
  }
  return list.find((m) => m.isDefault) ?? null;
}

// 명부 목록 배지 문구 — InfluencerRow.settlement(기본 결제 수단의 통화·수수료만)에서 파생.
// 계좌·이메일 등은 settlement에 애초에 없으니 여기서도 다룰 일이 없다(스펙 §5-4).
export function settlementBadge(
  s: { currency: Currency; fee: PaymentFee | null } | null,
): { label: string; muted: boolean } {
  if (!s) return { label: '정산 조건 없음', muted: true };
  const base = `${CURRENCY_SYMBOL[s.currency]} ${CURRENCY_LABEL[s.currency]}화`;
  if (!s.fee) return { label: `${base} · 인플 부담`, muted: false };
  if (s.fee.mode === 'grossUp') return { label: `${base} · CB ${s.fee.percent}%`, muted: false };
  return { label: `${base} · CB ${formatMoney(s.fee.amount, s.currency)}`, muted: false };
}

// updated 로그의 fields — 실제로 바뀐 항목만, 사람이 읽을 문자열로. fee는 formatFee 문구로 비교(pricing 관례 — 값 그대로 비교 대신 표시 문구 비교로 통일).
const DIFF_FIELDS = ['type', 'holder', 'currency', 'email', 'paypalId', 'identifier', 'qr', 'bank', 'branch', 'account', 'fee', 'memo'] as const;

function displayValue(field: (typeof DIFF_FIELDS)[number], m: PaymentMethodInput): string | null {
  switch (field) {
    case 'type': return PAYMENT_TYPE_LABEL[m.type];
    case 'holder': return m.holder ?? null;
    case 'currency': return m.currency ?? null;
    case 'email': return m.email ?? null;
    case 'paypalId': return m.paypalId ?? null;
    case 'identifier': return m.identifier ?? null;
    case 'qr': return m.qr ?? null;
    case 'bank': return m.bank ?? null;
    case 'branch': return m.branch ?? null;
    case 'account': return m.account ?? null;
    case 'fee': return formatFee(m.fee, m.currency);
    case 'memo': return m.memo ?? null;
    default: return null;
  }
}

function diffFields(before: PaymentMethodInput, after: PaymentMethodInput) {
  const fields: Array<{ field: string; from: string | null; to: string | null }> = [];
  for (const f of DIFF_FIELDS) {
    const from = displayValue(f, before);
    const to = displayValue(f, after);
    if (from !== to) fields.push({ field: f, from, to });
  }
  return fields;
}

function addOp(
  list: PaymentMethod[],
  input: PaymentMethodInput,
  makeDefault: boolean | undefined,
  now: string,
  newId: () => string,
): { list: PaymentMethod[]; changes: PaymentMethodChange[] } {
  const isFirst = list.length === 0;
  const method: PaymentMethod = { ...input, id: newId(), isDefault: isFirst || !!makeDefault, updatedAt: now };
  const addedChange: PaymentMethodChange = { action: 'added', type: method.type, label: describeMethod(method) };

  if (isFirst) {
    return { list: [method], changes: [addedChange] }; // 첫 수단은 무조건 기본
  }
  if (makeDefault) {
    const cleared = list.map((m) => (m.isDefault ? { ...m, isDefault: false } : m));
    const defaultChange: PaymentMethodChange = { action: 'default_changed', type: method.type, label: describeMethod(method) };
    return { list: [...cleared, method], changes: [addedChange, defaultChange] };
  }
  return { list: [...list, method], changes: [addedChange] };
}

function updateOp(
  list: PaymentMethod[],
  id: string,
  input: PaymentMethodInput,
  now: string,
): { list: PaymentMethod[]; changes: PaymentMethodChange[] } {
  const idx = list.findIndex((m) => m.id === id);
  if (idx === -1) throw new Error(PAYMENT_NOT_FOUND);
  const before = list[idx];
  const fields = diffFields(before, input);
  if (fields.length === 0) return { list, changes: [] }; // 실제로 바뀐 게 없으면 변경 0건(불필요한 로그 방지)

  const updated: PaymentMethod = { ...input, id: before.id, isDefault: before.isDefault, updatedAt: now };
  const newList = list.slice();
  newList[idx] = updated;
  const change: PaymentMethodChange = { action: 'updated', type: updated.type, label: describeMethod(updated), fields };
  return { list: newList, changes: [change] };
}

function removeOp(list: PaymentMethod[], id: string): { list: PaymentMethod[]; changes: PaymentMethodChange[] } {
  const idx = list.findIndex((m) => m.id === id);
  if (idx === -1) throw new Error(PAYMENT_NOT_FOUND);
  const removed = list[idx];
  const newList = list.filter((m) => m.id !== id);
  const changes: PaymentMethodChange[] = [{ action: 'removed', type: removed.type, label: describeMethod(removed) }];

  if (removed.isDefault && newList.length > 0) {
    newList[0] = { ...newList[0], isDefault: true }; // 남은 것 중 첫 번째(배열 순서)가 기본이 된다
    changes.push({ action: 'default_changed', type: newList[0].type, label: describeMethod(newList[0]) });
  }
  return { list: newList, changes };
}

function setDefaultOp(list: PaymentMethod[], id: string): { list: PaymentMethod[]; changes: PaymentMethodChange[] } {
  const idx = list.findIndex((m) => m.id === id);
  if (idx === -1) throw new Error(PAYMENT_NOT_FOUND);
  if (list[idx].isDefault) return { list, changes: [] }; // 이미 기본이면 변경 0건

  const newList = list.map((m, i) => (i === idx ? { ...m, isDefault: true } : m.isDefault ? { ...m, isDefault: false } : m));
  const changes: PaymentMethodChange[] = [{ action: 'default_changed', type: newList[idx].type, label: describeMethod(newList[idx]) }];
  return { list: newList, changes };
}

function assertDefaultInvariant(list: PaymentMethod[]): void {
  if (list.length === 0) return;
  const defaults = list.filter((m) => m.isDefault).length;
  if (defaults !== 1) throw new Error(`결제 수단 기본값 불변식 위반 — 기본 ${defaults}개 (버그)`);
}

export function applyPaymentOp(
  list: PaymentMethod[],
  op: PaymentOp,
  now: string,
  newId: () => string,
): { list: PaymentMethod[]; changes: PaymentMethodChange[] } {
  let result: { list: PaymentMethod[]; changes: PaymentMethodChange[] };
  switch (op.kind) {
    case 'add': result = addOp(list, op.input, op.makeDefault, now, newId); break;
    case 'update': result = updateOp(list, op.id, op.input, now); break;
    case 'remove': result = removeOp(list, op.id); break;
    case 'setDefault': result = setDefaultOp(list, op.id); break;
  }
  assertDefaultInvariant(result.list);
  return result;
}

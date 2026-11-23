'use client';
import { useEffect, useRef, useState } from 'react';
import type { InfluencerOption } from '@/lib/draftTypes';
import type { TaskType } from '@/lib/campaignJudgment';
import {
  CURRENCIES, CURRENCY_LABEL, AMOUNT_MESSAGE, parseAmount, formatAmount, suggestTaskCost,
  type TaskCost, type Currency,
} from '@/lib/campaignCost';
import { costConfirmScenario, profilePromptFor } from '@/lib/campaignFlowView';
import { Button } from '@/components/ui';
import { COST_REASON_MAX } from '@/lib/campaignTaskInput';
import { ZERO_COST_HINT } from '@/lib/costAtPost';
import { PriceProfileDialog } from './PriceProfileDialog';

// 비용 칸(b-task-8-brief.md, koo 결정 + 11-23 시안 A ②) — 배정된 인플루언서의 단가로 칸을 채워도 그건 제안일 뿐이다.
// 저장되는 길은 둘이다(koo 11-23: [확인]을 깜빡해 비용이 빈 채 게시되던 문제):
//  · 사람이 직접 적은 금액 — 칸을 벗어나거나 Enter를 치면 저장된다(메모 칸과 같은 방식). 저장 뒤 [되돌리기]로 직전 값으로.
//  · 손대지 않은 프로필 단가 — 칸을 벗어나는 것만으로 저장하지 않는다(아무도 안 본 값이 예산이 되면 안 된다, R24).
//    주황 '저장 전' 표시와 [N엔으로 저장] 버튼을 눌러야 저장된다.
//  · 지급이 끝난 작업(reasonRequired) — 지금처럼 사유를 적고 [확인]을 눌러야 저장된다(자동 저장 없음).
// 저장(=onSave 성공)이 곧 확정이다 — 확정 여부는 별도 플래그가 아니라 "저장됐는가"
// 그 자체다(값이 곧 상태). 그래서 이 컴포넌트는 내부에 "확정됨" 상태를 따로 들고 있지 않는다: 지금 입력과
// value(부모가 들고 있는 저장된 값 — edit는 task.cost, new는 패널의 로컬 상태)가 같으면 그게 확정이다.
// 확정 뒤 프로필과 다르거나(differs) 프로필에 단가가 없으면(no-profile) "프로필도 바꿀까요"를 그 다음에 묻는다 —
// 이 작업의 저장 자체는 그 답과 무관하게 이미 끝나 있다(질문에 답하지 않고 닫아도 이 작업 비용은 남는다).
// 통화가 다르면(currency-mismatch) 아예 묻지 않는다 — 단위가 다른 값을 프로필에 덮어쓰는 건 위험하다(koo 결정).
// mode='draft'(새 작업, 설계 §8) — [확인]이 없다: 보이는 값이 곧 [만들기]에 실릴 값이라 입력할 때마다
// onDraftChange로 부모에 올리고, 프로필 반영 질문은 만든 뒤 부모(FlowDetail)가 한 번 묻는다.
export function CostConfirmField({
  value, option, type, label, onSave, onUndo, onSaveProfile, disabledReason, mode = 'confirm', onDraftChange, error: externalError, reasonRequired = false,
}: {
  value: TaskCost | null;                 // 저장된(=확정된) 값 — edit: task.cost, new: 패널 로컬 상태
  option: InfluencerOption | undefined;   // 배정된 인플루언서(명부에 있을 때만 id가 있다)
  type: TaskType;
  label: string;                          // '비용' | '예산' — 칸 위 라벨은 부모가 그리므로 여기선 접근성 라벨로만 쓴다
  onSave: (cost: TaskCost, reason?: string) => Promise<boolean>;   // reason — 지급 완료 작업의 '바꾸는 이유'(스펙 2026-10-07 §6)
  onUndo?: (prev: TaskCost | null) => Promise<boolean>;            // 방금 저장한 값을 직전 값(없었으면 null)으로 — 없으면 [되돌리기]를 그리지 않는다
  onSaveProfile: (option: InfluencerOption, cost: TaskCost) => Promise<boolean>;
  disabledReason?: string;                // 있으면 칸을 비활성으로 그리고 이 문구를 보여준다(인플 미정 등). ''이면 문구 없이 비활성만 —
                                          // 이유를 칸 밖(비용 · 정산 상자의 결제 수단 줄)에서 한 번만 말할 때(설계 §10)
  mode?: 'confirm' | 'draft';
  onDraftChange?: (v: TaskCost | null | 'invalid') => void;   // draft 모드만 — 빈 칸 null, 못 읽는 값 'invalid'
  error?: string | null;                  // 부모가 정한 오류(draft 모드의 [만들기] 때 'invalid')
  reasonRequired?: boolean;               // 지급이 끝난 정산 요청이 붙은 작업 — 금액을 바꾸려면 사유를 적어야 저장(서버도 400)
}) {
  const profile = suggestTaskCost(option?.pricing, type);
  const [amount, setAmount] = useState(() => String(value?.amount ?? profile?.amount ?? ''));
  // 기본 통화는 엔(koo 09-28) — 저장된 값 → 프로필 단가의 통화 → 엔 순. 프로필의 '통화 없음 = 원' 규칙(normalizeCurrency)은
  // 저장된 단가의 뜻이라 바꾸지 않는다 — 여기는 둘 다 없을 때 처음 보이는 선택만이다.
  const [currency, setCurrency] = useState<Currency>(() => value?.currency ?? profile?.currency ?? 'JPY');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');   // '✓ 확정' 옆 한 줄 — 프로필 갱신 결과·명부 밖 사유·통화 불일치 사유
  const [dialog, setDialog] = useState<{ scenario: 'differs' | 'no-profile'; entered: TaskCost } | null>(null);
  const [reason, setReason] = useState('');   // 바꾸는 이유 — reasonRequired일 때만 쓴다
  const [touched, setTouched] = useState(false);   // 사람이 칸을 고쳤나 — 손대지 않은 프로필 단가는 칸을 벗어나도 저장하지 않는다
  // 저장이 오가는 동안 사람이 또 고친 값을 잃지 않게(리뷰 11-23: 금액 저장 중 통화를 바꾸면 화면은 원, DB는 엔으로 남았다) —
  // 지금 칸의 글자·통화와 저장 진행 여부를 ref로 들고, 저장이 끝나면 그 사이 달라진 값을 한 번 더 저장한다. 핸들러에서만 읽고 쓴다.
  const latestRef = useRef<{ amount: string; currency: Currency }>({ amount: '', currency: 'JPY' });
  const savingRef = useRef(false);
  const [undo, setUndo] = useState<{ prev: TaskCost | null } | null>(null);   // 방금 저장한 값의 직전 값 — 다시 고치면 사라진다
  // 저장된 값(value)이 밖에서 바뀌면(게시 확인 상자에서 함께 저장·'비용 없음' 해제 등) 손대지 않은 칸은 그 값을 따라간다 —
  // 안 그러면 칸에 옛 프로필 단가가 남아 Enter 한 번에 진짜 값을 덮는다(리뷰 11-23). 고치는 중·저장 중인 칸은 건드리지 않는다.
  const valueKey = value ? `${value.amount}:${value.currency}` : '';
  const [seenValueKey, setSeenValueKey] = useState(valueKey);
  if (valueKey !== seenValueKey) {
    setSeenValueKey(valueKey);
    if (mode === 'confirm' && !touched && !busy) {   // 새 작업 폼(draft)은 부모 값이 곧 이 칸의 메아리라 따라가지 않는다
      setAmount(String(value?.amount ?? profile?.amount ?? ''));
      setCurrency(value?.currency ?? profile?.currency ?? 'JPY');
      setUndo(null); setNote(''); setErr(null);
    }
  }
  const reasonRef = useRef<HTMLInputElement>(null);   // 사유가 비었는데 확인을 누르면 문구를 또 띄우지 않고 이 칸으로 보낸다

  // draft 모드에서 지금 보이는 값을 부모에 올린다 — 이펙트에서 setState하지 않으려고 핸들러와 마운트 때 부른다.
  const report = (a: string, c: Currency) => {
    if (mode !== 'draft' || !onDraftChange || disabledReason !== undefined) return;
    if (a.trim() === '') { onDraftChange(null); return; }
    const n = parseAmount(a);
    onDraftChange(n === null ? 'invalid' : { amount: n, currency: c });
  };
  // 마운트 때 초기값(프로필 단가)을 한 번 올린다 — 부모 콜백 호출일 뿐 이 컴포넌트의 setState가 아니다.
  // 부모는 key(핸들·옵션 도착)로 다시 마운트해 새 초기값을 받는다.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- 마운트 때 초기값을 한 번 올린다
  useEffect(() => { report(amount, currency); }, []);

  if (disabledReason !== undefined) {
    // I4 — 저장된 비용(value)이 있으면 빈 점선 상자로 지우지 않는다: 표는 값을 보여주는데 패널만 빈칸이면
    // 같은 화면이 두 말을 하는 셈이다(예: 미배정으로 돌아간 작업도 확정된 비용은 남아 있을 수 있다).
    return (
      <div>
        {value ? (
          <p className="flex h-10 items-center text-content tabular-nums">{formatAmount(value.amount, value.currency)}</p>
        ) : (
          <input disabled placeholder="¥" aria-label={label}
                 className="h-10 w-full rounded-md border border-dashed border-x-border-strong bg-x-surface px-3 text-content text-x-muted" />
        )}
        {disabledReason && <p className="mt-1 text-ui text-x-muted">{disabledReason}</p>}
      </div>
    );
  }

  const parsed = parseAmount(amount);
  const entered: TaskCost | null = parsed === null ? null : { amount: parsed, currency };
  // 저장된 값과 지금 입력이 같은가 — 같으면 이미 확정된 상태다(별도 플래그 없이 값 자체가 상태를 말한다)
  const saved = value !== null && entered !== null && value.amount === entered.amount && value.currency === entered.currency;
  const scenario = costConfirmScenario({ profile, entered });
  // 손대지 않은 프로필 단가가 칸에 보이는 상태 — 저장 전(확인 전). 버튼으로만 저장한다
  const suggestionPending = mode === 'confirm' && !saved && !touched && entered !== null && value === null;

  // next — 통화를 바꾼 직후처럼 state가 아직 반영되기 전의 값을 저장할 때 넘긴다
  async function confirm(next: TaskCost | null = entered) {
    if (savingRef.current) return;    // 연타로 같은 PATCH가 두 번 나가지 않게 — 그 사이 달라진 값은 저장이 끝난 뒤 아래에서 다시 저장한다
    if (next !== null && value !== null && value.amount === next.amount && value.currency === next.currency) return;   // 이미 저장된 값 그대로
    if (next === null) { setErr(AMOUNT_MESSAGE); return; }
    if (reasonRequired && !reason.trim()) { reasonRef.current?.focus(); return; }
    const cost = next;
    const prev = value;
    setErr(null);
    setBusy(true);
    savingRef.current = true;
    latestRef.current = { amount: String(cost.amount), currency: cost.currency };   // 저장을 시작한 순간의 칸 — 이 뒤로 고치면 핸들러가 덮어쓴다
    const ok = await onSave(cost, reasonRequired ? reason.trim() : undefined);
    savingRef.current = false;
    setBusy(false);
    // 저장 실패 — 값은 그대로 미확정. 부모가 서버 문구를 토스트로 알리지만, 칸을 이미 벗어난 뒤라 칸 아래에도 남긴다(Enter로 다시 저장)
    if (!ok) { setErr('저장되지 않았어요. 칸에서 Enter를 눌러 다시 저장해 주세요.'); return; }
    setNote('');
    setReason('');
    setUndo(reasonRequired ? null : { prev });   // 지급 완료 작업은 사유가 이력에 남는 변경이라 한 번에 되돌리지 않는다
    // 저장하는 동안 칸이 또 바뀌었나 — 바뀌었으면 '고치는 중'을 유지하고 지금 값을 이어서 저장한다(읽을 수 없는 값이면 저장하지 않고 알린다)
    const now = latestRef.current;
    const nowAmount = parseAmount(now.amount);
    if (!reasonRequired && (nowAmount !== cost.amount || now.currency !== cost.currency)) {
      if (nowAmount === null) { if (now.amount.trim() !== '') setErr(`${AMOUNT_MESSAGE} 저장되지 않았어요.`); return; }
      // prev는 이 함수가 처음 본 저장값이 아니라 방금 저장한 값이 된다 — [되돌리기]는 한 단계만 되돌린다
      void confirmAfter({ amount: nowAmount, currency: now.currency }, cost);
      return;
    }
    setTouched(false);
    if (type === 'other') return;   // 기타 협찬은 프로필 단가가 없다 — 프로필 이야기를 꺼내지 않는다
    // 저장한 값(cost)으로 다시 판정한다 — 통화를 바꾼 직후엔 렌더 때 계산한 scenario가 옛 통화 기준이다
    const sc = costConfirmScenario({ profile, entered: cost });
    if (sc === 'currency-mismatch') { setNote(' · 통화가 달라 프로필엔 반영 안 돼요'); return; }
    if (sc !== 'differs' && sc !== 'no-profile') return;   // same이면 물을 게 없다
    if (!option?.id) { setNote(' · 명부에 없는 인플루언서라 프로필엔 저장 못 해요'); return; }
    // 물을지 말지는 profilePromptFor 하나로(새 작업의 [만들기] 뒤와 같은 판정) — 여기까지 왔는데 null이면
    // no-profile인데 프로필에 이미 다른 통화 단가가 있는 경우뿐이다(프로필 통화는 하나라 덮어쓰지 않는다).
    const prompt = profilePromptFor({ option, type, cost });
    if (!prompt) { setNote(' · 통화가 달라 프로필엔 반영 안 돼요'); return; }
    setDialog({ scenario: prompt.scenario, entered: cost });
  }

  // 저장 중에 바뀐 값을 이어서 저장 — confirm과 같은 일을 하되 '직전 값'을 인자로 받는다(이 렌더의 value는 아직 옛 값이다)
  async function confirmAfter(cost: TaskCost, prev: TaskCost) {
    if (savingRef.current) return;
    setBusy(true);
    savingRef.current = true;
    latestRef.current = { amount: String(cost.amount), currency: cost.currency };
    const ok = await onSave(cost);
    savingRef.current = false;
    setBusy(false);
    if (!ok) { setErr('저장되지 않았어요. 칸에서 Enter를 눌러 다시 저장해 주세요.'); return; }
    setUndo({ prev });
    const now = latestRef.current;
    const nowAmount = parseAmount(now.amount);
    if (nowAmount !== null && (nowAmount !== cost.amount || now.currency !== cost.currency)) { void confirmAfter({ amount: nowAmount, currency: now.currency }, cost); return; }
    if (nowAmount === null && now.amount.trim() !== '') { setErr(`${AMOUNT_MESSAGE} 저장되지 않았어요.`); return; }
    setTouched(false);
  }

  // 칸을 벗어남 — 직접 적은 금액만 저장한다. 손대지 않은 제안값·지급 완료 작업(사유 필수)은 버튼으로만.
  function onBlurSave() {
    if (mode !== 'confirm' || !touched || reasonRequired || savingRef.current) return;   // 저장 중이면 끝난 뒤 이어서 저장된다(confirm)
    if (amount.trim() === '') {
      // 비운 채 벗어남 — 저장된 금액이 있으면 그 값으로 돌려놓는다(금액을 비우는 길은 '비용 없음'이다)
      if (value) { setAmount(String(value.amount)); setCurrency(value.currency); setNote(" · 금액은 비울 수 없어요. 돈이 나가지 않으면 '비용 없음'을 골라 주세요"); }
      setTouched(false);
      return;
    }
    if (entered === null) { setErr(`${AMOUNT_MESSAGE} 저장되지 않았어요.`); return; }
    void confirm();
  }
  async function undoSave() {
    if (!undo || !onUndo || busy) return;
    const prev = undo.prev;
    setBusy(true);
    const ok = await onUndo(prev);
    setBusy(false);
    if (!ok) return;
    setUndo(null); setNote(''); setTouched(false);
    // 직전에 저장된 값이 없었으면 제안(프로필 단가) 상태로 돌아간다
    setAmount(String(prev?.amount ?? profile?.amount ?? ''));
    setCurrency(prev?.currency ?? profile?.currency ?? 'JPY');
  }

  async function answerDialog(toProfile: boolean) {
    if (toProfile && dialog && option) {
      const ok = await onSaveProfile(option, dialog.entered);
      setNote(ok ? ' · 프로필 단가 갱신됨' : ' · 이 작업 비용은 저장됐어요 — 프로필 반영만 실패했어요');
    }
    setDialog(null);
  }

  let statusText: string;
  let amber = false;
  if (mode === 'draft') {
    // 새 작업(§10) — [확인]이 없다. 프로필 단가 그대로면 출처만, 사람이 금액을 고쳤으면 "어디서 저장되나"만 말한다
    // (koo 09-24: 금액을 넣어도 [확인]이 안 보여 저장되는지 헷갈렸다). 프로필과 다르면 만든 뒤 한 번 묻는다(Task 7).
    statusText = entered === null ? (amount.trim() === '' && !profile ? '프로필에 단가 없음' : '')
      : scenario === 'same' ? '프로필 단가'
      : '만들기를 누르면 저장돼요';
  } else if (saved) {
    // 확정된 값이라도 "지금 배정된 인플루언서"의 프로필 단가와 다르면 그 사실을 덧붙인다 — 교체·재배정 뒤
    // 앞사람 기준 금액이 그대로 남아 있어도 화면이 '✓ 확정'만 보여줘 조용히 틀린 값이 되는 문제(Task 8 리뷰
    // Minor)를 막는다. profile은 이미 "지금" 배정된 인플의 단가(위 option prop이 그 인플이다).
    if (profile && (scenario === 'differs' || scenario === 'currency-mismatch')) {
      const diff = scenario === 'currency-mismatch'
        ? `프로필 단가는 ${CURRENCY_LABEL[profile.currency]}로 적혀 있어요`
        : `프로필 ${formatAmount(profile.amount, profile.currency)}`;   // §10 — '다름'은 주황색이 말한다
      statusText = `✓ 저장됨 · ${diff}${note}`;
      amber = true;
    } else {
      statusText = `✓ 저장됨${note}`;
    }
  } else if (busy) {
    statusText = '저장 중…';
  } else if (entered === null) {
    statusText = amount.trim() !== '' ? '' : profile ? `금액을 넣어 주세요${note}` : `프로필에 단가가 없어요. 금액을 직접 적어 주세요${note}`;
  } else if (suggestionPending) {
    // 손대지 않은 프로필 단가 — 저장된 것처럼 보이지 않게 주황으로 말한다(시안 A ② 상태 1)
    statusText = '프로필 단가예요. 아직 이 작업 비용으로 저장되지 않았어요.';
    amber = true;
  } else if (!reasonRequired) {
    statusText = '칸을 벗어나면 저장돼요';
  } else if (scenario === 'same') {
    statusText = '프로필 단가';
  } else if (scenario === 'differs' && profile) {
    statusText = `프로필 ${formatAmount(profile.amount, profile.currency)}`;   // 확정 뒤 문구(위)와 같은 말
    amber = true;
  } else if (scenario === 'no-profile') {
    statusText = '프로필에 단가 없음';
  } else if (scenario === 'currency-mismatch' && profile) {
    statusText = `프로필 단가는 ${CURRENCY_LABEL[profile.currency]}로 적혀 있어요 — 이 작업만 저장돼요`;
  } else {
    statusText = '';
  }

  return (
    <div>
      <div className="flex items-center gap-2">
        <input inputMode="numeric" aria-label={label} value={amount}
               onChange={(e) => { latestRef.current = { amount: e.target.value, currency }; setAmount(e.target.value); setErr(null); setTouched(true); setUndo(null); setNote(''); report(e.target.value, currency); }}
               onBlur={onBlurSave}
               onKeyDown={(e) => { if (mode === 'confirm' && e.key === 'Enter' && !e.nativeEvent.isComposing) void confirm(); }}
               placeholder={mode === 'confirm' ? '금액' : '0'}
               className={`h-10 min-w-0 flex-1 rounded-md border px-3 text-content tabular-nums outline-none focus:border-x-blue ${
                 saved || mode === 'draft' || touched ? 'border-x-border-strong'
                   : suggestionPending ? 'border-dashed border-amber-500 text-amber-800' : 'border-dashed border-x-border-strong text-x-secondary'}`} />
        <select value={currency} aria-label={`${label} 통화`}
                onChange={(e) => {
                  const next = e.target.value as Currency; latestRef.current = { amount, currency: next }; setCurrency(next); setErr(null); setUndo(null); report(amount, next);
                  // 통화만 바꾼 것도 직접 고친 것이다 — 금액이 읽히면 바로 저장한다(고를 뿐 벗어나는 동작이 없다). 지급 완료 작업은 [확인]으로만
                  if (mode === 'confirm') { setTouched(true); if (!reasonRequired && parsed !== null) void confirm({ amount: parsed, currency: next }); }
                }}
                className="h-10 rounded-md border border-x-border-strong bg-white px-2 text-content outline-none focus:border-x-blue">
          {CURRENCIES.map((c) => <option key={c} value={c}>{CURRENCY_LABEL[c]}</option>)}
        </select>
        {/* 버튼은 두 경우에만 — 손대지 않은 프로필 단가([N엔으로 저장], 무엇이 저장되는지 금액으로 말한다)와 지급 완료 작업([확인] + 사유) */}
        {suggestionPending && !reasonRequired && entered && (
          <Button variant="primary" onClick={() => void confirm()} disabled={busy} className="h-10 shrink-0 whitespace-nowrap px-3.5 text-ui">
            {busy ? '저장 중…' : `${formatAmount(entered.amount, entered.currency)}으로 저장`}
          </Button>
        )}
        {mode === 'confirm' && !saved && reasonRequired && (
          <Button onClick={() => void confirm()} disabled={parsed === null || busy || !reason.trim()} className="h-10 px-3.5 text-ui">
            {busy ? '확인 중…' : '확인'}
          </Button>
        )}
      </div>
      {reasonRequired && mode === 'confirm' && !saved && entered !== null && (
        <div className="mt-1.5">
          <p className="text-[14px] text-amber-700">지급이 끝난 작업이라 사유를 적어야 저장돼요</p>
          <label className="mt-1.5 block text-[14px] text-x-secondary">바꾸는 이유
            <input ref={reasonRef} value={reason} maxLength={COST_REASON_MAX}
                   onChange={(e) => { setReason(e.target.value); setErr(null); }}
                   onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) void confirm(); }}
                   className="mt-1 h-10 w-full rounded-md border border-x-border-strong px-3 text-content outline-none focus:border-x-blue" />
          </label>
        </div>
      )}
      {(err ?? externalError) && <p role="alert" className="mt-1 text-[14px] text-red-600">{err ?? externalError}</p>}
      {statusText && (
        <p className={`mt-1 text-[14px] ${amber ? 'text-amber-700' : 'text-x-muted'}`}>
          {statusText}
          {saved && undo && onUndo && !busy && (
            <button type="button" onClick={() => void undoSave()} className="ml-2 text-x-blue-text underline">되돌리기</button>
          )}
        </p>
      )}
      {/* 0은 금액으로 저장돼 0원 정산 요청이 만들어진다 — 막지 않고 '비용 없음'을 권한다(koo 11-23) */}
      {mode !== 'draft' && parsed === 0 && <p className="mt-1 text-[14px] text-amber-700">{ZERO_COST_HINT}</p>}
      {dialog && option && (
        <PriceProfileDialog scenario={dialog.scenario} handle={option.handle} type={type}
                            profile={profile} entered={dialog.entered}
                            onAnswer={(toProfile) => void answerDialog(toProfile)} />
      )}
    </div>
  );
}

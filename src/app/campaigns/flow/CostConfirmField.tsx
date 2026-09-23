'use client';
import { useEffect, useState } from 'react';
import type { InfluencerOption } from '@/lib/draftTypes';
import type { TaskType } from '@/lib/campaignJudgment';
import {
  CURRENCIES, CURRENCY_LABEL, AMOUNT_MESSAGE, parseAmount, formatAmount, suggestTaskCost,
  type TaskCost, type Currency,
} from '@/lib/campaignCost';
import { costConfirmScenario, profilePromptFor } from '@/lib/campaignFlowView';
import { Button } from '@/components/ui';
import { PriceProfileDialog } from './PriceProfileDialog';

// 비용 [확인](b-task-8-brief.md, koo 결정) — 배정된 인플루언서의 단가로 칸을 채워도 그건 제안일 뿐이다.
// [확인]을 눌러야(=onSave 성공) 이 작업의 비용으로 저장된다 — 확정 여부는 별도 플래그가 아니라 "저장됐는가"
// 그 자체다(값이 곧 상태). 그래서 이 컴포넌트는 내부에 "확정됨" 상태를 따로 들고 있지 않는다: 지금 입력과
// value(부모가 들고 있는 저장된 값 — edit는 task.cost, new는 패널의 로컬 상태)가 같으면 그게 확정이다.
// 확정 뒤 프로필과 다르거나(differs) 프로필에 단가가 없으면(no-profile) "프로필도 바꿀까요"를 그 다음에 묻는다 —
// 이 작업의 저장 자체는 그 답과 무관하게 이미 끝나 있다(질문에 답하지 않고 닫아도 이 작업 비용은 남는다).
// 통화가 다르면(currency-mismatch) 아예 묻지 않는다 — 단위가 다른 값을 프로필에 덮어쓰는 건 위험하다(koo 결정).
// mode='draft'(새 작업, 설계 §8) — [확인]이 없다: 보이는 값이 곧 [만들기]에 실릴 값이라 입력할 때마다
// onDraftChange로 부모에 올리고, 프로필 반영 질문은 만든 뒤 부모(FlowDetail)가 한 번 묻는다.
export function CostConfirmField({
  value, option, type, label, onSave, onSaveProfile, disabledReason, mode = 'confirm', onDraftChange, error: externalError,
}: {
  value: TaskCost | null;                 // 저장된(=확정된) 값 — edit: task.cost, new: 패널 로컬 상태
  option: InfluencerOption | undefined;   // 배정된 인플루언서(명부에 있을 때만 id가 있다)
  type: TaskType;
  label: string;                          // '비용' | '예산' — 칸 위 라벨은 부모가 그리므로 여기선 접근성 라벨로만 쓴다
  onSave: (cost: TaskCost) => Promise<boolean>;
  onSaveProfile: (option: InfluencerOption, cost: TaskCost) => Promise<boolean>;
  disabledReason?: string;                // 있으면 칸을 비활성으로 그리고 이 문구를 보여준다(인플 미정 등). ''이면 문구 없이 비활성만 —
                                          // 이유를 칸 밖(비용 · 정산 상자의 결제 수단 줄)에서 한 번만 말할 때(설계 §10)
  mode?: 'confirm' | 'draft';
  onDraftChange?: (v: TaskCost | null | 'invalid') => void;   // draft 모드만 — 빈 칸 null, 못 읽는 값 'invalid'
  error?: string | null;                  // 부모가 정한 오류(draft 모드의 [만들기] 때 'invalid')
}) {
  const profile = suggestTaskCost(option?.pricing, type);
  const [amount, setAmount] = useState(() => String(value?.amount ?? profile?.amount ?? ''));
  const [currency, setCurrency] = useState<Currency>(() => value?.currency ?? profile?.currency ?? 'KRW');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');   // '✓ 확정' 옆 한 줄 — 프로필 갱신 결과·명부 밖 사유·통화 불일치 사유
  const [dialog, setDialog] = useState<{ scenario: 'differs' | 'no-profile'; entered: TaskCost } | null>(null);

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
          <input disabled placeholder="₩" aria-label={label}
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

  async function confirm() {
    if (busy) return;    // 연타로 같은 PATCH가 두 번 나가지 않게
    if (saved) return;   // 이미 확정된 값 그대로 — Enter가 다시 불러도 재저장·다이얼로그 재오픈을 막는다
    if (entered === null) { setErr(AMOUNT_MESSAGE); return; }
    setErr(null);
    setBusy(true);
    const ok = await onSave(entered);
    setBusy(false);
    if (!ok) return;   // 저장 실패 — 값은 그대로 미확정, 부모가 이미 오류를 토스트로 알린다
    setNote('');
    if (scenario === 'currency-mismatch') { setNote(' · 통화가 달라 프로필엔 반영 안 돼요'); return; }
    if (scenario !== 'differs' && scenario !== 'no-profile') return;   // same이면 물을 게 없다
    if (!option?.id) { setNote(' · 명부에 없는 인플루언서라 프로필엔 저장 못 해요'); return; }
    // 물을지 말지는 profilePromptFor 하나로(새 작업의 [만들기] 뒤와 같은 판정) — 여기까지 왔는데 null이면
    // no-profile인데 프로필에 이미 다른 통화 단가가 있는 경우뿐이다(프로필 통화는 하나라 덮어쓰지 않는다).
    const prompt = profilePromptFor({ option, type, cost: entered });
    if (!prompt) { setNote(' · 통화가 달라 프로필엔 반영 안 돼요'); return; }
    setDialog({ scenario: prompt.scenario, entered });
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
      statusText = `✓ 확정 · ${diff}${note}`;
      amber = true;
    } else {
      statusText = `✓ 확정${note}`;
    }
  } else if (entered === null) {
    statusText = profile ? '금액을 넣어 주세요' : '프로필에 단가 없음 — 직접 입력';
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
               onChange={(e) => { setAmount(e.target.value); setErr(null); report(e.target.value, currency); }}
               onKeyDown={(e) => { if (mode === 'confirm' && e.key === 'Enter' && !e.nativeEvent.isComposing) void confirm(); }}
               placeholder="0"
               className={`h-10 flex-1 rounded-md border px-3 text-content tabular-nums outline-none focus:border-x-blue ${
                 saved || mode === 'draft' ? 'border-x-border-strong' : 'border-dashed border-x-border-strong text-x-secondary'}`} />
        <select value={currency} aria-label={`${label} 통화`}
                onChange={(e) => { const next = e.target.value as Currency; setCurrency(next); setErr(null); report(amount, next); }}
                className="h-10 rounded-md border border-x-border-strong bg-white px-2 text-content outline-none focus:border-x-blue">
          {CURRENCIES.map((c) => <option key={c} value={c}>{CURRENCY_LABEL[c]}</option>)}
        </select>
        {mode === 'confirm' && !saved && (
          <Button onClick={() => void confirm()} disabled={parsed === null || busy} className="h-10 px-3.5 text-ui">
            {busy ? '확인 중…' : '확인'}
          </Button>
        )}
      </div>
      {(err ?? externalError) && <p role="alert" className="mt-1 text-ui text-red-600">{err ?? externalError}</p>}
      {statusText && <p className={`mt-1 text-ui ${amber ? 'text-amber-700' : 'text-x-muted'}`}>{statusText}</p>}
      {dialog && option && (
        <PriceProfileDialog scenario={dialog.scenario} handle={option.handle} type={type}
                            profile={profile} entered={dialog.entered}
                            onAnswer={(toProfile) => void answerDialog(toProfile)} />
      )}
    </div>
  );
}

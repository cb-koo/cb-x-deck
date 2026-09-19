'use client';
import { useState } from 'react';
import type { InfluencerOption } from '@/lib/draftTypes';
import { TASK_TYPE_LABEL, type TaskType } from '@/lib/campaignJudgment';
import {
  CURRENCIES, CURRENCY_LABEL, AMOUNT_MESSAGE, parseAmount, formatAmount, suggestTaskCost, normalizeCurrency,
  type TaskCost, type Currency,
} from '@/lib/campaignCost';
import { costConfirmScenario } from '@/lib/campaignFlowView';
import { Button } from '@/components/ui';
import { PriceProfileDialog } from './PriceProfileDialog';

// 비용 [확인](b-task-8-brief.md, koo 결정) — 배정된 인플루언서의 단가로 칸을 채워도 그건 제안일 뿐이다.
// [확인]을 눌러야(=onSave 성공) 이 작업의 비용으로 저장된다 — 확정 여부는 별도 플래그가 아니라 "저장됐는가"
// 그 자체다(값이 곧 상태). 그래서 이 컴포넌트는 내부에 "확정됨" 상태를 따로 들고 있지 않는다: 지금 입력과
// value(부모가 들고 있는 저장된 값 — edit는 task.cost, new는 패널의 로컬 상태)가 같으면 그게 확정이다.
// 확정 뒤 프로필과 다르거나(differs) 프로필에 단가가 없으면(no-profile) "프로필도 바꿀까요"를 그 다음에 묻는다 —
// 이 작업의 저장 자체는 그 답과 무관하게 이미 끝나 있다(질문에 답하지 않고 닫아도 이 작업 비용은 남는다).
// 통화가 다르면(currency-mismatch) 아예 묻지 않는다 — 단위가 다른 값을 프로필에 덮어쓰는 건 위험하다(koo 결정).
export function CostConfirmField({
  value, option, type, label, onSave, onSaveProfile, disabledReason,
}: {
  value: TaskCost | null;                 // 저장된(=확정된) 값 — edit: task.cost, new: 패널 로컬 상태
  option: InfluencerOption | undefined;   // 배정된 인플루언서(명부에 있을 때만 id가 있다)
  type: TaskType;
  label: string;                          // '비용' | '예산' — 칸 위 라벨은 부모가 그리므로 여기선 접근성 라벨로만 쓴다
  onSave: (cost: TaskCost) => Promise<boolean>;
  onSaveProfile: (option: InfluencerOption, cost: TaskCost) => Promise<boolean>;
  disabledReason?: string;                // 있으면 칸을 비활성으로 그리고 이 문구를 보여준다(인플 미정 등)
}) {
  const profile = suggestTaskCost(option?.pricing, type);
  const [amount, setAmount] = useState(() => String(value?.amount ?? profile?.amount ?? ''));
  const [currency, setCurrency] = useState<Currency>(() => value?.currency ?? profile?.currency ?? 'KRW');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');   // '✓ 확정' 옆 한 줄 — 프로필 갱신 결과·명부 밖 사유·통화 불일치 사유
  const [dialog, setDialog] = useState<{ scenario: 'differs' | 'no-profile'; entered: TaskCost } | null>(null);

  if (disabledReason) {
    return (
      <div>
        <input disabled placeholder="₩" aria-label={label}
               className="h-10 w-full rounded-md border border-dashed border-x-border-strong bg-x-surface px-3 text-content text-x-muted" />
        <p className="mt-1 text-caption text-x-muted">{disabledReason}</p>
      </div>
    );
  }

  const parsed = parseAmount(amount);
  const entered: TaskCost | null = parsed === null ? null : { amount: parsed, currency };
  // 저장된 값과 지금 입력이 같은가 — 같으면 이미 확정된 상태다(별도 플래그 없이 값 자체가 상태를 말한다)
  const saved = value !== null && entered !== null && value.amount === entered.amount && value.currency === entered.currency;
  const scenario = costConfirmScenario({ profile, entered });

  async function confirm() {
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
    // no-profile이라도 프로필에 이미 다른 유형 단가(=다른 통화)가 있으면 그 통화를 덮어쓰지 않는다 — 프로필의
    // 통화는 하나뿐이라(normalizeCurrency) 여기서 바꾸면 이미 있던 다른 유형 단가까지 통화가 같이 바뀐 것처럼 읽힌다.
    if (scenario === 'no-profile' && option.pricing && normalizeCurrency(option.pricing) !== entered.currency) {
      setNote(' · 통화가 달라 프로필엔 반영 안 돼요');
      return;
    }
    setDialog({ scenario, entered });
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
  if (saved) {
    statusText = `✓ 확정${note}`;
  } else if (entered === null) {
    statusText = profile ? '금액을 넣어 주세요' : '프로필에 단가 없음 — 직접 입력';
  } else if (scenario === 'same') {
    statusText = `프로필 단가 · ${TASK_TYPE_LABEL[type]}`;
  } else if (scenario === 'differs' && profile) {
    statusText = `프로필 단가 ${formatAmount(profile.amount, profile.currency)}과 다름`;
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
               onChange={(e) => { setAmount(e.target.value); setErr(null); }}
               onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) void confirm(); }}
               placeholder="0"
               className={`h-10 flex-1 rounded-md border px-3 text-content tabular-nums outline-none focus:border-x-blue ${
                 saved ? 'border-x-border-strong' : 'border-dashed border-x-border-strong text-x-secondary'}`} />
        <select value={currency} aria-label={`${label} 통화`} onChange={(e) => { setCurrency(e.target.value as Currency); setErr(null); }}
                className="h-10 rounded-md border border-x-border-strong bg-white px-2 text-content outline-none focus:border-x-blue">
          {CURRENCIES.map((c) => <option key={c} value={c}>{CURRENCY_LABEL[c]}</option>)}
        </select>
        {!saved && (
          <Button onClick={() => void confirm()} disabled={parsed === null || busy} className="h-10 px-3.5 text-ui">
            {busy ? '확인 중…' : '확인'}
          </Button>
        )}
      </div>
      {err && <p role="alert" className="mt-1 text-caption text-red-600">{err}</p>}
      {statusText && <p className={`mt-1 text-caption ${amber ? 'text-amber-700' : 'text-x-muted'}`}>{statusText}</p>}
      {dialog && option && (
        <PriceProfileDialog scenario={dialog.scenario} handle={option.handle} type={type}
                            profile={profile} entered={dialog.entered}
                            onAnswer={(toProfile) => void answerDialog(toProfile)} />
      )}
    </div>
  );
}

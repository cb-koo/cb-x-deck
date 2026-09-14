'use client';
import { useState, useRef, type ReactNode } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/apiFetch';
import { Button } from '@/components/ui';
import { relTime } from '@/lib/relTime';
import { kstMonthDay } from '@/lib/datetime';
import { PRICE_TYPE_LABEL, formatMoney, type PricingChange } from '@/lib/influencerPricing';
import { PAYMENT_FIELD_LABEL, type PaymentMethodChange } from '@/lib/influencerPayment';
import { TASK_TYPE_LABEL } from '@/lib/campaignJudgment';
import type { InfluencerAutoEvent, InfluencerChannel, InfluencerLogRow, PaymentLogPayload } from '@/lib/influencerStore';
import { errOf, PANEL, PANEL_TITLE, useErrorReport } from './profileShared';

export const CHANNEL_LABEL: Record<InfluencerChannel, string> = {
  dm: 'DM', line: '라인', email: '이메일', other: '기타',
};

// 자동 이벤트 문구 — 로그에는 사실만 저장되고 표현은 여기서 만든다(스펙 §2).
function autoText(l: InfluencerLogRow): ReactNode {
  const title = l.draftTitle?.trim() || '제목 없는 원고';
  const draft = l.draftId
    ? <Link href={`/generate?draft=${l.draftId}`} className="text-x-blue-text hover:underline">{title}</Link>
    : <span>{title}</span>;   // 원고가 지워졌으면 링크 없이 제목만 (누를 수 없는 것은 링크로 보이지 않게)
  switch (l.eventType) {
    case 'draft_assigned': return <>원고 배정 — {draft}</>;
    case 'draft_unassigned': return <>배정 해제 — {draft}</>;
    case 'draft_delivered': return <>원고 전달됨 — {draft}</>;
    case 'handle_changed': {
      // LogPayload가 유니언으로 늘어나면서 이 분기에서는 { from?, to? } 모양만 온다 — 좁혀서 캐스팅(동작 변화 없음).
      const p = l.payload as { from?: string; to?: string } | null;
      return <>핸들 변경 @{p?.from ?? '?'} → @{p?.to ?? '?'}</>;
    }
    case 'pricing_changed': {
      const p = l.payload as PricingChange | null;
      if (!p) return <>단가 변경</>;
      if (p.priceType === 'currency') {
        return <>단가 통화 {p.from === 'JPY' ? '엔화' : '원화'} → {p.to === 'JPY' ? '엔화' : '원화'}</>;
      }
      const fmt = (v: number | string | null) => (v === null ? '미정' : formatMoney(v as number, p.currency));
      return <>{PRICE_TYPE_LABEL[p.priceType]} 단가 {fmt(p.from)} → {fmt(p.to)}</>;
    }
    case 'payment_method_changed': {
      const p = l.payload as PaymentMethodChange | null;
      if (!p) return <>결제 수단 변경</>;
      // updated의 from/to는 표시용 문자열이지만 currency 필드만 예외로 'KRW'/'JPY' 원시 코드다(influencerPayment의 displayValue) —
      // pricing_changed의 통화 표시와 같은 말로 바꿔 보여준다.
      const fmtField = (field: string, v: string | null) =>
        v === null ? '없음' : field === 'currency' ? (v === 'JPY' ? '엔화' : '원화') : v;
      switch (p.action) {
        case 'added': return <>결제 수단 추가 — {p.label}</>;
        case 'removed': return <>결제 수단 삭제 — {p.label}</>;
        case 'default_changed': return <>기본 결제 수단 → {p.label}</>;
        case 'updated': {
          const fields = p.fields ?? [];
          if (fields.length === 0) return <>결제 수단 수정 — {p.label}</>;
          const f = fields[0];
          const extra = fields.length > 1 ? ` 외 ${fields.length - 1}건` : '';
          return <>결제 수단 수정 — {p.label}: {PAYMENT_FIELD_LABEL[f.field]} {fmtField(f.field, f.from)} → {fmtField(f.field, f.to)}{extra}</>;
        }
        default: return <>결제 수단 변경</>;
      }
    }
    case 'payment_requested': {
      const p = l.payload as PaymentLogPayload | null;
      if (!p) return <>정산 요청</>;
      return <>정산 요청 · {formatMoney(p.amountGross, p.currency)} <span className="text-x-muted">({TASK_TYPE_LABEL[p.taskType]})</span></>;
    }
    case 'payment_cancelled': {
      const p = l.payload as PaymentLogPayload | null;
      if (!p) return <>정산 요청 취소</>;
      return <>정산 요청 취소 · {formatMoney(p.amountGross, p.currency)}{p.reason ? <> — {p.reason}</> : null}</>;
    }
    case 'payment_revised': {
      const p = l.payload as PaymentLogPayload | null;
      if (!p) return <>정산 요청 수정</>;
      return <>정산 요청 수정 · {p.before ? <>{formatMoney(p.before.amountGross, p.before.currency)} → </> : null}{formatMoney(p.amountGross, p.currency)}{p.reason ? <> — {p.reason}</> : null}</>;
    }
    case 'payment_paid': {
      const p = l.payload as PaymentLogPayload | null;
      if (!p) return <>지급 완료</>;
      return <>지급 완료 · {formatMoney(p.amountGross, p.currency)}{typeof p.paidAmountKrw === 'number' ? <> → 실지급 {formatMoney(p.paidAmountKrw, 'KRW')}</> : null}</>;
    }
    default: return <>활동 기록</>;
  }
}

// 묶음 한 줄 문구 — 개별 행의 동사(autoText)를 그대로 이어 쓴다. 같은 사실을 두 가지 말로 부르지 않는다.
function groupText(eventType: InfluencerAutoEvent | null, n: number): string {
  switch (eventType) {
    case 'draft_assigned': return `원고 ${n}건 배정`;
    case 'draft_unassigned': return `배정 해제 ${n}건`;
    case 'draft_delivered': return `원고 ${n}건 전달됨`;
    case 'handle_changed': return `핸들 변경 ${n}건`;
    case 'pricing_changed': return `단가 변경 ${n}건`;
    case 'payment_method_changed': return `결제 수단 변경 ${n}건`;
    case 'payment_requested': return `정산 요청 ${n}건`;
    case 'payment_cancelled': return `정산 요청 취소 ${n}건`;
    case 'payment_revised': return `정산 요청 수정 ${n}건`;
    case 'payment_paid': return `지급 완료 ${n}건`;
    default: return `활동 기록 ${n}건`;
  }
}

// 인접한 같은 event_type의 auto 항목을 한 덩어리로 (스펙 §②). manual이 사이에 끼면 묶지 않는다 —
// 묶으면 시간 순서가 왜곡된다. 렌더 시점 파생일 뿐 원본 logs는 그대로 둔다.
function groupAuto(logs: InfluencerLogRow[]): InfluencerLogRow[][] {
  const out: InfluencerLogRow[][] = [];
  for (const l of logs) {
    const prev = out[out.length - 1];
    const head = prev?.[0];
    if (prev && head && head.kind === 'auto' && l.kind === 'auto' && head.eventType === l.eventType) prev.push(l);
    else out.push([l]);
  }
  return out;
}

// 묶음 기간 — 목록이 최신순이므로 마지막 항목이 가장 오래된 것. 하루 안에 몰렸으면 날짜 하나만 적는다.
function groupRange(logs: InfluencerLogRow[]): string {
  const from = kstMonthDay(logs[logs.length - 1].createdAt);
  const to = kstMonthDay(logs[0].createdAt);
  return from === to ? from : `${from}~${to}`;
}

export function Timeline({ id, logs, onAdded, onRemoved, onErrorChange }: {
  id: string; logs: InfluencerLogRow[];
  onAdded: (row: InfluencerLogRow) => void;
  onRemoved: (logId: string) => void;
  onErrorChange?: (v: boolean) => void;
}) {
  const [body, setBody] = useState('');
  // 채널 기본값 = 가장 최근 manual 로그의 채널(스펙 §③). 상태에는 "사용자가 고른 값"만 담고 기본값은
  // 렌더에서 파생한다 — 한 번 직접 고르면 기록을 남긴 뒤에도 그 선택이 그대로 남는다.
  const [picked, setPicked] = useState<'' | InfluencerChannel | null>(null);
  const channel = picked ?? logs.find((l) => l.kind === 'manual')?.channel ?? '';
  const [err, setErr] = useState('');
  const busy = useRef(false);
  useErrorReport(err !== '', onErrorChange);

  async function add() {
    const text = body.trim();
    if (!text || busy.current) return;
    busy.current = true;
    try {
      const r = await apiFetch(`/api/influencers/${id}/logs`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: text, ...(channel ? { channel } : {}) }),
      });
      if (!r.ok) { setErr(await errOf(r)); return; }
      setBody(''); setErr('');
      onAdded((await r.json()) as InfluencerLogRow);
    } catch {
      setErr('기록을 남기지 못했어요 — 네트워크를 확인하고 다시 시도해 주세요');
    } finally { busy.current = false; }
  }

  return (
    // 회색 바닥 위 흰 패널 1장(스펙 §7) — 위 여백·구분선은 부모의 space-y-5가 대신한다
    <section className={PANEL}>
      <h2 className={PANEL_TITLE}>주고받은 기록</h2>
      <p className="text-caption leading-relaxed text-x-muted">DM·통화에서 오간 이야기를 한 줄로 남겨두면, 나중에 누가 봐도 어디까지 이야기했는지 알 수 있어요.</p>
      <div className="mt-1.5 flex gap-1.5">
        <input value={body} onChange={(e) => setBody(e.target.value)}
               onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) add(); }}
               placeholder="예: 단가 협의 완료, 다음 주 원고 전달 예정" aria-label="기록 내용"
               className="min-w-0 flex-1 rounded-lg border border-x-border-strong px-2.5 py-1.5 text-ui outline-none focus:border-x-blue" />
        <select value={channel} onChange={(e) => setPicked(e.target.value as '' | InfluencerChannel)}
                aria-label="이야기가 오간 곳"
                className="shrink-0 rounded-lg border border-x-border-strong bg-white px-2 py-1.5 text-ui outline-none focus:border-x-blue">
          <option value="">어디서 (선택)</option>
          {(Object.keys(CHANNEL_LABEL) as InfluencerChannel[]).map((c) => (
            <option key={c} value={c}>{CHANNEL_LABEL[c]}</option>
          ))}
        </select>
        <Button variant="primary" className="shrink-0 whitespace-nowrap" onClick={add}>기록</Button>
      </div>
      {err && <p role="alert" className="mt-1 text-caption text-red-500">{err}</p>}

      {logs.length === 0 ? (
        <p className="mt-3 text-ui leading-relaxed text-x-muted">아직 기록이 없어요 — 위에 한 줄 남기면 여기 쌓여요.</p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {groupAuto(logs).map((g) => {
            if (g.length > 1) return <AutoGroup key={g[g.length - 1].id} logs={g} />;
            const l = g[0];
            return l.kind === 'auto'
              ? <AutoLine key={l.id} log={l} />
              : <LogItem key={l.id} id={id} log={l} onRemoved={onRemoved} />;
          })}
        </ul>
      )}
    </section>
  );
}

// 자동 이벤트 한 줄 — 카드도 아이콘도 없는 회색 텍스트. 사람이 남긴 기록이 스캔에서 먼저 보이도록
// 일부러 약하게 둔다(스펙 §②). 지우기 버튼이 없는 것도 그대로다 — 자동 기록은 지나간 사실이다.
function AutoLine({ log }: { log: InfluencerLogRow }) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-1.5 px-3 py-0.5 text-ui text-x-secondary">
      {/* 카드·아이콘을 걷어내면 화면에서는 위계로 구분되지만 스크린리더에는 아무 단서도 남지 않는다 —
          '자동 기록'이라는 사실은 눈에 보이지 않게라도 반드시 읽혀야 한다(기존 sr-only 관례). */}
      <span><span className="sr-only">자동 기록: </span>{autoText(log)}</span>
      {/* member가 없는 auto 로그는 가져오기 스크립트(actorId null)가 남긴 것 — 이름 자리를 비워두면
          "누가"가 빠진 것처럼 보여 '가져오기'로 밝힌다(T4 확인). */}
      <span className="text-caption text-x-muted">{log.member?.name ?? '가져오기'}</span>
      <span className="text-caption text-x-muted">{relTime(log.createdAt, '').trim()}</span>
    </li>
  );
}

// 같은 일이 연달아 일어난 구간은 한 줄로 접는다 — 펼치면 개별 행(원고 제목 링크 포함)이 그대로 나온다.
function AutoGroup({ logs }: { logs: InfluencerLogRow[] }) {
  const [open, setOpen] = useState(false);
  return (
    <li>
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open}
              className="flex w-full flex-wrap items-baseline gap-x-1.5 rounded-lg px-3 py-0.5 text-left text-ui text-x-secondary hover:bg-x-hover">
        <span aria-hidden className="text-caption text-x-muted">{open ? '▾' : '▸'}</span>
        <span><span className="sr-only">자동 기록: </span>{groupText(logs[0].eventType, logs.length)}</span>
        <span className="text-caption text-x-muted">({groupRange(logs)})</span>
      </button>
      {open && <ul className="pl-4">{logs.map((l) => <AutoLine key={l.id} log={l} />)}</ul>}
    </li>
  );
}

function LogItem({ id, log, onRemoved }: { id: string; log: InfluencerLogRow; onRemoved: (logId: string) => void }) {
  const [confirming, setConfirming] = useState(false);
  const [err, setErr] = useState('');

  async function remove() {
    try {
      const r = await apiFetch(`/api/influencers/${id}/logs/${log.id}`, { method: 'DELETE' });
      if (!r.ok) { setErr(await errOf(r)); return; }
      onRemoved(log.id);
    } catch {
      setErr('지우지 못했어요 — 네트워크를 확인하고 다시 시도해 주세요');
    }
  }

  // 사람이 남긴 기록만 이 카드로 온다(자동 이벤트는 AutoLine) — 배경·채널칩·작성자를 그대로 유지한다.
  return (
    <li className="rounded-lg border border-x-border px-3 py-2">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1 text-ui">
          <span className="whitespace-pre-wrap">{log.body}</span>
          <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-caption text-x-muted">
            {log.channel && (
              <span className="rounded-full bg-x-border/50 px-1.5 py-0.5 text-x-secondary">{CHANNEL_LABEL[log.channel]}</span>
            )}
            {log.member && <span>{log.member.name}</span>}
            <span>{relTime(log.createdAt, '').trim()}</span>
          </p>
        </div>
        {/* 지울 수 있는 건 사람이 쓴 기록뿐 — 자동 기록은 사실이라 버튼 자체를 두지 않는다 */}
        {confirming ? (
          <span className="flex shrink-0 items-center gap-1.5 text-caption">
            <button onClick={remove} className="rounded bg-red-600 px-2 py-0.5 text-white">지우기</button>
            <button onClick={() => setConfirming(false)} className="rounded border border-x-border-strong px-2 py-0.5">취소</button>
          </span>
        ) : (
          <button onClick={() => setConfirming(true)} aria-label="이 기록 지우기"
                  className="shrink-0 text-caption text-x-muted hover:text-red-500">✕</button>
        )}
      </div>
      {err && <p role="alert" className="mt-1 text-caption text-red-500">{err}</p>}
    </li>
  );
}

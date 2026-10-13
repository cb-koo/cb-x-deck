'use client';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui';
import { useToast } from '@/lib/toastContext';
import { fetchPending, sendPendingApi } from '@/lib/settlementApi';
import type { PendingRow, PendingSummary } from '@/lib/settlementAutoStore';
import { AUTO_RUN_STALE_MS, GROUP_LABEL, shortReason, sendWhenLabel, type PendingGroup } from '@/lib/settlementAuto';
import { TASK_TYPE_LABEL } from '@/lib/campaignJudgment';
import { PAYMENT_TYPE_LABEL } from '@/lib/influencerPayment';
import { formatMoney } from '@/lib/influencerPricing';
import { kstMonthDay } from '@/lib/datetime';
import { FlowDetail } from '@/app/campaigns/flow/FlowDetail';
import { CELL, HEAD, NUM, TYPE_CHIP, METHOD_CHIP } from './tableStyle';
import { HoldDialog } from './HoldDialog';

// 정산 요청 대기(스펙 2026-10-12 §7, koo 10-13 QA: 짧은 명사형 명칭·사유 한 칸·행을 누르면 작업 패널).
// 묶음은 서버 판정(settlementAuto.pendingGroup) 그대로 — 화면이 따로 판정하지 않는다(라벨-값 일치).
// 행을 누르면 캠페인 화면과 같은 작업 패널이 오른쪽에 열린다(FlowDetail embed) — 결제 수단·증빙·동의서·링크·금액을 그 자리에서 고친다.
const DOW = '일월화수목금토';
const KST_MS = 9 * 3_600_000;
const hhmm = (iso: string) => { const k = new Date(Date.parse(iso) + KST_MS); return `${String(k.getUTCHours()).padStart(2, '0')}:${String(k.getUTCMinutes()).padStart(2, '0')}`; };
const dayLabel = (ymd: string) => `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}(${DOW[new Date(`${ymd}T12:00:00Z`).getUTCDay()]})`;
const GROUP_SUB: Record<PendingGroup, (s: PendingSummary, rows: PendingRow[]) => string> = {
  attention: () => '지급 전에 글이 내려갔거나 안 보여요 · 보낼지 정해 주세요',
  blocked: () => '고치면 자동 전송돼요 · 행을 눌러 그 자리에서 고쳐요',
  // 지난 월요일 전에 확인된 건(곧 전송)이 섞여 있으면 따로 센다 — 머리말 날짜와 행의 '곧 전송'이 엇갈려 보이지 않게(QA 10-13)
  waiting: (s, rows) => {
    const due = rows.filter((r) => r.sendAt === null).length;
    return due ? `곧 전송 ${due}건 · 나머지 ${sendWhenLabel(s.nextSendAt)} 자동 전송` : `${sendWhenLabel(s.nextSendAt)} 자동 전송`;
  },
  stopped: () => '자동 전송 안 함 · [보내기]로 바로 보내요',
};

export function PendingTab({ initialCampaignId, onGoRequests }: { initialCampaignId?: string | null; onGoRequests: () => void }) {
  const { show } = useToast();
  const [data, setData] = useState<{ rows: PendingRow[]; summary: PendingSummary } | null>(null);
  const [err, setErr] = useState('');
  const [campaignId, setCampaignId] = useState<string | null>(initialCampaignId ?? null);
  const [busy, setBusy] = useState<string | null>(null);
  const [holdTarget, setHoldTarget] = useState<PendingRow | null>(null);
  const [rowErr, setRowErr] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<{ campaignId: string; taskId: string } | null>(null);

  const load = useCallback(async () => {
    const r = await fetchPending();
    if (!r.ok) { setErr(r.error); return; }
    setErr(''); setData(r.data);
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- 마운트 시 1회 로드, setState는 비동기 콜백(CandidateTable 관례)
  useEffect(() => { void load(); }, [load]);
  // 패널을 닫으면 목록을 다시 읽는다 — 패널에서 고친 값(결제 수단 등록·증빙 첨부)이 묶음을 옮긴다
  const closePanel = useCallback(() => { setOpen(null); void load(); }, [load]);
  const embed = useMemo(() => (open ? { taskId: open.taskId, onClose: closePanel } : undefined), [open, closePanel]);

  async function send(row: PendingRow) {
    setBusy(row.cand.taskId);
    const r = await sendPendingApi(row.cand.taskId);
    setBusy(null);
    if (r.ok) {
      show(`@${row.cand.influencerHandle} 정산 요청을 보냈어요`);
      setRowErr((p) => { const n = { ...p }; delete n[row.cand.taskId]; return n; });
    } else setRowErr((p) => ({ ...p, [row.cand.taskId]: r.error }));
    await load();
  }

  if (err) return <p role="alert" className="text-ui text-red-700">{err}</p>;
  if (!data) return <p className="text-ui text-x-muted">불러오는 중…</p>;
  const all = campaignId ? data.rows.filter((r) => r.cand.campaignId === campaignId) : data.rows;
  const focusName = campaignId ? data.rows.find((r) => r.cand.campaignId === campaignId)?.cand.campaignName : null;
  const of = (g: PendingGroup) => all.filter((r) => r.group === g);
  const s = data.summary;
  const rowProps = (r: PendingRow) => ({ r, err: rowErr[r.cand.taskId], selected: open?.taskId === r.cand.taskId,
    onOpen: () => setOpen({ campaignId: r.cand.campaignId, taskId: r.cand.taskId }) });
  const hold = (r: PendingRow) => <Button onClick={() => setHoldTarget(r)} disabled={busy !== null} title="자동으로 보내지 않고 전송 보류에 둬요">보류</Button>;
  const sendBtn = (r: PendingRow, label: string, title: string) => (
    <Button variant={r.group === 'attention' ? 'primary' : 'subtle'} onClick={() => void send(r)}
            disabled={busy !== null || r.blocking.length > 0} title={r.blocking.length ? `먼저 고쳐 주세요: ${shortReason(r.cand, 'blocked', r.blocking)}` : title}>
      {busy === r.cand.taskId ? '보내는 중…' : label}
    </Button>
  );

  return (
    <section>
      <RunLine summary={s} onGoRequests={onGoRequests} />
      {campaignId && (
        <p className="mt-3 text-ui text-x-secondary">
          {focusName ? <><b className="font-semibold text-x-text">{focusName}</b>만 보는 중</> : '이 캠페인은 정산 요청 대기 없음'}
          <button type="button" onClick={() => setCampaignId(null)} className="ml-2 text-x-blue-text hover:underline">전체 보기</button>
        </p>
      )}
      {all.length === 0 && (
        <p className="mt-6 rounded-xl border border-dashed border-x-border p-8 text-center text-ui text-x-muted">
          정산 요청 대기 없음 · 게시 확인된 작업은 다음 월요일 07:00에 자동 전송돼요
        </p>
      )}

      <Group g="attention" rows={of('attention')} s={s} cols={['인플루언서', '유형', '캠페인', '작업 금액', '게시일', '사유', '']}>
        {(r) => (
          <Row key={r.cand.taskId} {...rowProps(r)} withPosted>
            <td className={`${CELL} text-ui text-amber-700`}>{shortReason(r.cand, 'attention', [])}
              {r.blocking.length > 0 && <span className="text-red-700"> · {shortReason(r.cand, 'blocked', r.blocking)}</span>}</td>
            <Actions>{hold(r)}{sendBtn(r, '보내기', '협의 후 내림 등 지급할 건이면 지금 보내요 — 요청자는 내 이름')}</Actions>
          </Row>
        )}
      </Group>

      <Group g="blocked" rows={of('blocked')} s={s} cols={['인플루언서', '유형', '캠페인', '작업 금액', '게시일', '사유']}>
        {(r) => (
          <Row key={r.cand.taskId} {...rowProps(r)} withPosted>
            <td className={`${CELL} text-ui text-red-700`}>
              {shortReason(r.cand, 'blocked', r.blocking)}
              {r.blocking.some((i) => i.code === 'no-category') && (
                <a href="/settlement?tab=settings" onClick={(e) => e.stopPropagation()} className="ml-1.5 text-x-blue-text hover:underline">설정 →</a>
              )}
            </td>
          </Row>
        )}
      </Group>

      <Group g="waiting" rows={of('waiting')} s={s} cols={['인플루언서', '유형', '캠페인', '작업 금액', '송금액', '결제 수단', '전송', '']}>
        {(r) => (
          <Row key={r.cand.taskId} {...rowProps(r)}>
            <td className={`${CELL} ${NUM}`}>{r.cand.money ? formatMoney(r.cand.money.amountGross, r.cand.money.payoutCurrency) : '—'}</td>
            <td className={CELL}>{r.cand.method && <span className={METHOD_CHIP}>{PAYMENT_TYPE_LABEL[r.cand.method.type]}</span>}</td>
            <td className={`${CELL} text-ui text-x-secondary`}>{r.sendAt ? sendWhenLabel(r.sendAt) : '곧 전송'}</td>
            <Actions>{hold(r)}{sendBtn(r, '바로 보내기', '월요일까지 기다리지 않고 지금 보내요 — 요청자는 내 이름')}</Actions>
          </Row>
        )}
      </Group>

      <Group g="stopped" rows={of('stopped')} s={s} cols={['인플루언서', '유형', '캠페인', '작업 금액', '사유', '']}>
        {(r) => (
          <Row key={r.cand.taskId} {...rowProps(r)}>
            <td className={`${CELL} text-ui text-x-secondary`}>{stopReason(r)}
              {r.blocking.length > 0 && <span className="text-red-700"> · {shortReason(r.cand, 'blocked', r.blocking)}</span>}</td>
            <Actions>{sendBtn(r, '보내기', '지금 정산팀으로 보내요 — 요청자는 내 이름')}</Actions>
          </Row>
        )}
      </Group>

      {holdTarget && <HoldDialog target={holdTarget} onClose={() => setHoldTarget(null)} onDone={() => { setHoldTarget(null); show('전송 보류했어요'); void load(); }} />}
      {open && embed && (
        <FlowDetail key={open.campaignId} id={open.campaignId} embed={embed} onChanged={() => void load()} onDeleted={closePanel} />
      )}
    </section>
  );
}

// 맨 위 한 줄 — 오늘 자동 전송 수 + 마지막 확인. 15분 넘게 확인이 없으면 빨간 줄(스펙 §7)
function RunLine({ summary: s, onGoRequests }: { summary: PendingSummary; onGoRequests: () => void }) {
  const stale = s.lastRunAgeMin !== null && s.lastRunAgeMin * 60_000 > AUTO_RUN_STALE_MS;
  return (
    <p className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-ui ${stale ? 'text-red-700' : 'text-x-secondary'}`}>
      <span>오늘 자동 전송 <b className="font-semibold text-x-text">{s.sentAutoToday}건</b></span>
      <button type="button" onClick={onGoRequests} className="text-x-blue-text hover:underline">요청 내역 →</button>
      {s.lastRunAt === null
        ? <span className="text-x-muted">· 자동 전송 꺼짐 · 급하면 [바로 보내기]</span>
        : stale
          ? <span>· 자동 전송 {s.lastRunAgeMin}분째 응답 없음(마지막 {hhmm(s.lastRunAt)}) · 급하면 [바로 보내기]</span>
          : <span className="text-x-muted">· 마지막 확인 {hhmm(s.lastRunAt)}</span>}
    </p>
  );
}

function stopReason(r: PendingRow): string {
  const md = (iso: string | null) => (iso ? kstMonthDay(iso) : '');
  if (r.state.hold) return ['보류', md(r.state.hold.at), r.state.hold.byName, r.state.hold.reason].filter(Boolean).join(' · ');
  const c = r.state.cancelled;
  return ['요청 취소', md(c?.at ?? null), c?.byName, c?.reason].filter(Boolean).join(' · ');
}

function Group({ g, rows, s, cols, children }: { g: PendingGroup; rows: PendingRow[]; s: PendingSummary; cols: string[]; children: (r: PendingRow) => ReactNode }) {
  if (!rows.length) return null;
  return (
    <div className="mt-6">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-[16px] font-semibold">{GROUP_LABEL[g]} {rows.length}</h2>
        <span className="text-ui text-x-muted">{GROUP_SUB[g](s, rows)}</span>
      </div>
      <div className="overflow-x-auto rounded-xl border border-x-border bg-white">
        <table className="w-full border-collapse">
          <thead><tr>{cols.map((c, i) => <th key={i} className={`${HEAD} ${c === '작업 금액' || c === '송금액' ? 'text-right' : ''}`} aria-label={c || '처리'}>{c}</th>)}</tr></thead>
          <tbody>{rows.map(children)}</tbody>
        </table>
      </div>
    </div>
  );
}
// 행 하나 = 작업 하나(한 줄). 누르면 작업 패널. 버튼 칸은 클릭이 행으로 새지 않게 막는다.
function Row({ r, err, selected, withPosted, onOpen, children }: { r: PendingRow; err?: string; selected: boolean; withPosted?: boolean; onOpen: () => void; children: ReactNode }) {
  const c = r.cand;
  return (
    <>
      <tr onClick={onOpen} className={`cursor-pointer text-[15px] hover:bg-x-hover ${selected ? 'bg-x-surface' : ''}`} title="눌러서 작업 패널 열기">
        <td className={`${CELL} font-semibold`}>@{c.influencerHandle}</td>
        <td className={CELL}><span className={TYPE_CHIP[c.taskType]}>{TASK_TYPE_LABEL[c.taskType]}</span></td>
        <td className={CELL}>{c.campaignName} <span className="text-ui text-x-muted">· {c.clientName}</span></td>
        <td className={`${CELL} ${NUM}`}>{formatMoney(c.cost.amount, c.cost.currency)}</td>
        {withPosted && <td className={CELL}>{dayLabel(c.postedAt)}</td>}
        {children}
      </tr>
      {err && (
        <tr><td colSpan={9} className="border-b border-x-border/60 px-3 pb-2.5 pt-0 text-ui"><span role="alert" className="font-medium text-red-700">{err}</span></td></tr>
      )}
    </>
  );
}
function Actions({ children }: { children: ReactNode }) {
  return <td className={`${CELL} text-right`} onClick={(e) => e.stopPropagation()}><span className="inline-flex items-center gap-1.5">{children}</span></td>;
}

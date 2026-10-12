'use client';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui';
import { useToast } from '@/lib/toastContext';
import { fetchPending, sendPendingApi } from '@/lib/settlementApi';
import type { PendingRow, PendingSummary } from '@/lib/settlementAutoStore';
import type { ReadinessIssue } from '@/lib/settlementCalc';
import { AUTO_RUN_STALE_MS } from '@/lib/settlementAuto';
import { TASK_TYPE_LABEL } from '@/lib/campaignJudgment';
import { PAYMENT_TYPE_LABEL } from '@/lib/influencerPayment';
import { formatMoney } from '@/lib/influencerPricing';
import { kstMonthDay } from '@/lib/datetime';
import { CELL, HEAD, NUM, TYPE_CHIP, METHOD_CHIP } from './tableStyle';
import { HoldDialog } from './HoldDialog';

// 정산 요청 대기(스펙 2026-10-12 §7) — 고르고 보내는 칸 없이, 사람이 할 일이 있는 묶음부터 보여 준다.
// 묶음은 서버 판정(settlementAuto.pendingGroup) 그대로 — 화면이 따로 판정하지 않는다(라벨-값 일치).
const DOW = '일월화수목금토';
const KST_MS = 9 * 3_600_000;
// "10/19 월 07:00" (서울)
function whenLabel(iso: string): string {
  const k = new Date(Date.parse(iso) + KST_MS);
  return `${k.getUTCMonth() + 1}/${k.getUTCDate()} ${DOW[k.getUTCDay()]} ${String(k.getUTCHours()).padStart(2, '0')}:${String(k.getUTCMinutes()).padStart(2, '0')}`;
}
const hhmm = (iso: string) => whenLabel(iso).slice(-5);
const dayLabel = (ymd: string) => `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))} ${DOW[new Date(`${ymd}T12:00:00Z`).getUTCDay()]}`;

export function PendingTab({ initialCampaignId, onGoRequests }: { initialCampaignId?: string | null; onGoRequests: () => void }) {
  const { show } = useToast();
  const [data, setData] = useState<{ rows: PendingRow[]; summary: PendingSummary } | null>(null);
  const [err, setErr] = useState('');
  const [campaignId, setCampaignId] = useState<string | null>(initialCampaignId ?? null);
  const [busy, setBusy] = useState<string | null>(null);
  const [holdTarget, setHoldTarget] = useState<PendingRow | null>(null);
  const [rowErr, setRowErr] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const r = await fetchPending();
    if (!r.ok) { setErr(r.error); return; }
    setErr(''); setData(r.data);
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- 마운트 시 1회 로드, setState는 비동기 콜백(CandidateTable 관례)
  useEffect(() => { void load(); }, [load]);

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
  const of = (g: PendingRow['group']) => all.filter((r) => r.group === g);
  const attention = of('attention'), blocked = of('blocked'), waiting = of('waiting'), stopped = of('stopped');
  const s = data.summary;

  return (
    <section>
      <RunLine summary={s} onGoRequests={onGoRequests} />
      {campaignId && (
        <p className="mt-3 text-ui text-x-secondary">
          {focusName ? <>캠페인 <b className="font-semibold text-x-text">{focusName}</b>만 보고 있어요</> : '링크의 캠페인에는 정산 요청 대기가 없어요'}
          <button type="button" onClick={() => setCampaignId(null)} className="ml-2 text-x-blue-text hover:underline">전체 보기</button>
        </p>
      )}
      {all.length === 0 && (
        <p className="mt-6 rounded-xl border border-dashed border-x-border p-8 text-center text-ui text-x-muted">
          확인할 것도 기다리는 것도 없어요 — 캠페인에서 게시를 확인하면 다음 월요일 오전 7시에 자동으로 정산팀에 보내요
        </p>
      )}

      {attention.length > 0 && (
        <Group title={`확인이 필요해요 ${attention.length}`} sub="지급 전에 글이 내려가거나 안 보여요 — 보낼지 정해 주세요"
               foot="협의해서 내린 거면 [확인하고 보내기]. 지급하지 않을 거면 [보내지 않기]로 멈추고, 작업 자체가 무효면 캠페인에서 작업을 취소해요.">
          <Head cols={['인플루언서', '유형', '캠페인', '작업 금액', '게시 확인', '상황', '']} />
          <tbody>
            {attention.map((r) => (
              <Row key={r.cand.taskId} r={r} err={rowErr[r.cand.taskId]} extra={r.blocking.length > 0 ? <Issues issues={r.blocking} campaignId={r.cand.campaignId} prefix="보내려면 먼저: " /> : null}>
                <td className={`${CELL} text-ui text-amber-700`}>
                  {r.cand.issues.filter((i) => i.code === 'removed' || i.code === 'unseen').map((i) => i.text).join(' · ')}
                  <Link href={`/campaigns/flow?id=${r.cand.campaignId}`} className="ml-1.5 text-x-blue-text hover:underline">게시물 확인 →</Link>
                </td>
                <Actions>
                  <Button onClick={() => setHoldTarget(r)} disabled={busy !== null}>보내지 않기</Button>
                  <Button variant="primary" onClick={() => void send(r)} disabled={busy !== null || r.blocking.length > 0}
                          title={r.blocking.length ? '아래 막힌 이유를 먼저 고쳐 주세요' : '지금 정산팀으로 보내요 — 요청자는 내 이름이에요'}>
                    {busy === r.cand.taskId ? '보내는 중…' : '확인하고 보내기'}
                  </Button>
                </Actions>
              </Row>
            ))}
          </tbody>
        </Group>
      )}

      {blocked.length > 0 && (
        <Group title={`고쳐야 보내져요 ${blocked.length}`} sub="고치면 5분 안에 자동으로 넘어가요(이번 주 월요일 전에 확인된 작업은 바로, 그 뒤 확인된 작업은 다음 월요일)">
          <Head cols={['인플루언서', '유형', '캠페인', '작업 금액', '게시 확인', '못 넘어간 이유']} />
          <tbody>
            {blocked.map((r) => (
              <Row key={r.cand.taskId} r={r} err={rowErr[r.cand.taskId]}>
                <td className={`${CELL} text-ui`}><Issues issues={r.blocking} campaignId={r.cand.campaignId} /></td>
              </Row>
            ))}
          </tbody>
        </Group>
      )}

      {waiting.length > 0 && (
        <Group title={`다음 월요일에 보내요 ${waiting.length}`} sub={`${whenLabel(s.nextSendAt)}에 한꺼번에 보내요 · 그 전에 고친 금액·결제 수단이 그대로 반영돼요`}>
          <Head cols={['인플루언서', '유형', '캠페인', '작업 금액', '송금액', '결제 수단', '보내는 때', '']} />
          <tbody>
            {waiting.map((r) => (
              <Row key={r.cand.taskId} r={r} err={rowErr[r.cand.taskId]} noConfirm>
                <td className={`${CELL} ${NUM}`}>{r.cand.money ? formatMoney(r.cand.money.amountGross, r.cand.money.payoutCurrency) : '—'}</td>
                <td className={CELL}>{r.cand.method && <span className={METHOD_CHIP}>{PAYMENT_TYPE_LABEL[r.cand.method.type]}</span>}</td>
                <td className={`${CELL} text-ui text-x-secondary`}>{r.sendAt ? whenLabel(r.sendAt) : '곧 보내요'}</td>
                <Actions>
                  <Button onClick={() => setHoldTarget(r)} disabled={busy !== null}>보내지 않기</Button>
                  <Button onClick={() => void send(r)} disabled={busy !== null} title="월요일까지 기다리지 않고 지금 보내요 — 요청자는 내 이름이에요">
                    {busy === r.cand.taskId ? '보내는 중…' : '지금 보내기'}
                  </Button>
                </Actions>
              </Row>
            ))}
          </tbody>
        </Group>
      )}

      {stopped.length > 0 && (
        <Group title={`멈춘 작업 ${stopped.length}`} sub="보내지 않기로 했거나 요청이 취소된 작업 — 자동으로 다시 보내지 않아요. [보내기]를 누르면 바로 보내요">
          <Head cols={['인플루언서', '유형', '캠페인', '작업 금액', '멈춘 이유', '']} />
          <tbody>
            {stopped.map((r) => (
              <Row key={r.cand.taskId} r={r} err={rowErr[r.cand.taskId]} noConfirm extra={r.blocking.length > 0 ? <Issues issues={r.blocking} campaignId={r.cand.campaignId} prefix="보내려면 먼저: " /> : null}>
                <td className={`${CELL} text-ui text-x-muted`}>{stopReason(r)}</td>
                <Actions>
                  <Button onClick={() => void send(r)} disabled={busy !== null || r.blocking.length > 0}
                          title={r.blocking.length ? '아래 막힌 이유를 먼저 고쳐 주세요' : '지금 정산팀으로 보내요 — 요청자는 내 이름이에요'}>
                    {busy === r.cand.taskId ? '보내는 중…' : '보내기'}
                  </Button>
                </Actions>
              </Row>
            ))}
          </tbody>
        </Group>
      )}

      {holdTarget && <HoldDialog target={holdTarget} onClose={() => setHoldTarget(null)} onDone={() => { setHoldTarget(null); show('보내지 않기로 했어요 — 멈춘 작업에 있어요'); void load(); }} />}
    </section>
  );
}

// 맨 위 한 줄 — 오늘 자동으로 보낸 수 + 마지막 확인. 15분 넘게 확인이 없으면 빨간 줄(스펙 §7)
function RunLine({ summary: s, onGoRequests }: { summary: PendingSummary; onGoRequests: () => void }) {
  const stale = s.lastRunAgeMin !== null && s.lastRunAgeMin * 60_000 > AUTO_RUN_STALE_MS;
  return (
    <p className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-ui ${stale ? 'text-red-700' : 'text-x-secondary'}`}>
      {s.sentAutoToday > 0 && <span className="font-semibold text-emerald-700">오늘 자동으로 보낸 작업 {s.sentAutoToday}건</span>}
      <button type="button" onClick={onGoRequests} className="text-x-blue-text hover:underline">요청 내역에서 보기 →</button>
      {s.lastRunAt === null
        ? <span className="text-x-muted">· 자동 전송이 아직 켜지지 않았어요 — 급한 건은 [지금 보내기]로 보내요</span>
        : stale
          ? <span>· 자동 전송이 {s.lastRunAgeMin}분째 확인되지 않아요 (마지막 확인 {hhmm(s.lastRunAt)}) — 급한 건은 [지금 보내기]로 보내 주세요</span>
          : <span className="text-x-muted">· 마지막 확인 {hhmm(s.lastRunAt)}</span>}
    </p>
  );
}

function stopReason(r: PendingRow): string {
  const md = (iso: string | null) => (iso ? kstMonthDay(iso) : '');
  if (r.state.hold) return ['보내지 않기', md(r.state.hold.at), r.state.hold.byName, r.state.hold.reason].filter(Boolean).join(' · ');
  const c = r.state.cancelled;
  return ['요청 취소', md(c?.at ?? null), c?.byName, c?.reason].filter(Boolean).join(' · ');
}

function Group({ title, sub, foot, children }: { title: string; sub: string; foot?: string; children: ReactNode }) {
  return (
    <div className="mt-6">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-[16px] font-semibold">{title}</h2>
        <span className="text-ui text-x-muted">{sub}</span>
      </div>
      <div className="overflow-x-auto rounded-xl border border-x-border bg-white">
        <table className="w-full border-collapse">{children}</table>
      </div>
      {foot && <p className="mt-2 text-ui text-x-secondary">{foot}</p>}
    </div>
  );
}
function Head({ cols }: { cols: string[] }) {
  return <thead><tr>{cols.map((c, i) => <th key={i} className={`${HEAD} ${c === '작업 금액' || c === '송금액' ? 'text-right' : ''}`} aria-label={c || '처리'}>{c}</th>)}</tr></thead>;
}
// 공통 앞 칸 4~5개(인플·유형·캠페인·작업 금액·게시 확인) + 묶음별 칸. 막힌 이유·오류는 행 아래 한 줄.
function Row({ r, err, extra, noConfirm, children }: { r: PendingRow; err?: string; extra?: ReactNode; noConfirm?: boolean; children: ReactNode }) {
  const c = r.cand;
  const sub = extra || err;
  return (
    <>
      <tr className="text-[15px]">
        <td className={`${CELL} font-semibold ${sub ? 'border-b-0' : ''}`}>@{c.influencerHandle}</td>
        <td className={`${CELL} ${sub ? 'border-b-0' : ''}`}><span className={TYPE_CHIP[c.taskType]}>{TASK_TYPE_LABEL[c.taskType]}</span></td>
        <td className={`${CELL} ${sub ? 'border-b-0' : ''}`}>{c.campaignName} <span className="text-ui text-x-muted">· {c.clientName}</span></td>
        <td className={`${CELL} ${NUM} ${sub ? 'border-b-0' : ''}`}>{formatMoney(c.cost.amount, c.cost.currency)}</td>
        {!noConfirm && <td className={`${CELL} ${sub ? 'border-b-0' : ''}`}>{dayLabel(c.postedAt)}</td>}
        {children}
      </tr>
      {sub && (
        <tr>
          <td colSpan={9} className="border-b border-x-border/60 px-3 pb-2.5 pt-0 text-ui">
            {extra}
            {err && <span role="alert" className="ml-2 font-medium text-red-700">{err}</span>}
          </td>
        </tr>
      )}
    </>
  );
}
function Actions({ children }: { children: ReactNode }) {
  return <td className={`${CELL} text-right`}><span className="inline-flex items-center gap-1.5">{children}</span></td>;
}
// 막힌 이유 + 고칠 곳(CandidateRow와 같은 링크) — 첫 이유만 링크를 붙여 한 줄을 지킨다
function Issues({ issues, campaignId, prefix }: { issues: ReadinessIssue[]; campaignId: string; prefix?: string }) {
  const camp = `/campaigns/flow?id=${campaignId}`;
  const link: Partial<Record<ReadinessIssue['code'], [string, string]>> = {
    'no-payment-method': ['/influencers', '프로필에서 등록 →'], 'paypay-no-receiving-info': ['/influencers', '프로필에서 채우기 →'],
    'no-influencer': ['/influencers', '명부 →'], 'no-proof': [camp, '캠페인에서 넣기 →'], 'no-agreement': [camp, '캠페인에서 첨부 →'],
    'no-reference': [camp, '캠페인에서 넣기 →'], 'no-category': ['/settlement?tab=settings', '설정에서 정하기 →'],
  };
  return (
    <span className="text-red-700">
      {prefix}
      {issues.map((i, n) => (
        <span key={i.code}>{n > 0 && ' · '}{i.text}
          {/* 같은 페이지의 다른 탭(설정)은 a — Link는 같은 경로라 탭 상태가 그대로 남는다 */}
          {link[i.code] && (link[i.code]![0].startsWith('/settlement')
            ? <a href={link[i.code]![0]} className="ml-1.5 text-x-blue-text hover:underline">{link[i.code]![1]}</a>
            : <Link href={link[i.code]![0]} className="ml-1.5 text-x-blue-text hover:underline">{link[i.code]![1]}</Link>)}
        </span>
      ))}
    </span>
  );
}

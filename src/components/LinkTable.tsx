'use client';
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui';
import { RefreshIcon, TrashIcon } from '@/components/XIcons';
import { formatFull } from '@/lib/format';
import { kstDateTime } from '@/lib/datetime';
import { relTimeFine } from '@/lib/relTime';
import type { TrackingLinkRow, LinkClickSnapshotRow } from '@/lib/linkStore';
import { LinkClicksChart, type DailyClickPoint } from '@/components/LinkClicksChart';

export type LinkHistoryState = 'loading' | 'ready' | 'error';

// 표시 전용 표 — 정렬은 없다(최신 생성순 고정). 열 순서 = 읽기 동선:
// 누구에게(인플루언서) → 무엇으로(원고·캠페인) → 무엇을 줬나(단축 링크, 이 표의 제1 행동인 복사) →
// 결과(클릭) → 신선도(측정) → 행동. TrackingTable과 같은 골격이지만 폭 조절·선택은 없다
// (링크는 열이 7개뿐이라 폭을 다툴 이유가 없고, 삭제는 1건 단위다).
type ColKey = 'expand' | 'influencer' | 'draft' | 'campaign' | 'link' | 'clicks' | 'captured' | 'actions';
interface ColDef { key: ColKey; label: string; width: number; numeric?: boolean }

const COLS: ColDef[] = [
  { key: 'expand', label: '', width: 32 },
  { key: 'influencer', label: '인플루언서', width: 140 },
  { key: 'draft', label: '원고', width: 200 },
  { key: 'campaign', label: '캠페인', width: 150 },
  { key: 'link', label: '단축 링크', width: 280 },
  { key: 'clicks', label: '클릭', width: 140, numeric: true },
  { key: 'captured', label: '측정', width: 130 },
  { key: 'actions', label: '동작', width: 84 },
];
const TOTAL_WIDTH = COLS.reduce((sum, c) => sum + c.width, 0);

export function LinkTable({
  rows, refreshingIds, expandedId, onToggleExpand, history, historyState, daily, dailyState, onRefresh, onRemove,
}: {
  rows: TrackingLinkRow[];              // 이미 정렬·필터가 끝난 배열 — 여기서 순서를 바꾸지 않는다
  refreshingIds: ReadonlySet<string>;
  expandedId: string | null;            // 펼친 행 — 한 번에 하나(TrackingTable과 같은 이유)
  onToggleExpand: (id: string) => void;
  history: LinkClickSnapshotRow[];
  daily: DailyClickPoint[];              // 펼친 행의 최근 30일 일별 클릭(뷰가 소유·조회)
  dailyState: LinkHistoryState;      // 펼친 행의 클릭 이력(뷰가 소유·조회 — TrackingTable 관례)
  historyState: LinkHistoryState;
  onRefresh: (row: TrackingLinkRow) => void;
  onRemove: (row: TrackingLinkRow) => void;
}) {
  // 복사됨 표시는 2초 — 어느 행을 복사했는지가 정보라 boolean이 아니라 id를 들고 있는다
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current); }, []);

  const copy = useCallback((row: TrackingLinkRow) => {
    navigator.clipboard.writeText(row.shortUrl).then(() => {
      setCopiedId(row.id);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopiedId(null), 2000);
    }).catch(() => { /* 클립보드 거부 시 링크 자체가 화면에 있어 손으로 복사할 수 있다 */ });
  }, []);

  return (
    // 가로·세로 스크롤 컨테이너는 이 하나뿐 — sticky thead는 이 div를 기준으로 고정된다(TrackingTable 구조)
    <div className="max-h-[70vh] w-full overflow-auto">
      <table className="table-fixed border-collapse text-ui" style={{ width: `max(${TOTAL_WIDTH}px, 100%)` }}>
        <colgroup>
          {COLS.map((c) => <col key={c.key} style={{ width: c.width }} />)}
          {/* 채움 칸 — 폭 미지정이라 남는 공간을 전부 떠안는다(TrackingTable과 동일) */}
          <col />
        </colgroup>
        <thead className="sticky top-0 z-10 bg-white">
          <tr className="border-b border-x-border text-left text-caption text-x-muted">
            {COLS.map((c) => (
              c.key === 'expand'
                ? <th key={c.key} aria-hidden="true" />
                : (
                  <th key={c.key} scope="col"
                      title={c.key === 'clicks' ? '짧은 링크가 눌린 횟수 — 새로고침을 누른 순간의 값이에요' : undefined}
                      className={`overflow-hidden whitespace-nowrap px-3 py-2 font-normal ${c.numeric ? 'text-right' : 'text-left'}`}>
                    {c.label}
                  </th>
                )
            ))}
            {/* colgroup의 채움 칸과 짝을 이루는 빈 헤더 칸 — 데이터가 없어 보조기술 트리에서 뺀다 */}
            <th aria-hidden="true" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const busy = refreshingIds.has(r.id);
            const goneAt = r.unavailableAt;   // 좁혀둔 값을 그대로 쓴다 — 아래에서 non-null 단정을 피하려고
            const gone = goneAt !== null;
            const open = expandedId === r.id;
            const total = r.clicks?.totalClicks ?? null;
            const human = r.clicks?.humanClicks ?? null;
            return (
              <Fragment key={r.id}>
                <tr id={`link-${r.id}`} className="border-b border-x-border transition-colors hover:bg-x-hover">
                  {/* 펼침 — 이 링크의 클릭 이력을 바로 아래 행에 연다. 표를 떠나지 않고 과거 값을 본다 */}
                  <td className="px-1 py-2">
                    <button onClick={() => onToggleExpand(r.id)} aria-expanded={open}
                            title={open ? '클릭 이력 접기' : '클릭 이력 보기 — 그동안 쌓인 클릭 수'}
                            aria-label={open ? '클릭 이력 접기' : '클릭 이력 보기'}
                            className="rounded p-1 text-x-muted hover:bg-x-text/5 hover:text-x-secondary">
                      <span aria-hidden className="inline-block text-[11px] leading-none">{open ? '▼' : '▶'}</span>
                    </button>
                  </td>
                  <td className="truncate whitespace-nowrap px-3 py-2 text-x-secondary">@{r.influencerHandle}</td>
                  {/* 연결된 원고가 없는 링크도 있다(트래킹 화면에서 직접 만든 경우) — 없음을 '—'로 정직하게 */}
                  <td className="overflow-hidden px-3 py-2">
                    <span className="block min-w-0 truncate" title={r.draftLabel ?? undefined}>
                      {r.draftLabel ?? '—'}
                    </span>
                  </td>
                  <td className="truncate whitespace-nowrap px-3 py-2 text-x-secondary" title={`utm_campaign=${r.utmCampaign}`}>
                    {r.utmCampaign}
                  </td>
                  {/* 이 표의 제1 행동 = 인플루언서에게 줄 링크 복사. 표기는 도메인+경로만 —
                      https://가 폭을 먹는데 정보는 없다. 클릭하면 실제 링크가 열려 눈으로 확인된다 */}
                  <td className="overflow-hidden px-3 py-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <a href={r.shortUrl} target="_blank" rel="noreferrer"
                         title={`${r.shortUrl} — 새 탭에서 열어 도착지를 확인해요`}
                         className="min-w-0 flex-1 truncate text-x-blue-text hover:underline">
                        {r.shortUrl.replace(/^https?:\/\//, '')}
                      </a>
                      {/* 패딩·글자 크기는 Button 기본값을 그대로 쓴다 — px-2 같은 축소 override는
                          Tailwind CSS 순서상 variant의 px-3에 밀려 조용히 무시된다(TrackAddForm의 px-4는 반대로 이김) */}
                      <Button variant="subtle" onClick={() => copy(r)} className="shrink-0 whitespace-nowrap"
                              title="인플루언서에게 전달할 짧은 링크를 클립보드에 담아요">
                        {copiedId === r.id ? '복사됨 ✓' : '복사'}
                      </Button>
                    </div>
                  </td>
                  {/* 측정 전 = 실재하는 상태다(링크는 클릭 0에서 시작하므로 0과 '아직 안 봄'은 다른 말).
                      링크가 사라졌어도 마지막 값은 남긴다 — 지운 값이 0으로 보이면 거짓말이 된다 */}
                  <td className={`whitespace-nowrap px-3 py-2 text-right tabular-nums ${gone ? 'text-x-muted opacity-60' : 'text-x-text'}`}>
                    {r.clicks === null
                      ? <span className="text-caption text-x-muted">측정 전</span>
                      : <span title={human !== null ? `봇 제외 ${formatFull(human)}` : undefined}>{formatFull(total)}</span>}
                    {/* 링크 소실은 색이 아니라 글자로 말한다 — 무엇이 어긋났고 언제 확인했는지까지 */}
                    {goneAt !== null && (
                      // 좁은 칸이라 줄바꿈을 허용한다 — truncate로 잘리면 '언제 확인했는지'가 사라진다
                      <span className="mt-1 inline-block whitespace-normal rounded-full bg-amber-50 px-2 py-0.5 text-caption leading-tight text-amber-800"
                            title="짧은 링크를 short.io에서 찾지 못했어요 — 대시보드에서 지워졌는지 확인해 주세요">
                        링크 없음 · {relTimeFine(goneAt, '확인')}
                      </span>
                    )}
                  </td>
                  {/* 얼마나 최신인지가 판단 재료(새로고침을 누를지) — 상대 표기가 그 판단에 맞다.
                      정확한 시각은 title로, 이력 펼침으로 */}
                  <td className="truncate whitespace-nowrap px-3 py-2 text-x-secondary"
                      title={r.capturedAt ? kstDateTime(r.capturedAt) : undefined}>
                    {r.capturedAt ? relTimeFine(r.capturedAt, '측정') : '—'}
                  </td>
                  {/* 행마다 반복되는 액션은 글자 대신 아이콘(TrackingTable 관례) — 뜻은 title이 나른다 */}
                  <td className="whitespace-nowrap px-3 py-2">
                    <div className="flex items-center gap-0.5">
                      <Button variant="icon" onClick={() => onRefresh(r)} disabled={busy}
                              title="지금 클릭 수를 다시 가져와요 (API 호출 1회)" aria-label="클릭 수 새로고침">
                        <RefreshIcon className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} />
                      </Button>
                      <Button variant="icon" onClick={() => onRemove(r)}
                              title="목록에서 빼기 — 짧은 링크 자체는 계속 열려요(쌓인 클릭 기록은 지워져요)"
                              aria-label="목록에서 빼기">
                        <TrashIcon className="h-4 w-4" />
                      </Button>
                    </div>
                  </td>
                  <td aria-hidden="true" />
                </tr>
                {open && <ClickHistory link={r} rows={history} state={historyState} daily={daily} dailyState={dailyState} />}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// 클릭 이력 — 펼친 행 바로 아래에 부모 표의 열 그대로 이어 그린다(최신이 위, TrackingTable의 펼침 문법).
// 클릭 수가 부모의 '클릭' 열 바로 아래 세로로 정렬돼야 "이 숫자가 어떻게 늘었나"가 읽힌다.
// 왼쪽(인플루언서·원고·캠페인·링크)은 비운다 — 부모와 같은 값을 반복하면 표가 두 벌로 보인다.
// 헤더도 없다: 부모 헤더가 위에 고정돼 있어 그 자리가 곧 이 값의 이름이다.
// 봇 제외 값은 총 클릭 아래에 붙인다 — 같은 지표의 두 번째 값이라 옆 칸(다른 열)으로 보내면 뜻이 어긋난다.
// 그래프가 아니라 숫자인 이유: 수동 새로고침이라 간격이 불규칙해 점 두세 개짜리 곡선은 오해를 부른다.
function ClickHistory({ link, rows, state, daily, dailyState }: {
  link: TrackingLinkRow; rows: LinkClickSnapshotRow[]; state: LinkHistoryState;
  daily: DailyClickPoint[]; dailyState: LinkHistoryState;
}) {
  // 펼침의 정보 위계(koo QA 08-25 확정): ① 원본 링크(무슨 링크인지) ② 최근 7일 클릭(어떻게 반응했는지) ③ 측정 이력(우리가 잰 기록)
  const total30 = daily.reduce((a, p) => a + p.clicks, 0);
  const chart = (
    <tr className="bg-x-surface/60">
      <td />
      <td colSpan={COLS.length} className="py-2 pl-3 pr-3">
        <p className="text-caption text-x-muted">
          최근 7일 클릭{dailyState === 'ready' && <b className="ml-1.5 text-x-secondary">합계 {total30}</b>}
        </p>
        {dailyState === 'loading' && <p className="mt-1 text-caption text-x-muted">클릭 추이 불러오는 중…</p>}
        {dailyState === 'error' && <p className="mt-1 text-caption text-x-secondary">클릭 추이를 가져오지 못했어요 — 접었다 다시 열어보세요</p>}
        {dailyState === 'ready' && <LinkClicksChart points={daily} />}
      </td>
    </tr>
  );
  // 원본 링크 확인(koo QA 08-25): 단축 링크가 실제로 어디로 가는지 — 랜딩 원본과 UTM 붙은 최종 주소.
  // 검수·공유 양쪽에 쓰이므로 복사 버튼을 각각 둔다.
  const [copied, setCopied] = useState<'landing' | 'long' | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current); }, []);
  const copyUrl = (kind: 'landing' | 'long', url: string) => {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(kind);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(null), 2000);
    }).catch(() => {});
  };
  const urls = (
    <tr className="bg-x-surface/60">
      <td />
      <td colSpan={COLS.length} className="py-1.5 pl-3 pr-3">
        <p className="text-caption text-x-muted">원본 링크</p>
        {/* 행 카드(원고 카드 섹션과 같은 문법): 긴 UTM 주소는 한 줄 말줄임 — 전체는 hover(title)와 복사로.
            break-all로 두세 줄 꺾이면 파라미터 덩어리가 화면을 채워 정작 '어디로 가는지'를 못 읽는다. */}
        {([['landing', '랜딩 원본', link.landingUrl], ['long', 'UTM 포함 최종', link.longUrl]] as const).map(([kind, label, url]) => (
          <div key={kind} className="mt-1 flex items-center gap-2 rounded-md border border-x-border bg-white px-2.5 py-1.5">
            <span className="w-[92px] shrink-0 text-caption text-x-muted">{label}</span>
            <a href={url} target="_blank" rel="noreferrer" title={url}
               className="min-w-0 flex-1 truncate text-[13px] text-x-blue-text hover:underline">{url}</a>
            <button onClick={() => copyUrl(kind, url)}
                    className="shrink-0 rounded-full border border-x-border-strong px-2.5 py-0.5 text-caption text-x-secondary transition-colors hover:bg-x-hover">
              {copied === kind ? '복사됨 ✓' : '복사'}
            </button>
          </div>
        ))}
      </td>
    </tr>
  );
  const note = (text: string) => (
    <tr className="border-b border-x-border bg-x-surface/60">
      <td colSpan={COLS.length + 1} className="py-2 pl-14 text-caption text-x-muted">{text}</td>
    </tr>
  );
  if (state === 'loading') return <>{urls}{chart}{note('클릭 이력 불러오는 중…')}</>;
  if (state === 'error') return <>{urls}{chart}{note('클릭 이력을 불러오지 못했어요 — 접었다 다시 열어보세요')}</>;
  if (rows.length === 0) return <>{urls}{chart}{note('아직 클릭 기록이 없어요 — 새로고침을 누르면 지금 값이 기록돼요')}</>;

  return (
    <>
      {urls}
      {chart}
      {rows.map((s, i) => {
        const last = i === rows.length - 1;
        return (
          <tr key={s.capturedAt} className={`bg-x-surface/60 ${last ? 'border-b border-x-border' : ''}`}>
            <td />
            {/* 인플루언서 자리: 이 줄들이 위 행의 이력임을 말하는 표시 — 첫 줄에만 적어 반복을 줄인다 */}
            <td className="whitespace-nowrap py-1 pl-3 text-caption text-x-muted">
              {i === 0 && `클릭 이력 ${rows.length}건${rows.length >= 50 ? ' (최근 50)' : ''}`}
            </td>
            <td /><td /><td />
            <td className="whitespace-nowrap px-3 py-1 text-right text-x-secondary tabular-nums">
              {formatFull(s.totalClicks)}
              {s.humanClicks !== null && (
                <span className="block text-caption text-x-muted">봇 제외 {formatFull(s.humanClicks)}</span>
              )}
            </td>
            <td className="whitespace-nowrap px-3 py-1 text-x-secondary tabular-nums">{kstDateTime(s.capturedAt)}</td>
            <td /><td />
          </tr>
        );
      })}
    </>
  );
}

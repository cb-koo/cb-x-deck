// 인플루언서 성과 표 — 인플 1명 = 한 줄, 성과 지표를 묶음(이력·게시한 작업·노출·참여율·반응·확산)으로 나란히. 스펙 2026-09-30 §4·§5·§12·§13·§14
// 펼친 작업은 같은 표의 행(같은 colgroup)으로 넣는다 — 작업 숫자가 부모 숫자와 같은 세로줄에 선다(스펙 §13.2).
// 표 모양은 정산 표 공용 모양(HEAD·CELL·NUM)을 그대로 쓴다 — 다른 화면 표와 같아 보이게(스펙 §12-1).
'use client';
import { Fragment } from 'react';
import Link from 'next/link';
import { Avatar } from '@/components/Avatar';
import { BlueCheckIcon } from '@/components/XIcons';
import { TASK_TYPE_LABEL, type TaskType } from '@/lib/campaignJudgment';
import { DISPLAY_TYPE_ORDER } from '@/lib/campaignFlowView';
import { formatAmount } from '@/lib/campaignCost';
import { HEAD, CELL, NUM } from '@/app/settlement/tableStyle';
import {
  formatMetric, taskEngagement, taskCpv, taskPerfState, isPosted, perfEmptyReason,
  type PerfRow, type PerfTask, type SortKey, type Agg, type MetricKey, type SortDir,
} from '@/lib/influencerPerformance';

interface Col { key: SortKey; label: string; width: number; help?: string }
interface Group { label: string; cols: Col[] }

// 묶음 순서(스펙 §4): 이력 · 게시한 작업 · 노출 · 참여율 · 반응 · 확산 — 관련 지표끼리 붙인다(koo 09-30)
const ENGAGEMENT_HELP = '공개 반응(좋아요·답글·북마크·RT·인용) ÷ 조회 · X 분석 화면보다 낮게 나와요 (클릭 수 미포함)';
// 표를 한 화면에 맞추려 폭을 줄였다(스펙 리뷰 09-30) — 1440px 노트북(사이드바 208px 제외)에서 가로 스크롤 없이 전 열이 보이게.
// 게시한 작업 묶음은 유형별 라벨 길이가 달라 균일 폭이 아니다 — '인용RT'·'방문협찬'은 좁히면 헤더 글자가 넘쳐 실측(13px)으로 늘렸다.
// QA 2차(스펙 §13.3): 큰 수를 전체 숫자로 보이며 폭을 다시 나눴다(합계 1168px 유지, 15px 시스템 글꼴 실측).
// 반응·확산 64→68('1,234' 41px + 여백 24px), 조회 96→88('528,625' 60px), 조회당 비용 88→80('999.9원' 54px),
// 캠페인 60→56·최근 게시일 88→80(머리 글자 기준), 남은 8px은 인플 칸(펼친 행의 캠페인 이름)에.
const TASK_TYPE_COL_WIDTH: Record<TaskType, number> = { post: 52, quoteRt: 68, rt: 48, visit: 72 };
const GROUPS: Group[] = [
  { label: '이력', cols: [{ key: 'campaigns', label: '캠페인', width: 56 }, { key: 'lastPosted', label: '최근 게시일', width: 80 }] },
  // '게시한 작업' — 예정 작업은 세지 않아 캠페인 화면(예정 포함) 건수와 다를 수 있음을 이름으로 드러낸다(스펙 §12-3)
  { label: '게시한 작업', cols: DISPLAY_TYPE_ORDER.map((t) => ({ key: `n_${t}` as SortKey, label: TASK_TYPE_LABEL[t], width: TASK_TYPE_COL_WIDTH[t] })) },
  { label: '노출', cols: [{ key: 'views', label: '조회', width: 88 }, { key: 'cpv', label: '조회당 비용', width: 80 }] },
  { label: '', cols: [{ key: 'engagement', label: '참여율', width: 76, help: ENGAGEMENT_HELP }] },
  { label: '반응', cols: [{ key: 'likes', label: '좋아요', width: 68 }, { key: 'replies', label: '답글', width: 68 }, { key: 'bookmarks', label: '북마크', width: 68 }] },
  { label: '확산', cols: [{ key: 'retweets', label: 'RT수', width: 68 }, { key: 'quotes', label: '인용수', width: 68 }] },
];
const METRIC_COLS = new Set<SortKey>(['views', 'cpv', 'engagement', 'likes', 'replies', 'bookmarks', 'retweets', 'quotes']);
const NAME_WIDTH = 208;
const md = (ymd: string | null) => (ymd ? `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}` : '—');

// 묶음 첫 칸 = 왼쪽 흐린 구분선(머리·몸통 모두) — 세로선은 묶음 경계에만(스펙 §12-1). 첫 묶음(이력)은 sticky 인플 칸의
// 오른쪽 그림자 선이 이미 경계를 그어주므로 겹치는 이중선을 만들지 않는다.
const GROUP_FIRST = new Set<SortKey>(GROUPS.slice(1).map((g) => g.cols[0].key));
const DIVIDER = 'border-l border-l-x-border';
const ALL_COLS = GROUPS.flatMap((g) => g.cols);
const TABLE_WIDTH = NAME_WIDTH + ALL_COLS.reduce((s, c) => s + c.width, 0);
// 고정 열 오른쪽 구분선 — border-collapse에서 border는 sticky와 같이 안 움직여 그림자 선으로 긋는다
const STICKY_EDGE = 'shadow-[inset_-1px_0_0_var(--color-x-border)]';
// 묶음 이름 줄 — 열 머리(HEAD)와 같은 배경 위에 작고 흐리게. 아래선 없이 열 이름 줄과 한 덩어리로 보이게.
const GROUP_HEAD = 'whitespace-nowrap bg-x-surface px-2 pb-0 pt-2 text-center text-caption font-medium text-x-muted';

const isCountKey = (key: SortKey): boolean => key.startsWith('n_');
// 노출~확산 열 = 성과 값 자리(부모·자식 행 같은 열 순서). 성과 열은 표 끝에 붙어 있어 나머지 열 뒤에 합친 칸 하나로 대신할 수 있다
const PERF_COLS = ALL_COLS.filter((c) => METRIC_COLS.has(c.key));
const NON_PERF_COLS = ALL_COLS.filter((c) => !METRIC_COLS.has(c.key));

function cellText(r: PerfRow, key: SortKey, agg: Agg): string {
  if (METRIC_COLS.has(key)) return formatMetric(key as MetricKey, r.stats[key as MetricKey][agg]);
  if (key === 'campaigns') return String(r.campaignCount);
  if (key === 'lastPosted') return md(r.lastPostedAt);
  // 작업 건수는 항상 셀 수 있는 값(0건도 '앎')이라 '—'(모름)를 쓰지 않는다 — 0도 숫자로, 흐린 색만 유지
  return String(r.typeCounts[key.slice(2) as TaskType]);
}

// 값 없음('—')과 건수 0은 흐리게 — 숫자와 섞여도 눈이 값 있는 숫자에만 가게
const Val = ({ v, muted }: { v: string; muted?: boolean }) =>
  (muted ?? v === '—') ? <span className="text-x-muted">{v}</span> : <>{v}</>;

export function InfluencerPerfTable({ rows, agg, sort, dir, onSort, expanded, onToggle }: {
  rows: PerfRow[];              // 이미 정렬된 배열 — 여기서 순서를 바꾸지 않는다(PerformanceTable 관례)
  agg: Agg; sort: SortKey; dir: SortDir;
  onSort: (key: SortKey) => void;
  expanded: Set<string>; onToggle: (handle: string) => void;
}) {
  return (
    // 표 칸이 가로·세로 스크롤을 모두 맡는다 — overflow-x만 두면 thead의 sticky top이 이 칸에 갇혀 안 걸린다(스펙 §18-1).
    // 높이는 page.tsx의 세로 flex가 남은 화면만큼으로 줄인다(min-h-0).
    // border-separate(간격 0): border-collapse에선 선이 sticky 칸과 같이 안 움직여 머리 아래선이 스크롤 때 떨어진다.
    // 칸마다 아래선·왼쪽 구분선만 있어 겹치는 선이 없으니 모양은 collapse와 같다.
    <div className="min-h-0 w-full overflow-auto rounded-xl border border-x-border">
      <table className="table-fixed border-separate border-spacing-0 text-content" style={{ width: `max(${TABLE_WIDTH}px, 100%)` }}>
        <colgroup>
          <col style={{ width: NAME_WIDTH }} />
          {ALL_COLS.map((c) => <col key={c.key} style={{ width: c.width }} />)}
        </colgroup>
        {/* 머리 두 줄을 thead째 위에 고정 — 줄마다 top을 재지 않아도 둘이 함께 붙는다. z-30 > 몸통 고정 열(z-10) */}
        <thead className="sticky top-0 z-30">
          {/* 1줄 = 묶음 이름 */}
          <tr>
            {/* HEAD의 bg-x-surface는 불투명 — 가로 스크롤 때 밑으로 지나가는 칸이 비치지 않는다 */}
            {/* 모서리 칸 = 위(thead)·왼쪽 둘 다 고정, thead 안에서 가장 위(z-20) — 가로 스크롤 때 묶음 이름 칸이 밑으로 지나간다 */}
            <th rowSpan={2} scope="col" className={`${HEAD} sticky left-0 z-20 ${STICKY_EDGE}`}>
              인플
            </th>
            {GROUPS.map((g, i) => (
              <th key={g.cols[0].key} colSpan={g.cols.length} scope="colgroup"
                  className={`${GROUP_HEAD} ${i > 0 ? DIVIDER : ''}`}>
                {g.label}
              </th>
            ))}
          </tr>
          {/* 2줄 = 열 이름(누르면 그 기준으로 줄 세우기) */}
          <tr>
            {ALL_COLS.map((c) => {
              const active = sort === c.key;
              const helpId = c.help ? `${c.key}-help` : undefined;
              return (
                <th key={c.key} scope="col"
                    aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                    className={`${HEAD} p-0! ${GROUP_FIRST.has(c.key) ? DIVIDER : ''}`}>
                  {/* 여백은 칸(th)이 아니라 버튼이 가진다(p-0!로 HEAD 여백을 끔) — 누르는 영역이 칸 전체.
                      정렬 화살표는 절대 위치(레이아웃 폭을 차지하지 않음) + 좁은 여백(px-2) — 64px처럼 좁은 칸에서
                      화살표가 라벨을 밀어 왼쪽 구분선 밖으로 넘치는 것을 막는다(스펙 리뷰 09-30 fix round 2) */}
                  <button type="button" onClick={() => onSort(c.key)} title={c.help} aria-describedby={helpId}
                          className={`relative flex h-9 w-full items-center justify-end gap-0.5 px-2 font-semibold hover:text-x-text ${active ? 'text-x-text' : ''}`}>
                    {c.label}
                    {c.help && <span aria-hidden className="text-caption text-x-muted">ⓘ</span>}
                    {active && (
                      <span aria-hidden
                            className="pointer-events-none absolute right-0.5 top-1/2 -translate-y-1/2 text-[10px]">
                        {dir === 'asc' ? '▲' : '▼'}
                      </span>
                    )}
                  </button>
                  {c.help && <span id={helpId} className="sr-only">{c.help}</span>}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const open = expanded.has(r.handle);
            const name = r.displayName || r.handle;
            const emptyReason = perfEmptyReason(r);
            return (
              <Fragment key={r.handle}>
                {/* 행 전체 클릭 = 펼치기. 키보드는 이름 칸 버튼(클릭이 행으로 올라가 한 번만 토글된다).
                    펼친 행만 옅은 파랑(스펙 §14, #f2f8fd) — 불투명색을 쓴다(bg-x-blue/5는 반투명이라 sticky 칸과 겹쳐 두 배로
                    진해지고, 가로 스크롤 때 밑 칸이 비친다 — HEAD·기존 CHILD_BG가 불투명을 쓰는 이유와 같다).
                    hover는 더 진한 같은 계열의 불투명색으로, 파랑이 지워지지 않게 */}
                <tr onClick={() => onToggle(r.handle)}
                    className={`group cursor-pointer ${open ? 'bg-[#f2f8fd] hover:bg-[#e8f3fc]' : 'hover:bg-x-hover'}`}>
                  {/* 인플 칸 = 사진 + @핸들 하나만 — 핸들 전체·이름은 마우스를 올리면(title) 보인다(스펙 §12-1·§18-3).
                      사진 24px·좁은 간격으로 핸들 글자 폭을 조금 더 확보(칸 폭 208px은 그대로).
                      @핸들은 명부에 있으면(influencerId) 프로필 링크 — 펼침 버튼 밖에 둬(버튼 안에 링크는 안 되는 HTML) 클릭이 이동만 하고 토글은 안 되게(스펙 §14) */}
                  <td className={`${CELL} sticky left-0 z-10 ${STICKY_EDGE} ${open ? 'bg-[#f2f8fd] group-hover:bg-[#e8f3fc]' : 'bg-white group-hover:bg-x-hover'}`}
                      title={r.displayName ? `@${r.handle} · ${r.displayName}` : `@${r.handle}`}>
                    <div className="flex w-full min-w-0 items-center gap-1.5">
                      <button type="button" aria-expanded={open} aria-label={`${name} 작업 ${open ? '접기' : '펼치기'}`}
                              className="flex min-w-0 shrink-0 items-center gap-1 text-left">
                        <span aria-hidden className="w-3 shrink-0 text-[10px] text-x-muted">{open ? '▼' : '▶'}</span>
                        <Avatar url={r.avatarUrl} name={name} size={24} />
                      </button>
                      {r.influencerId ? (
                        <Link href={`/influencers?i=${r.influencerId}`} onClick={(e) => e.stopPropagation()}
                              className="truncate font-medium hover:underline">
                          @{r.handle}
                        </Link>
                      ) : (
                        <span className="truncate font-medium">@{r.handle}</span>
                      )}
                      {r.isBlueVerified && <BlueCheckIcon className="h-4 w-4 shrink-0" />}
                    </div>
                  </td>
                  {(emptyReason ? NON_PERF_COLS : ALL_COLS).map((c) => {
                    const text = cellText(r, c.key, agg);
                    return (
                      <td key={c.key} className={`${CELL} ${NUM} ${GROUP_FIRST.has(c.key) ? DIVIDER : ''}`}>
                        <Val v={text} muted={isCountKey(c.key) ? text === '0' : undefined} />
                      </td>
                    );
                  })}
                  {/* 성과 8칸이 전부 비면 '—' 여덟 개 대신 노출~확산을 합친 한 칸에 이유 한 줄(스펙 §18-4).
                      왼쪽 구분선은 노출 묶음 경계 그대로. 정렬 시 값 없음 → 맨 아래 규칙은 그대로다 */}
                  {emptyReason && (
                    <td colSpan={PERF_COLS.length} title={emptyReason}
                        className={`${CELL} truncate text-center text-x-muted ${DIVIDER}`}>
                      {emptyReason}
                    </td>
                  )}
                </tr>
                {open && <TaskRows row={r} />}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// 펼친 행 — 작업마다 부모와 같은 표의 한 행(스펙 §13.2). 순서는 게시일 내림차순·게시 전은 맨 아래(summarizeInfluencer가 정렬).
// 자식 행에는 클릭 핸들러가 없다 — 펼치기/접기는 부모 행만 한다.
// 흰 바탕·글자 한 단계 흐리게(text-x-secondary)·14px(스펙 §14) — 색·크기는 행(tr)에 둬 자식 칸이 물려받게 하고,
// 값 없음(text-x-muted)·↗ 링크(text-x-blue-text) 같은 칸별 글자색은 그 칸 자신에 그대로 둬 상속을 덮어쓰게 한다.
const CHILD_ROW = 'bg-white text-x-secondary text-[14px]';
const CHILD_BG = 'bg-white';
const CHILD_CELL = `${CELL} h-10!`;
// 묶음 끝(그 인플의 마지막 작업 행) 아래는 진한 선으로 다음 인플과 구분(스펙 §14).
// border-b- 만 지정(양쪽 다 지정하는 border- 대신) — DIVIDER의 왼쪽 세로 구분선(border-l-x-border) 색은 그대로 둔다.
const LAST_ROW_BORDER = 'border-b-x-border-strong!';
// 게시한 작업 4열(투고~방문협찬)을 합친 한 칸 = '유형 · 비용'
const TASK_TYPE_SPAN = DISPLAY_TYPE_ORDER.length;
const TYPE_FIRST_KEY = `n_${DISPLAY_TYPE_ORDER[0]}` as SortKey;

function taskMetricText(t: PerfTask, key: MetricKey): string {
  if (key === 'engagement') return formatMetric('engagement', taskEngagement(t.metrics));
  if (key === 'cpv') return formatMetric('cpv', taskCpv(t));
  return formatMetric(key, t.metrics?.[key] ?? null);
}

// 성과가 없는 작업의 사유(스펙 §13.2 우선순위) — 삭제됨 > RT 안내 > 게시 전(—) > 수집 전
function reasonCell(t: PerfTask): { text: string; title?: string } | null {
  switch (taskPerfState(t)) {
    case 'removed':
      return {
        text: t.removedReason ? `삭제됨 · ${t.removedReason}` : '삭제됨',
        title: `${t.removedAt ? `${md(t.removedAt)} 게시물이 내려가` : '게시물이 내려가'} 평균·중앙값에서 빠졌어요`,
      };
    case 'rt': return { text: 'RT는 조회가 원글에 쌓여요' };
    case 'unposted': return { text: '—' };   // 게시일 칸이 이미 '게시 전'이라고 말한다
    case 'uncollected': return { text: '수집 전', title: '조회 수치가 아직 없어 평균·중앙값에서 빠졌어요' };
    default: return null;
  }
}

function TaskRows({ row }: { row: PerfRow }) {
  return (
    <>
      {row.tasks.map((t, i) => {
        const reason = reasonCell(t);
        const typeCost = t.cost
          ? `${TASK_TYPE_LABEL[t.type]} · ${formatAmount(t.cost.amount, t.cost.currency)}`
          : TASK_TYPE_LABEL[t.type];
        const last = i === row.tasks.length - 1;
        const border = last ? LAST_ROW_BORDER : '';
        return (
          <tr key={t.id} className={CHILD_ROW}>
            {/* 인플 칸 = 캠페인 이름(들여쓰기 pl-4 = 부모 행 사진 왼쪽 끝: 화살표 12px + 간격 4px · 한 줄 말줄임) + ↗ 원 게시물 */}
            <td className={`${CHILD_CELL} sticky left-0 z-10 ${CHILD_BG} ${STICKY_EDGE} ${border}`}>
              <div className="flex min-w-0 items-center gap-1 pl-4">
                <span className="truncate" title={t.campaignName}>{t.campaignName}</span>
                {t.postUrl && (
                  <a href={t.postUrl} target="_blank" rel="noopener noreferrer"
                     title="X 게시물 새 창으로 열기" aria-label={`${t.campaignName} X 게시물 새 창으로 열기`}
                     onClick={(e) => e.stopPropagation()}
                     className="shrink-0 px-1 text-x-blue-text hover:underline">↗</a>
                )}
              </div>
            </td>
            {/* 캠페인 열은 비움 · 최근 게시일 열 = 그 작업의 게시일 */}
            <td className={`${CHILD_CELL} ${border}`} />
            <td className={`${CHILD_CELL} ${NUM} ${border} ${t.postedAt ? '' : 'text-x-muted'}`}>
              {t.postedAt ? md(t.postedAt) : isPosted(t) ? '—' : '게시 전'}
            </td>
            <td colSpan={TASK_TYPE_SPAN}
                className={`${CHILD_CELL} truncate ${border} ${GROUP_FIRST.has(TYPE_FIRST_KEY) ? DIVIDER : ''}`} title={typeCost}>
              {typeCost}
            </td>
            {reason ? (
              <td colSpan={PERF_COLS.length} title={reason.title}
                  className={`${CHILD_CELL} truncate text-center text-x-muted ${border} ${DIVIDER}`}>
                {reason.text}
              </td>
            ) : PERF_COLS.map((c) => (
              <td key={c.key} className={`${CHILD_CELL} ${NUM} ${border} ${GROUP_FIRST.has(c.key) ? DIVIDER : ''}`}>
                <Val v={taskMetricText(t, c.key as MetricKey)} />
              </td>
            ))}
          </tr>
        );
      })}
    </>
  );
}

// 인플루언서 성과 표 — 인플 1명 = 한 줄, 성과 지표를 묶음(이력·작업·노출·참여율·반응·확산)으로 나란히. 스펙 2026-09-30 §4·§5
'use client';
import { Fragment, type ReactNode } from 'react';
import Link from 'next/link';
import { Avatar } from '@/components/Avatar';
import { BlueCheckIcon } from '@/components/XIcons';
import { TASK_TYPE_LABEL, type TaskType } from '@/lib/campaignJudgment';
import { DISPLAY_TYPE_ORDER } from '@/lib/campaignFlowView';
import { formatAmount } from '@/lib/campaignCost';
import {
  formatMetric, viewsSampleNote, taskEngagement, CONTENT_TYPES,
  type PerfRow, type PerfTask, type SortKey, type Agg, type MetricKey, type SortDir,
} from '@/lib/influencerPerformance';

interface Col { key: SortKey; label: string; width: number; help?: string }
interface Group { label: string; cols: Col[] }

// 묶음 순서(스펙 §4): 이력 · 작업 · 노출 · 참여율 · 반응 · 확산 — 관련 지표끼리 붙인다(koo 09-30)
const ENGAGEMENT_HELP = '공개 반응(좋아요·답글·북마크·RT·인용) ÷ 조회 · X 분석 화면보다 낮게 나와요 (클릭 수 미포함)';
// 표를 한 화면에 맞추려 폭을 줄였다(스펙 리뷰 09-30) — 1440px 노트북(사이드바 208px 제외)에서 가로 스크롤 없이 전 열이 보이게.
// 작업 묶음은 유형별 라벨 길이가 달라 균일 폭이 아니다 — '인용RT'·'방문협찬'은 좁히면 헤더 글자가 넘쳐 실측(Geist 13px bold)으로 늘렸다.
const TASK_TYPE_COL_WIDTH: Record<TaskType, number> = { post: 52, quoteRt: 68, rt: 48, visit: 72 };
const GROUPS: Group[] = [
  { label: '이력', cols: [{ key: 'campaigns', label: '캠페인', width: 60 }, { key: 'lastPosted', label: '최근 게시일', width: 88 }] },
  { label: '작업', cols: DISPLAY_TYPE_ORDER.map((t) => ({ key: `n_${t}` as SortKey, label: TASK_TYPE_LABEL[t], width: TASK_TYPE_COL_WIDTH[t] })) },
  { label: '노출', cols: [{ key: 'views', label: '조회', width: 96 }, { key: 'cpv', label: '조회당 비용', width: 88 }] },
  { label: '', cols: [{ key: 'engagement', label: '참여율', width: 76, help: ENGAGEMENT_HELP }] },
  { label: '반응', cols: [{ key: 'likes', label: '좋아요', width: 64 }, { key: 'replies', label: '답글', width: 64 }, { key: 'bookmarks', label: '북마크', width: 64 }] },
  { label: '확산', cols: [{ key: 'retweets', label: 'RT수', width: 64 }, { key: 'quotes', label: '인용수', width: 64 }] },
];
const METRIC_COLS = new Set<SortKey>(['views', 'cpv', 'engagement', 'likes', 'replies', 'bookmarks', 'retweets', 'quotes']);
const NAME_WIDTH = 200;
const md = (ymd: string | null) => (ymd ? `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}` : '—');

// 묶음 첫 칸 = 왼쪽 구분선(머리·몸통 모두) — 묶음이 눈으로 갈라져 보이게. 첫 묶음(이력)은 sticky 인플 칸의
// 오른쪽 그림자 선이 이미 경계를 그어주므로 겹치는 이중선을 만들지 않는다.
const GROUP_FIRST = new Set<SortKey>(GROUPS.slice(1).map((g) => g.cols[0].key));
const ALL_COLS = GROUPS.flatMap((g) => g.cols);
const TABLE_WIDTH = NAME_WIDTH + ALL_COLS.reduce((s, c) => s + c.width, 0);
// 고정 열 오른쪽 구분선 — border-collapse에서 border는 sticky와 같이 안 움직여 그림자 선으로 긋는다
const STICKY_EDGE = 'shadow-[inset_-1px_0_0_var(--color-x-border-strong)]';

const isCountKey = (key: SortKey): boolean => key.startsWith('n_');

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
    <div className="w-full overflow-x-auto rounded-xl border border-x-border">
      <table className="table-fixed border-collapse text-content" style={{ width: `max(${TABLE_WIDTH}px, 100%)` }}>
        <colgroup>
          <col style={{ width: NAME_WIDTH }} />
          {ALL_COLS.map((c) => <col key={c.key} style={{ width: c.width }} />)}
        </colgroup>
        <thead className="text-ui text-x-secondary">
          {/* 1줄 = 묶음 이름 */}
          <tr>
            <th rowSpan={2} scope="col"
                className={`sticky left-0 z-20 whitespace-nowrap border-b border-x-border-strong bg-white px-4 py-2.5 text-left font-bold ${STICKY_EDGE}`}>
              인플
            </th>
            {GROUPS.map((g, i) => (
              <th key={g.cols[0].key} colSpan={g.cols.length} scope="colgroup"
                  className={`whitespace-nowrap border-b border-x-border pb-1 pt-2 text-center text-ui font-medium text-x-muted ${i > 0 ? 'border-l' : ''}`}>
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
                    className={`whitespace-nowrap border-b border-x-border-strong p-0 font-bold ${GROUP_FIRST.has(c.key) ? 'border-l border-l-x-border' : ''}`}>
                  {/* 정렬 화살표는 절대 위치(레이아웃 폭을 차지하지 않음) + 헤더 여백 축소(px-2) — 64px처럼 좁은 칸에서
                      화살표가 라벨을 밀어 왼쪽 구분선 밖으로 넘치는 것을 막는다(스펙 리뷰 09-30 fix round 2) */}
                  <button type="button" onClick={() => onSort(c.key)} title={c.help} aria-describedby={helpId}
                          className={`relative flex h-10 w-full items-center justify-end gap-0.5 px-2 hover:text-x-text ${active ? 'text-x-text' : ''}`}>
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
            const note = viewsSampleNote(r);
            return (
              <Fragment key={r.handle}>
                {/* 행 전체 클릭 = 펼치기. 키보드는 이름 칸 버튼(클릭이 행으로 올라가 한 번만 토글된다) */}
                <tr onClick={() => onToggle(r.handle)}
                    className="group h-12 cursor-pointer border-b border-x-border hover:bg-x-hover">
                  <td className={`sticky left-0 z-10 bg-white px-4 group-hover:bg-x-hover ${STICKY_EDGE}`}>
                    <button type="button" aria-expanded={open} aria-label={`${name} 작업 ${open ? '접기' : '펼치기'}`}
                            className="flex w-full min-w-0 items-center gap-2 text-left">
                      <span aria-hidden className="w-3 shrink-0 text-[10px] text-x-muted">{open ? '▼' : '▶'}</span>
                      <Avatar url={r.avatarUrl} name={name} size={28} />
                      <span className="truncate font-semibold">{name}</span>
                      {r.isBlueVerified && <BlueCheckIcon className="h-4 w-4" />}
                      {r.displayName && <span className="truncate text-ui text-x-muted">@{r.handle}</span>}
                    </button>
                  </td>
                  {ALL_COLS.map((c) => {
                    const text = cellText(r, c.key, agg);
                    return (
                      <td key={c.key}
                          className={`whitespace-nowrap px-3 text-right tabular-nums ${GROUP_FIRST.has(c.key) ? 'border-l border-x-border' : ''}`}>
                        <Val v={text} muted={isCountKey(c.key) ? text === '0' : undefined} />
                        {c.key === 'views' && note && (
                          <span className="ml-1 text-ui text-x-muted" title="조회가 수집된 게시물 / 게시된 게시물">{note} 수집</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
                {open && (
                  <tr className="border-b border-x-border-strong">
                    <td colSpan={1 + ALL_COLS.length} className="bg-x-surface px-4 pb-4 pt-2">
                      <ExpandedTasks tasks={r.tasks} />
                      {r.influencerId && (
                        <Link href={`/influencers?i=${r.influencerId}`}
                              className="mt-3 inline-block text-ui font-semibold text-x-blue-text hover:underline">
                          인플루언서 프로필 열기 →
                        </Link>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// 펼친 행 — 작업 목록(스펙 §5). 성과 열 순서는 위 표 성과 묶음과 같다(눈으로 따라 내려가며 비교).
// 작업 목록엔 조회당 비용 칸이 없다 — 비용·조회 칸으로 대신(스펙 §5), 그래서 여기 키에는 'cpv'가 없다.
type TaskMetricKey = Exclude<MetricKey, 'cpv'>;
const TASK_METRICS: Array<{ key: TaskMetricKey; label: string }> = [
  { key: 'views', label: '조회' }, { key: 'engagement', label: '참여율' },
  { key: 'likes', label: '좋아요' }, { key: 'replies', label: '답글' }, { key: 'bookmarks', label: '북마크' },
  { key: 'retweets', label: 'RT수' }, { key: 'quotes', label: '인용수' },
];
const TASK_COLS: Array<{ label: string; width: number; right?: boolean }> = [
  { label: '날짜', width: 72 }, { label: '캠페인', width: 240 }, { label: '유형', width: 80 }, { label: '비용', width: 104, right: true },
  ...TASK_METRICS.map((m) => ({ label: m.label, width: m.key === 'views' ? 96 : 72, right: true })),
  { label: '게시물', width: 64 },
];
const TASK_TABLE_WIDTH = TASK_COLS.reduce((s, c) => s + c.width, 0);

function taskMetricText(t: PerfTask, key: TaskMetricKey): string {
  if (key === 'engagement') return formatMetric('engagement', taskEngagement(t.metrics));
  return formatMetric(key, t.metrics?.[key] ?? null);
}

function ExpandedTasks({ tasks }: { tasks: PerfTask[] }) {
  const cell = 'h-11 whitespace-nowrap px-3';
  return (
    <table className="table-fixed border-collapse bg-white text-ui" style={{ width: TASK_TABLE_WIDTH }}>
      <colgroup>{TASK_COLS.map((c) => <col key={c.label} style={{ width: c.width }} />)}</colgroup>
      <thead className="text-x-secondary">
        <tr>
          {TASK_COLS.map((c) => (
            <th key={c.label} scope="col"
                className={`h-9 whitespace-nowrap border-b border-x-border-strong px-3 font-bold ${c.right ? 'text-right' : 'text-left'}`}>
              {c.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {tasks.map((t) => {
          const posted = t.postedAt !== null || t.postUrl !== null;
          const content = CONTENT_TYPES.includes(t.type);
          const span = TASK_METRICS.length;
          let perf: ReactNode;
          if (t.type === 'rt') {
            perf = <td colSpan={span} className={`${cell} text-center text-x-muted`}>RT는 조회가 원글에 쌓여요</td>;
          } else if (content && !posted) {
            perf = TASK_METRICS.map((m) => <td key={m.key} className={`${cell} text-right text-x-muted`}>—</td>);
          } else if (t.metrics?.views == null) {
            perf = (
              <td colSpan={span} className={`${cell} text-center text-x-muted`} title="조회 수치가 아직 없어 평균·중앙값에서 빠졌어요">
                수집 전
              </td>
            );
          } else {
            perf = TASK_METRICS.map((m) => (
              <td key={m.key} className={`${cell} text-right tabular-nums`}><Val v={taskMetricText(t, m.key)} /></td>
            ));
          }
          return (
            <tr key={t.id} className="border-b border-x-border last:border-b-0">
              <td className={`${cell} tabular-nums ${t.postedAt ? '' : 'text-x-muted'}`}>{t.postedAt ? md(t.postedAt) : posted ? '—' : '게시 전'}</td>
              <td className={`${cell} truncate`} title={t.campaignName}>{t.campaignName}</td>
              <td className={cell}>{TASK_TYPE_LABEL[t.type]}</td>
              <td className={`${cell} text-right tabular-nums`}>
                {t.cost ? formatAmount(t.cost.amount, t.cost.currency) : <span className="text-x-muted">—</span>}
              </td>
              {perf}
              <td className={cell}>
                {t.postUrl && (
                  <a href={t.postUrl} target="_blank" rel="noopener noreferrer" title="X 게시물 새 창으로 열기"
                     className="text-x-blue-text hover:underline">↗</a>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// 검색 트렌드 표 — 시술 하나 = 한 줄(시술·월 검색량·추세(지금 방향)·1년 변화·한국 검색·많이 찾는 것·4년 추이). 추세와 1년 변화는 따로 본다(koo 10-14). 표 모양은 정산 표 공용(HEAD·CELL·NUM).
'use client';
import { Sparkline } from '@/components/charts/Sparkline';
import { HEAD, CELL, NUM } from '@/app/settlement/tableStyle';
import { fmtVolume, fmtChange, type TrendSummary } from '@/lib/searchTrend';
import type { Stage, ProfileIntent } from '@/lib/searchIntent';
import { StateChip, InterestChip } from './StateChip';
import type { Interest } from '@/lib/trendInterest';
import { notableText, type Notable } from '@/lib/trendNotable';

export type IntentInfo = {
  total: number[]; korea: number[];
  profile: Record<ProfileIntent, number> | null; prev: Record<ProfileIntent, number> | null;
  stage: Stage | null; prevStage: Stage | null; ambiguous: boolean; keywords: number;
  top: Partial<Record<ProfileIntent, Array<[jp: string, volume: number, ko?: string]>>>;  // ko = 한국어 번역
  members?: Array<{ id: string; kr: string; jp: string; total: number[] }>;  // 같은 시술명 묶음의 검색어별 구성
  // 시술명 검색 결과 구성 — 일본 사이트 이미지 검색 상위 20개를 피부과·미용 / 다른 진료과 / 화장품·셀프 / 무관한 뜻으로 나눈 수(10-14)
  serp?: { derm: number; med: number; self: number; unrelated: number; note: string };
  noName: number[];  // 시술명 단독 검색을 뺀 합계 — 타 진료과 혼재 시술은 이것으로 크기·추세를 본다
};

export type TrendRow = {
  id: string; major: string; majorOrder: number; middle: string; name: string; kr: string; jp: string; en: string;
  volumes: number[] | null; series: number[] | null; summary: TrendSummary; searchText: string;
  baseName: string;
  notable: Notable | null;
  interest: Interest;  // 많이 찾는 것(평균 대비 두드러진 관심사) — '관심 단계'를 대신함(10-15)  // 주목 시술(성장·한국 수요) — 지도 이름·굵은 점·필터  // 저장된 시술명(같은 이름이 두 분류에 있으면 화면 name은 한국어 표기로 바뀐다)
  intent: IntentInfo | null; korea: { now: number; yearAgo: number } | null;
};

// 한국 검색 — 월 50 미만은 '적음'(키워드 플래너가 작은 값을 0으로 합치는 일이 잦다)
// 섞임 판정 — 무관한 뜻이 많으면 동음이의(집계에서 시술명 단독 제외), 다른 진료과가 8/20 이상이면 혼재 경고
export const MED_MIX = 8;
export const SELF_MIX = 10;

export function KoreaCell({ k }: { k: TrendRow['korea'] }) {
  if (!k || k.now < 50) return <span className="text-ui text-x-muted">소량</span>;
  const c = k.yearAgo >= 50 ? k.now / k.yearAgo - 1 : null;
  return (
    <span className="tabular-nums">
      {fmtVolume(k.now)}
      {c !== null && Math.abs(c) >= 0.3 && <span className={`ml-1.5 text-ui ${c > 0 ? 'text-green-700' : 'text-red-600'}`}>{c > 0 ? '▲' : '▼'}{fmtChange(c).replace(/^[+−]/, '')}</span>}
      {c === null && k.yearAgo < 50 && <span className="ml-1.5 text-ui text-green-700">신규</span>}
    </span>
  );
}

// 정렬 — 머리를 누르면 그 열로, 같은 머리를 다시 누르면 반대 방향(koo 10-14). 값 없는 줄은 방향과 상관없이 아래.
export type SortKey = 'name' | 'volume' | 'trend' | 'year' | 'korea' | 'interest';
export type SortDir = 'asc' | 'desc';
export interface TableSort { key: SortKey; dir: SortDir }
// 처음 누를 때 방향 — 이름은 가나다순, 숫자·추세·단계는 큰 쪽(늘어나는 쪽·결정 단계)부터
export const SORT_FIRST_DIR: Record<SortKey, SortDir> = { name: 'asc', volume: 'desc', trend: 'desc', year: 'desc', korea: 'desc', interest: 'desc' };

// 오른쪽 정렬 숫자 열 뒤에 왼쪽 정렬 칩·글자가 바로 붙어 경계가 안 보였다(10-14) — 숫자 열 오른쪽에 여백을 더 준다
const NUM_GAP = 'pr-7';

function SortTh({ k, sort, onSort, align = 'left', title, children }: {
  k: SortKey; sort: TableSort; onSort: (k: SortKey) => void; align?: 'left' | 'right'; title?: string; children: React.ReactNode;
}) {
  const on = sort.key === k;
  return (
    <th className={`${HEAD} ${align === 'right' ? `text-right ${NUM_GAP}` : ''}`} title={title} aria-sort={on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button onClick={() => onSort(k)} className={`group inline-flex items-center gap-1 ${on ? 'text-x-text' : 'hover:text-x-text'}`}>
        {children}
        <span className={on ? '' : 'opacity-0 group-hover:opacity-40'}>{on && sort.dir === 'asc' ? '▲' : '▼'}</span>
      </button>
    </th>
  );
}

export function TrendTable({ rows, selectedId, onSelect, sort, onSort }: {
  rows: TrendRow[]; selectedId: string | null; onSelect: (id: string) => void; sort: TableSort; onSort: (k: SortKey) => void;
}) {
  return (
    <div className="shrink-0 overflow-x-auto rounded-xl border border-x-border bg-white">
      {/* 열 너비 고정 — 시술 열이 남는 폭을 다 가져가 숫자 열 사이가 벌어지던 것(10-14) */}
      <table className="w-full min-w-[1120px] table-fixed border-separate border-spacing-0 text-[15px]">
        <colgroup>
          <col />
          <col className="w-[128px]" />
          <col className="w-[176px]" />
          <col className="w-[120px]" />
          <col className="w-[156px]" />
          <col className="w-[150px]" />
          <col className="w-[152px]" />
        </colgroup>
        <thead>
          <tr>
            <SortTh k="name" sort={sort} onSort={onSort}>시술</SortTh>
            <SortTh k="volume" sort={sort} onSort={onSort} align="right" title="시술 관련 검색어 합계의 최근 3개월 평균(화장품·셀프·동음이의 제외)">월 검색량</SortTh>
            <SortTh k="trend" sort={sort} onSort={onSort} title="지금 방향 — 최근 3개월 vs 직전 3개월(해마다 반복되는 계절은 지우고 봄)">추세</SortTh>
            <SortTh k="year" sort={sort} onSort={onSort} align="right" title="최근 3개월 평균 vs 1년 전 같은 3개월 — 1년 전이 소량(월 100 미만)이면 신규">1년 변화</SortTh>
            <SortTh k="korea" sort={sort} onSort={onSort} align="right" title="韓国·ソウル·江南·明洞·弘大(ホンデ) 포함 검색의 최근 3개월 평균">한국 검색량</SortTh>
            <SortTh k="interest" sort={sort} onSort={onSort} title="시술 평균보다 유난히 많이 찾는 것(개념·비교 · 효과·후기 · 부작용·통증 · 가격 · 병원·지역) — 1.3배 이상이면 표시, 정렬은 몇 배인지 순">많이 찾는 것</SortTh>
            <th className={HEAD}>4년 추이</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const s = r.summary;
            const on = r.id === selectedId;
            return (
              <tr key={r.id} onClick={() => onSelect(r.id)} aria-selected={on}
                  className={`cursor-pointer ${on ? 'bg-x-blue/10' : 'hover:bg-x-hover'}`}>
                <td className={`${CELL} truncate`} title={`${r.name} · ${r.jp} · ${r.major}`}>
                  <span className="font-medium">{r.name}</span>
                  {r.notable && <span className="ml-1.5 text-amber-600" title={`주목 — ${notableText(r.notable).join(' · ')}`}>★</span>}
                  <span className="ml-2.5 text-ui text-x-muted">{r.jp}</span>
                  <span className="ml-2.5 text-ui text-x-muted">· {r.major}</span>
                </td>
                <td className={`${CELL} ${NUM} ${NUM_GAP}`}>
                  {s.state === 'nodata' ? <span className="text-x-muted">—</span> : fmtVolume(s.now)}
                  {s.state !== 'nodata' && !r.volumes && <span className="ml-0.5 text-x-muted" title="시술명 검색량은 키워드 플래너 값 없음 — 효과·가격 등이 붙은 검색만 합계라 실제보다 작음">*</span>}
                </td>
                <td className={CELL} title={s.seasonMonth ? `매년 ${s.seasonMonth}월에 검색 많음` : undefined}>
                  <StateChip state={s.state} />
                  {s.seasonMonth && <span className="ml-1.5 text-ui text-x-muted">성수기 {s.seasonMonth}월</span>}
                </td>
                <td className={`${CELL} ${NUM} ${NUM_GAP}`}>
                  {s.state === 'low' || s.state === 'nodata' ? <span className="text-x-muted">—</span>
                    : s.change === null ? <span className="text-green-700" title="1년 전 소량(월 100 미만) — 변화율 대신 신규">신규</span>
                    : <span className={s.change >= 0.3 ? 'text-green-700' : s.change <= -0.3 ? 'text-red-600' : 'text-x-secondary'}>{fmtChange(s.change)}</span>}
                </td>
                <td className={`${CELL} ${NUM} ${NUM_GAP}`}><KoreaCell k={r.korea} /></td>
                <td className={CELL}>
                  {r.intent?.ambiguous
                    ? <span className="text-ui text-amber-700" title={`시술명만 검색하면 다른 뜻이 대부분 — ${r.intent.serp?.note ?? ''}`}>⚠ 동음이의 혼재</span>
                    : (r.intent?.serp?.med ?? 0) >= MED_MIX
                      ? <span className="text-ui text-amber-700" title={`시술명 검색 결과 상위 20개 중 ${r.intent!.serp!.med}개가 다른 진료과(${r.intent!.serp!.note}) — 시술명 단독 검색은 빼고 효과·가격 등이 붙은 검색만 셈`}>⚠ 타 진료과 혼재</span>
                      : <InterestChip interest={r.interest} />}
                </td>
                <td className={CELL}>
                  {r.series ? <Sparkline values={r.series} width={120} height={28} /> : <span className="text-ui text-x-muted">—</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export type MajorRow = {
  major: string; total: number; rising: number; falling: number;
  top: { name: string; now: number } | null; change: number | null; korea: number;
};

export function MajorTable({ rows, onOpen }: { rows: MajorRow[]; onOpen: (major: string) => void }) {
  return (
    <div className="shrink-0 overflow-x-auto rounded-xl border border-x-border bg-white">
      <table className="w-full border-separate border-spacing-0 text-[15px]">
        <thead>
          <tr>
            <th className={HEAD}>분류</th>
            <th className={`${HEAD} text-right`}>시술</th>
            <th className={`${HEAD} text-right`}>상승</th>
            <th className={`${HEAD} text-right`}>하락</th>
            <th className={HEAD} title="소속 시술의 최근 3개월 변화(직전 3개월 대비, 계절 감안) 중앙값 — 시술 태그와 같은 기준">최근 추세(중앙값)</th>
            <th className={HEAD}>최다 검색 시술</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.major} onClick={() => onOpen(r.major)} className="cursor-pointer hover:bg-x-hover">
              <td className={`${CELL} font-medium`}>{r.major}</td>
              <td className={`${CELL} ${NUM} text-x-secondary`}>{r.total}</td>
              <td className={`${CELL} ${NUM}`}>{r.rising ? <span className="text-green-700">{r.rising}</span> : <span className="text-x-muted">0</span>}</td>
              <td className={`${CELL} ${NUM}`}>{r.falling ? <span className="text-red-600">{r.falling}</span> : <span className="text-x-muted">0</span>}</td>
              <td className={`${CELL} tabular-nums`}>
                {r.change === null ? <span className="text-x-muted">—</span>
                  : r.change >= 0.2 ? <span className="text-green-700">▲ 상승 {fmtChange(r.change)}</span>
                  : r.change <= -0.2 ? <span className="text-red-600">▼ 하락 {fmtChange(r.change)}</span>
                  : <span className="text-x-secondary">― 보합 {fmtChange(r.change)}</span>}
              </td>
              <td className={CELL}>{r.top ? <>{r.top.name} <span className="ml-1 text-ui tabular-nums text-x-muted">{fmtVolume(r.top.now)}</span></> : <span className="text-x-muted">—</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

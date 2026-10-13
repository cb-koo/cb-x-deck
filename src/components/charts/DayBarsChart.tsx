'use client';
import { useState } from 'react';
import { scaleBand, scaleLinear, scaleSqrt } from 'd3-scale';
import { C, S, T, NUM, compact } from './tokens';
import { useWidth, Tip, TipBody, type TipRow } from './ChartCard';
import { niceMax } from './TimeCompareChart';

// 일별 막대 + (선택) 위쪽 게시물 줄 — 같은 날짜 축에 위아래로 놓아 "게시 → 반응" 시차를 보여 준다.
// 사용자 관점 검토(10-09): 원은 한 가지만 뜻한다(크기 = 북마크 수). 같은 날 글은 한 원으로 합친다.
// 기록이 없는 구간(dimBefore 이전)은 막대를 흐리게 하고 강조하지 않는다 — 원인 정보 없는 강조는 의문만 남긴다.
export type DayEvent = { date: string; weight: number; count: number; label?: string; posts: Array<{ id?: string; handle: string; bookmarks: number; views: number }> };
export type DayNote = { date: string; text: string };
type Props = {
  days: string[]; values: Array<number | null>; band?: [number, number]; highlightAbove?: number;
  events?: DayEvent[]; dimBefore?: string; dimText?: string;
  notes?: DayNote[]; valueName: string; height?: number; bandLabel?: string;
  onSelectPosts?: (ids: string[]) => void; // 게시 원을 누르면 그날 글 id들(있을 때만 원이 눌린다)
  selectedPostIds?: string[];               // 글 상세 패널에 열린 글 — 그 글이 든 원에 테두리
};

const STRIP = 78;

export function DayBarsChart({ days, values, band, highlightAbove, events, dimBefore, dimText, notes = [], valueName, height = 190, bandLabel, onSelectPosts, selectedPostIds = [] }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const stripH = events ? STRIP : 0;
  const axisW = 32, padB = 24, padT = 22;
  const plotW = Math.max(width - axisW, 0);
  const plotH = height - padB - padT;
  const x = scaleBand<string>().domain(days).range([0, plotW]).paddingInner(0.3).paddingOuter(0.15);
  const max = niceMax(Math.max(1, ...values.filter((v): v is number => v !== null)));
  const y = scaleLinear().domain([0, max]).range([stripH + padT + plotH, stripH + padT]);
  const r = scaleSqrt().domain([0, Math.max(1, ...(events ?? []).map((e) => e.weight))]).range([0, Math.min(24, stripH / 2 - 8)]);
  const cx = (d: string) => (x(d) ?? 0) + x.bandwidth() / 2;
  const mondays = days.filter((d) => new Date(d + 'T00:00:00Z').getUTCDay() === 1);
  const total = stripH + height;
  const dimmed = (i: number) => dimBefore !== undefined && days[i] < dimBefore;
  const hot = (i: number) => !dimmed(i) && values[i] !== null && highlightAbove !== undefined && (values[i] as number) > highlightAbove;
  const evByDay = new Map((events ?? []).map((e) => [e.date, e]));
  const dimEnd = dimBefore ? (x(dimBefore) ?? 0) - (x.step() * x.paddingInner()) / 2 : 0;

  return (
    <div ref={ref} style={{ position: 'relative', height: total }}>
      {width > 0 && (
        <svg width={width} height={total} role="img" aria-label={`${valueName} 일별`}
             onMouseLeave={() => setHover(null)}
             onMouseMove={(e) => {
               const rr = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
               const i = Math.floor(((e.clientX - rr.left) / plotW) * days.length);
               setHover(i >= 0 && i < days.length ? i : null);
             }}>
          {mondays.map((d) => {
            const xx = (x(d) ?? 0) - (x.step() * x.paddingInner()) / 2;
            return <line key={d} x1={xx} x2={xx} y1={0} y2={stripH + padT + plotH} stroke={C.separator} />;
          })}
          {events && (
            <g>
              {dimText && dimEnd > 0 && <text x={dimEnd / 2} y={stripH / 2 + 4} textAnchor="middle" fontSize={T.label} fill={C.muted}>{dimText}</text>}
              {[...events].sort((a, b) => b.weight - a.weight).map((e) => (
                <g key={e.date} style={{ cursor: onSelectPosts ? 'pointer' : undefined }}
                   onClick={onSelectPosts ? () => { const ids = e.posts.map((p) => p.id).filter((v): v is string => !!v); if (ids.length) onSelectPosts(ids); } : undefined}>
                  <circle cx={cx(e.date)} cy={stripH / 2 + 6} r={Math.max(3, r(e.weight))} fill={C.primaryDeep} fillOpacity={0.55}
                          stroke={e.posts.some((p) => p.id && selectedPostIds.includes(p.id)) ? C.text : '#fff'} strokeWidth={e.posts.some((p) => p.id && selectedPostIds.includes(p.id)) ? 2 : 1} />
                  {e.count > 1 && r(e.weight) >= 9 && <text x={cx(e.date)} y={stripH / 2 + 10} textAnchor="middle" fontSize={11} fontWeight={700} fill="#fff">{e.count}</text>}
                </g>
              ))}
              {fitLabels(events, cx, plotW).map(({ e, x: lx }) => (
                <text key={e.date} x={lx} y={12} textAnchor="middle" fontSize={T.label} fill={C.secondary}>{e.label}</text>
              ))}
              <line x1={0} x2={plotW} y1={stripH} y2={stripH} stroke={C.grid} />
            </g>
          )}
          {band && <rect x={dimEnd} y={y(band[1])} width={plotW - dimEnd} height={Math.max(1, y(band[0]) - y(band[1]))} fill={C.band} />}
          {band && bandLabel && <text x={plotW - 4} y={y(band[1]) - 4} textAnchor="end" fontSize={11} fill={C.secondary} stroke="#f7f9f9" strokeWidth={3} paintOrder="stroke">{bandLabel}</text>}
          {[max / 2, max].map((t) => (
            <g key={t}>
              <line x1={0} x2={plotW} y1={y(t)} y2={y(t)} stroke={C.grid} strokeDasharray={S.gridDash} />
              <text x={width} y={y(t) + 4} textAnchor="end" fontSize={T.axis} fill={C.muted}>{NUM.format(t)}</text>
            </g>
          ))}
          {values.map((v, i) => v !== null && v > 0 && (
            <path key={days[i]} d={barPath(x(days[i]) ?? 0, y(v), x.bandwidth(), y(0) - y(v), S.barRadius)}
                  fill={hot(i) ? C.primary : C.neutralBar} opacity={dimmed(i) ? 0.35 : hover === null || hover === i ? 1 : 0.6} />
          ))}
          <line x1={0} x2={plotW} y1={y(0)} y2={y(0)} stroke={C.axis} />
          <text x={width} y={y(0) + 4} textAnchor="end" fontSize={T.axis} fill={C.muted}>0</text>
          {notes.map((n) => {
            const i = days.indexOf(n.date); if (i < 0) return null;
            return <text key={n.date} x={cx(n.date)} y={y(values[i] ?? 0) - 6} textAnchor="middle" fontSize={T.label} fontWeight={700} fill={C.primaryDeep}>{n.text}</text>;
          })}
          {mondays.map((d) => (
            <text key={d} x={x(d) ?? 0} y={total - 6} fontSize={T.axis} fill={C.muted}>{short(d)}</text>
          ))}
        </svg>
      )}
      {hover !== null && width > 0 && (
        <Tip x={cx(days[hover])} y={y(values[hover] ?? 0)} width={width}>
          <TipBody
            title={`${short(days[hover])} (${'일월화수목금토'[new Date(days[hover] + 'T00:00:00Z').getUTCDay()]})`}
            sub={hot(hover) ? '크게 튄 날' : dimmed(hover) ? '게시 기록 없는 기간' : band && (values[hover] ?? 0) > band[1] ? '평소보다 많은 날' : undefined}
            rows={[
              { label: valueName, value: `${values[hover] ?? '—'}명`, strong: true, tone: hot(hover) ? 'up' : undefined },
              ...(band ? [{ label: '평소 하루', value: `${band[0]}~${band[1]}명`, tone: 'muted' as const }] : []),
              ...postRows('전날 게시', hover > 0 ? evByDay.get(days[hover - 1]) : undefined),
              ...postRows('이날 게시', evByDay.get(days[hover])),
            ]}
            note={onSelectPosts && evByDay.get(days[hover]) ? '위 원을 누르면 글 상세를 볼 수 있어요' : undefined}
          />
        </Tip>
      )}
    </div>
  );
}

// 상세의 게시 줄 — 반응은 보통 다음 날 나오므로 '전날 게시'를 먼저, 북마크 많은 2개까지만.
function postRows(label: string, ev: DayEvent | undefined): TipRow[] {
  if (!ev || ev.posts.length === 0) return [];
  const more = ev.posts.length > 2 ? ` · 외 ${ev.posts.length - 2}개` : '';
  return [
    { label: `${label} ${ev.posts.length}개${more}`, value: '', section: true },
    ...ev.posts.slice(0, 2).map((p): TipRow => ({ label: `@${p.handle}`, value: `북마크 ${NUM.format(p.bookmarks)}` })),
  ];
}

// 이름표가 겹치면 북마크(weight) 큰 것부터 자리를 차지하고 겹치는 것은 뺀다 — 차트 폭이 줄어도(옆 패널이 열려도) 안 겹친다.
// 글자 폭은 정확히 잴 수 없어 대략값(한 글자 ≈ 0.62em)으로 본다.
function fitLabels(events: DayEvent[], cx: (d: string) => number, plotW: number): Array<{ e: DayEvent; x: number }> {
  const placed: Array<[number, number]> = [];
  const out: Array<{ e: DayEvent; x: number }> = [];
  for (const e of [...events].filter((ev) => ev.label).sort((a, b) => b.weight - a.weight)) {
    const half = ((e.label as string).length * T.label * 0.62) / 2 + 6;
    const x = Math.min(Math.max(cx(e.date), half), plotW - half); // 가장자리 글은 안쪽으로 밀어 넣는다
    const l = x - half, r = x + half;
    if (placed.some(([pl, pr]) => l < pr && r > pl)) continue;
    placed.push([l, r]); out.push({ e, x });
  }
  return out;
}

function short(d: string) { const [, m, dd] = d.split('-'); return `${Number(m)}/${Number(dd)}`; }
// 위 모서리만 둥근 막대 — 윗변이 값을 정확히 가리키도록 반경은 작게
export function barPath(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}
export { compact };

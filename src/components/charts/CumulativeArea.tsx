'use client';
import { scaleLinear } from 'd3-scale';
import { area, line, curveLinear } from 'd3-shape';
import { C, S, T, compact } from './tokens';
import { useWidth } from './ChartCard';
import { niceMax } from './TimeCompareChart';

// 단일 계열 누적 선 + 옅은 면(캠페인 현황 카드·패널, 시안 2026-11-12 chartSvg).
// values의 null은 그리지 않는다(오늘 뒤 = 아직 오지 않은 날). 눈금은 카드마다 자기 최댓값 — 클라이언트끼리 비교하지 않게.
// 오늘 칸은 점을 크게, 가로 글자를 굵게. 세로 눈금 글자는 오른쪽, 0 글자는 생략(바닥선이 말한다).
type Props = {
  labels: string[];
  values: Array<number | null>;
  todayIndex: number;
  height?: number;
  marks?: Array<string | null>;
  // 칸 범위(포함)에 옅은 바탕 + 왼쪽 위 글자 — 지난 주 차트에서 캠페인 기간(월~일)과 그 뒤 성장 구간을 가른다(koo 11-12)
  band?: { from: number; to: number; label: string };
  ariaLabel: string;
};

const AREA_OPACITY = 0.1;     // 시안 polygon opacity .1
const LINE_WIDTH = 2.5;       // 시안 stroke-width 2.5 — 카드 하나에 선 하나라 키트 기본(2)보다 굵게
const DOT_R = 3, TODAY_R = 4.5;

export function CumulativeArea({ labels, values, todayIndex, height = 136, marks, band, ariaLabel }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>();
  // 여백은 시안 그대로: 왼쪽 10, 오른쪽 46(눈금 글자), 위 12(점 위 글자가 있으면 28), 아래 26(가로 글자)
  const L = 10, R = 46, top = marks ? 28 : 12, B = 26;
  const w = Math.max(width - L - R, 0), h = Math.max(height - top - B, 0);
  const nums = values.filter((v): v is number => v !== null);
  // 가운데 눈금(max/2)이 '0.5'·'7.5' 같은 소수가 되지 않게 홀수 최댓값(1·3·5·15 등)은 짝수로 올린다(전부 0이면 2)
  const nice = niceMax(Math.max(1, ...nums));
  const max = nice % 2 === 0 ? nice : Math.ceil(nice / 2) * 2;
  const n = labels.length;
  const x = (i: number) => L + (n > 1 ? (w * i) / (n - 1) : w / 2);
  const y = scaleLinear().domain([0, max]).range([top + h, top]);
  const ticks = [0, max / 2, max];
  const mkLine = line<number | null>().defined((v) => v !== null).x((_, i) => x(i)).y((v) => y(v ?? 0)).curve(curveLinear);
  const mkArea = area<number | null>().defined((v) => v !== null).x((_, i) => x(i)).y0(y(0)).y1((v) => y(v ?? 0)).curve(curveLinear);
  // 가로 글자 솎기(LineChart 방식) — 요일 한 글자는 칸이 좁아도 다 들어가고, 'M/D'는 하나에 ≈ 48px
  const gap = labels.every((l) => l.length <= 1) ? 24 : 48;
  const step = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(w / gap))));
  const showLabel = (i: number) => i === todayIndex || i === n - 1 || (i % step === 0 && n - 1 - i >= step / 2);
  // 띠는 첫 칸의 점부터 마지막 칸과 다음 칸 사이 가운데까지 — 마지막 날의 점이 띠 안에 온전히 들어가게
  const bandX0 = band ? x(band.from) : 0;
  const bandX1 = band ? (band.to + 1 < n ? (x(band.to) + x(band.to + 1)) / 2 : x(band.to)) : 0;
  return (
    <div ref={ref} style={{ position: 'relative', height }}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={band ? `${ariaLabel}, ${band.label} ${labels[band.from]}~${labels[band.to]}` : ariaLabel}>
          {band && (
            <g>
              <rect x={bandX0} y={top} width={Math.max(bandX1 - bandX0, 0)} height={h} fill={C.band} opacity={0.6} />
              <text x={bandX0 + 4} y={top + 12} fontSize={11} fill={C.secondary}>{band.label}</text>
            </g>
          )}
          {ticks.map((t, k) => (
            <g key={k}>
              <line x1={L} x2={L + w} y1={y(t)} y2={y(t)} stroke={k === 0 ? C.axis : C.grid} strokeDasharray={k === 0 ? undefined : S.gridDash} />
              {k > 0 && <text x={L + w + 8} y={y(t) + 4} fontSize={T.axis} fill={C.muted}>{compact(t)}</text>}
            </g>
          ))}
          {labels.map((l, i) => showLabel(i) && (
            // 첫 글자를 가운데 정렬하면 왼쪽 여백(L)보다 긴 글자('10/26')는 앞이 잘린다 — 넘칠 만큼 길면 점에서 오른쪽으로 시작(koo 11-12).
            // 12px 숫자·'/' ≈ 7px/자. 요일 한 글자는 여백 안이라 그대로 가운데
            <text key={i} x={x(i)} y={top + h + 18} fontSize={T.axis} textAnchor={i === 0 && (l.length * 7) / 2 > L ? 'start' : 'middle'}
                  fill={i === todayIndex ? C.text : C.muted} fontWeight={i === todayIndex ? 700 : 400}>{l}</text>
          ))}
          <path d={mkArea(values) ?? ''} fill={C.primary} opacity={AREA_OPACITY} />
          <path d={mkLine(values) ?? ''} fill="none" stroke={C.primary} strokeWidth={LINE_WIDTH} strokeLinejoin="round" />
          {values.map((v, i) => v !== null && (
            <g key={i}>
              <circle cx={x(i)} cy={y(v)} r={i === todayIndex ? TODAY_R : DOT_R} fill={C.primary}
                      stroke={i === todayIndex ? '#fff' : undefined} strokeWidth={i === todayIndex ? 2 : undefined} />
              {marks?.[i] && <text x={x(i)} y={y(v) - 11} fontSize={T.label} textAnchor="middle" fill={C.secondary}>{marks[i]}</text>}
            </g>
          ))}
        </svg>
      )}
    </div>
  );
}

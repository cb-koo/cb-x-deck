// 시술 지도 — 점 하나 = 시술 하나. 가로 = 월 검색량(로그, 수백 배 차이라), 세로 = 1년 변화(%), 원 크기 = 한국 검색.
// 네 칸으로 읽는다: 크고 늘어남(오른쪽 위) · 작지만 뜸(왼쪽 위) · 크지만 줄어듦(오른쪽 아래) · 작고 정체(왼쪽 아래).
// 수요 적음·데이터 없음·다른 뜻 섞인 시술은 뺀다(숫자를 믿기 어려워 위치가 거짓말을 한다).
'use client';
import { BubbleScatter, type Bubble } from '@/components/charts/BubbleScatter';
import { fmtVolume, fmtChange, STATE_LABEL } from '@/lib/searchTrend';
import { STAGE_LABEL } from '@/lib/searchIntent';
import type { TrendRow } from './TrendTable';

const Y_MIN = -80, Y_MAX = 250;  // 세로축을 넘는 시술(리투오 +8,900% 등)은 끝에 붙이고 상세에서 실제 값을 보여 준다

export function TrendMap({ rows, open, onToggle, selectedId, onSelect }: {
  rows: TrendRow[]; open: boolean; onToggle: () => void; selectedId: string | null; onSelect: (id: string) => void;
}) {
  // 신규(전년 소량, change = null)는 맨 위에 붙인다 — 빼면 가장 크게 뜬 시술이 지도에서 사라진다
  const live = rows.filter((r) => r.summary.now !== null && r.summary.state !== 'low' && r.summary.state !== 'nodata' && !r.intent?.ambiguous);
  // 이름·굵은 점 = 주목 시술(성장·한국 수요, trendNotable) — 표의 ★·'주목' 필터와 같은 기준(10-15)
  const points: Bubble[] = live.map((r) => {
    const s = r.summary;
    const ch = s.change === null ? Y_MAX : s.change * 100;
    return {
      id: r.id, x: Math.max(100, s.now ?? 100), y: Math.max(Y_MIN, Math.min(Y_MAX, ch)), size: r.korea?.now ?? 0,
      label: r.notable ? r.name : undefined, strong: !!r.notable,
      tip: {
        title: r.name, sub: `${r.jp} · ${r.major}`,
        rows: [
          { label: '월 검색량', value: fmtVolume(s.now), strong: true },
          { label: '추세', value: `${STATE_LABEL[s.state]} · 1년 ${fmtChange(s.change)}`, tone: ch >= 30 ? 'up' : ch <= -30 ? 'down' : undefined },
          { label: '한국 검색량', value: r.korea && r.korea.now >= 50 ? fmtVolume(r.korea.now) : '소량' },
          { label: '관심 단계', value: r.intent?.stage ? STAGE_LABEL[r.intent.stage] : '—' },
        ],
      },
    };
  });
  return (
    <section className="mb-4 shrink-0 rounded-xl border border-x-border bg-white">
      <button onClick={onToggle} className="flex w-full items-center gap-2 px-5 py-3 text-left">
        <span className="text-[16px] font-semibold">시술 지도</span>
        <span className="text-ui text-x-muted">가로 검색량 · 세로 1년 변화 · 원 크기 한국 검색량 · 이름 붙은 점 = ★ 주목</span>
        <span className="ml-auto text-ui text-x-secondary">{open ? '접기 ▴' : '펼치기 ▾'}</span>
      </button>
      {open && (
        <div className="px-5 pb-4">
          {points.length < 3
            ? <p className="py-6 text-center text-ui text-x-muted">표시 대상 부족(소량·데이터 없음 제외)</p>
            : <BubbleScatter points={points} xName="월 검색량" yName="전년 대비(%)" height={340} zeroLabel="전년 수준" onSelect={onSelect} selectedId={selectedId} />}
          <p className="mt-1 text-ui text-x-muted">+{Y_MAX}% 초과·신규는 상단 고정 · 점 클릭 시 상세 · 소량·데이터 없음·동음이의 혼재 제외 · ★ 주목 = 1년 새 월 1,000건↑(+30%↑)·지금 유지, 또는 한국 검색 월 100건↑ 증가</p>
        </div>
      )}
    </section>
  );
}

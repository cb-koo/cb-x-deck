'use client';
import { C, NUM, compact } from './tokens';

// 게시물 성적표 — "어떤 글이 효과 있었나"에 바로 답하는 기본 화면(산점도는 관계를 볼 때 보조).
// 한 줄 = 글 하나, 인입 증가 순. 북마크는 막대(인입과 가장 잘 맞는 반응), 조회는 글자.
// 인입 증가 = 게시 당일~다음 날 신규 인입 − 평소 하루 × 2. 0을 가운데 둔 양방향 막대. 다른 글과 겹친 날은 표시.
export type PostScore = { handle: string; date: string; views: number; bookmarks: number; lift: number; overlap?: string };

export function PostScoreTable({ rows, baseText }: { rows: PostScore[]; baseText: string }) {
  const sorted = [...rows].sort((a, b) => b.lift - a.lift);
  const maxBm = Math.max(1, ...rows.map((r) => r.bookmarks));
  const maxLift = Math.max(1, ...rows.map((r) => Math.abs(r.lift)));
  const GRID = 'minmax(0,1.4fr) 64px minmax(0,1fr) minmax(0,1.2fr)';
  return (
    <div role="table" style={{ display: 'flex', flexDirection: 'column' }}>
      <div role="row" style={{ display: 'grid', gridTemplateColumns: GRID, gap: 12, fontSize: 12, color: C.muted, paddingBottom: 6, borderBottom: '1px solid #e6ebee' }}>
        <div>게시물</div><div style={{ textAlign: 'right' }}>조회</div><div>북마크</div><div>인입 증가 (평소 대비)</div>
      </div>
      {sorted.map((r, i) => {
        const w = (Math.abs(r.lift) / maxLift) * 50;
        return (
          <div role="row" key={r.handle + r.date} style={{ display: 'grid', gridTemplateColumns: GRID, gap: 12, alignItems: 'center', minHeight: 48, borderTop: i ? '1px solid #eceff1' : 'none' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>@{r.handle}</div>
              <div style={{ fontSize: 12, color: C.muted }}>{r.date}{r.overlap ? ` · ${r.overlap}` : ''}</div>
            </div>
            <div style={{ textAlign: 'right', fontSize: 13, color: C.secondary, fontVariantNumeric: 'tabular-nums' }}>{compact(r.views)}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <div style={{ flex: 1, height: 8, background: '#e6ebee', borderRadius: 4 }}>
                <div style={{ width: `${(r.bookmarks / maxBm) * 100}%`, height: 8, background: C.primaryDeep, opacity: 0.7, borderRadius: 4 }} />
              </div>
              <span style={{ fontSize: 13, fontVariantNumeric: 'tabular-nums', width: 44, textAlign: 'right' }}>{NUM.format(r.bookmarks)}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ flex: 1, position: 'relative', height: 8 }}>
                <div style={{ position: 'absolute', left: '50%', top: -3, bottom: -3, width: 1, background: C.axis }} />
                <div style={{ position: 'absolute', top: 0, height: 8, borderRadius: 4, width: `${w}%`, left: r.lift >= 0 ? '50%' : `${50 - w}%`,
                  background: r.lift > 0 ? C.primary : C.neutralBar, opacity: r.overlap ? 0.55 : 1 }} />
              </div>
              <span style={{ fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums', width: 44, textAlign: 'right', color: r.lift > 0 ? C.primaryDeep : C.secondary }}>
                {r.lift > 0 ? '+' : r.lift < 0 ? '−' : ''}{Math.abs(Math.round(r.lift))}명
              </span>
            </div>
          </div>
        );
      })}
      <div style={{ fontSize: 12, color: C.muted, marginTop: 8 }}>{baseText}</div>
    </div>
  );
}

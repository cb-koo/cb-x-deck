'use client';
import { C, NUM, compact } from './tokens';
import type { PostGroup } from './postGroups';

// 게시물 성적표 — 한 줄 = 게시 묶음(효과 창이 겹치는 글들). 인입 증가는 묶음마다 한 번만 센다(postGroups.ts).
// 묶음 줄을 펼치면 글별 북마크·조회와 '추정 몫'(북마크 비율로 나눈 값)이 보인다. 추정은 늘 '추정'으로 표기.
const GRID = 'minmax(0,1.5fr) 64px minmax(0,1fr) minmax(0,1.1fr)';
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const span = (g: PostGroup) => {
  const last = g.posts.reduce((m, p) => (p.date > m ? p.date : m), g.from);
  return g.from === last ? md(g.from) : `${md(g.from)}~${md(last)}`;
};
const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n)}명`;

function LiftBar({ lift, max }: { lift: number; max: number }) {
  const w = (Math.abs(lift) / max) * 50;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ flex: 1, position: 'relative', height: 8 }}>
        <div style={{ position: 'absolute', left: '50%', top: -3, bottom: -3, width: 1, background: C.axis }} />
        <div style={{ position: 'absolute', top: 0, height: 8, borderRadius: 4, width: `${w}%`, left: lift >= 0 ? '50%' : `${50 - w}%`, background: lift > 0 ? C.primary : C.neutralBar }} />
      </div>
      <span style={{ fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums', width: 48, textAlign: 'right', color: lift > 0 ? C.primaryDeep : C.secondary }}>{signed(lift)}</span>
    </div>
  );
}

// onSelect: 줄을 누르면 그 묶음의 글 id들을 넘긴다(글 상세 패널 — 여러 개면 패널이 목록부터). 이때는 줄을 펼치지 않는다
// (일별 차트 원·버블을 눌렀을 때와 같은 결과). 없으면 예전처럼 여러 글 묶음을 그 자리에서 펼친다. selectedIds: 패널에 열린 글.
export function PostScoreTable({ groups, onSelect, selectedIds = [] }: { groups: PostGroup[]; onSelect?: (ids: string[]) => void; selectedIds?: string[] }) {
  const sorted = [...groups].sort((a, b) => b.lift - a.lift);
  const maxBm = Math.max(1, ...groups.map((g) => g.bookmarks));
  const maxLift = Math.max(1, ...groups.map((g) => Math.abs(g.lift)));
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'grid', gridTemplateColumns: GRID, gap: 12, fontSize: 12, color: C.muted, paddingBottom: 6, borderBottom: '1px solid #e6ebee' }}>
        <div>게시 묶음 · 대표 글</div><div style={{ textAlign: 'right' }}>조회</div><div>북마크</div><div>인입 증가 (평소 대비)</div>
      </div>
      {sorted.map((g, i) => (
        <details key={g.from} style={{ borderTop: i ? '1px solid #eceff1' : 'none', background: g.posts.some((p) => p.id && selectedIds.includes(p.id)) ? '#e8f5fe' : undefined, borderRadius: 6 }}>
          <summary style={{ listStyle: 'none', cursor: g.posts.length > 1 || onSelect ? 'pointer' : 'default' }}
                   onClick={onSelect ? (e) => { e.preventDefault(); const ids = g.posts.map((p) => p.id).filter((v): v is string => !!v); if (ids.length) onSelect(ids); } : undefined}>
            <div style={{ display: 'grid', gridTemplateColumns: GRID, gap: 12, alignItems: 'center', minHeight: 52 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>@{g.posts[0].handle}{g.posts.length === 1 && onSelect ? <span style={{ color: C.primaryDeep, marginLeft: 6 }}>›</span> : null}</div>
                <div style={{ fontSize: 12, color: C.muted }}>{span(g)} 게시{g.posts.length > 1 ? <> · <span style={{ color: C.primaryDeep }}>글 {g.posts.length}개 {onSelect ? '›' : '▾'}</span></> : ''}</div>
              </div>
              <div style={{ textAlign: 'right', fontSize: 13, color: C.secondary, fontVariantNumeric: 'tabular-nums' }}>{compact(g.views)}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <div style={{ flex: 1, height: 8, background: '#e6ebee', borderRadius: 4 }}>
                  <div style={{ width: `${(g.bookmarks / maxBm) * 100}%`, height: 8, background: C.primaryDeep, opacity: 0.7, borderRadius: 4 }} />
                </div>
                <span style={{ fontSize: 13, fontVariantNumeric: 'tabular-nums', width: 44, textAlign: 'right' }}>{NUM.format(g.bookmarks)}</span>
              </div>
              <LiftBar lift={g.lift} max={maxLift} />
            </div>
          </summary>
          {g.posts.length > 1 && !onSelect && (
            <div style={{ margin: '0 0 10px 12px', padding: '8px 12px', background: '#fff', borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {g.posts.map((p) => (
                <div key={p.handle + p.date} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.5fr) 64px minmax(0,1fr) minmax(0,1.1fr)', gap: 12, fontSize: 13, alignItems: 'center' }}>
                  <div style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>@{p.handle} <span style={{ color: C.muted, fontSize: 12 }}>{md(p.date)}</span></div>
                  <div style={{ textAlign: 'right', color: C.secondary, fontVariantNumeric: 'tabular-nums' }}>{compact(p.views)}</div>
                  <div style={{ fontVariantNumeric: 'tabular-nums' }}>{NUM.format(p.bookmarks)} <span style={{ color: C.muted, fontSize: 12 }}>({Math.round(p.share * 100)}%)</span></div>
                  <div style={{ color: C.secondary }}>추정 <b style={{ color: C.text }}>{signed(p.estLift)}</b></div>
                </div>
              ))}
            </div>
          )}
        </details>
      ))}
    </div>
  );
}

// 캠페인 현황 슬랙 이미지(스펙 2026-11-13 §5, 시안 docs/mockups/campaign-status-slack-20261113.html).
// ImageResponse(satori)는 flex만 된다(grid 안 됨) — 시안의 grid를 flex로 옮겼다. 배치 폭 800px를 2배(1600px)로 그린다: 모든 크기에 X를 곱한다.
import type { Overview, OverviewCard } from '../campaignOverview.ts';
import { sortCards } from '../campaignOverview.ts';
import { weekLabel } from '../campaignListView.ts';
import { sentAtLabel, tileDescriptions } from '../campaignStatusSlack.ts';

export const X = 2;                 // 출력 배율
export const LAYOUT_W = 800;        // 시안 배치 폭
const ROW_H = 56;                   // 캠페인 한 줄
const FIXED_H = 450;                // 머리·네 칸·안내 줄·여백(시안 975px − 10줄×56 = 415, Pretendard 줄 높이 차이 여유 35)
export const imageHeight = (rows: number) => (FIXED_H + rows * ROW_H) * X;

const C = {
  t: '#0f1419', s: '#536471', m: '#6c7781', b: '#eff3f4', bs: '#cfd9de', blue: '#1d9bf0', track: '#e6ecef',
  warn: '#b45309', warnBg: '#fff4e5', warnBd: '#f6dfbd', green: '#0a7d54', greenBg: '#e8f6f0', surf: '#f7f9f9',
};
const px = (n: number) => n * X;

function Bar({ ratio, h = 12 }: { ratio: number; h?: number }) {
  return (
    <div style={{ display: 'flex', width: '100%', height: px(h), background: C.track, borderRadius: px(99), overflow: 'hidden' }}>
      <div style={{ width: `${Math.min(1, Math.max(0, ratio)) * 100}%`, height: '100%', background: C.blue, borderRadius: px(99) }} />
    </div>
  );
}

function Tile({ label, value, desc, warn, bar }: { label: string; value: number; desc?: string | null; warn?: boolean; bar?: number }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', flex: 1, padding: `${px(14)}px ${px(16)}px`, borderRadius: px(12),
      border: `${px(1)}px solid ${warn ? C.warnBd : C.b}`, background: warn ? C.warnBg : '#fff',
    }}>
      <div style={{ fontSize: px(17), color: C.s }}>{label}</div>
      {/* satori의 baseline 맞춤은 작은 글자를 아래로 처지게 그려서, 아래 끝 맞춤 + 작은 글자 아래 여백으로 시안의 기준선을 맞춘다 */}
      <div style={{ display: 'flex', alignItems: 'flex-end', marginTop: px(2) }}>
        <span style={{ fontSize: px(38), fontWeight: 700, color: warn ? C.warn : C.t, lineHeight: 1.2 }}>{value}</span>
        <span style={{ fontSize: px(20), color: C.s, lineHeight: 1.2, marginBottom: px(4), marginLeft: px(1) }}>건</span>
      </div>
      {bar !== undefined ? <div style={{ display: 'flex', marginTop: px(10) }}><Bar ratio={bar} /></div>
        : desc ? <div style={{ fontSize: px(16), color: C.m, marginTop: px(2) }}>{desc}</div> : null}
    </div>
  );
}

const CHIP: Record<OverviewCard['status'], { bg: string; color: string; border?: string }> = {
  late: { bg: C.warnBg, color: C.warn },
  done: { bg: C.greenBg, color: C.green },
  onTrack: { bg: C.surf, color: C.s },
  unset: { bg: '#fff', color: C.s, border: `${px(1)}px dashed ${C.bs}` },
};

function Row({ card }: { card: OverviewCard }) {
  const q = card.quantity, chip = CHIP[card.status];
  return (
    <div style={{ display: 'flex', alignItems: 'center', height: px(ROW_H), borderBottom: `${px(1)}px solid ${C.b}` }}>
      <div style={{ width: px(200), fontSize: px(21), fontWeight: 700, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{card.title}</div>
      <div style={{ display: 'flex', width: px(168), marginLeft: px(14) }}>
        <div style={{
          fontSize: px(17), fontWeight: 700, padding: `${px(3)}px ${px(11)}px`, borderRadius: px(999),
          background: chip.bg, color: chip.color, border: chip.border ?? 'none',
        }}>{card.statusLabel}</div>
      </div>
      <div style={{ display: 'flex', flex: 1, marginLeft: px(14) }}>
        {q.planned > 0 ? <Bar ratio={q.posted / q.planned} /> : <Bar ratio={0} />}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', width: px(92), marginLeft: px(14), fontSize: px(21) }}>
        {q.planned > 0
          ? <><span style={{ fontWeight: 700 }}>{q.posted}</span><span style={{ color: C.s, marginLeft: px(5) }}>/ {q.planned}건</span></>
          : <span style={{ color: C.s }}>-</span>}
      </div>
    </div>
  );
}

export function StatusImage({ o, sentAt }: { o: Overview; sentAt: Date }) {
  const t = o.tiles, d = tileDescriptions(t);
  const rows = sortCards(o.cards, 'progress');
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', width: '100%', height: '100%', background: '#fff', color: C.t,
      padding: `${px(28)}px ${px(28)}px ${px(24)}px`, fontFamily: 'Pretendard', lineHeight: 1.45,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div style={{ fontSize: px(30), fontWeight: 700 }}>{`${weekLabel(o.week.weekStart)} 캠페인 현황`}</div>
        <div style={{ fontSize: px(18), color: C.s }}>{sentAtLabel(sentAt)}</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', margin: `${px(18)}px 0 ${px(20)}px` }}>
        <div style={{ display: 'flex' }}>
          <Tile label="계획" value={t.planned} desc={d.planned} />
          <div style={{ width: px(12) }} />
          <Tile label="게시 완료" value={t.posted} bar={t.planned > 0 ? t.posted / t.planned : 0} />
        </div>
        <div style={{ display: 'flex', marginTop: px(12) }}>
          <Tile label="예정일 지난 미게시" value={t.overdue} desc={d.overdue} warn={t.overdue > 0} />
          <div style={{ width: px(12) }} />
          <Tile label="남은 게시 예정" value={t.remaining} desc={d.remaining} />
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', borderTop: `${px(1)}px solid ${C.bs}` }}>
        {rows.map((c) => <Row key={c.campaignId} card={c} />)}
      </div>
      <div style={{ fontSize: px(16), color: C.m, marginTop: px(14) }}>진행률(게시 ÷ 계획)이 높은 순이에요. 방문협찬(장기) 캠페인은 빠져 있어요.</div>
    </div>
  );
}

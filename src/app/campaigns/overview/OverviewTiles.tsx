// 캠페인 현황 — 수량 네 칸(스펙 §4-2, 시안 tiles()). 주차 캠페인만 합친 값이고 계산은 전부 buildOverview가 했다.
import type { OverviewTiles as Tiles } from '@/lib/campaignOverview';
import { tileDescriptions } from '@/lib/campaignStatusSlack';

const TILE = 'rounded-[12px] border px-[18px] py-4';
const LABEL = 'text-[13px] text-x-secondary';
const VALUE = 'mt-1 text-[28px] font-bold tabular-nums';
const DESC = 'mt-1 text-[13px] text-x-muted';
// 글자 크기는 토큰(text-ui 등) 대신 px 값 — 토큰은 줄 높이까지 바꿔 시안(1.45 상속)과 어긋난다

function Value({ n, warn }: { n: number; warn?: boolean }) {
  return (
    <div className={`${VALUE} ${warn ? 'text-[#b45309]' : ''}`}>
      {n}<small className="text-[15px] font-normal text-x-secondary">건</small>
    </div>
  );
}

// 게시 막대 — 카드 진행 막대와 같은 모양(시안 .bar)
export function ProgressBar({ ratio, className = '' }: { ratio: number; className?: string }) {
  return (
    <div className={`h-2 overflow-hidden rounded-[99px] bg-[#e6ecef] ${className}`}>
      <i className="block h-full rounded-[99px] bg-x-blue" style={{ width: `${Math.min(1, Math.max(0, ratio)) * 100}%` }} />
    </div>
  );
}

export function OverviewTiles({ tiles: t }: { tiles: Tiles }) {
  // 밀린 게 하나라도 있을 때만 주황 — 0건에 강조색을 쓰면 문제가 있는 것처럼 보인다(스펙 §4-2)
  const late = t.overdue > 0;
  // 보조 글은 슬랙 공유 이미지·메시지와 같은 함수 — 셋이 같은 말을 한다
  const d = tileDescriptions(t);
  return (
    <div className="grid grid-cols-2 gap-3 @min-[560px]:grid-cols-4">
      <div className={`${TILE} border-x-border`}>
        <div className={LABEL}>계획</div>
        <Value n={t.planned} />
        <div className={DESC}>{d.planned}</div>
      </div>
      <div className={`${TILE} border-x-border`}>
        <div className={LABEL}>게시 완료</div>
        <Value n={t.posted} />
        <ProgressBar ratio={t.planned > 0 ? t.posted / t.planned : 0} className="mt-[10px]" />
      </div>
      <div className={`${TILE} ${late ? 'border-[#f6dfbd] bg-[#fff4e5]' : 'border-x-border'}`}>
        <div className={LABEL}>예정일 지난 미게시</div>
        <Value n={t.overdue} warn={late} />
        <div className={DESC}>{d.overdue}</div>
      </div>
      <div className={`${TILE} border-x-border`}>
        <div className={LABEL}>남은 게시 예정</div>
        <Value n={t.remaining} />
        {d.remaining && <div className={DESC}>{d.remaining}</div>}
      </div>
    </div>
  );
}

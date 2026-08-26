'use client';
import { useState } from 'react';
import Link from 'next/link';
import { InfoTip } from '@/components/InfoTip';
import type { InfluencerCampaignItem } from '@/lib/campaignStore';
import { campaignStatus, CAMPAIGN_STATUS_LABEL, formatDateKo, type CampaignStatus } from '@/lib/campaignJudgment';
import { formatMoneyBy } from '@/lib/campaignCost';
import { kstToday } from '@/lib/datetime';

// 인플 프로필 "참여 캠페인"(캠페인 스펙 §5) — 원고가 배정됐거나 추가 비용이 적힌 캠페인. 캠페인명·기간·배정 콘텐츠 n·비용 소계(통화별).
// 조회만: 값은 전부 서버 롤업(listInfluencerCampaigns)이고 여기서 다시 세지 않는다. 캠페인 클릭 → /campaigns?id=(Task 11 라우트 형식).
// 협업 콘텐츠 탭 맨 위 — 캠페인은 이 사람에게 넘긴 콘텐츠의 묶음이다(거래 정보 탭은 단가·조건의 자리).
// 가독성 기준(캠페인 스펙 §3-2): 본문 15px(text-content)·보조 13px(text-ui)·행 ≥48px(py-3) — text-caption(11px)은 쓰지 않는다.
const STATUS_STYLE: Record<CampaignStatus, string> = {
  upcoming: 'bg-x-blue/10 text-x-blue-text', active: 'bg-green-100 text-green-800', ended: 'bg-x-surface text-x-secondary',
};

export function CampaignSection({ campaigns }: { campaigns: InfluencerCampaignItem[] }) {
  // '오늘'(서울)은 마운트 시 한 번 — 렌더마다 시계를 읽지 않는다(react-hooks/purity, /campaigns page 관례)
  const [today] = useState(() => kstToday());
  return (
    <section className="mt-7 pt-1">
      <div className="flex flex-wrap items-center gap-1.5">
        <h2 className="text-content font-bold">참여 캠페인</h2>
        {/* 우측 금액에 있던 native title을 여기로 접었다 — 이 저장소는 native title을 쓰지 않는다(InfoTip.tsx 상단 설명) */}
        <InfoTip text="이 계정에 원고가 배정됐거나 추가 비용이 적힌 캠페인을 모아 보여줘요. 오른쪽 금액은 이 캠페인에서 이 사람의 콘텐츠 비용 + 추가 비용이에요(통화가 다르면 따로 보여요). 캠페인을 누르면 캠페인 화면이 열려요." />
        {campaigns.length > 0 && <span className="text-ui text-x-muted">· {campaigns.length}개</span>}
      </div>
      {campaigns.length === 0 ? (
        <p className="mt-1 text-ui leading-relaxed text-x-muted">아직 참여한 캠페인이 없어요 — 캠페인 화면에서 원고에 이 계정을 배정하면 여기 모여요.</p>
      ) : (
        <ul className="mt-1.5 space-y-1">
          {campaigns.map((c) => {
            const status = campaignStatus(c.startsOn, c.endsOn, today);
            return (
              <li key={c.id}>
                <Link href={`/campaigns?id=${c.id}`}
                      className="flex items-center gap-3 rounded-lg border border-x-border px-3 py-3 hover:bg-x-hover">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-content font-medium">{c.name}</span>
                    <span className="block text-ui text-x-muted">
                      {formatDateKo(c.startsOn)} ~ {formatDateKo(c.endsOn)} · 콘텐츠 {c.contentCount}개
                      {/* 돈이 붙었는데 원고가 없는 경우를 말로 드러낸다(캠페인 스펙 §2-4). 단, listInfluencerCampaigns는
                          contentCount를 셀 때 status='unused' 원고를 뺀다 — 이 캠페인에 배정된 원고가 전부 미사용이고
                          추가 비용 행도 없으면 contentCount·subtotal이 둘 다 비어 "추가 비용만"이라 하면 거짓말이 된다.
                          그래서 비용이 실제로 있을 때만 "추가 비용만"이라 하고, 없으면 미사용 사실을 그대로 밝힌다. */}
                      {c.contentCount === 0 && (
                        formatMoneyBy(c.subtotal) !== '—' ? (
                          <span className="text-amber-800"> · 배정 원고 없음 — 추가 비용만</span>
                        ) : (
                          <span className="text-x-muted"> · 배정 원고 없음(미사용만)</span>
                        )
                      )}
                    </span>
                  </span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-ui font-bold ${STATUS_STYLE[status]}`}>{CAMPAIGN_STATUS_LABEL[status]}</span>
                  <span className="shrink-0 text-content tabular-nums">
                    {formatMoneyBy(c.subtotal)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

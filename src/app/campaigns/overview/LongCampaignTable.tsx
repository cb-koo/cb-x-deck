// 캠페인 현황 — 방문협찬(장기 캠페인) 표(스펙 §4-5, 시안 정적 <table>).
// 방문부터 게시까지 주를 넘기는 작업이라 주간 수량에 섞지 않고 따로 보여준다. 숫자는 LongRow 그대로.
'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { formatCpv, type LongRow } from '@/lib/campaignOverview';
import { compact, NUM } from '@/components/charts/tokens';

// 시안 th / td(본문 표 크기 — 패널 표보다 크다)
const TH = 'whitespace-nowrap border-b border-x-border-strong px-3 py-[10px] text-left text-[13px] font-medium text-x-secondary';
const TD = 'h-[54px] whitespace-nowrap border-b border-x-border px-3 py-0';
const NUMTD = `${TD} text-right tabular-nums`;
const DIM = 'text-x-muted';

const hrefOf = (id: string) => `/campaigns/flow?id=${id}`;

export function LongCampaignTable({ rows, isCurrentWeek }: { rows: LongRow[]; isCurrentWeek: boolean }) {
  const router = useRouter();
  // 장기 캠페인이 없으면 제목까지 통째로 그리지 않는다 — 빈 표는 볼 게 없다
  if (rows.length === 0) return null;
  return (
    <>
      <div className="mb-[14px] mt-10 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="mb-1 text-[17px] font-bold">방문협찬 (장기 캠페인)</h2>
          <div className="text-[13px] text-x-muted">방문부터 게시까지 오래 걸리는 작업이라 주간 수량에 넣지 않고 따로 보여줘요. 줄을 누르면 캠페인 화면으로 가요.</div>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead><tr>
            <th className={TH}>클라이언트</th>
            <th className={TH}>지금 단계</th>
            {/* 지난 주를 볼 때 '이번 주'는 거짓말 — 보고 있는 그 주라는 뜻으로 바꾼다 */}
            <th className={`${TH} text-right`}>{isCurrentWeek ? '이번 주 게시' : '이 주 게시'}</th>
            <th className={`${TH} text-right`}>조회수</th>
            <th className={`${TH} text-right`}>저장수</th>
            <th className={`${TH} text-right`}>CPV</th>
          </tr></thead>
          <tbody>
            {rows.map((r) => {
              const views = r.perf.views.value, bookmarks = r.perf.bookmarks.value;
              const cpv = formatCpv(r.perf.cpv);
              return (
                <tr key={r.campaignId} className="cursor-pointer [&:hover>td]:bg-x-surface" onClick={() => router.push(hrefOf(r.campaignId))}>
                  <td className={`${TD} font-bold`}>
                    {/* 키보드로도 갈 수 있게 이름은 진짜 링크 — 줄 클릭과 겹쳐 두 번 이동하지 않게 전파를 막는다 */}
                    <Link href={hrefOf(r.campaignId)} onClick={(e) => e.stopPropagation()} className="text-inherit no-underline">{r.title}</Link>
                  </td>
                  <td className={TD}>
                    <div className="flex gap-[14px] text-[14px]">
                      {r.stages.map((s) => <span key={s.label} className="text-x-secondary">{s.label} <b className="text-x-text">{s.count}</b></span>)}
                    </div>
                  </td>
                  <td className={NUMTD}>{r.postedThisWeek}건</td>
                  <td className={`${NUMTD} ${views === null ? DIM : ''}`}>{views === null ? '-' : compact(views)}</td>
                  <td className={`${NUMTD} ${bookmarks === null ? DIM : ''}`}>{bookmarks === null ? '-' : NUM.format(bookmarks)}</td>
                  {/* 값 없음('-')만 흐리게(시안 td.dim) — 무상은 '0.0원'으로 숫자처럼 보인다(koo 11-12) */}
                  <td className={`${NUMTD} ${r.perf.cpv.kind === 'none' ? DIM : ''}`}>{cpv}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

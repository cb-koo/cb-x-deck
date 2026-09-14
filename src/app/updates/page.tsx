import { UPDATES, type UpdateType } from '@/content/updates';
import { groupByMonth, isMonthOpen, formatDay, assertValidUpdates } from '@/lib/updates';
import { UpdateLink } from './UpdateLink';

// 정적 렌더 — 데이터가 빌드 시점 상수라 force-dynamic 없음, DB 조회 0 (스펙 §3).

// 유형별 배지·점 색 (스펙 §3). 색은 배지 글자와 함께 쓰므로 색만으로 전하지 않는다.
// 내부는 빈 원 — 축선만 훑어도 "큰 소식 / 잔잔한 소식" 리듬이 보이게.
const TYPE_STYLE: Record<UpdateType, { badge: string; node: string }> = {
  '새 기능': { badge: 'bg-[#e8f4fd] text-x-blue-text', node: 'bg-x-blue' },
  '개선':   { badge: 'bg-[#e6f7f0] text-[#0a7a52]',   node: 'bg-x-green' },
  '수정':   { badge: 'bg-[#fff4e0] text-[#9a5b00]',   node: 'bg-[#f59e0b]' },
  '내부':   { badge: 'bg-[#f1f3f4] text-x-secondary', node: 'bg-white border-2 border-x-border-strong' },
};

// 빌드 시 데이터 검사 — 잘못된 항목이 있으면 next build가 실패한다 (스펙 §1의 약속)
assertValidUpdates(UPDATES);

export default function UpdatesPage() {
  const groups = groupByMonth(UPDATES);

  return (
    <main className="mx-auto max-w-[760px] px-10 pt-12 pb-28 text-x-text">
      <h1 className="text-[24px] font-bold">업데이트 소식</h1>
      <p className="mt-2.5 text-[16px] leading-[1.65] text-x-secondary">
        기능이 추가되거나 바뀌면 여기에 올립니다. 눈에 보이지 않는 변화도 모두 적어요.
      </p>
      {/* 범례 — 축선의 점 색이 무슨 뜻인지 처음 보는 사람도 알 수 있게 (koo 질문에서 확인된 빈틈, UX 원칙 2) */}
      <ul aria-label="점 색깔 뜻" className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-x-secondary">
        {(Object.keys(TYPE_STYLE) as UpdateType[]).map((t) => (
          <li key={t} className="flex items-center gap-1.5">
            <span aria-hidden className={`inline-block h-2.5 w-2.5 rounded-full ${TYPE_STYLE[t].node}`} />
            <span>{t}{t === '내부' && <span className="text-x-muted"> — 화면 변화 없는 성능·안정성 작업</span>}</span>
          </li>
        ))}
      </ul>

      {groups.length === 0 ? (
        <p className="mt-10 text-[16px] text-x-secondary">아직 올라온 소식이 없어요</p>
      ) : (
        // 축선 하나가 월 헤더 뒤로 이어진다 — 접힌 월에서도 "아래로 더 있다"가 보인다 (스펙 §3)
        <div className="relative mt-10">
          <span aria-hidden className="absolute bottom-0 left-1 top-0 w-0.5 bg-[#e1e8ed]" />
          {groups.map((g, i) => (
            <details key={g.ym} open={isMonthOpen(i)} className="group pb-2">
              <summary className="flex cursor-pointer list-none items-baseline gap-2 pl-7 text-[14px] font-bold tracking-[0.02em] text-x-secondary [&::-webkit-details-marker]:hidden">
                <span aria-hidden className="inline-block text-x-muted transition-transform group-open:rotate-90">▸</span>
                <span>{g.label}</span>
                {/* 접힌 월만 건수 — 펼치면 항목이 보여 숫자가 중복 신호가 된다 */}
                <span className="font-normal text-x-muted group-open:hidden">· {g.entries.length}건</span>
              </summary>
              <ol className="mt-3 list-none p-0">
                {g.entries.map((e, j) => {
                  const style = TYPE_STYLE[e.type];
                  return (
                    <li key={`${e.date}-${j}`} className="relative pb-10 pl-7 last:pb-4">
                      <span aria-hidden
                            className={`absolute left-0 top-[5px] h-2.5 w-2.5 rounded-full ring-3 ring-white ${style.node}`} />
                      <div className="flex items-center gap-2 text-[14px] text-x-secondary">
                        <span className="tabular-nums">{formatDay(e.date)}</span>
                        <span className="text-x-border-strong">·</span>
                        <span className={`rounded-full px-[9px] py-0.5 text-[12px] font-semibold leading-normal ${style.badge}`}>{e.type}</span>
                      </div>
                      <h2 className="mt-1.5 text-[18px] font-bold leading-snug text-balance">{e.title}</h2>
                      <p className="mt-2 text-[16px] leading-[1.7]">{e.summary}</p>
                      {e.bullets && e.bullets.length > 0 && (
                        <ul className="mt-2 list-disc pl-5 text-[16px] leading-[1.7] marker:text-x-secondary">
                          {e.bullets.map((b, k) => <li key={k} className="mb-1 last:mb-0">{b}</li>)}
                        </ul>
                      )}
                      {e.link && <UpdateLink label={e.link.label} href={e.link.href} />}
                    </li>
                  );
                })}
              </ol>
            </details>
          ))}
        </div>
      )}
    </main>
  );
}

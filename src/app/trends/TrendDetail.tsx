// 검색 트렌드 상세 — 판정 문장(크기·방향·성격·한국) → 월별 그래프(전체 / 한국) → 성격 막대(지금 vs 1년 전) → 함께 찾는 말 → 같은 묶음 비교.
// 스펙 2026-10-13 §5-2(3차)
'use client';
import { useState } from 'react';
import { LineChart } from '@/components/charts/LineChart';
import { SegmentedBar } from '@/components/charts/SegmentedBar';
import { describe, fmtVolume } from '@/lib/searchTrend';
import { INTENT_LABEL, PROFILE_INTENTS, STAGE_LABEL, STAGE_HINT, type ProfileIntent } from '@/lib/searchIntent';
import { StateChip, StageChip } from './StateChip';
import { KoreaCell, type TrendRow } from './TrendTable';

const PERIODS = [{ m: 12, label: '1년' }, { m: 24, label: '2년' }, { m: 48, label: '4년' }] as const;

// 성격 색 — 고객 여정 순서대로 알아보기(하늘) → 고민(보라 계열) → 고르기(주황 계열) → 한국(초록). 칸 안에 %를 같이 적어 색만으로 읽지 않게.
const INTENT_COLOR: Record<ProfileIntent, string> = {
  info: '#7cc4f4', effect: '#8b7fd6', worry: '#5b4bb7', concern: '#c9d3d9', cost: '#f2a541', place: '#d9782b', korea: '#1f9d55',
};

const pct = (v: number) => `${Math.round(v * 100)}%`;

function ProfileBar({ label, p }: { label: string; p: Record<ProfileIntent, number> }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-14 shrink-0 text-ui text-x-secondary">{label}</span>
      <div className="min-w-0 flex-1">
        <SegmentedBar inBar total={1} segments={PROFILE_INTENTS.map((i) => ({ value: p[i], color: INTENT_COLOR[i], label: INTENT_LABEL[i] }))} />
      </div>
    </div>
  );
}

export function TrendDetail({ row, months, siblings, onSelect, onClose }: {
  row: TrendRow; months: string[]; siblings: TrendRow[]; onSelect: (id: string) => void; onClose: () => void;
}) {
  const [period, setPeriod] = useState<12 | 24 | 48>(24);
  const summary = row.summary;
  const it = row.intent;
  const vols = row.series;
  const n = months.length;
  const from = Math.max(0, n - period);
  const labels = months.slice(from).map((m) => `${m.slice(2, 4)}.${m.slice(5, 7)}`);
  const series = vols ? [
    { name: '검색량', values: vols.slice(from) },
    { name: '1년 전', dashed: true, color: '#8ecdf8', values: months.slice(from).map((_, i) => vols[from + i - 12] ?? null) },
  ] : [];
  const korea = it?.korea ?? null;
  const showKorea = !!korea && korea.slice(from).some((v) => v >= 50);
  const ranked = [...siblings].sort((a, b) => (b.summary.now ?? -1) - (a.summary.now ?? -1));

  // 성격 문장 — 비중 큰 두 의도를 사용자 말로
  const prof = it?.profile ?? null;
  const topTwo = prof ? PROFILE_INTENTS.filter((i) => i !== 'korea').sort((a, b) => prof[b] - prof[a]).slice(0, 2) : [];
  const characterText = it?.stage && prof
    ? `함께 찾는 말은 ${topTwo.map((i) => `${INTENT_LABEL[i]}(${pct(prof[i])})`).join('·')}이 많아요 — ${STAGE_LABEL[it.stage]}이에요.`
    : '함께 찾는 말이 적어 왜 찾는지는 판단을 보류해요.';
  const koreaText = row.korea && row.korea.now >= 50
    ? `한국에서 받으려는 검색(韓国·ソウル·江南)은 한 달 ${fmtVolume(row.korea.now)}번이에요.`
    : '한국에서 받으려는 검색은 아직 적어요.';

  return (
    <aside className="flex w-[clamp(560px,44vw,780px)] shrink-0 flex-col overflow-y-auto border-l border-x-border bg-white">
      <div className="sticky top-0 z-10 flex items-start gap-3 border-b border-x-border bg-white px-6 py-4">
        <div className="min-w-0">
          <p className="text-[18px] font-bold">{row.name}</p>
          <p className="truncate text-ui text-x-muted">{row.jp}{row.en && ` · ${row.en}`} · {row.major} › {row.middle}</p>
        </div>
        <button onClick={onClose} aria-label="닫기" className="ml-auto shrink-0 rounded-full px-2 py-1 text-x-secondary hover:bg-x-hover">✕</button>
      </div>

      <div className="space-y-7 px-6 py-5">
        <div>
          <div className="flex flex-wrap items-center gap-1.5">
            <StateChip state={summary.state} />
            <StageChip stage={it?.stage ?? null} />
          </div>
          <p className="mt-2 text-[15px] leading-relaxed">{describe(summary)} {characterText} {koreaText}</p>
          {it?.ambiguous && (
            <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-ui text-amber-800">
              이 이름은 게임·상품·사람 이름 같은 다른 뜻으로도 많이 검색돼요. 다른 뜻 검색은 빼고 셌지만, 이름만 검색한 수에는 섞여 있어 실제 시술 수요보다 클 수 있어요.
            </p>
          )}
        </div>

        {vols && (
          <div>
            <div className="mb-2 flex items-center">
              <p className="text-ui font-semibold text-x-secondary">월별 검색량 <span className="font-normal text-x-muted">· 관련 검색어 {it?.keywords ?? 1}개 합계</span></p>
              <div className="ml-auto flex gap-1">
                {PERIODS.map((p) => (
                  <button key={p.m} onClick={() => setPeriod(p.m)}
                          className={`rounded-full px-2.5 py-0.5 text-ui ${period === p.m ? 'bg-x-text text-white' : 'text-x-secondary hover:bg-x-hover'}`}>{p.label}</button>
                ))}
              </div>
            </div>
            <LineChart labels={labels} series={series} height={240} />
            {showKorea && korea && (
              <div className="mt-4">
                <p className="mb-1 text-ui font-semibold text-x-secondary">한국 검색 <span className="font-normal text-x-muted">· 韓国·ソウル·江南이 붙은 검색</span></p>
                <LineChart labels={labels} series={[{ name: '한국', color: '#1f9d55', values: korea.slice(from) }]} height={140} />
              </div>
            )}
            <p className="mt-2 text-ui text-x-muted">검색량은 구간으로 반올림된 값이라 달마다 계단처럼 튈 수 있어요. 판정은 3개월 평균으로 해요. 여러 검색어를 합쳐서 한 사람이 겹쳐 세질 수 있어요 — 크기보다 방향을 보세요.</p>
          </div>
        )}

        <dl className="grid grid-cols-3 gap-3">
          <div className="rounded-lg bg-x-surface px-3 py-2.5">
            <dt className="text-ui text-x-muted">최근 3개월 평균</dt>
            <dd className="mt-0.5 text-[17px] font-semibold tabular-nums">{fmtVolume(summary.now)}</dd>
          </div>
          <div className="rounded-lg bg-x-surface px-3 py-2.5">
            <dt className="text-ui text-x-muted">1년 전 같은 3개월</dt>
            <dd className="mt-0.5 text-[17px] font-semibold tabular-nums">{fmtVolume(summary.yearAgo)}</dd>
          </div>
          <div className="rounded-lg bg-x-surface px-3 py-2.5">
            <dt className="text-ui text-x-muted">한국 검색</dt>
            <dd className="mt-0.5 text-[17px] font-semibold"><KoreaCell k={row.korea} /></dd>
          </div>
        </dl>

        {it && prof && (
          <div>
            <p className="mb-1 text-ui font-semibold text-x-secondary">왜 찾나 — 함께 찾는 말의 비중</p>
            {it.stage && <p className="mb-3 text-ui text-x-muted">{STAGE_LABEL[it.stage]}: {STAGE_HINT[it.stage]}
              {it.prevStage && it.prevStage !== it.stage && <> · 1년 전엔 <b className="font-semibold text-x-secondary">{STAGE_LABEL[it.prevStage]}</b>이었어요</>}</p>}
            <div className="space-y-2">
              <ProfileBar label="지금" p={prof} />
              {it.prev && <ProfileBar label="1년 전" p={it.prev} />}
            </div>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
              {PROFILE_INTENTS.map((i) => (
                <span key={i} className="flex items-center gap-1.5 text-ui text-x-secondary">
                  <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: INTENT_COLOR[i] }} />{INTENT_LABEL[i]} <span className="tabular-nums text-x-muted">{pct(prof[i])}</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {it && Object.keys(it.top).length > 0 && (
          <div>
            <p className="mb-2 text-ui font-semibold text-x-secondary">함께 찾는 말 — 최근 12개월 월평균</p>
            <div className="divide-y divide-x-border/60 rounded-lg border border-x-border">
              {PROFILE_INTENTS.filter((i) => it.top[i]?.length).map((i) => (
                <div key={i} className="flex items-start gap-3 px-3 py-2.5">
                  <span className="mt-0.5 flex w-[80px] shrink-0 items-center gap-1.5 text-ui text-x-secondary">
                    <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: INTENT_COLOR[i] }} />{INTENT_LABEL[i]}
                  </span>
                  <div className="flex min-w-0 flex-wrap gap-1.5">
                    {(it.top[i] ?? []).map(([t, m]) => (
                      <span key={t} className="rounded-md bg-x-surface px-2 py-0.5 text-ui">{t} <span className="tabular-nums text-x-muted">{fmtVolume(m)}</span></span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div>
          <p className="mb-2 text-ui font-semibold text-x-secondary">
            {siblings.every((s) => s.middle === row.middle) ? `같은 묶음(${row.major} › ${row.middle})` : `같은 분류(${row.major})`}에서 — 많이 찾는 순
          </p>
          <ul className="divide-y divide-x-border/60 rounded-lg border border-x-border">
            {ranked.map((s) => (
              <li key={s.id}>
                <button onClick={() => onSelect(s.id)}
                        className={`flex h-11 w-full items-center gap-2 px-3 text-left text-[15px] ${s.id === row.id ? 'bg-x-blue/10 font-semibold' : 'hover:bg-x-hover'}`}>
                  <span className="min-w-0 flex-1 truncate">{s.name}</span>
                  <span className="tabular-nums text-x-secondary">{s.summary.state === 'nodata' ? '—' : fmtVolume(s.summary.now)}</span>
                  <span className="w-[88px] text-right"><StateChip state={s.summary.state} /></span>
                  <span className="w-[96px] text-right"><StageChip stage={s.intent?.stage ?? null} /></span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </aside>
  );
}

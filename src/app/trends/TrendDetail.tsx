// 검색 트렌드 상세 — 판정 문장(크기·방향·성격·한국) → 월별 그래프(전체 / 한국) → 검색 의도(의도별 한 줄: 비중·전년 변화·대표 검색어) → 같은 묶음 비교.
// 스펙 2026-10-13 §5-2(3차)
'use client';
import { useState } from 'react';
import { LineChart } from '@/components/charts/LineChart';
import { Sparkline } from '@/components/charts/Sparkline';
import { describe, fmtVolume } from '@/lib/searchTrend';
import { INTENT_LABEL, PROFILE_INTENTS, STAGE_LABEL, STAGE_HINT, type ProfileIntent } from '@/lib/searchIntent';
import { StateChip, StageChip } from './StateChip';
import { KoreaCell, type TrendRow, type IntentInfo } from './TrendTable';

const PERIODS = [{ m: 12, label: '1년' }, { m: 24, label: '2년' }, { m: 48, label: '4년' }] as const;

const pct = (v: number) => `${Math.round(v * 100)}%`;

// 검색 의도 — 한국은 위 한국 검색량 그래프가 따로 보여 주므로 빼고, 나머지를 100%로 다시 나눈다
type Share = Partial<Record<ProfileIntent, number>>;
const LIST_INTENTS = PROFILE_INTENTS.filter((i) => i !== 'korea');
function shares(p: Record<ProfileIntent, number> | null): Share | null {
  if (!p) return null;
  const all = LIST_INTENTS.reduce((s, i) => s + p[i], 0);
  return all > 0 ? Object.fromEntries(LIST_INTENTS.map((i) => [i, p[i] / all])) : null;
}
const SHIFT = 0.1;  // 전년보다 10%p 이상 움직인 의도에만 ▲▼ — 나머지(대부분)는 표시 없이

// 의도별 한 줄 — 이름 · 막대 · 비중 · 전년 변화 · 대표 검색어. 막대·범례·검색어 목록을 따로 두면 같은 7개를 세 번 읽어야 했다(10-14).
function IntentRows({ now, prev, top }: { now: Share; prev: Share | null; top: IntentInfo['top'] }) {
  const list = LIST_INTENTS.filter((i) => (now[i] ?? 0) >= 0.005 || top[i]?.length).sort((a, b) => (now[b] ?? 0) - (now[a] ?? 0));
  return (
    <div className="divide-y divide-x-border/60 rounded-lg border border-x-border">
      {list.map((i) => {
        const v = now[i] ?? 0;
        const d = prev ? v - (prev[i] ?? 0) : 0;
        return (
          <div key={i} className="flex items-center gap-3 px-3 py-2.5">
            <span className="w-[84px] shrink-0 text-ui text-x-secondary">{INTENT_LABEL[i]}</span>
            <span className="h-2 w-[96px] shrink-0 overflow-hidden rounded-full bg-x-surface">
              <span className="block h-full rounded-full bg-x-blue" style={{ width: `${Math.round(v * 100)}%` }} />
            </span>
            <span className="w-9 shrink-0 text-right text-ui font-medium tabular-nums">{pct(v)}</span>
            <span className={`w-[52px] shrink-0 text-ui tabular-nums ${d > 0 ? 'text-green-700' : 'text-red-600'}`}>
              {Math.abs(d) >= SHIFT ? `${d > 0 ? '▲' : '▼'}${Math.round(Math.abs(d) * 100)}%p` : ''}
            </span>
            <span className="min-w-0 flex-1 truncate text-ui" title={(top[i] ?? []).map(([t, m, ko]) => `${ko ? `${ko} (${t})` : t} ${fmtVolume(m)}`).join('\n')}>
              {(top[i] ?? []).slice(0, 2).map(([t, m, ko], k) => (
                <span key={t}>{k > 0 && <span className="text-x-muted"> · </span>}
                  {ko && <span className="text-x-secondary">{ko} </span>}<span className="text-x-muted">{t} {fmtVolume(m)}</span>
                </span>
              ))}
            </span>
          </div>
        );
      })}
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
    { name: '전년', dashed: true, color: '#8ecdf8', values: months.slice(from).map((_, i) => vols[from + i - 12] ?? null) },
  ] : [];
  const korea = it?.korea ?? null;
  const showKorea = !!korea && korea.slice(from).some((v) => v >= 50);
  // 대표 검색어(시트 일본어 키워드)가 0으로 오는 경우 — 키워드 플래너가 비슷한 표현을 다른 대표어로 합쳐 0을 준다(ニキビ治療 등)
  const repZero = !row.volumes || row.volumes.slice(-3).every((v) => v === 0);
  const members = it?.members ?? null;
  const memberNow = (t: number[]) => t.slice(-3).reduce((a, b) => a + b, 0) / 3;
  const memberSum = members ? members.reduce((a, m) => a + memberNow(m.total), 0) : 0;
  const ranked = [...siblings].sort((a, b) => (b.summary.now ?? -1) - (a.summary.now ?? -1));

  // 성격 문장 — 비중 큰 두 의도를 사용자 말로
  const prof = shares(it?.profile ?? null);
  const prevProf = shares(it?.prev ?? null);
  const topTwo = prof ? [...LIST_INTENTS].sort((a, b) => (prof[b] ?? 0) - (prof[a] ?? 0)).slice(0, 2) : [];
  const characterText = it?.stage && prof
    ? `검색 의도는 ${topTwo.map((i) => `${INTENT_LABEL[i]} ${pct(prof[i] ?? 0)}`).join(' · ')} 중심의 ${STAGE_LABEL[it.stage]} 단계예요.`
    : '연관 검색어가 적어 관심 단계는 판단 보류예요.';
  const koreaText = row.korea && row.korea.now >= 50
    ? `한국 검색량(韓国·ソウル·江南·明洞·弘大)은 월 ${fmtVolume(row.korea.now)}이에요.`
    : '한국 검색량은 아직 소량이에요.';

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
          {repZero && summary.state !== 'nodata' && (
            <p className="mt-2 rounded-lg bg-x-surface px-3 py-2 text-ui text-x-secondary">
              대표 검색어 {row.jp.split(' 외 ')[0]}는 키워드 플래너 값이 0(비슷한 표현을 다른 대표어로 합쳐 집계). 수치는 수식어·한국 조합 검색 기준이라 실제 수요보다 작을 수 있어요.
            </p>
          )}
          {it?.ambiguous && (
            <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-ui text-amber-800">
              동음이의 혼재: 시술명만 검색하면 게임·회사·상품 등 다른 뜻이 대부분이에요. 시술명 단독 검색은 빼고 효과·가격·병원 등이 붙은 검색만 셌어요 — 실제 수요보다 작게 잡혀요.
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
                <p className="mb-1 text-ui font-semibold text-x-secondary">한국 검색량 <span className="font-normal text-x-muted">· 韓国·ソウル·江南·明洞·弘大 포함</span></p>
                <LineChart labels={labels} series={[{ name: '한국', color: '#1f9d55', values: korea.slice(from) }]} height={140} />
              </div>
            )}
            <p className="mt-2 text-ui text-x-muted">구간 반올림값이라 월별 계단형 변동 · 판정은 3개월 평균 · 검색어 합계라 중복 집계 가능(규모보다 추세 위주로)</p>
          </div>
        )}

        <dl className="grid grid-cols-3 gap-3">
          <div className="rounded-lg bg-x-surface px-3 py-2.5">
            <dt className="text-ui text-x-muted">최근 3개월 평균</dt>
            <dd className="mt-0.5 text-[17px] font-semibold tabular-nums">{fmtVolume(summary.now)}</dd>
          </div>
          <div className="rounded-lg bg-x-surface px-3 py-2.5">
            <dt className="text-ui text-x-muted">전년 동기 3개월 평균</dt>
            <dd className="mt-0.5 text-[17px] font-semibold tabular-nums">{fmtVolume(summary.yearAgo)}</dd>
          </div>
          <div className="rounded-lg bg-x-surface px-3 py-2.5">
            <dt className="text-ui text-x-muted">한국 검색량</dt>
            <dd className="mt-0.5 text-[17px] font-semibold"><KoreaCell k={row.korea} /></dd>
          </div>
        </dl>

        {members && (
          <div>
            <p className="mb-2 text-ui font-semibold text-x-secondary">검색어 구성 <span className="font-normal text-x-muted">· 같은 시술명의 제품·표기 변형, 최근 3개월 평균</span></p>
            <ul className="divide-y divide-x-border/60 rounded-lg border border-x-border">
              {[...members].sort((a, b) => memberNow(b.total) - memberNow(a.total)).map((m) => {
                const v = memberNow(m.total);
                return (
                  <li key={m.id} className="flex h-11 items-center gap-3 px-3 text-[15px]">
                    <span className="min-w-0 flex-1 truncate">{m.jp} <span className="text-ui text-x-muted">{m.kr}</span></span>
                    <span className="tabular-nums text-x-secondary">{v > 0 ? fmtVolume(v) : <span className="text-ui text-x-muted">데이터 없음</span>}</span>
                    <span className="w-10 text-right text-ui tabular-nums text-x-muted">{memberSum > 0 && v > 0 ? pct(v / memberSum) : ''}</span>
                    <span className="w-[96px]">{v > 0 && <Sparkline values={m.total} width={96} height={24} />}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {it && prof && (
          <div>
            <div className="mb-2 flex items-baseline gap-2">
              <p className="text-ui font-semibold text-x-secondary">검색 의도 · 최근 1년</p>
              {it.stage && <span className="ml-auto text-ui text-x-muted" title={STAGE_HINT[it.stage]}>
                <b className="font-semibold text-x-secondary">{STAGE_LABEL[it.stage]} 단계</b>
                {it.prevStage && it.prevStage !== it.stage && <> (전년 {STAGE_LABEL[it.prevStage]})</>}
              </span>}
            </div>
            <IntentRows now={prof} prev={prevProf} top={it.top} />
            <p className="mt-1.5 text-ui text-x-muted">▲▼ 전년보다 10%p 이상 바뀐 의도 · 오른쪽은 대표 검색어 — 한국어 번역 · 일본어 원문 · 월평균</p>
          </div>
        )}

        <div>
          <p className="mb-2 text-ui font-semibold text-x-secondary">
            {siblings.every((s) => s.middle === row.middle) ? `같은 묶음(${row.major} › ${row.middle})` : `같은 분류(${row.major})`}내 검색량 순위
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

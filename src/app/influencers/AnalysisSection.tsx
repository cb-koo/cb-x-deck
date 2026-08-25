'use client';
import { useState, type ReactNode } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import { Button } from '@/components/ui';
import { formatCount } from '@/lib/format';
import { kstMonthDay, kstDayRange, dateOnlyMonthDay, asDateOnly } from '@/lib/datetime';
import { relTime } from '@/lib/relTime';
import { judgeCadence, judgeEngagement } from '@/lib/influencerJudgment';
import { CONTENT_TYPE_LABEL, type ContentType } from '@/lib/analysisStats';
import type { InfluencerAnalysis } from '@/lib/influencerStore';

export function AnalysisSection({ id, analysis, analyzedAt, followers, onAnalyzed }: {
  id: string;
  analysis: InfluencerAnalysis | null;
  analyzedAt: string | null;
  followers: number | null;
  onAnalyzed: (analysis: InfluencerAnalysis, analyzedAt: string) => void;
}) {
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState('');

  // X 수집 + LLM 분석 = 비용 액션 — 버튼으로만(AGENTS.md ⑥). 실패해도 기존 결과는 지우지 않는다.
  async function run() {
    if (running) return;
    setRunning(true);
    setErr('');
    try {
      const r = await apiFetch(`/api/influencers/${id}/analyze`, { method: 'POST' });
      const body = (await r.json().catch(() => ({}))) as {
        analysis?: InfluencerAnalysis; analyzedAt?: string; error?: string;
      };
      // 서버 문구를 그대로 쓴다 — 원인을 넘겨짚지 않는다(프로필 갱신과 같은 관례)
      if (!r.ok || !body.analysis) {
        setErr(body.error ?? `분석하지 못했어요 (오류 ${r.status})`);
        return;
      }
      onAnalyzed(body.analysis, body.analyzedAt ?? new Date().toISOString());
    } catch {
      setErr('분석하지 못했어요 — 네트워크를 확인하고 다시 시도해 주세요');
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className="mt-7 border-t border-x-border pt-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-content font-bold">계정 분석</h2>
        {analysis && (
          <>
            <span className="text-caption text-x-muted">
              최근 {analysis.sample.count}건 · {kstMonthDay(analysis.sample.since)}~{kstMonthDay(analysis.sample.until)} 기준
              {analyzedAt && <> · {relTime(analyzedAt, '분석')}</>}
              {/* 받아온 글보다 분류한 글이 적을 때만 그 사실을 적는다 — 표본 0건이면 이 말도 나오지 않는다 */}
              {analysis.sample.count > analysis.sample.classified &&
                <> · 이 중 {analysis.sample.classified}건 분석됨</>}
            </span>
            <Button variant="subtle" className="ml-auto shrink-0" onClick={run} disabled={running}>
              {running ? '분석 중… (1~2분)' : '다시 분석'}
            </Button>
          </>
        )}
      </div>

      {!analysis && (
        <div className="mt-1">
          <p className="text-caption leading-relaxed text-x-muted">
            최근 3개월 글(최대 100건)을 X에서 받아와 주제·반응 수준을 분석해요 — 1~2분 걸려요.
          </p>
          <Button variant="primary" className="mt-1.5" onClick={run} disabled={running}>
            {running ? '분석 중… (1~2분)' : '계정 분석'}
          </Button>
        </div>
      )}

      {err && <p role="alert" className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-ui text-red-700">{err}</p>}

      {analysis && <AnalysisResult analysis={analysis} followers={followers} />}
    </section>
  );
}

// judge* 문구는 '값 — 판단' 한 문장으로 온다(influencerJudgment). 타일에서 값(큰 글씨)과 판단(캡션)을
// 위아래로 나누려면 쪼개야 하는데, 판단 함수는 명부·프로필이 함께 쓰는 단일 출처라 손대지 않고
// 표시 직전인 여기서만 자른다. ' — '가 없는 문구(예: '조회수를 확인할 수 없었어요')는 통째로 값이다.
function splitJudgment(label: string): { value: string; verdict: string | null } {
  const i = label.indexOf(' — ');
  if (i < 0) return { value: label, verdict: null };
  return { value: label.slice(0, i), verdict: label.slice(i + 3) };
}

// 수치 타일 — 값 한 줄 + 그 값을 어떻게 읽어야 하는지(캡션). 숫자만 던지지 않는다(UX 원칙 3).
function StatTile({ value, caution = false, children }: {
  value: string; caution?: boolean; children?: ReactNode;
}) {
  return (
    <div className={`rounded-lg border px-3 py-2 ${caution ? 'border-amber-300 bg-amber-50' : 'border-x-border'}`}>
      <p className="text-content font-bold">{value}</p>
      {children}
    </div>
  );
}

// ── 발행 히트맵 ──────────────────────────────────────────────────────────────
// 주당 몇 건(타일)은 평균이라 "몰아 쓰고 2주 쉬는" 계정과 "매일 한 건"을 구분하지 못한다.
// 히트맵은 그 분포를 그대로 보여준다 — 열=주, 행=요일.
const CELL = 11;   // px. 13~14주 × (11+2)px ≈ 180px — 패널 폭에 들어간다
const GAP = 2;     // 칸 사이 여백은 배경색이 만든다(면과 면을 붙이지 않는다)

// 시퀀셜 단일 색상(x-blue 계열, 옅음→진함)과 고정 임계값. 분위수로 나누면 같은 색이 계정마다
// 다른 뜻이 돼 두 계정을 나란히 읽을 수 없다 — 여기서 색 하나는 언제나 같은 건수다.
// 0건은 x-border(#eff3f4)와 같은 회색: 데이터가 아니라 바탕이라는 뜻. 4·5단계는 x-blue/x-blue-text.
const HEAT_STEPS = ['#eff3f4', '#cfe9fb', '#8ecdf6', '#1d9bf0', '#1573ad'];
const HEAT_LABELS = ['0건', '1건', '2건', '3~4건', '5건 이상'];
function heatStep(n: number): number {
  if (n <= 0) return 0;
  if (n <= 2) return n;
  return n <= 4 ? 3 : 4;
}

// daily는 게시가 있었던 날만 담는다. 격자는 표본 구간(sample.since~until)을 그대로 깐다 —
// 캡션이 말하는 기간과 그림의 기간이 다르면 둘 중 하나는 거짓말이 된다.
// 구간 첫날이 주 중간이면 그 앞 칸은 아예 렌더하지 않는다(0건 회색으로 채우면 '안 썼다'는 거짓말).
function PostingHeatmap({ daily, since, until, count }: {
  daily: Record<string, number>; since: string; until: string; count: number;
}) {
  const days = kstDayRange(new Date(since), new Date(until));
  if (days.length === 0) return null;

  // 날짜 문자열의 요일 — 시간대 시프트 없이 읽는다(0=일요일, 열은 일요일에 바뀐다)
  const dowOf = (d: string) => new Date(d + 'T00:00:00Z').getUTCDay();
  const firstDow = dowOf(days[0]);
  const colOf = (i: number) => Math.floor((i + firstDow) / 7);
  const cols = colOf(days.length - 1) + 1;

  // 달 라벨은 '그 달 1일이 든 열' 위에만 — 달 시작은 최소 4열 간격이라 라벨끼리 겹칠 일이 없다.
  // (모든 달 경계를 찍으면 앞쪽 반쪽 열에서 라벨 두 개가 13px 안에 겹친다.)
  const monthMarks = days.flatMap((d, i) => (
    d.slice(8) === '01' ? [{ col: colOf(i), label: `${Number(d.slice(5, 7))}월` }] : []
  ));

  return (
    <div>
      <p className="text-caption text-x-muted">발행 활동</p>
      <div className="mt-1 overflow-x-auto">
        <div
          role="img"
          aria-label={`발행 히트맵: 최근 ${count}건, 일별 게시 분포`}
          className="grid w-max"
          style={{
            gridTemplateColumns: `repeat(${cols}, ${CELL}px)`,
            gridTemplateRows: `auto repeat(7, ${CELL}px)`,
            gap: `${GAP}px`,
          }}
        >
          {monthMarks.map((m) => (
            <span
              key={m.col}
              className="whitespace-nowrap text-caption leading-none text-x-muted"
              style={{ gridColumnStart: m.col + 1, gridRowStart: 1 }}
            >{m.label}</span>
          ))}
          {/* 칸이 작아 hover 타깃이 곧 title이다 — 마우스를 올리면 날짜와 건수가 그대로 나온다 */}
          {days.map((d, i) => {
            const n = daily[d] ?? 0;
            return (
              <div
                key={d}
                title={`${dateOnlyMonthDay(asDateOnly(d))} · ${n}건`}
                className="rounded-[2px]"
                style={{
                  gridColumnStart: colOf(i) + 1,
                  gridRowStart: ((i + firstDow) % 7) + 2,   // 1행은 달 라벨
                  background: HEAT_STEPS[heatStep(n)],
                }}
              />
            );
          })}
        </div>
      </div>
      <div className="mt-1 flex items-center gap-1.5 text-caption text-x-muted">
        <span>적음</span>
        <span className="flex" style={{ gap: `${GAP}px` }}>
          {HEAT_STEPS.map((c, i) => (
            <span key={c} title={HEAT_LABELS[i]} className="rounded-[2px]"
              style={{ width: CELL, height: CELL, background: c }} />
          ))}
        </span>
        <span>많음</span>
      </div>
    </div>
  );
}

// 결과는 읽기 전용 — 사람의 판단은 태그·고정 메모에 남긴다(스펙 §3). 여기엔 수정 UI를 두지 않는다.
function AnalysisResult({ analysis, followers }: { analysis: InfluencerAnalysis; followers: number | null }) {
  const { stats, sample, topics, summary } = analysis;
  const cadence = judgeCadence(stats.perWeek, sample.count);
  const cad = splitJudgment(cadence.label);
  const eng = splitJudgment(judgeEngagement(stats.medianViews, followers));
  const types = (Object.entries(stats.typeDist) as Array<[ContentType, number]>)
    .sort((a, b) => b[1] - a[1]);

  return (
    <div className="mt-2 space-y-2">
      {/* 표본 0건이면 이 한 줄이 전부다 — 아무 글도 분류되지 않았는데 수치·유형을 적으면 라벨-값이 어긋난다.
          숫자가 없으니 타일로 세우지 않고 기존 주의 칩 그대로 둔다. 주의는 색만으로 전하지 않는다 —
          judgeCadence의 문구가 판단을 그대로 담고 있다. */}
      {sample.count === 0 ? (
        <p className={`inline-block rounded-full px-2.5 py-0.5 text-ui leading-relaxed ${
          cadence.caution ? 'bg-amber-50 text-amber-800' : 'bg-x-surface text-x-secondary'
        }`}>{cadence.label}</p>
      ) : (
        <>
          {/* 좁은 패널에서는 타일이 저절로 줄바꿈된다 — 화면 폭이 아니라 이 그리드가 가진 폭 기준 */}
          <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2">
            <StatTile value={cad.value} caution={cadence.caution}>
              {cad.verdict && (
                <p className={`mt-0.5 text-caption leading-relaxed ${
                  cadence.caution ? 'text-amber-800' : 'text-x-secondary'
                }`}>{cad.verdict}</p>
              )}
            </StatTile>
            <StatTile value={eng.value}>
              {eng.verdict && <p className="mt-0.5 text-caption leading-relaxed text-x-secondary">{eng.verdict}</p>}
              {stats.medianLikes !== null && (
                <p className="mt-0.5 text-caption text-x-secondary">좋아요 중앙값 {formatCount(stats.medianLikes)}</p>
              )}
            </StatTile>
            <StatTile value={`원글 ${stats.mix.original} · RT ${stats.mix.retweet} · 인용 ${stats.mix.quote}`}>
              <p className="mt-0.5 text-caption text-x-secondary">표본 구성(건수)</p>
            </StatTile>
          </div>
          {/* 유형은 분류된 글만 세므로 위 타일(표본 전체)과 분모가 다르다 — 같은 상자에 넣지 않는다 */}
          {types.length > 0 && (
            <p className="text-ui leading-relaxed text-x-secondary">
              유형: {types.map(([k, v]) => `${CONTENT_TYPE_LABEL[k]} ${v}`).join(' · ')}
            </p>
          )}
          {/* 원글·인용이 0건(전부 RT)이면 서버가 summary/topics를 비워 보낸다 — 조용히 비는 대신 이유를 적는다 */}
          {summary === null && (
            <p className="text-ui leading-relaxed text-x-secondary">
              리트윗만 있어 글 내용은 분석하지 못했어요 — 직접 쓴 글이 없는 계정이에요
            </p>
          )}
          {/* 이 필드가 생기기 전에 저장된 분석엔 daily가 없다 — 그럴 땐 히트맵을 통째로 감춘다.
              빈 격자·안내문을 두면 "이 계정은 안 썼다"로 읽히거나, 없는 기능을 있는 척하게 된다. */}
          {analysis.daily && (
            <PostingHeatmap daily={analysis.daily} since={sample.since} until={sample.until}
              count={sample.count} />
          )}
        </>
      )}

      {topics.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {topics.map((t) => (
            <span key={t.tag} className="rounded-full border border-x-border-strong px-2 py-0.5 text-ui">
              {t.tag} <span className="text-x-muted">{t.count}건{t.medianViews !== null &&
                ` · 조회 중앙값 ${formatCount(t.medianViews)}`}</span>
            </span>
          ))}
        </div>
      )}

      {summary && (
        <dl className="space-y-3 text-ui">
          <div><dt className="font-bold">성향·톤</dt><dd className="leading-relaxed text-x-secondary">{summary.tone}</dd></div>
          <div><dt className="font-bold">반응이 좋은 글</dt><dd className="leading-relaxed text-x-secondary">{summary.patterns}</dd></div>
          <div><dt className="font-bold">협찬 관찰</dt><dd className="leading-relaxed text-x-secondary">{summary.sponsorship}</dd></div>
        </dl>
      )}
    </div>
  );
}

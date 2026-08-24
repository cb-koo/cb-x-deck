'use client';
import { useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import { Button } from '@/components/ui';
import { formatCount } from '@/lib/format';
import { kstMonthDay } from '@/lib/datetime';
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
    <section className="mt-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-ui font-bold">계정 분석</h2>
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
          <p className="text-caption text-x-muted">
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

// 결과는 읽기 전용 — 사람의 판단은 태그·고정 메모에 남긴다(스펙 §3). 여기엔 수정 UI를 두지 않는다.
function AnalysisResult({ analysis, followers }: { analysis: InfluencerAnalysis; followers: number | null }) {
  const { stats, sample, topics, summary } = analysis;
  const cadence = judgeCadence(stats.perWeek, sample.count);
  const types = (Object.entries(stats.typeDist) as Array<[ContentType, number]>)
    .sort((a, b) => b[1] - a[1]);

  return (
    <div className="mt-2 space-y-2">
      {/* 주의는 색만으로 전하지 않는다 — judgeCadence의 문구가 판단을 그대로 담고 있다 */}
      <p className={`inline-block rounded-full px-2.5 py-0.5 text-ui ${
        cadence.caution ? 'bg-amber-50 text-amber-800' : 'bg-x-surface text-x-secondary'
      }`}>{cadence.label}</p>

      {/* 표본 0건이면 위 문구가 전부다 — 아무 글도 분류되지 않았는데 수치·유형을 적으면 라벨-값이 어긋난다 */}
      {sample.count > 0 && (
        <>
          <p className="text-ui text-x-secondary">
            {judgeEngagement(stats.medianViews, followers)}
            {stats.medianLikes !== null && <> · 좋아요 중앙값 {formatCount(stats.medianLikes)}</>}
          </p>
          <p className="text-ui text-x-secondary">
            구성: 원글 {stats.mix.original} · RT {stats.mix.retweet} · 인용 {stats.mix.quote}
            {types.length > 0 && <> · 유형: {types.map(([k, v]) => `${CONTENT_TYPE_LABEL[k]} ${v}`).join(' · ')}</>}
          </p>
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
        <dl className="space-y-1.5 text-ui">
          <div><dt className="font-bold">성향·톤</dt><dd className="text-x-secondary">{summary.tone}</dd></div>
          <div><dt className="font-bold">반응이 좋은 글</dt><dd className="text-x-secondary">{summary.patterns}</dd></div>
          <div><dt className="font-bold">협찬 관찰</dt><dd className="text-x-secondary">{summary.sponsorship}</dd></div>
        </dl>
      )}
    </div>
  );
}

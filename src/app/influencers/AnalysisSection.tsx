'use client';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { apiFetch } from '@/lib/apiFetch';
import { Button } from '@/components/ui';
import { formatKoCount } from '@/lib/formatKo';
import { kstMonthDay, kstDayRange, kstDate, asDateOnly } from '@/lib/datetime';
import { relTime } from '@/lib/relTime';
import { judgeCadence, judgeEngagement } from '@/lib/influencerJudgment';
import { CONTENT_TYPE_LABEL, type ContentType } from '@/lib/analysisStats';
import type { InfluencerAnalysis } from '@/lib/influencerStore';
import { PANEL, PANEL_TITLE } from './profileShared';

type AnalyzeResult = { analysis: InfluencerAnalysis; analyzedAt: string };

// 진행 중인 분석 레지스트리(모듈 스코프 — 컴포넌트보다 오래 산다).
//
// 계약: 서버는 이탈과 무관하게 끝까지 돌아 저장한다 — 이 레지스트리는 표시 복원용이다.
// 다른 인플루언서를 보다 돌아와도 '분석 중…'과 완료 반영이 이어지고, 진행 중 재클릭은
// 새 요청 대신 같은 프로미스에 붙는다(비용 2배 방지). 새로고침하면 표시는 잃지만
// 결과는 이미 저장돼 있다 — 다음 조회에서 그대로 보인다.
const inflight = new Map<string, Promise<AnalyzeResult>>();

// 서버가 말해 준 실패 — 네트워크 실패와 문구를 갈라 쓰려고 종류를 구분한다
class AnalyzeError extends Error {}

// X 수집 + LLM 분석 = 비용 액션 — 버튼으로만(AGENTS.md ⑥). 실패해도 기존 결과는 지우지 않는다.
function startAnalysis(id: string): Promise<AnalyzeResult> {
  const p = (async () => {
    const r = await apiFetch(`/api/influencers/${id}/analyze`, { method: 'POST' });
    const body = (await r.json().catch(() => ({}))) as {
      analysis?: InfluencerAnalysis; analyzedAt?: string; error?: string;
    };
    // 서버 문구를 그대로 쓴다 — 원인을 넘겨짚지 않는다(프로필 갱신과 같은 관례)
    if (!r.ok || !body.analysis) throw new AnalyzeError(body.error ?? `분석하지 못했어요 (오류 ${r.status})`);
    return { analysis: body.analysis, analyzedAt: body.analyzedAt ?? new Date().toISOString() };
  })();
  inflight.set(id, p);
  // catch를 먼저 물려 원본 프로미스에 핸들러를 남긴다 — 구독자가 없는 순간에 실패해도
  // unhandled rejection이 되지 않는다. 정리는 자기 프로미스일 때만(뒤 실행을 지우지 않게).
  p.catch(() => {}).finally(() => { if (inflight.get(id) === p) inflight.delete(id); });
  return p;
}

export function AnalysisSection({ id, analysis, analyzedAt, followers, onAnalyzed }: {
  id: string;
  analysis: InfluencerAnalysis | null;
  analyzedAt: string | null;
  followers: number | null;
  onAnalyzed: (analysis: InfluencerAnalysis, analyzedAt: string) => void;
}) {
  // 진행·오류 모두 id를 달고 다닌다 — 다른 계정으로 갈아타도 남의 상태를 물려받지 않는다.
  // 진행 표시는 레지스트리에서도 읽는다: 화면을 벗어났다 돌아온 첫 렌더에서 '분석 중…'이 그대로 서 있어야 한다.
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState<{ id: string; text: string } | null>(null);
  const running = busyId === id || inflight.has(id);
  const errText = err?.id === id ? err.text : '';

  // 부모가 인라인 화살표로 넘기는 콜백 — ref로 받아야 effect가 매 렌더 다시 붙지 않는다
  const onAnalyzedRef = useRef(onAnalyzed);
  useEffect(() => { onAnalyzedRef.current = onAnalyzed; });

  // live.ok = '아직 이 id로 마운트돼 있다'. unmount 후 setState와 id가 바뀐 뒤의 잘못된 반영을 함께 막는다.
  const liveRef = useRef({ ok: true });
  const attach = useCallback((p: Promise<AnalyzeResult>, forId: string, live: { ok: boolean }) => {
    p.then(
      (res) => { if (!live.ok) return; setBusyId(null); onAnalyzedRef.current(res.analysis, res.analyzedAt); },
      (e: unknown) => {
        if (!live.ok) return;
        setBusyId(null);
        setErr({ id: forId, text: e instanceof AnalyzeError ? e.message
          : '분석하지 못했어요 — 네트워크를 확인하고 다시 시도해 주세요' });
      },
    );
  }, []);

  // 마운트(또는 id 교체) 시 진행 중인 분석이 있으면 그 결과에 다시 붙는다 — 표시는 위 running이 이미 되살렸다
  useEffect(() => {
    const live = { ok: true };
    liveRef.current = live;
    const p = inflight.get(id);
    if (p) attach(p, id, live);
    return () => { live.ok = false; };
  }, [id, attach]);

  function run() {
    setErr(null);
    setBusyId(id);
    // 이미 돌고 있으면 붙기만 한다 — 새 요청을 보내지 않는다(중복 실행 = 비용 2배)
    attach(inflight.get(id) ?? startAnalysis(id), id, liveRef.current);
  }

  // 면 문법: 회색 바닥 위 흰 패널 한 장(스펙 §7). 자체 상단 간격·구분선은 두지 않는다 —
  // 패널 사이 간격은 부모의 space-y-5 하나가 단일 출처다.
  return (
    <section className={PANEL}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className={PANEL_TITLE}>계정 분석</h2>
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

      {errText && <p role="alert" className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-ui text-red-700">{errText}</p>}

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

// 블록 소제목 — 무엇을 알 수 있는 자리인지 사용자 언어로(AGENTS.md 원칙 1·2)
// h3: 시각은 그대로 두고 스크린리더 heading 탐색에 걸리게 한다(계정 분석 h2 아래 소제목 레벨)
function BlockTitle({ children }: { children: ReactNode }) {
  return <h3 className="text-ui font-bold">{children}</h3>;
}

// ── 유형 분포 ────────────────────────────────────────────────────────────────
// 묻는 것이 "전체 중 얼마"(부분-전체)라 도넛을 쓴다. 조각 다섯 개 이하이고, 값은
// 전부 범례에 글자로 적히므로 각도 비교의 약점(작은 조각끼리 순위가 안 읽힌다)이 사라진다.
//
// 색은 **범주에 고정**한다 — 순위가 아니라 정체성을 따른다(dataviz 비협상 규칙).
// 계정이 달라져 순서가 바뀌어도 '홍보·협찬'은 언제나 같은 초록이라 두 계정을 나란히 읽을 수 있다.
// '기타'만 중립 회색: 성과가 아니라 분류에 안 잡혔다는 뜻이라 색을 주면 다섯 번째 범주처럼 보인다.
const TYPE_COLOR: Record<ContentType, string> = {
  review: '#2a78d6',   // 후기·체험
  daily: '#eb6834',    // 일상·잡담
  promo: '#1baf7a',    // 홍보·협찬
  info: '#caa500',     // 정보 — 전체 쌍 검증(일상 주황과 ΔE≥15)을 위해 #eda100에서 조정
  other: '#cfd9de',    // 기타 — 중립 회색(항상)
};

const DONUT_PX = 140;   // 실제 렌더 크기(viewBox는 120 좌표계)
const DONUT_R = 42;     // 스트로크 중심 반지름 — 두께 18이면 바깥 51·안쪽 33, 120 안에 9px 여백
const DONUT_W = 18;
const DONUT_C = 2 * Math.PI * DONUT_R;
const SLICE_GAP = 2;    // 조각 사이 흰 간격(px, viewBox 좌표) — 면과 면을 붙이지 않는다

function TypeDonut({ types, classified }: {
  types: Array<[ContentType, number]>; classified: number;
}) {
  if (types.length === 0 || classified <= 0) return null;
  // 분모는 분류된 글 수 — 위 타일(표본 전체)과 분모가 다르다. 그 사실은 도넛 가운데 총건수와 '분류 기준' 캡션이 말한다.
  const otherLeads = types[0][0] === 'other';

  // 12시에서 시계 방향, 건수 내림차순(types가 이미 정렬돼 온다). 길이를 gap만큼 깎아 흰 간격을 만든다 —
  // 흰 선을 덧그리는 대신 조각 자체를 줄여야 안쪽·바깥쪽 모서리에 덧칠 자국이 남지 않는다.
  // 시작점 = 앞선 조각 길이의 합. 유형은 많아야 다섯이라 매번 앞을 훑어도 값이 싸다 —
  // 대신 렌더 중에 바깥 변수를 고쳐 쓰지 않는다(React Compiler 규칙).
  const lens = types.map(([, v]) => (v / classified) * DONUT_C);
  const slices = types.map(([k, v], i) => {
    const len = lens[i];
    const start = lens.slice(0, i).reduce((a, b) => a + b, 0);
    return {
      k, v,
      pct: Math.round((v / classified) * 100),
      start,
      // 조각이 하나뿐이면 간격을 낼 상대가 없다(고리에 이 빠진 자국만 남는다).
      // 아주 작은 조각도 1px는 남겨 범례의 색 점과 이어 보이게 한다.
      dash: types.length > 1 ? Math.max(len - SLICE_GAP, 1) : len,
    };
  });

  // 조각에 hover 툴팁을 두지 않는 대신, 스크린리더에는 이 한 줄이 값 전부를 준다(범례가 이미 눈에 보인다)
  const label = `글 유형 분포: ${slices.map((s) => `${CONTENT_TYPE_LABEL[s.k]} ${s.pct}%`).join(', ')}`;

  return (
    <div>
      <BlockTitle>어떤 유형의 글을 쓰나</BlockTitle>
      <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-4">
        <div className="relative shrink-0" style={{ width: DONUT_PX, height: DONUT_PX }}>
          <svg viewBox="0 0 120 120" width={DONUT_PX} height={DONUT_PX} role="img" aria-label={label}>
            {/* -90° 회전 = 12시 시작. circle의 진행 방향이 시계 방향이라 그대로 내림차순이 된다 */}
            <g transform="rotate(-90 60 60)">
              {slices.map((s) => (
                <circle
                  key={s.k}
                  cx="60" cy="60" r={DONUT_R}
                  fill="none"
                  stroke={TYPE_COLOR[s.k]}
                  strokeWidth={DONUT_W}
                  strokeDasharray={`${s.dash} ${DONUT_C - s.dash}`}
                  strokeDashoffset={-s.start}
                />
              ))}
            </g>
          </svg>
          {/* 가운데 값은 SVG <text> 대신 HTML — 타이포 토큰(text-content/text-caption)을 그대로 쓴다 */}
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-content font-bold tabular-nums">{classified}건</span>
            <span className="text-caption text-x-muted">분류 기준</span>
          </div>
        </div>

        {/* 범례 = 값 표시. 색만으로 읽게 두지 않는다 — 라벨과 숫자가 곧 정보고, 색은 조각과 잇는 실이다.
            순서는 조각과 같다(12시부터 시계 방향). */}
        <ul className="min-w-[130px] flex-1 space-y-1.5">
          {slices.map((s) => (
            <li key={s.k} className="flex items-center gap-2">
              <span className="size-2.5 shrink-0 rounded-full" style={{ background: TYPE_COLOR[s.k] }} />
              <span className="text-ui">{CONTENT_TYPE_LABEL[s.k]}</span>
              <span className="ml-auto whitespace-nowrap text-ui tabular-nums text-x-secondary">
                {s.v}건 · {s.pct}%
              </span>
            </li>
          ))}
        </ul>
      </div>
      {/* 회색이 무슨 뜻인지는 색이 아니라 글로 적는다 */}
      {otherLeads && (
        <p className="mt-3 text-ui leading-relaxed text-x-secondary">
          분류에 안 잡히는 글이 가장 많아요 — 잡담·짧은 반응이 많은 계정일 수 있어요
        </p>
      )}
    </div>
  );
}

// ── 주제 × 반응 ──────────────────────────────────────────────────────────────
// 칩은 "어느 주제가 잘 통하나"에 답하지 못한다(정렬도 비교 기준도 없다). 표로 세우고
// 계정 자신의 조회 중앙값을 기준선으로 둔다 — 배수는 계정 크기와 무관하게 읽힌다.
const MIN_TOPIC_N = 3;   // n≤2는 중앙값이 한두 건에 끌려다닌다 — 배수를 적지 않는다

function ratioVerdict(r: number): { text: string; cls: string } {
  if (r >= 1.5) return { text: '잘 퍼짐', cls: 'text-x-blue-text' };
  if (r <= 0.7) return { text: '낮음', cls: 'text-x-secondary' };
  return { text: '보통', cls: 'text-x-secondary' };
}

function TopicTable({ topics, accountMedianViews }: {
  topics: InfluencerAnalysis['topics']; accountMedianViews: number | null;
}) {
  // 조회 중앙값 내림차순, 값이 없는 주제는 뒤로 — '모름'이 상위에 서면 순위가 거짓말이 된다
  const rows = [...topics].sort((a, b) => (b.medianViews ?? -1) - (a.medianViews ?? -1));
  const base = accountMedianViews && accountMedianViews > 0 ? accountMedianViews : null;

  return (
    <div>
      <BlockTitle>어떤 주제가 통하나</BlockTitle>
      <div className="mt-2 overflow-x-auto">
        {/* 2열 배치라 이 표가 갖는 폭은 패널의 절반이다 — 열 넷이 들어갈 최소치까지 낮추고,
            그보다 좁아지면 표만 가로 스크롤한다(패널 전체가 밀리지 않게) */}
        {/* 숫자 열은 내용 폭(w-0 + nowrap)으로 좁혀 오른쪽에 모이고, 주제 열이 남는 폭을 다 갖는다 —
            열을 균등 분배하면 숫자 사이가 벌어져 같은 행으로 읽기 어렵다(피드백). 열 간격은 pl-5 하나로. */}
        <table className="w-full min-w-[320px] text-ui">
          <thead>
            <tr className="text-caption text-x-muted">
              <th className="py-1 text-left font-normal">주제</th>
              <th className="w-0 whitespace-nowrap py-1 pl-5 text-right font-normal">건수</th>
              <th className="w-0 whitespace-nowrap py-1 pl-5 text-right font-normal">조회 중앙값</th>
              <th className="w-0 whitespace-nowrap py-1 pl-5 text-right font-normal">계정 중앙값 대비</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => {
              const ratio = base !== null && t.medianViews !== null ? t.medianViews / base : null;
              const v = ratio !== null ? ratioVerdict(ratio) : null;
              return (
                <tr key={t.tag} className="border-t border-x-border">
                  <td className="py-2">{t.tag}</td>
                  <td className="whitespace-nowrap py-2 pl-5 text-right tabular-nums text-x-secondary">{t.count}</td>
                  <td className="whitespace-nowrap py-2 pl-5 text-right tabular-nums text-x-secondary">
                    {t.medianViews !== null ? formatKoCount(t.medianViews) : '—'}
                  </td>
                  <td className="whitespace-nowrap py-2 pl-5 text-right">
                    {t.count < MIN_TOPIC_N ? (
                      <span className="text-x-muted">표본 부족</span>
                    ) : ratio !== null && v !== null ? (
                      /* 배수(숫자)와 판단어를 함께 — 색만으로 '잘 퍼짐'을 전하지 않는다 */
                      <span className={v.cls}>
                        <span className="tabular-nums">×{ratio.toFixed(1)}</span> {v.text}
                      </span>
                    ) : (
                      <span className="text-x-muted">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── 발행 히트맵 ──────────────────────────────────────────────────────────────
// 주당 몇 건(타일)은 평균이라 "몰아 쓰고 2주 쉬는" 계정과 "매일 한 건"을 구분하지 못한다.
// 히트맵은 그 분포를 그대로 보여준다 — 열=주, 행=요일.
// 셀은 고정 20px다. 폭을 나눠 갖게(1fr) 두면 표본이 짧은 계정에서 열 두세 개가 패널 폭을
// 나눠 셀 하나가 200px로 부풀었다(실제 피드백). 크기를 고정하고 대신 창을 데이터에 맞춘다.
const CELL = 20;      // px — 계정이 달라도 셀 크기는 같다
const GAP = 3;        // 칸 사이 여백은 배경색이 만든다(면과 면을 붙이지 않는다)
const MIN_WEEKS = 4;  // 그보다 좁으면 격자로 안 보인다
const MAX_WEEKS = 14; // 3개월 창의 폭 — 그보다 길면 오래된 쪽을 잘라 최근 14주만 남긴다

// 시퀀셜 단일 색상(x-blue 계열, 옅음→진함)과 고정 임계값. 분위수로 나누면 같은 색이 계정마다
// 다른 뜻이 돼 두 계정을 나란히 읽을 수 없다 — 여기서 색 하나는 언제나 같은 건수다.
// 0건은 x-border(#eff3f4)와 같은 회색: 데이터가 아니라 바탕이라는 뜻. 4·5단계는 x-blue/x-blue-text.
const HEAT_STEPS = ['#eff3f4', '#cfe9fb', '#8ecdf6', '#1d9bf0', '#1573ad'];
function heatStep(n: number): number {
  if (n <= 0) return 0;
  if (n <= 2) return n;
  return n <= 4 ? 3 : 4;
}

const DOW = ['일', '월', '화', '수', '목', '금', '토'];
const DAY_MS = 24 * 60 * 60 * 1000;

// 달력일 문자열의 산술 — 시간대 시프트가 아니라 다음/이전 날짜 문자열을 구할 뿐이다
function addDays(d: string, n: number): string {
  const x = new Date(d + 'T00:00:00Z');
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}
// 날짜 문자열의 요일 — 시간대 시프트 없이 읽는다(0=일요일, 열은 일요일에 바뀐다)
const dowOf = (d: string) => new Date(d + 'T00:00:00Z').getUTCDay();
const dayDiff = (a: string, b: string) =>
  Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / DAY_MS);

// 셀 하나가 말하는 것: 언제 · 몇 건. daily 키는 이미 KST date-only라 시간대 시프트 없이 읽는다.
function cellLabel(key: string, n: number): string {
  const d = asDateOnly(key);
  const dow = DOW[new Date(d + 'T00:00:00Z').getUTCDay()];
  return `${Number(d.slice(5, 7))}월 ${Number(d.slice(8, 10))}일 (${dow}) · ${n > 0 ? `게시 ${n}건` : '게시 없음'}`;
}

// daily는 게시가 있었던 날만 담는다. 창은 **표본 시작 주(일요일)~until** — 100건 상한에 걸린
// 다작 계정에 3개월 격자를 깔면 대부분이 빈칸이라 "안 썼다"처럼 보인다. 대신 최소 4주(격자 꼴 유지)·
// 최대 14주(3개월 폭)로 잘라 데이터가 있는 구간을 크게 보여 준다. 잘라서 창이 표본 시작보다
// 앞서는 경우엔 since 전 날짜를 그리지 않는다 — 0건 회색으로 채우면 '안 썼다'는 거짓말이 되고,
// 빈칸은 "여기부터 100건이 찼다"를 그대로 보여준다.
function PostingHeatmap({ daily, since, until, months, count }: {
  daily: Record<string, number>; since: string; until: string; months: number; count: number;
}) {
  // 셀 90개를 Tooltip으로 감싸면 포털이 90개 뜬다 — 대신 격자 하나가 툴팁 하나를 공유한다.
  // (배치·포털 방식은 components/Tooltip.tsx와 같다. 왜 브라우저 기본 title이 아닌지도 거기 적혀 있다:
  //  뜨기까지 1초 가까이 걸리고, 조건에 따라 아예 안 뜬다 — 이 저장소가 이미 겪은 문제다.)
  const [tip, setTip] = useState<{ text: string; top: number; left: number; below: boolean } | null>(null);
  const showTip = (el: HTMLElement, text: string) => {
    const r = el.getBoundingClientRect();
    // 앵커가 hidden 패널 안으로 들어가면 rect가 전부 0이다 — 좌상단으로 튀는 대신 닫는다.
    if (r.width === 0 && r.height === 0) { setTip(null); return; }
    const below = r.top - 8 < 40;   // 화면 위로 넘치면 아래로 뒤집는다
    setTip({
      text,
      top: below ? r.bottom + 8 : r.top - 8,
      left: Math.max(8, Math.min(r.left + r.width / 2, window.innerWidth - 8)),
      below,
    });
  };
  // 스크롤·리사이즈로 앵커가 움직이면 좌표가 거짓이 된다 — 따라다니는 대신 닫는다(마우스는 이미 떠났다)
  useEffect(() => {
    if (!tip) return;
    const close = () => setTip(null);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', close);     // 키보드로 탭을 바꾸면 마우스 툴팁은 남을 이유가 없다
    window.addEventListener('popstate', close);    // 뒤로가기/?tab 링크로 패널이 바뀌어도 같다
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', close);
      window.removeEventListener('popstate', close);
    };
  }, [tip]);

  const untilDay = kstDate(until);
  const sinceDay = kstDate(since);   // 이 날 이전 칸은 표본 밖 — 그리지 않는다
  if (!untilDay || !sinceDay) return null;

  // 표본 시작이 든 주의 일요일에서 시작해, 주 수를 4~14주로 가둔다
  let start = addDays(sinceDay, -dowOf(sinceDay));
  let weeks = Math.floor(dayDiff(start, untilDay) / 7) + 1;
  if (weeks < MIN_WEEKS) { start = addDays(start, -(MIN_WEEKS - weeks) * 7); weeks = MIN_WEEKS; }
  else if (weeks > MAX_WEEKS) { start = addDays(start, (weeks - MAX_WEEKS) * 7); weeks = MAX_WEEKS; }

  const days = kstDayRange(new Date(start + 'T00:00:00Z'), new Date(untilDay + 'T00:00:00Z'));
  if (days.length === 0) return null;

  const firstDow = dowOf(days[0]);
  const colOf = (i: number) => Math.floor((i + firstDow) / 7);
  const cols = colOf(days.length - 1) + 1;

  // 달 라벨은 '그 달 1일이 든 열' 위에만 — 달 시작은 최소 4열 간격이라 라벨끼리 겹칠 일이 없다.
  // (모든 달 경계를 찍으면 앞쪽 반쪽 열에서 라벨 두 개가 13px 안에 겹친다.)
  const monthMarks = days.flatMap((d, i) => (
    d.slice(8) === '01' ? [{ col: colOf(i), label: `${Number(d.slice(5, 7))}월` }] : []
  ));

  // 표본이 분석 창(months개월)보다 짧으면 그 사실을 제목 줄에 적는다 — 격자가 짧은 이유가
  // '활동이 없어서'가 아니라 '100건 상한에 먼저 걸려서'라는 걸 여기서만 말할 수 있다.
  // 기간은 실제 표본 폭(since~until)을 그대로 적는다 — 격자 열 수(weeks, 4주 클램프)는
  // 격자 폭 계산에만 쓰고 문구에는 섞지 않는다(클램프된 열 수와 표본 폭이 어긋날 수 있다).
  const winStart = new Date(until);
  winStart.setMonth(winStart.getMonth() - months);
  const shortSample = sinceDay > kstDate(winStart.toISOString());
  const heading = shortSample
    ? `${kstMonthDay(since)}~${kstMonthDay(until)}에 ${count}건이 찼어요`
    : '발행 활동';

  return (
    <div>
      <BlockTitle>{heading}</BlockTitle>
      <div className="mt-2 overflow-x-auto">
        <div
          role="img"
          /* 셀은 탭 대상이 아니다 — 90개 탭스톱은 지나치다. 스크린리더에는 이 요약 한 줄로 준다. */
          aria-label={`발행 히트맵: 최근 ${count}건, 일별 게시 분포`}
          className="grid w-max"
          style={{
            gridTemplateColumns: `auto repeat(${cols}, ${CELL}px)`,   // 1열은 요일 라벨
            gridTemplateRows: `auto repeat(7, ${CELL}px)`,
            gap: `${GAP}px`,
          }}
          onMouseLeave={() => setTip(null)}
        >
          {/* 세로축이 요일이라는 건 라벨 없이는 스스로 설명되지 않는다("이게 왜 7칸이지?"라는
              질문을 실제로 받았다). GitHub처럼 격줄(월·수·금)만 적는다 — 7개를 다 적으면
              라벨이 격자만큼 시끄러워진다. */}
          {([['월', 3], ['수', 5], ['금', 7]] as const).map(([label, row]) => (
            <span key={label}
              className="self-center pr-1 text-caption leading-none text-x-muted"
              style={{ gridColumnStart: 1, gridRowStart: row }}
              onMouseEnter={() => setTip(null)}
            >{label}</span>
          ))}
          {monthMarks.map((m) => (
            <span
              key={m.col}
              className="whitespace-nowrap text-caption leading-none text-x-muted"
              style={{ gridColumnStart: m.col + 2, gridRowStart: 1 }}
              /* 라벨 줄로 올라가면 방금 보던 셀의 툴팁은 이미 거짓말이다 — 격자를 벗어나기 전에 걷는다 */
              onMouseEnter={() => setTip(null)}
            >{m.label}</span>
          ))}
          {days.map((d, i) => {
            if (d < sinceDay) return null;   // 표본 시작 전: 데이터 없음 ≠ 0건 — 빈칸으로 둔다
            const n = daily[d] ?? 0;
            return (
              <div
                key={d}
                className="rounded-[3px]"
                style={{
                  gridColumnStart: colOf(i) + 2,              // 1열은 요일 라벨
                  gridRowStart: ((i + firstDow) % 7) + 2,     // 1행은 달 라벨
                  background: HEAT_STEPS[heatStep(n)],
                }}
                onMouseEnter={(e) => showTip(e.currentTarget, cellLabel(d, n))}
              />
            );
          })}
        </div>
      </div>
      <div className="mt-2 text-caption text-x-muted">
        <div className="flex items-center gap-1.5">
          <span>적음</span>
          <span className="flex" style={{ gap: `${GAP}px` }}>
            {HEAT_STEPS.map((c) => (
              <span key={c} className="rounded-[3px]"
                style={{ width: CELL, height: CELL, background: c }} />
            ))}
          </span>
          <span>많음</span>
        </div>
        {/* 색이 몇 건인지는 hover가 아니라 글로 적는다 — 범례에 title을 달면 아무도 못 본다 */}
        <p className="mt-1">회색은 게시 없음 · 진해질수록 1건 · 2건 · 3~4건 · 5건 이상</p>
      </div>
      {tip && createPortal(
        <div role="tooltip" style={{ top: tip.top, left: tip.left }}
             className={`pointer-events-none fixed z-[60] -translate-x-1/2 whitespace-nowrap rounded-md bg-x-text px-2 py-1 text-[12px] leading-none text-white shadow-lg ${tip.below ? '' : '-translate-y-full'}`}>
          {tip.text}
        </div>,
        document.body,
      )}
    </div>
  );
}

// 결과는 읽기 전용 — 사람의 판단은 태그·고정 메모에 남긴다(스펙 §3). 여기엔 수정 UI를 두지 않는다.
//
// 순서는 결론 → 근거(스펙 §1): 헤드라인 한두 문장이 먼저 서고, 그 아래로 수치·분포·주제·발행·서술이
// 근거로 따라온다. 예전 순서(숫자부터)는 "내용이 눈에 안 들어온다"는 피드백을 받았다.
function AnalysisResult({ analysis, followers }: { analysis: InfluencerAnalysis; followers: number | null }) {
  const { stats, sample, topics, summary } = analysis;
  const cadence = judgeCadence(stats.perWeek, sample.count);
  const cad = splitJudgment(cadence.label);
  const eng = splitJudgment(judgeEngagement(stats.medianViews, followers));
  const types = (Object.entries(stats.typeDist) as Array<[ContentType, number]>)
    .sort((a, b) => b[1] - a[1]);

  return (
    <div className="mt-4 space-y-5">
      {/* 결론 — 구버전 분석엔 headline이 없다(그럴 땐 이 자리를 통째로 생략한다) */}
      {summary?.headline && (
        <p className="text-content font-medium leading-relaxed">{summary.headline}</p>
      )}

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
                <p className="mt-0.5 text-caption text-x-secondary">좋아요 중앙값 {formatKoCount(stats.medianLikes)}</p>
              )}
            </StatTile>
            <StatTile value={`원글 ${stats.mix.original} · RT ${stats.mix.retweet} · 인용 ${stats.mix.quote}`}>
              <p className="mt-0.5 text-caption text-x-secondary">표본 구성(건수)</p>
            </StatTile>
          </div>

          {/* '무엇을 쓰나'(유형)와 '무엇이 통하나'(주제)는 같은 질문의 두 면이라 나란히 세운다.
              접힘 기준은 화면 폭이 아니라 이 블록이 실제로 가진 폭(@container) — 사이드바·패널 폭이
              달라져도 표가 눌리지 않는다. 접히는 지점은 @2xl(672px) — 그 폭에서 한 열이 (672-24)/2 = 324px라
              표의 최소 폭(320px)이 딱 들어간다. 더 이른 @xl(576px)에서 나누면 나누자마자 표가 스크롤한다. */}
          <div className="@container">
            {/* 나란히 놓이면 두 열의 경계가 보여야 한다(피드백: "유형·주제 구분이 잘 안 된다") — 간격 대신
                세로 구분선 + 좌우 패딩으로 나눈다. 접힌(1열) 상태에서는 구분선 없이 세로 간격만. */}
            <div className="grid grid-cols-1 gap-6 @2xl:grid-cols-2 @2xl:gap-0 @2xl:divide-x @2xl:divide-x-border @2xl:[&>*+*]:pl-6 @2xl:[&>*:first-child]:pr-6">
              {/* 유형은 분류된 글만 세므로 위 타일(표본 전체)과 분모가 다르다 — 도넛 가운데가 그 분모를 적는다 */}
              <TypeDonut types={types} classified={sample.classified} />
              {topics.length > 0 && (
                <TopicTable topics={topics} accountMedianViews={stats.medianViews} />
              )}
            </div>
          </div>

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
              months={sample.months} count={sample.count} />
          )}
        </>
      )}

      {/* 서술 제목은 질문형 — 읽는 사람이 던지는 질문을 그대로 적어 답을 찾아가게 한다(AGENTS.md 원칙 1) */}
      {summary && (
        <dl className="space-y-3 text-ui">
          <div><dt className="font-bold">어떤 계정인가</dt><dd className="leading-relaxed text-x-secondary">{summary.tone}</dd></div>
          <div><dt className="font-bold">어떤 글이 통하나</dt><dd className="leading-relaxed text-x-secondary">{summary.patterns}</dd></div>
          <div><dt className="font-bold">협찬은 어떻게 하나</dt><dd className="leading-relaxed text-x-secondary">{summary.sponsorship}</dd></div>
        </dl>
      )}
    </div>
  );
}

'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui';
import { formatKoCount } from '@/lib/formatKo';
import { kstMonthDay, kstDayRange, kstDate, asDateOnly } from '@/lib/datetime';
import { relTime } from '@/lib/relTime';
import { judgeDirectCadence, judgeEngagement, judgeRt } from '@/lib/influencerJudgment';
import { CONTENT_TYPE_LABEL, type ContentType, type Activity } from '@/lib/analysisStats';
import type { InfluencerAnalysis } from '@/lib/influencerStore';
import { PANEL, PANEL_TITLE } from './profileShared';
import { start as startRun, useRunState, getError } from './analysisRun';

export function AnalysisSection({ id, analysis, analyzedAt, followers, onAnalyzed }: {
  id: string;
  analysis: InfluencerAnalysis | null;
  analyzedAt: string | null;
  followers: number | null;
  onAnalyzed: (analysis: InfluencerAnalysis, analyzedAt: string) => void;
}) {
  // 진행·오류의 단일 출처는 모듈 스코프 스토어(analysisRun) — 명부의 일괄 실행이 시작한 분석도
  // 이미 열려 있는 이 화면에 그대로 반영된다. 화면을 벗어났다 돌아와도 '분석 중…'이 서 있고,
  // 상태는 id를 달고 다니므로 다른 계정으로 갈아타도 남의 진행을 물려받지 않는다.
  const running = useRunState(id) === 'running';
  const errText = getError(id) ?? '';

  // 부모가 인라인 화살표로 넘기는 콜백 — ref로 받아야 effect가 매 렌더 다시 붙지 않는다
  const onAnalyzedRef = useRef(onAnalyzed);
  useEffect(() => { onAnalyzedRef.current = onAnalyzed; });

  // 진행 중이면(내가 눌렀든, 일괄 실행이 시작했든, 마운트 전에 시작됐든) 그 프로미스에 붙어 완료를 반영한다.
  // start는 진행 중이면 같은 프로미스를 돌려주므로 새 요청이 나가지 않는다(비용 2배 방지).
  // live는 unmount·id 교체 뒤의 잘못된 반영을 막는다. 실패 문구는 스토어(getError)가 갖는다 —
  // 여기서 다시 붙잡으면 unhandled rejection만 남는다.
  useEffect(() => {
    if (!running) return;
    let live = true;
    startRun(id).then(
      (res) => { if (live) onAnalyzedRef.current(res.analysis, res.analyzedAt); },
      () => {},
    );
    return () => { live = false; };
  }, [id, running]);

  // X 수집 + LLM 분석 = 비용 액션 — 버튼으로만(AGENTS.md ⑥). 실패해도 기존 결과는 지우지 않는다.
  // 결과를 여기서 받지 않는 이유: start가 상태를 'running'으로 올리면 위 effect가 같은 프로미스에 붙는다.
  function run() { void startRun(id).catch(() => {}); }

  // 캡션은 두 표본(활동 4주 / 직접 쓴 글)을 따로 적는다 — 한 숫자로 뭉치면 라벨과 값이 어긋난다(UX 원칙 4).
  const v2 = analysis?.activity;
  const caption: string[] = [];
  if (analysis && v2) {
    const s = analysis.sample;
    caption.push(s.directComplete && s.directSince
      ? `직접 쓴 글 ${s.direct ?? 0}건(${kstMonthDay(s.directSince)}~${kstMonthDay(s.until)})`
      // 60건을 못 채웠다 = 6개월 안에 있는 글이 그게 전부다. 기간을 적으면 "이 기간만 봤다"로 읽힌다.
      : `직접 쓴 글 ${s.direct ?? 0}건(6개월 안 전부)`);
    // 상한에 걸렸을 때만 적는다 — 계정 트윗이 소진돼 끝난 건 상한이 아니다(스펙 §0)
    caption.push(v2.truncated ? `활동 최근 4주(수집 상한으로 최근 ${v2.coveredDays}일치)` : '활동 최근 4주');
  }
  if (analysis && analyzedAt) caption.push(relTime(analyzedAt, '분석'));

  // 면 문법: 회색 바닥 위 흰 패널 한 장(스펙 §7). 자체 상단 간격·구분선은 두지 않는다 —
  // 패널 사이 간격은 부모의 space-y-5 하나가 단일 출처다.
  return (
    <section className={PANEL}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className={PANEL_TITLE}>계정 분석</h2>
        {analysis && (
          <>
            <span className="text-caption text-x-muted">{caption.join(' · ')}</span>
            <Button variant="subtle" className="ml-auto shrink-0" onClick={run} disabled={running}>
              {running ? '분석 중… (1~2분)' : '다시 분석'}
            </Button>
          </>
        )}
      </div>

      {!analysis && (
        <div className="mt-1">
          <p className="text-caption leading-relaxed text-x-muted">
            최근 4주 활동과 직접 쓴 글 최근 60건을 X에서 받아와 주제·반응 수준을 분석해요 — 1~2분 걸려요.
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
  // 분모는 분류된 직접 글 수 — 위 타일(활동 4주)과 표본이 다르다. 그 사실은 도넛 가운데 총건수와 '분류 기준' 캡션이 말한다.
  const otherLeads = types[0][0] === 'other';

  // 12시에서 시계 방향, 건수 내림차순(types가 이미 정렬돼 온다). 길이를 gap만큼 깎아 흰 간격을 만든다 —
  // 흰 선을 덧그리는 대신 조각 자체를 줄여야 안쪽·바깥쪽 모서리에 덧칠 자국이 남지 않는다.
  // 시작점 = 앞선 조각 길이의 합. 유형은 많아야 다섯이라 매번 앞을 훑어도 값이 싸다 —
  // 대신 렌더 중에 바깥 변수를 고쳐 쓰지 않는다(React Compiler 규칙).
  const lens = types.map(([, v]) => (v / classified) * DONUT_C);
  const slices = types.map(([k, v], i) => {
    const len = lens[i];
    const startAt = lens.slice(0, i).reduce((a, b) => a + b, 0);
    return {
      k, v,
      pct: Math.round((v / classified) * 100),
      start: startAt,
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

// ── 퍼나르는 주제 ────────────────────────────────────────────────────────────
// RT가 무엇을 퍼나르는지는 확산 채널로서의 정체성이다(스펙 §0). 조회수는 원작자 것이라 건수만 적는다 —
// 그래서 표(정렬·비교)가 아니라 칩이다. 무엇을 세었는지는 아래 캡션이 말한다(라벨-값 일치).
function RtTopicChips({ items, rtSince, until, rtClassified }: {
  items: { tag: string; count: number }[]; rtSince: string | null; until: string; rtClassified: number;
}) {
  const days = rtSince ? Math.max(1, Math.round((Date.parse(until) - Date.parse(rtSince)) / DAY_MS)) : null;
  return (
    <div>
      <BlockTitle>퍼나르는 주제</BlockTitle>
      <ul className="mt-2 flex flex-wrap gap-1.5">
        {items.map((t) => (
          <li key={t.tag} className="rounded-full bg-x-surface px-2.5 py-0.5 text-ui text-x-secondary">
            {t.tag} <span className="tabular-nums">{t.count}건</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-caption text-x-muted">
        {days !== null ? `최근 ${days}일 RT ${rtClassified}건 기준` : `RT ${rtClassified}건 기준`}
      </p>
    </div>
  );
}

// ── 발행 히트맵 ──────────────────────────────────────────────────────────────
// 하루 몇 건(타일)은 평균이라 "몰아 쓰고 2주 쉬는" 계정과 "매일 한 건"을 구분하지 못한다.
// 히트맵은 그 분포를 그대로 보여준다 — 열=주, 행=요일.
// 셀은 고정 20px다. 폭을 나눠 갖게(1fr) 두면 열 두세 개가 패널 폭을 나눠 셀 하나가 200px로
// 부풀었다(실제 피드백). 창은 활동 창(28일) 그대로 — 달력 주로 잘려 최대 5열(양끝 부분 열)이다.
const CELL = 20;      // px — 계정이 달라도 셀 크기는 같다
const GAP = 3;        // 칸 사이 여백은 배경색이 만든다(면과 면을 붙이지 않는다)

// 시퀀셜 단일 색상(x-blue 계열, 옅음→진함)과 고정 임계값. 분위수로 나누면 같은 색이 계정마다
// 다른 뜻이 돼 두 계정을 나란히 읽을 수 없다 — 여기서 색 하나는 언제나 같은 건수다.
// 0건은 x-border(#eff3f4)와 같은 회색: 데이터가 아니라 바탕이라는 뜻. 4·5단계는 x-blue/x-blue-text.
const HEAT_STEPS = ['#eff3f4', '#cfe9fb', '#8ecdf6', '#1d9bf0', '#1573ad'];

// 임계는 줄마다 다르다 — 직접 글 [1,2,3,5]와 RT [1,5,10,20]은 자릿수가 다른 축이라
// 같은 눈금을 쓰면 RT 줄이 전부 최고 단계로 물든다(스펙 §5).
type HeatThresholds = readonly [number, number, number, number];
const DIRECT_THRESHOLDS: HeatThresholds = [1, 2, 3, 5];
const RT_THRESHOLDS: HeatThresholds = [1, 5, 10, 20];

function heatStep(n: number, th: HeatThresholds): number {
  let s = 0;
  for (const t of th) if (n >= t) s += 1;
  return s;
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

// 셀 하나가 말하는 것: 언제 · 몇 건. daily 키는 이미 KST date-only라 시간대 시프트 없이 읽는다.
// noun은 줄마다 다르다 — RT 줄에서 '게시 3건'이라 적으면 라벨과 값이 어긋난다(UX 원칙 4).
function cellLabel(key: string, n: number, noun: string): string {
  const d = asDateOnly(key);
  const dow = DOW[new Date(d + 'T00:00:00Z').getUTCDay()];
  return `${Number(d.slice(5, 7))}월 ${Number(d.slice(8, 10))}일 (${dow}) · ${n > 0 ? `${noun} ${n}건` : `${noun} 없음`}`;
}

// daily는 게시가 있었던 날만 담는다. 창은 호출자가 준 since~until 그대로 — 활동 창이 28일 고정이라
// 계정이 달라도 격자 폭이 같고, 두 계정(그리고 위·아래 두 줄)을 나란히 읽을 수 있다.
// since 이전 칸(첫 열의 앞부분)은 그리지 않는다 — 0건 회색으로 채우면 '안 썼다'는 거짓말이 된다.
function PostingHeatmap({ daily, since, until, thresholds, legend, title, ariaLabel, noun }: {
  daily: Record<string, number>; since: string; until: string;
  thresholds: HeatThresholds; legend: string; title: string; ariaLabel: string; noun: string;
}) {
  // 셀 수십 개를 Tooltip으로 감싸면 포털이 그만큼 뜬다 — 대신 격자 하나가 툴팁 하나를 공유한다.
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
  const sinceDay = kstDate(since);   // 이 날 이전 칸은 창 밖 — 그리지 않는다
  if (!untilDay || !sinceDay) return null;

  // 창 시작이 든 주의 일요일에서 시작한다(열 = 달력 주). 28일 창이면 열은 4개 또는 5개.
  const gridStart = addDays(sinceDay, -dowOf(sinceDay));
  const days = kstDayRange(new Date(gridStart + 'T00:00:00Z'), new Date(untilDay + 'T00:00:00Z'));
  if (days.length === 0) return null;

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
      <BlockTitle>{title}</BlockTitle>
      <div className="mt-2 overflow-x-auto">
        <div
          role="img"
          /* 셀은 탭 대상이 아니다 — 수십 개 탭스톱은 지나치다. 스크린리더에는 이 요약 한 줄로 준다. */
          aria-label={ariaLabel}
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
            if (d < sinceDay) return null;   // 창 시작 전: 데이터 없음 ≠ 0건 — 빈칸으로 둔다
            const n = daily[d] ?? 0;
            return (
              <div
                key={d}
                className="rounded-[3px]"
                style={{
                  gridColumnStart: colOf(i) + 2,              // 1열은 요일 라벨
                  gridRowStart: ((i + firstDow) % 7) + 2,     // 1행은 달 라벨
                  background: HEAT_STEPS[heatStep(n, thresholds)],
                }}
                onMouseEnter={(e) => showTip(e.currentTarget, cellLabel(d, n, noun))}
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
        <p className="mt-1">{legend}</p>
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
// 순서는 결론 → 근거(스펙 §1): 헤드라인 한두 문장이 먼저 서고, 그 아래로 수치·발행·유형·주제·서술이
// 근거로 따라온다. 예전 순서(숫자부터)는 "내용이 눈에 안 들어온다"는 피드백을 받았다.
function AnalysisResult({ analysis, followers }: { analysis: InfluencerAnalysis; followers: number | null }) {
  const { summary } = analysis;
  // activity의 유무가 곧 분석 버전이다(스펙 §3). 구버전은 지표의 기준(3개월·표본 100건)이 달라
  // 새 지표와 나란히 읽으면 안 된다 — 값을 다시 계산하는 대신 다시 분석하라고 말한다.
  const activity = analysis.activity;

  return (
    <div className="mt-4 space-y-5">
      {/* 결론 — 구버전 분석엔 headline이 없다(그럴 땐 이 자리를 통째로 생략한다) */}
      {summary?.headline && (
        <p className="text-content font-medium leading-relaxed">{summary.headline}</p>
      )}

      {activity
        ? <ActivityResult analysis={analysis} activity={activity} followers={followers} />
        : (
          <p className="text-ui leading-relaxed text-x-secondary">
            이전 방식으로 분석된 결과예요 — 다시 분석하면 4주 활동·직접 글 기준 지표로 바뀌어요
          </p>
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

const sumCounts = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);

// v2 본문 — 활동(4주 창)과 내용(직접 글 표본)은 표본이 다르다. 어느 숫자가 어느 표본인지는
// 각 블록의 제목·캡션이 말한다(라벨-값 일치).
function ActivityResult({ analysis, activity, followers }: {
  analysis: InfluencerAnalysis; activity: Activity; followers: number | null;
}) {
  const { stats, sample, topics, summary } = analysis;

  // 창 안 수집 수 = 직접 + RT. 0이면 '4주 내내 아무것도 없었다'는 뜻이라 판단이 갈린다(judgeDirectCadence).
  const collectedInWindow = sumCounts(activity.dailyDirect) + sumCounts(activity.dailyRt);
  const cadence = judgeDirectCadence(activity.directPerDay, collectedInWindow);
  const cad = splitJudgment(cadence.label);
  const rt = judgeRt(activity.rtPerDay, activity.rtShare);
  const eng = splitJudgment(judgeEngagement(stats.medianViews, followers));
  const types = (Object.entries(stats.typeDist) as Array<[ContentType, number]>)
    .sort((a, b) => b[1] - a[1]);
  const direct = sample.direct ?? 0;
  const rtTopics = (analysis.rtTopics ?? []).slice(0, 5);
  const win = `${kstMonthDay(activity.since)}~${kstMonthDay(activity.until)}`;

  return (
    <>
      {/* 좁은 패널에서는 타일이 저절로 줄바꿈된다 — 화면 폭이 아니라 이 그리드가 가진 폭 기준 */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2">
        <StatTile value={cad.value} caution={cadence.caution}>
          {cad.verdict && (
            <p className={`mt-0.5 text-caption leading-relaxed ${
              cadence.caution ? 'text-amber-800' : 'text-x-secondary'
            }`}>{cad.verdict}</p>
          )}
          <p className="mt-0.5 text-caption text-x-secondary">직접 쓴 글 · 최근 4주</p>
        </StatTile>
        <StatTile value={rt.value}>
          {/* RT는 많고 적음이 좋고 나쁨이 아니다 — 판단문도 서술로만 적는다(주의 색 없음) */}
          <p className="mt-0.5 text-caption leading-relaxed text-x-secondary">{rt.verdict}</p>
        </StatTile>
        <StatTile value={eng.value}>
          {eng.verdict && <p className="mt-0.5 text-caption leading-relaxed text-x-secondary">{eng.verdict}</p>}
          {stats.medianLikes !== null && (
            <p className="mt-0.5 text-caption text-x-secondary">좋아요 중앙값 {formatKoCount(stats.medianLikes)}</p>
          )}
        </StatTile>
      </div>

      {/* 두 줄로 나누는 이유: RT로만 도는 확산형 계정을 한 줄(직접 글)로만 그리면 '활동 없음'으로 보인다.
          같은 창·같은 셀 크기라 위아래를 그대로 겹쳐 읽을 수 있다 — 임계만 축에 맞게 다르다. */}
      <div className="space-y-4">
        <PostingHeatmap
          daily={activity.dailyDirect} since={activity.since} until={activity.until}
          thresholds={DIRECT_THRESHOLDS} noun="게시"
          title="직접 쓴 글 (최근 4주)"
          ariaLabel={`직접 쓴 글 히트맵: 최근 4주(${win}) 일별 게시 건수`}
          legend="회색은 게시 없음 · 진해질수록 1건 · 2건 · 3~4건 · 5건 이상"
        />
        <PostingHeatmap
          daily={activity.dailyRt} since={activity.since} until={activity.until}
          thresholds={RT_THRESHOLDS} noun="RT"
          title="RT (최근 4주)"
          ariaLabel={`RT 히트맵: 최근 4주(${win}) 일별 RT 건수`}
          legend="회색은 RT 없음 · 진해질수록 1~4건 · 5~9건 · 10~19건 · 20건 이상"
        />
      </div>

      {/* '무엇을 쓰나'(유형)와 '무엇이 통하나'(주제)는 같은 질문의 두 면이라 나란히 세운다.
          접힘 기준은 화면 폭이 아니라 이 블록이 실제로 가진 폭(@container) — 사이드바·패널 폭이
          달라져도 표가 눌리지 않는다. 접히는 지점은 @2xl(672px) — 그 폭에서 한 열이 (672-24)/2 = 324px라
          표의 최소 폭(320px)이 딱 들어간다. 더 이른 @xl(576px)에서 나누면 나누자마자 표가 스크롤한다. */}
      {direct > 0 && (
        <div className="@container">
          {/* 나란히 놓이면 두 열의 경계가 보여야 한다(피드백: "유형·주제 구분이 잘 안 된다") — 간격 대신
              세로 구분선 + 좌우 패딩으로 나눈다. 접힌(1열) 상태에서는 구분선 없이 세로 간격만. */}
          <div className="grid grid-cols-1 gap-6 @2xl:grid-cols-2 @2xl:gap-0 @2xl:divide-x @2xl:divide-x-border @2xl:[&>*+*]:pl-6 @2xl:[&>*:first-child]:pr-6">
            {/* 유형·주제는 분류된 직접 글만 센다 — 위 타일(4주 활동)과 표본이 다르다는 건 도넛 가운데가 적는다 */}
            <TypeDonut types={types} classified={sample.directClassified ?? 0} />
            {topics.length > 0 && (
              <TopicTable topics={topics} accountMedianViews={stats.medianViews} />
            )}
          </div>
        </div>
      )}

      {/* 직접 쓴 글이 0건이면 유형·주제 표는 셀 것이 없다 — 조용히 비는 대신 무엇으로 봤는지 적는다 */}
      {direct === 0 && rtTopics.length > 0 && (
        <p className="text-ui leading-relaxed text-x-secondary">
          직접 쓴 글이 없어 퍼나르는 주제로만 봤어요
        </p>
      )}

      {rtTopics.length > 0 && (
        <RtTopicChips items={rtTopics} rtSince={sample.rtSince ?? null}
          until={sample.until} rtClassified={sample.rtClassified ?? 0} />
      )}

      {/* 직접 글도 RT도 없으면 서버가 summary를 비워 보낸다 — 조용히 비는 대신 이유를 적는다 */}
      {summary === null && (
        <p className="text-ui leading-relaxed text-x-secondary">
          최근 6개월 직접 쓴 글도, 최근 4주 RT도 없어 글 내용은 분석하지 못했어요
        </p>
      )}
    </>
  );
}

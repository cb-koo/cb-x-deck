'use client';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui';
import { runQueue } from '@/lib/runQueue';
import { start } from './analysisRun';
import type { InfluencerRow } from '@/lib/influencerStore';

// 일괄 분석 진행 상태는 **모듈 스코프**다(스펙 §6). 다이얼로그 state에 두면 창을 닫는 순간
// 진행 표시가 사라지고 다시 열면 "안 돌고 있는 것처럼" 보인다 — 실제로는 계속 돌고 있는데도.
// analysisRun과 같은 구독형 패턴이라 명부 헤더 배지도 같은 출처를 본다(두 곳이 다른 숫자를 말하지 않는다).
export type BulkTarget = { id: string; handle: string };
export type BulkState = {
  running: boolean;
  total: number;
  done: number;              // 끝난 계정 수(성공+실패) — 진행 문구 '12/24 완료'의 앞 숫자
  failed: BulkTarget[];      // 재시도는 이 목록만 다시 돌린다
};

const IDLE: BulkState = { running: false, total: 0, done: 0, failed: [] };
let bulkState: BulkState = IDLE;
const bulkSubs = new Set<() => void>();

function setBulk(next: BulkState) {
  bulkState = next;
  bulkSubs.forEach((cb) => cb());
}

export function getBulkState(): BulkState { return bulkState; }
export function subscribeBulk(cb: () => void): () => void {
  bulkSubs.add(cb);
  return () => { bulkSubs.delete(cb); };
}
// getServerSnapshot은 항상 같은 객체여야 한다 — 새 객체를 만들면 무한 렌더가 된다
export function useBulkState(): BulkState {
  return useSyncExternalStore(subscribeBulk, getBulkState, () => IDLE);
}
// 끝난 결과를 치운다(진행 중엔 무시) — 다음에 열 때 지난 회차 결과가 남아 있지 않도록
function resetBulk() { if (!bulkState.running) setBulk(IDLE); }

// 동시 3건. 서버는 이탈과 무관하게 각 계정을 끝까지 저장하므로, 여기서 하는 일은 '언제 다음 걸 시작할지'뿐이다.
async function runBulk(targets: BulkTarget[], onFinished: () => void | Promise<void>) {
  if (bulkState.running || targets.length === 0) return;
  setBulk({ running: true, total: targets.length, done: 0, failed: [] });
  await runQueue(
    targets,
    (t) => start(t.id).then(() => undefined),
    3,
    (t, ok) => setBulk({
      ...bulkState,
      done: bulkState.done + 1,
      failed: ok ? bulkState.failed : [...bulkState.failed, t],
    }),
  );
  setBulk({ ...bulkState, running: false });
  await onFinished();   // 명부 새로고침 — 다이얼로그가 닫혀 있어도 불린다(부모는 계속 떠 있다)
}

// 대상 기본값: 아직 분석 안 했거나, 이전 방식으로 분석된 계정(스펙 §6·§7).
export function bulkTargets(rows: InfluencerRow[], includeRecent: boolean): BulkTarget[] {
  const pick = includeRecent ? rows : rows.filter((r) => !r.analyzedAt || !r.analysisV2);
  return pick.map((r) => ({ id: r.id, handle: r.handle }));
}

export function BulkAnalyzeDialog({ rows, onClose, onFinished }: {
  rows: InfluencerRow[];
  onClose: () => void;
  onFinished: () => Promise<void>;   // 명부 다시 읽기 — 분석 시점 캡션이 바뀐다
}) {
  const [includeRecent, setIncludeRecent] = useState(false);
  const bulk = useBulkState();

  // 닫을 때 끝난 회차 결과를 치운다 — 진행 중이면 resetBulk가 무시하므로 계속 돌고, 다시 열면 이어 보인다
  const close = useCallback(() => { resetBulk(); onClose(); }, [onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.isComposing) close(); }; // IME 조합 중 Esc 무시
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [close]);

  const targets = bulkTargets(rows, includeRecent);
  const n = targets.length;
  const notYet = rows.filter((r) => !r.analyzedAt).length;
  const oldWay = rows.filter((r) => r.analyzedAt && !r.analysisV2).length;
  // 비용·시간은 첫 실행 전이라 추정치다 — 문구에서 추정임을 밝힌다(라벨-값 일치)
  const cost = (0.1 * n).toFixed(1);
  const minutes = Math.ceil((n / 3) * 2.5);

  // 한 번이라도 돌린 회차가 있으면 진행/결과 화면 — 창을 닫았다 열어도 이어 보인다
  const showProgress = bulk.total > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-6" onClick={close}>
      <div className="w-full max-w-[520px] rounded-2xl bg-white p-4" role="dialog" aria-modal="true"
           aria-label="전체 분석" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center">
          <h2 className="text-[15px] font-bold">전체 분석</h2>
          <button onClick={close} aria-label="닫기" className="ml-auto rounded px-1.5 text-x-secondary hover:bg-x-border">✕</button>
        </div>

        {!showProgress ? (
          <>
            <p className="mt-3 text-ui">
              아직 분석하지 않았거나 이전 방식으로 분석된 계정을 한 번에 분석해요.
            </p>
            <p className="mt-1 text-caption text-x-muted">
              지금 명부 {rows.length}계정 중 미분석 {notYet} · 이전 방식 {oldWay}
            </p>

            <label className="mt-3 flex items-center gap-2 text-ui">
              <input type="checkbox" checked={includeRecent} onChange={(e) => setIncludeRecent(e.target.checked)} />
              최근 분석도 포함
            </label>
            <p className="mt-0.5 pl-6 text-caption text-x-muted">
              켜면 최근에 분석한 계정까지 전부 다시 분석해요 — 그만큼 비용과 시간이 늘어요.
            </p>

            <p className="mt-3 rounded-lg bg-x-surface px-3 py-2 text-ui text-x-secondary">
              대상 {n}계정 · 예상 비용 약 ${cost}(수집+AI, 첫 실행 뒤 실측으로 보정) · 예상 시간 약 {minutes}분
            </p>
            <p className="mt-2 text-caption text-x-muted">
              이 탭을 열어둔 동안 진행돼요. 중간에 닫아도 끝난 계정은 저장돼 있고, 다시 실행하면 남은 계정만 이어서 해요.
            </p>

            <div className="mt-4 flex items-center gap-3">
              {/* 비용이 드는 액션이라 사용자가 대상·비용·시간을 본 뒤에만 시작한다(opt-in) */}
              <Button variant="primary" autoFocus disabled={n === 0} onClick={() => { runBulk(targets, onFinished); }}>
                시작
              </Button>
              <button onClick={close} className="text-ui text-x-secondary">취소</button>
              {n === 0 && (
                <span className="text-caption text-x-muted">
                  분석할 계정이 없어요 — 다시 분석하려면 &lsquo;최근 분석도 포함&rsquo;을 켜세요
                </span>
              )}
            </div>
          </>
        ) : (
          <>
            <p className="mt-3 text-ui" aria-live="polite">
              {bulk.done}/{bulk.total} 완료{bulk.failed.length > 0 && ` · 실패 ${bulk.failed.length}`}
              {!bulk.running && <span className="ml-1.5 text-x-secondary">— 다 끝났어요</span>}
            </p>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-x-border" aria-hidden>
              <div className="h-full bg-x-blue transition-all"
                   style={{ width: `${Math.round((bulk.done / Math.max(1, bulk.total)) * 100)}%` }} />
            </div>
            <p className="mt-2 text-caption text-x-muted">
              이 탭을 열어둔 동안 진행돼요. 중간에 닫아도 끝난 계정은 저장돼 있고, 다시 실행하면 남은 계정만 이어서 해요.
            </p>

            {bulk.failed.length > 0 && (
              <>
                <p className="mt-3 text-caption text-x-secondary">분석하지 못한 계정</p>
                <ul className="mt-1 max-h-[30vh] space-y-1 overflow-y-auto">
                  {bulk.failed.map((t) => (
                    <li key={t.id} className="rounded-lg border border-x-border px-3 py-1.5 text-ui">@{t.handle}</li>
                  ))}
                </ul>
              </>
            )}

            <div className="mt-4 flex items-center gap-3">
              {!bulk.running && bulk.failed.length > 0 && (
                <Button variant="primary" onClick={() => { runBulk(bulk.failed, onFinished); }}>
                  재시도 ({bulk.failed.length}계정)
                </Button>
              )}
              <Button variant={!bulk.running && bulk.failed.length > 0 ? 'subtle' : 'primary'} onClick={close}>
                {bulk.running ? '닫아두고 계속하기' : '닫기'}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

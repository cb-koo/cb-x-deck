'use client';
import { useRef, type ReactNode } from 'react';
import { TAB_KEYS, TAB_LABEL, type TabKey } from '@/lib/profileTabs';

// 구역 전환용 밑줄 탭 — X 프로필(게시물/답글/미디어)과 같은 문법. 필터용 알약(DraftFilterBar)과 섞지 않는다.
// 패널은 전부 마운트하고 hidden으로만 숨긴다 — 입력 중 텍스트·저장 실패 문구·분석 진행이 보존된다(스펙 §3).
// 방향키는 포커스만 옮기고 Enter/Space로 활성화(수동) — 활성화가 곧 URL 내비게이션이라 키마다 일어나면 안 된다.
export function ProfileTabs({ active, onChange, badges, errorTabs, panels }: {
  active: TabKey; onChange: (t: TabKey) => void;
  badges: Partial<Record<TabKey, number>>;
  errorTabs: ReadonlySet<TabKey>;
  panels: Record<TabKey, ReactNode>;
}) {
  const refs = useRef<Partial<Record<TabKey, HTMLButtonElement | null>>>({});
  function onKeyDown(e: React.KeyboardEvent, i: number) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const next = TAB_KEYS[(i + (e.key === 'ArrowRight' ? 1 : TAB_KEYS.length - 1)) % TAB_KEYS.length];
    refs.current[next]?.focus();
  }
  return (
    <>
      <div role="tablist" aria-label="프로필 구역" className="mt-5 flex flex-wrap border-b border-x-border">
        {TAB_KEYS.map((k, i) => {
          const on = k === active;
          const badge = badges[k];
          return (
            <button key={k} role="tab" id={`ptab-${k}`} aria-selected={on} aria-controls={`ppanel-${k}`}
                    tabIndex={on ? 0 : -1} ref={(el) => { refs.current[k] = el; }}
                    onClick={() => onChange(k)} onKeyDown={(e) => onKeyDown(e, i)}
                    className={`relative -mb-px flex items-center gap-1.5 px-3 py-2 text-ui ${
                      on ? 'border-b-2 border-x-blue font-bold text-x-text' : 'border-b-2 border-transparent text-x-secondary hover:text-x-text'
                    }`}>
              {TAB_LABEL[k]}
              {badge !== undefined && badge > 0 && (
                <span className="rounded-full bg-x-surface px-1.5 text-caption tabular-nums text-x-secondary">{badge}</span>
              )}
              {/* 저장 실패가 숨은 탭 안에 있다 — 색(빨간 점)과 말(sr-only)로 함께 알린다 */}
              {errorTabs.has(k) && (
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-red-500" aria-hidden />
              )}
              {errorTabs.has(k) && <span className="sr-only">저장되지 않은 항목 있음</span>}
            </button>
          );
        })}
      </div>
      {TAB_KEYS.map((k) => (
        <div key={k} role="tabpanel" id={`ppanel-${k}`} aria-labelledby={`ptab-${k}`} hidden={k !== active}>
          {panels[k]}
        </div>
      ))}
    </>
  );
}

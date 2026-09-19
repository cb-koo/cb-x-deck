'use client';
import type { ReactNode } from 'react';

export type DraftTab = 'generate' | 'write' | 'pick';
const TAB_LABEL: Record<DraftTab, string> = { generate: 'AI로 만들기', write: '직접 쓰기', pick: '있는 원고 고르기' };

// 원고 모드(§5) — 패널이 원고 일을 하는 상태. 원고가 붙어 있으면 손보는 곳(카드)이고,
// 없으면 만드는 곳(생성·직접 쓰기·고르기)이다. 세 갈래의 알맹이는 부모(TaskPanel)가 넣는다(이 파일은 골격만) —
// Task 3·4·5가 generate·write·pick 자리를 채운다.
//
// attached는 draft 로드 여부가 아니라 task.draftId 유무로 판정한다(부모가 판단해 넘긴다) — 붙어 있는데
// 아직 GET 응답이 안 왔을 때 draft로 판정하면 탭 껍데기가 잠깐 보였다가 카드로 바뀌는 깜빡임이 생긴다.
// card 쪽이 자기 로딩·에러 표시를 직접 들고 있다(기존 오버레이의 '불러오는 중…' 관례와 같다).
export function DraftMode({ attached, tab, onTab, busy, pickCount, card, generate, write, pick }: {
  attached: boolean;
  tab: DraftTab; onTab: (t: DraftTab) => void;
  // 시안을 만드는 동안(DraftGenerate) 또는 직접 쓰기가 올리는·저장하는 동안(DraftWrite) 탭을 못 바꾸게
  // 한다(리뷰 지적 2) — 탭을 바꾸면 그 컴포넌트가 언마운트돼 요청이 화면에서 끊겨 보인다. label은 켜는
  // 쪽이 준다(리뷰 지적 3) — boolean 하나로 세 자리(DraftMode·TaskPanel 헤더·푸터)가 전부 '만드는 중이에요'로
  // 고정돼 있던 게 Task 4부터는 거짓이 됐다(업로드·저장 중에도 켜지는데 아무것도 '만들고' 있지 않다).
  // busy와 label을 한 값으로 묶어 둔다 — 둘을 따로 두면 busy=true인데 label을 빼먹는 드리프트가 난다.
  busy: { label: string } | null;
  pickCount: number | null;   // 후보 수(형제 시안 + 작업 없는 원고 합) — 아직 못 읽었으면 null(0이라고 거짓말하지 않는다)
  card: ReactNode; generate: ReactNode; write: ReactNode; pick: ReactNode;
}) {
  if (attached) return <>{card}</>;
  return (
    <div>
      <div className="-mx-6 mb-4 flex items-center gap-1 border-b border-x-border px-6">
        {(['generate', 'write', 'pick'] as DraftTab[]).map((t) => (
          <button key={t} type="button" onClick={() => onTab(t)} disabled={!!busy} aria-current={tab === t ? 'page' : undefined}
                  className={`px-3 py-2 text-ui disabled:cursor-not-allowed disabled:opacity-50 ${tab === t ? 'border-b-2 border-x-blue text-x-text' : 'text-x-secondary hover:text-x-text'}`}>
            {TAB_LABEL[t]}{t === 'pick' && pickCount !== null ? <span className="ml-1 text-x-muted">{pickCount}</span> : null}
          </button>
        ))}
        {/* title만으로 끝내지 않는다(UX 원칙 2·5, 거짓 어포던스 금지) — 탭이 막힌 보이는 이유를 한 줄로 둔다 */}
        {busy && <span className="ml-auto shrink-0 text-caption text-x-muted">{busy.label}</span>}
      </div>
      {tab === 'generate' ? generate : tab === 'write' ? write : pick}
    </div>
  );
}

'use client';
import { useEffect } from 'react';
import type { LibraryEntry } from '@/lib/candidateStore';
import type { TweetTranslation } from '@/lib/types';
import { CandidateCard } from './CandidateCard';

// 표 행 클릭으로 여는 카드 팝업 — 카드 보기와 완전히 같은 표면(코멘트·빼기·번역·초안)을 그대로 얹는다.
// 표 전용 상세 UI를 따로 만들지 않는다 (DraftCard 단일 표면 원칙과 동일).
export function LibraryCardModal({ entry, meId, wsId, onChanged, onRemoveTeam, translation, showTranslation, onTranslate, translating, onClose }: {
  entry: LibraryEntry;
  meId: string | null;
  wsId: string;
  onChanged: () => void;
  onRemoveTeam: (tweetId: string) => void;
  translation?: TweetTranslation | null;
  showTranslation?: boolean;
  onTranslate?: (tweetId: string) => void;
  translating?: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.isComposing) return;   // IME 조합 중 Esc 무시 — 다른 모달들과 동일 규칙
      // 입력 중 Esc는 입력의 몫(코멘트 초안 유실 방지) — 모달은 배경 클릭이나 빈 곳 Esc로 닫는다
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-6" onClick={onClose}>
      {/* CandidateCard 자체가 테두리·라운드를 가진다 — 셸은 폭·배경만 준다 */}
      <div role="dialog" aria-modal="true" className="w-full max-w-[560px] rounded-xl bg-white"
           onClick={(e) => e.stopPropagation()}>
        {/* dense=false: 팝업은 정독 표면(spec) — 본문 클램프·인용 접기·코멘트 접기 없이 전체를 보여준다 */}
        <CandidateCard entry={entry} dense={false} meId={meId} wsId={wsId} onChanged={onChanged}
                       onRemoveTeam={onRemoveTeam}
                       translation={translation} showTranslation={showTranslation}
                       onTranslate={onTranslate} translating={translating} />
      </div>
    </div>
  );
}

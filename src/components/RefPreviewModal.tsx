'use client';
import { useEffect, useState } from 'react';
import { RefTweetCard } from '@/components/RefTweetCard';
import { useTranslations } from '@/components/useTranslations';
import { Tooltip } from '@/components/Tooltip';
import { GlobeIcon } from '@/components/XIcons';
import { tweetPermalink } from '@/lib/tweetLink';
import type { ReferenceRow } from '@/lib/referenceStore';

// 레퍼런스 미리보기 — 패널 칩 클릭으로 연다. 데이터가 부모 refRows에 이미 있어 조회 없이 즉시 뜬다(스펙 §B).
// z-50: AddByLinkModal과 같은 층. 시트(z-40)와는 동시에 열릴 수 없다 — 시트가 열리면 패널이 오버레이에 덮인다.
export function RefPreviewModal({ row, onClose, onRemove }: {
  row: ReferenceRow | null; onClose: () => void; onRemove: (tweetId: string) => void;
}) {
  // 번역 — 덱/시트와 같은 훅·같은 전역 캐시(tweet_translation). 어디서 번역했든 무과금 재사용(스펙 §B).
  const { translations, translatingIds, translateErr, loadCached, translateOne } = useTranslations();
  const [showTranslation, setShowTranslation] = useState(false);
  // 훅의 translateErr는 성공 때만 지워져 세션 내내 남는다 — 어느 트윗의 오류인지 함께 기록해
  // 다른 트윗 미리보기에 이전 오류가 보이는 일을 막는다(리뷰 Important, UX 원칙 4).
  const [errFor, setErrFor] = useState<string | null>(null);
  const tweetId = row?.tweetId ?? null;
  useEffect(() => {
    if (!tweetId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 대상이 바뀔 때마다 표시·오류 귀속 초기화(모달 재사용, AddByLinkModal 관례)
    setShowTranslation(false); setErrFor(null);
    void loadCached([tweetId]); // 기번역분 조용히 로드(과금 없음)
  }, [tweetId, loadCached]);

  useEffect(() => {
    if (!row) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.isComposing) onClose(); }; // IME 조합 중 Esc 무시
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [row, onClose]);

  if (!row) return null;
  const translation = translations[row.tweetId]?.content;
  const translating = translatingIds.has(row.tweetId);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-6" onClick={onClose}>
      {/* max-w-640: '참고할 레퍼런스' 시트와 같은 폭 — 같은 카드를 다른 폭으로 보여주면 다른 화면처럼 읽힌다(koo 확정) */}
      <div className="max-h-full w-full max-w-[640px] overflow-y-auto rounded-2xl bg-white" role="dialog" aria-modal="true"
           aria-label="참고할 레퍼런스" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 flex items-center border-b border-x-border bg-white px-4 py-3">
          <h2 className="text-[15px] font-bold">참고할 레퍼런스</h2>
          <button onClick={onClose} aria-label="닫기" autoFocus className="ml-auto rounded px-1.5 text-x-secondary hover:bg-x-border">✕</button>
        </div>
        <div className="relative flex gap-3 px-4 pb-3.5 pt-3">
          <RefTweetCard row={row} translation={showTranslation ? translation : undefined} />
        </div>
        {translateErr && errFor === row.tweetId && (
          <p className="border-t border-x-border bg-red-50 px-4 py-1.5 text-caption text-red-700">{translateErr}</p>
        )}
        {/* 확인 후의 다음 행동을 그 자리에 — 빼기(이건 아니네) / 번역(뜻 모르겠네) / 원문(맥락 더 볼래) (스펙 의도) */}
        <div className="flex items-center gap-3 border-t border-x-border px-4 py-3">
          <button onClick={() => { onRemove(row.tweetId); onClose(); }}
                  className="text-ui text-x-secondary hover:text-red-500 hover:underline">
            이 레퍼런스 빼기
          </button>
          {/* 콘텐츠 카드(DraftCard)의 번역 버튼과 같은 모습 — 지구본 아이콘·같은 툴팁 문구·켜짐은 파란색(koo 확정) */}
          <Tooltip text={translating ? '번역 중…' : translation && showTranslation ? '원문만 보기' : '한국어로 번역'}>
            <button onClick={() => {
                      if (translation) { setShowTranslation((v) => !v); return; }
                      setShowTranslation(true); // 도착하는 대로 바로 보이게 먼저 켠다(시트 관례)
                      setErrFor(row.tweetId); // 실패 시 오류가 이 트윗의 것임을 표시
                      void translateOne(row.tweetId);
                    }}
                    disabled={translating}
                    aria-label={translation && showTranslation ? '원문만 보기' : '한국어로 번역'}
                    aria-pressed={!!translation && showTranslation}
                    className={`flex items-center rounded-full p-2 hover:bg-x-blue/10 hover:text-x-blue-text disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-current ${translation && showTranslation ? 'text-x-blue-text' : 'text-x-secondary'}`}>
              <GlobeIcon className="h-[19px] w-[19px]" />
            </button>
          </Tooltip>
          <a href={tweetPermalink(row.authorHandle, row.tweetId)} target="_blank" rel="noopener noreferrer"
             className="ml-auto text-ui text-x-blue-text hover:underline">
            X에서 원문 보기 ↗
          </a>
        </div>
      </div>
    </div>
  );
}

'use client';
import { useState } from 'react';
import { DRAFT_STATUSES, STATUS_LABEL, type DraftStatus } from '@/lib/draftStatus';
import type { InfluencerOption } from '@/lib/draftTypes';
import { InfluencerChip } from '@/components/InfluencerChip';
import type { RosterGate } from '@/lib/rosterPick';

// 표 뷰에서 여러 건을 고르면 뜨는 바. 결과 패널 스크롤 컨테이너 하단에 sticky로 붙는다 —
// 50행을 내려가 고른 뒤 액션을 찾아 다시 올라오는 일이 없도록.
// 표시 전용이다: 판단(형제 시안 경고)과 저장(낙관적 갱신·롤백)은 전부 페이지가 한다.
// 칩 규격(13px·높이 32px·테두리)은 DraftStatusChip·InfluencerChip과 같다 — 같은 성격의
// "내가 정하는 것"이 화면마다 다른 덩치로 보이지 않게.
export function BulkActionBar({ count, options, linksText, onStatus, onInfluencer, onDelete, onClear, roster }: {
  count: number;
  options: InfluencerOption[];
  // 고른 원고들의 "제목 + 링크" 묶음. 문구를 만드는 규칙은 draftShare가 쥐고, 여기는 복사만 한다.
  linksText: string;
  onStatus: (s: DraftStatus) => void;
  onInfluencer: (handle: string | null) => void;
  onDelete: () => void;
  onClear: () => void;
  roster?: RosterGate;   // 명부 게이팅(설계 §9 ⑤) — 주는 화면에서만 켜진다
}) {
  // 클립보드와 피드백을 이 컴포넌트가 함께 쥔다 — 페이지로 나누면 '복사됨' 표시가 눌린 버튼과
  // 떨어진 곳에서 관리돼 어긋나기 쉽다. 카드의 링크 복사 버튼과 같은 방식(잠깐 체크 표시)이다.
  const [copied, setCopied] = useState(false);
  const [copyErr, setCopyErr] = useState('');
  async function copyLinks() {
    setCopyErr('');
    try {
      await navigator.clipboard.writeText(linksText);
      setCopied(true); setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopyErr('링크를 복사하지 못했어요 — 브라우저 권한을 확인해주세요');
    }
  }
  return (
    <div className="sticky bottom-0 z-10 -mx-4 mt-2 flex flex-wrap items-center gap-2 border-t border-x-border bg-white px-4 py-2.5 shadow-[0_-2px_8px_rgba(0,0,0,0.06)]">
      <span className="text-ui font-bold">{count}개 선택됨</span>

      <label className="relative inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-x-border-strong bg-white px-2.5 text-ui font-bold text-x-secondary focus-within:ring-2 focus-within:ring-x-blue">
        상태 변경 <span aria-hidden className="opacity-60">⌄</span>
        <select value="" onChange={(e) => { if (e.target.value) onStatus(e.target.value as DraftStatus); }}
                aria-label="선택한 원고의 상태 변경" className="absolute inset-0 w-full cursor-pointer opacity-0">
          <option value="">상태 고르기</option>
          {DRAFT_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
      </label>

      {/* 처음엔 '이미 배정된 적 있는 후보'만 고르는 셀렉트였다. 오타 하나가 여러 건에 박히는 걸
          막으려던 것인데, 실제로는 배정된 적 있는 핸들이 0개라 고를 게 아무것도 없는 죽은 버튼이
          됐다(사용자 피드백 2026-08-13 — "어떤 기능인지 모르겠음"). 후보를 만드는 유일한 길이
          '카드에서 한 건 배정'인데 화면 어디에도 그 말이 없었다.
          그래서 카드에서 쓰는 칩을 그대로 쓴다 — 핸들 검증·프로필 링크 붙여넣기·후보 제안이
          이미 들어 있고, 규칙이 두 벌로 갈라지지 않는다. 오타 방지는 실행 직전 확인창이 맡는다. */}
      <InfluencerChip handle={null} options={options} onChange={onInfluencer} label="인플루언서 배정" roster={roster} />

      {/* 링크 복사 — 상태·배정과 달리 원고를 바꾸지 않고 밖으로 가져가는 액션이라 삭제 앞에 둔다.
          "제목 + 링크"로 복사되므로 받는 사람이 열어보기 전에도 뭐가 뭔지 안다. */}
      <button onClick={() => void copyLinks()}
              title={`고른 원고 ${count}개의 제목과 링크를 복사합니다 — 팀원에게 그대로 붙여넣으면 돼요`}
              className="h-8 rounded-lg border border-x-border-strong bg-white px-2.5 text-ui font-bold text-x-secondary hover:bg-x-hover">
        {copied ? '복사됨 ✓' : '링크 복사'}
      </button>

      <button onClick={onDelete}
              className="h-8 rounded-lg border border-red-200 px-2.5 text-ui font-bold text-red-600 hover:bg-red-50">
        삭제
      </button>

      <button onClick={onClear} className="ml-auto text-ui text-x-secondary hover:underline">선택 해제</button>
      {copyErr && <p role="alert" className="w-full text-caption text-red-600">{copyErr}</p>}
    </div>
  );
}

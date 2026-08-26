// 업데이트 소식 데이터 — 이 파일이 글 그 자체다. 규칙은 AGENTS.md "업데이트 소식 작성 규칙" 참조.
// 최신 항목을 맨 위에 추가한다(정렬은 src/lib/updates.ts가 다시 하므로 순서가 어긋나도 화면은 맞다).
export type UpdateType = '새 기능' | '개선' | '수정' | '내부';

export type UpdateEntry = {
  date: string;                 // 'YYYY-MM-DD' — 배포일(KST). 작성 시점의 배포 예정일
  type: UpdateType;
  title: string;                // 사용자 말 한 줄 — "~할 수 있어요", "~를 고쳤어요"
  summary: string;              // 1~3문장
  bullets?: string[];           // 세부 항목
  link?: { label: string; href: string };  // 관련 화면. 워크스페이스 안 화면은 href에 '{ws}' 토큰
};

export const UPDATES: UpdateEntry[] = [];

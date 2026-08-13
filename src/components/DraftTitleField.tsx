'use client';
import { useEffect, useRef, useState } from 'react';

// 원고 이름 — 카드 위에서 바로 고친다.
//
// 편집 모달 안에만 두었더니 표·칸반에서 팝업을 열었을 때 제목을 넣을 곳이 없었다(사용자 피드백).
// 카드는 세 보기 방식이 공유하는 콘텐츠 표면이라, 여기 올리면 카드 목록·표 팝업·칸반 팝업에
// 한 번에 반영된다. 상태 칩과 인플루언서 칩이 같은 이유로 편집창에서 카드로 승격된 선례를 따른다.
//
// 저장 시점이 Enter와 포커스 아웃 둘 다인 이유: 이 칸은 모달이 아니라 카드 위에 떠 있어서,
// 사용자가 저장 버튼을 찾지 않고 그냥 다른 곳을 누른다. 그때 조용히 버리면 쓴 글이 사라진다.
export function DraftTitleField({ title, fallback, onChange }: {
  title: string | null;      // 사람이 붙인 제목 — null·'' = 아직 없음
  fallback: string;          // 지금 목록에 실제로 나오는 라벨(자동 제목 또는 첫 줄) — placeholder로 쓴다
  onChange: (next: string | null) => void;  // '' 대신 null을 넘긴다(= 제목 지움)
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(title ?? '');
  const inputRef = useRef<HTMLInputElement | null>(null);
  // 저장이 Enter와 blur 양쪽에서 일어나므로, Enter로 저장한 뒤 따라오는 blur가 같은 값을 한 번 더
  // 보내지 않도록 표시해 둔다(같은 값 PATCH 두 번 = 서버 왕복 낭비).
  const savedRef = useRef(false);

  // 다시쓰기·번역 등으로 draft가 갱신되면 바깥 값이 바뀐다 — 편집 중이 아닐 때만 따라간다.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 외부 값 동기화, 편집 중이 아닐 때만
    if (!editing) setValue(title ?? '');
  }, [title, editing]);

  function commit() {
    if (savedRef.current) { savedRef.current = false; setEditing(false); return; }
    const next = value.trim();
    setEditing(false);
    if (next === (title ?? '')) return; // 바뀐 게 없으면 서버를 부르지 않는다
    onChange(next || null);
  }

  if (!editing) {
    const shown = title?.trim();
    return (
      <button type="button"
              onClick={() => { setValue(title ?? ''); setEditing(true); }}
              aria-label={shown ? `원고 이름 "${shown}" — 눌러서 고치기` : '원고에 이름 붙이기'}
              title={shown ? '목록·보드에 나오는 이름 — 눌러서 고치기' : '목록·보드에서 이 원고를 부를 이름을 붙입니다'}
              className={`block max-w-full truncate rounded px-1 py-0.5 text-left text-ui hover:bg-x-hover ${
                shown ? 'font-bold text-x-text' : 'text-x-muted'}`}>
        {shown ?? '+ 이름 붙이기'}
      </button>
    );
  }

  return (
    <input ref={inputRef} value={value} maxLength={80} autoFocus
           onChange={(e) => setValue(e.target.value)}
           onBlur={commit}
           onKeyDown={(e) => {
             // IME 조합 중 Enter는 글자 확정이다 — 저장으로 새면 조합하던 글자가 사라진 것처럼 느껴진다.
             if (e.key === 'Enter' && !e.nativeEvent.isComposing) { savedRef.current = false; commit(); }
             if (e.key === 'Escape' && !e.nativeEvent.isComposing) {
               // 카드가 peek 오버레이 안에 있으면 그쪽도 Esc를 듣는다 — 취소가 상세까지 닫지 않게 끊는다.
               e.stopPropagation();
               savedRef.current = true;   // 뒤따르는 blur가 되돌린 값을 저장하지 않도록
               setValue(title ?? '');
               setEditing(false);
             }
           }}
           aria-label="원고 이름"
           placeholder={fallback}
           className="w-full rounded border border-x-blue px-1 py-0.5 text-ui font-bold outline-none placeholder:font-normal placeholder:text-x-muted" />
  );
}

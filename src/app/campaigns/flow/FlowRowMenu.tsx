'use client';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { replaceDisabledReason, type FlowRow } from '@/lib/campaignFlowView';

// 행·패널 공용 ··· 메뉴(Task 10, b-task-10-brief.md §3-2) — TaskTable.tsx의 RowMenu(포털·좌표 클램프·바깥
// 클릭·Esc·스크롤 닫기)와 같은 골격, 항목만 이 화면 것으로 바꿨다. 표의 마지막 칸(renderMenu)과 패널 헤더가
// 같은 컴포넌트를 쓴다 — 둘 다 "이 작업에 지금 할 수 있는 것"이 같아야 하고, 따로 두면 한쪽만 항목이 갈린다.
//
// 서버가 이미 막는 조작에는 버튼을 아예 안 둔다(거짓 어포던스 금지): 게시된 작업엔 취소·교체·게시물 연결이
// 없고, 취소된 작업엔 되돌리기·삭제만 있다. 인플루언서 교체는 자리는 두되(게시 전·취소 아닐 때) 인플이
// 없거나 방문이 지났으면 비활성 + 보이는 이유 문구(title만으로 끝내지 않는다, UX 원칙 2·5)로 막는다.
const MENU_W = 200;
const ITEM_H = 32;
const DIVIDER_H = 9;
const DISABLED_ITEM_H = 46;   // 라벨 + 이유 문구 두 줄

function MenuButton({ onClick, danger, disabled, reason, children }: {
  onClick?: () => void; danger?: boolean; disabled?: boolean; reason?: string; children: ReactNode;
}) {
  if (disabled) {
    return (
      <div role="menuitem" aria-disabled="true" title={reason} className="rounded px-2.5 py-1.5 text-left text-ui text-x-muted">
        <div>{children}</div>
        {reason && <div className="mt-0.5 text-[11px] leading-tight text-x-muted">{reason}</div>}
      </div>
    );
  }
  return (
    <button type="button" role="menuitem" onClick={onClick}
            className={`block w-full rounded px-2.5 py-1.5 text-left text-ui ${danger ? 'text-red-700 hover:bg-red-50' : 'hover:bg-x-hover'}`}>
      {children}
    </button>
  );
}

export interface FlowRowMenuActions {
  posted: (t: FlowRow) => void;         // 게시 확인 다이얼로그 열기
  schedule: (t: FlowRow) => void;       // 예정일 바꾸기 — 오른쪽 패널 열기(§3-2)
  openDraft: (t: FlowRow) => void;      // 붙은 원고 카드 열기
  attachDraft: (t: FlowRow) => void;    // 있는 원고 고르기 모달 열기
  generateHref: (t: FlowRow) => string; // 새로 만들기(Link) — /generate로
  linkPost: (t: FlowRow) => void;       // 게시물 연결(트래킹) 모달 열기
  replace: (t: FlowRow) => void;        // 인플루언서 교체 다이얼로그 열기
  cancel: (t: FlowRow) => void;         // 작업 취소 다이얼로그 열기
  restore: (t: FlowRow) => void;        // 되돌리기 — 확인 없이 즉시(결정 1)
  remove: (t: FlowRow) => void;         // 삭제 — window.confirm은 호출부가 쥔다(기존 문구 재사용)
}

export function FlowRowMenu({ task, today, on }: {
  task: FlowRow;
  today: string;   // 인플루언서 교체 비활성 판정(방문 지남)에 필요 — replaceDisabledReason
  on: FlowRowMenuActions;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const cancelled = task.cancelledAt !== null;
  const prePost = !cancelled && task.postedAt === null;
  const replaceReason = replaceDisabledReason(task, today);

  // 항목 구성 — 순서는 브리프 그대로. 상태마다 항목 수·비활성 문구 유무가 달라 고정 근사치 대신 실제 구성에서
  // 높이를 쌓아 flip(위/아래 뒤집기) 판단에 쓴다.
  type Row = { node: ReactNode; h: number } | { divider: true };
  const rows: Row[] = [];
  const push = (node: ReactNode, h = ITEM_H) => rows.push({ node, h });

  if (prePost) {
    push(<MenuButton key="posted" onClick={() => { setOpen(false); on.posted(task); }}>게시 확인</MenuButton>);
    push(<MenuButton key="schedule" onClick={() => { setOpen(false); on.schedule(task); }}>예정일 바꾸기</MenuButton>);
  }
  if (task.draftId) {
    push(<MenuButton key="openDraft" onClick={() => { setOpen(false); on.openDraft(task); }}>원고 열기</MenuButton>);
  } else if (task.type !== 'rt' && !cancelled) {
    push(<MenuButton key="attachDraft" onClick={() => { setOpen(false); on.attachDraft(task); }}>원고 붙이기</MenuButton>);
    push(
      <Link key="generate" href={on.generateHref(task)} role="menuitem" onClick={() => setOpen(false)}
            className="block rounded px-2.5 py-1.5 text-ui hover:bg-x-hover">새로 만들기</Link>,
    );
  }
  if (prePost && task.type !== 'rt') {
    push(<MenuButton key="linkPost" onClick={() => { setOpen(false); on.linkPost(task); }}>게시물 연결(트래킹)</MenuButton>);
  }

  const tail: Row[] = [];
  if (prePost) {
    tail.push({
      node: (
        <MenuButton key="replace" disabled={!!replaceReason} reason={replaceReason ?? undefined}
                    onClick={() => { setOpen(false); on.replace(task); }}>인플루언서 교체</MenuButton>
      ),
      h: replaceReason ? DISABLED_ITEM_H : ITEM_H,
    });
    tail.push({ node: <MenuButton key="cancel" danger onClick={() => { setOpen(false); on.cancel(task); }}>작업 취소</MenuButton>, h: ITEM_H });
  } else if (cancelled) {
    tail.push({ node: <MenuButton key="restore" onClick={() => { setOpen(false); on.restore(task); }}>되돌리기</MenuButton>, h: ITEM_H });
  }
  if (tail.length) {
    if (rows.length) rows.push({ divider: true });
    rows.push(...tail);
  }
  if (rows.length) rows.push({ divider: true });
  rows.push({ node: <MenuButton key="remove" danger onClick={() => { setOpen(false); on.remove(task); }}>삭제</MenuButton>, h: ITEM_H });

  const menuH = rows.reduce((sum, r) => sum + ('divider' in r ? DIVIDER_H : r.h), 8);

  const place = useCallback(() => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const left = Math.min(Math.max(8, r.right - MENU_W), Math.max(8, window.innerWidth - MENU_W - 8));
    const below = r.bottom + 4;
    const flip = below + menuH > window.innerHeight && r.top - menuH - 4 > 0;
    setPos({ top: flip ? r.top - menuH - 4 : below, left });
  }, [menuH]);
  const close = useCallback(() => { if (menuRef.current?.contains(document.activeElement)) btnRef.current?.focus(); setOpen(false); }, []);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { const t = e.target as Node | null; if (!t || menuRef.current?.contains(t) || btnRef.current?.contains(t)) return; close(); };
    const onKey = (e: KeyboardEvent) => { if (e.key !== 'Escape' || e.isComposing) return; e.stopPropagation(); close(); };
    const onMove = () => place();
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [open, close, place]);

  return (
    <>
      <button ref={btnRef} type="button" onClick={() => { if (open) { close(); return; } place(); setOpen(true); }}
              aria-haspopup="menu" aria-expanded={open} aria-label="작업 메뉴"
              className="cursor-pointer rounded px-1.5 text-x-muted hover:bg-x-border hover:text-x-text">···</button>
      {open && createPortal(
        <div ref={menuRef} role="menu" style={{ top: pos.top, left: pos.left, width: MENU_W }} onClick={(e) => e.stopPropagation()}
             className="fixed z-50 rounded-lg border border-x-border-strong bg-white p-1 shadow-lg">
          {rows.map((r, i) => ('divider' in r ? <div key={`d${i}`} role="separator" className="my-1 border-t border-x-border" /> : r.node))}
        </div>, document.body)}
    </>
  );
}

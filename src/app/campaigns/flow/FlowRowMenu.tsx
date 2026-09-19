'use client';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { replaceDisabledReason, type FlowRow } from '@/lib/campaignFlowView';
import type { DraftTab } from './draft/DraftMode';

// 행·패널 공용 ··· 메뉴(Task 10, b-task-10-brief.md §3-2) — TaskTable.tsx의 RowMenu(포털·좌표 클램프·바깥
// 클릭·Esc·스크롤 닫기)와 같은 골격, 항목만 이 화면 것으로 바꿨다. 표의 마지막 칸(renderMenu)과 패널 헤더가
// 같은 컴포넌트를 쓴다 — 둘 다 "이 작업에 지금 할 수 있는 것"이 같아야 하고, 따로 두면 한쪽만 항목이 갈린다.
//
// 서버가 이미 막는 조작에는 버튼을 아예 안 둔다(거짓 어포던스 금지): 게시된 작업엔 취소·교체가
// 없고, 취소된 작업엔 되돌리기·삭제만 있다. 인플루언서 교체는 자리는 두되(게시 전·취소 아닐 때) 인플이
// 없거나 방문이 지났으면 비활성 + 보이는 이유 문구(title만으로 끝내지 않는다, UX 원칙 2·5)로 막는다.
// 게시 확인·게시물 연결(트래킹)은 둘 다 posted_at을 찍을 수 있다 — 인플 미정인 채로 찍히면 배정·교체·
// 취소·정산이 전부 막혀 삭제 말고는 복구 길이 없다(b-final-fix-brief.md C1). 그래서 게시 전(prePost) +
// 인플 미정이면 이 두 항목도 비활성 + 이유 문구로 막는다. 이미 게시된 작업의 게시물 연결(링크만 나중에
// 등록)은 posted_at을 새로 찍지 않으니 인플 미정이어도 막지 않는다.
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
  // 원고 열기·원고 붙이기·새로 만들기 — 셋 다 이 행의 패널을 원고 모드로 연다(C 원고 모드). 화면 밖(/generate)
  // 이나 별도 모달로 보내지 않는다 — 한 화면에서 두 갈래가 생기면 사용자는 어느 쪽이 맞는지 모른다.
  // 붙은 원고가 있으면(원고 열기) tab은 무시된다(패널이 탭 대신 카드를 그린다).
  openDraftMode: (t: FlowRow, tab: DraftTab) => void;
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

  // 항목 onClick이 쓰므로 항목을 만들기 전에 선언한다 — 닫으면서 포커스를 트리거 버튼으로 되돌린다(TaskTable.RowMenu 관례).
  const close = useCallback(() => { if (menuRef.current?.contains(document.activeElement)) btnRef.current?.focus(); setOpen(false); }, []);

  const cancelled = task.cancelledAt !== null;
  const prePost = !cancelled && task.postedAt === null;
  const replaceReason = replaceDisabledReason(task, today);

  // 항목 구성 — 순서는 브리프 그대로. 상태마다 항목 수·비활성 문구 유무가 달라 고정 근사치 대신 실제 구성에서
  // 높이를 쌓아 flip(위/아래 뒤집기) 판단에 쓴다.
  type Row = { node: ReactNode; h: number } | { divider: true };
  const rows: Row[] = [];
  const push = (node: ReactNode, h = ITEM_H) => rows.push({ node, h });

  // 게시 확인·게시물 연결 둘 다 posted_at을 찍을 수 있다 — 인플 미정인 채로 찍히면 되돌릴 길이 없다(C1, 위 주석).
  const NEEDS_INFLUENCER = '인플루언서를 먼저 정해요';
  const postReason = prePost && task.influencerHandle === null ? NEEDS_INFLUENCER : undefined;
  if (prePost) {
    push(
      <MenuButton key="posted" disabled={!!postReason} reason={postReason} onClick={() => { close(); on.posted(task); }}>게시 확인</MenuButton>,
      postReason ? DISABLED_ITEM_H : ITEM_H,
    );
    push(<MenuButton key="schedule" onClick={() => { close(); on.schedule(task); }}>예정일 바꾸기</MenuButton>);
  }
  if (task.draftId) {
    push(<MenuButton key="openDraft" onClick={() => { close(); on.openDraftMode(task, 'generate'); }}>원고 열기</MenuButton>);
  } else if (task.type !== 'rt' && !cancelled) {
    push(<MenuButton key="attachDraft" onClick={() => { close(); on.openDraftMode(task, 'pick'); }}>있는 원고 고르기</MenuButton>);
    push(<MenuButton key="generate" onClick={() => { close(); on.openDraftMode(task, 'generate'); }}>AI로 만들기</MenuButton>);
  }
  // 게시물 연결은 게시 뒤에도 쓴다 — 게시 확인 때 링크 등록이 실패하면 "행 메뉴에서 다시 시도하세요"가
  // 가리키는 곳이 바로 여기다(기존 화면도 게시 여부를 따지지 않는다). RT는 자기 게시물이 없어 제외.
  if (!cancelled && task.type !== 'rt') {
    const linkReason = prePost && task.influencerHandle === null ? NEEDS_INFLUENCER : undefined;
    push(
      <MenuButton key="linkPost" disabled={!!linkReason} reason={linkReason} onClick={() => { close(); on.linkPost(task); }}>게시물 연결(트래킹)</MenuButton>,
      linkReason ? DISABLED_ITEM_H : ITEM_H,
    );
  }

  const tail: Row[] = [];
  if (prePost) {
    tail.push({
      node: (
        <MenuButton key="replace" disabled={!!replaceReason} reason={replaceReason ?? undefined}
                    onClick={() => { close(); on.replace(task); }}>인플루언서 교체</MenuButton>
      ),
      h: replaceReason ? DISABLED_ITEM_H : ITEM_H,
    });
    tail.push({ node: <MenuButton key="cancel" danger onClick={() => { close(); on.cancel(task); }}>작업 취소</MenuButton>, h: ITEM_H });
  } else if (cancelled) {
    tail.push({ node: <MenuButton key="restore" onClick={() => { close(); on.restore(task); }}>되돌리기</MenuButton>, h: ITEM_H });
  }
  if (tail.length) {
    if (rows.length) rows.push({ divider: true });
    rows.push(...tail);
  }
  if (rows.length) rows.push({ divider: true });
  rows.push({ node: <MenuButton key="remove" danger onClick={() => { close(); on.remove(task); }}>삭제</MenuButton>, h: ITEM_H });

  const menuH = rows.reduce((sum, r) => sum + ('divider' in r ? DIVIDER_H : r.h), 8);

  const place = useCallback(() => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const left = Math.min(Math.max(8, r.right - MENU_W), Math.max(8, window.innerWidth - MENU_W - 8));
    const below = r.bottom + 4;
    const flip = below + menuH > window.innerHeight && r.top - menuH - 4 > 0;
    setPos({ top: flip ? r.top - menuH - 4 : below, left });
  }, [menuH]);
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

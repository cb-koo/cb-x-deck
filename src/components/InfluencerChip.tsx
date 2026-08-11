'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { InfluencerOption } from '@/lib/draftTypes';
import { parseXHandle, handleParseMessage } from '@/lib/xHandle';
import { InfluencerField } from './InfluencerField';

// 카드에서 바로 배정 — 상태 칩과 같은 자리(도구층 스트립)에서 "누구에게"를 한 번의 클릭으로 고친다.
// 편집창을 여는 마찰이 실사용에서 확인돼 승격한 것이다(AGENTS.md 원칙 6).
//
// 검증·오류 표시·열고 닫기는 전부 이 컴포넌트가 진다. 부모는 '검증을 통과한 값'만 받아
// 그대로 서버에 낙관적으로 반영한다 — 저장되는 값의 최종 근거는 여전히 서버 정규화다(같은 parseXHandle).

const POP_W = 288;   // px. Tailwind 임의값 대신 상수 — 화면 밖으로 나가지 않게 좌표를 잴 때 같은 수가 필요하다.
const POP_H = 210;   // 라벨+입력+도움말+버튼 줄의 높이 상한. 위/아래 뒤집기 '판단'에만 쓰므로 근사치로 충분하다.

export function InfluencerChip({ handle, options, onChange }: {
  handle: string | null;                     // null = 미배정
  options: InfluencerOption[];
  onChange: (next: string | null) => void;   // 정규화된 핸들, 또는 null(배정 해제)
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [value, setValue] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const chipRef = useRef<HTMLButtonElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);

  // 칩의 화면 좌표에 팝오버를 고정한다. 카드 안에 absolute로 넣지 않는 이유는 두 가지다 —
  // 카드 루트가 overflow-hidden이라 짧은 카드에서는 잘리고, 이 카드는 peek 오버레이(z-40) 안에서도
  // 뜨기 때문에 카드 안 z-index로는 그 층을 넘을 수 없다. body로 포털해 두 문제를 한 번에 없앤다.
  const place = useCallback(() => {
    const r = chipRef.current?.getBoundingClientRect();
    if (!r) return;
    // 카드는 최대 600px이고 스트립은 좁다 — 왼쪽 맞춤 + 화면 경계 클램프면 카드 밖으로 삐져나가지 않는다.
    const left = Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - POP_W - 8));
    const below = r.bottom + 4;
    const flip = below + POP_H > window.innerHeight && r.top - POP_H - 4 > 0;
    setPos({ top: flip ? r.top - POP_H - 4 : below, left });
  }, []);

  const close = useCallback(() => {
    // 초점을 먼저 옮기고 나서 닫는다 — 사라진 뒤에 부르면 이미 없는 요소를 향해 부르는 셈이라
    // activeElement가 body로 튕긴다(useDismissible 선례). 바깥을 눌러 닫을 때는 사용자가 방금 누른 곳에서
    // 초점을 뺏지 않도록, 초점이 팝오버 안에 있을 때만 칩으로 되돌린다.
    if (popRef.current?.contains(document.activeElement)) chipRef.current?.focus();
    setOpen(false);
  }, []);

  function openPop() {
    setValue(handle ?? '');   // 열 때마다 현재 배정에서 다시 시작 — 지난번에 취소한 입력이 남지 않는다
    setErr(null);
    place();
    setOpen(true);
  }

  function save(raw: string = value) {
    const typed = raw.trim();
    // 빈 칸은 오류가 아니라 '배정 해제'다. parseXHandle('')은 'empty'를 돌려주므로 파서를 부르기 전에 걸러낸다 —
    // 이 순서가 뒤집히면 배정을 지우려는 사용자가 "계정 핸들이나 프로필 링크를 넣어주세요"를 보게 된다.
    let next: string | null = null;
    if (typed) {
      const parsed = parseXHandle(typed);
      // 형식이 틀리면 닫지 않는다 — 닫아버리면 안 저장된 채로 저장된 것처럼 보인다(거짓 성공 방지).
      if (!parsed.ok) { setErr(handleParseMessage(parsed.reason)); return; }
      next = parsed.handle;
    }
    // 바뀐 게 없으면 부모를 부르지 않는다 — 같은 값으로 PATCH를 한 번 더 보낼 이유가 없다.
    // 대소문자는 그대로 보존해 비교한다(Hadakan__ → hadakan__ 도 사용자가 의도한 표기 변경이다).
    if (next !== handle) onChange(next);
    close();
  }

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      if (popRef.current?.contains(t) || chipRef.current?.contains(t)) return;   // 팝오버·칩 안을 누른 것
      close();
    };
    // capture 단계에서 받아 전파를 끊는다. 이 카드는 peek 오버레이 안에서도 뜨는데 그 오버레이도
    // document에 Esc 리스너를 달고 있어, 그대로 두면 Esc 한 번에 팝오버와 상세가 함께 닫힌다.
    // capture에서 stopPropagation을 하면 같은 document의 버블 리스너까지 오지 않는다.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.isComposing) return;   // IME 조합 중 Esc는 조합 취소다 — 닫으면 글자가 사라진 것처럼 느껴진다
      e.stopPropagation();
      close();
    };
    // 좌표 고정이라 앵커가 움직이면 따라가야 한다. scroll은 버블링하지 않으므로 capture로 받아야
    // peek 오버레이(overflow-y-auto)처럼 스크롤되는 조상 안에서도 잡힌다.
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

  const typed = value.trim();

  return (
    <>
      {/* 크기(13px·높이 32px·테두리)는 DraftStatusChip과 같은 규격 — 이 줄에서 '내가 정하는 것'은
          같은 덩치로 보이고 옆의 읽기용 메타(11px 회색)와 대비돼야 한다. 처음엔 11px이라 메타 글자와
          구분이 안 됐고 "눈에 안 들어온다"는 피드백을 받았다.
          의미색은 상태 칩이 독점하므로 여기는 무채색이고, 값의 유무를 실선/점선으로 말한다 —
          점선은 "비어 있는 칸"이라는 뜻이라 미배정이 '채우는 자리'로 읽힌다. */}
      <button ref={chipRef} type="button" onClick={() => (open ? close() : openPop())}
              aria-haspopup="dialog" aria-expanded={open}
              aria-label={handle ? `게시할 인플루언서 @${handle} — 바꾸기` : '게시할 인플루언서 배정하기'}
              title={handle ? '이 원고를 줄 인플루언서 — 눌러서 바꾸기' : '이 원고를 줄 인플루언서를 배정합니다'}
              className={`inline-flex h-8 items-center gap-1.5 rounded-lg border bg-white px-2.5 text-ui focus:outline-none focus-visible:ring-2 focus-visible:ring-x-blue ${
                handle ? 'border-x-border-strong text-x-text hover:bg-x-hover'
                       : 'border-dashed border-x-border-strong text-x-muted hover:bg-x-hover hover:text-x-secondary'
              }`}>
        {handle ? <>@{handle} <span aria-hidden className="text-x-muted">⌄</span></> : '+ 인플루언서'}
      </button>

      {open && createPortal(
        <div ref={popRef} role="dialog" aria-label="인플루언서 배정"
             style={{ top: pos.top, left: pos.left, width: POP_W }}
             // 포털은 DOM 밖이지만 React 이벤트는 컴포넌트 트리를 타고 올라간다 — 여기서 끊지 않으면
             // 팝오버 안을 누른 것이 peek 오버레이의 '배경 클릭'으로 새어 상세가 닫힌다.
             onClick={(e) => e.stopPropagation()}
             className="fixed z-50 rounded-xl border border-x-border-strong bg-white p-3 shadow-lg">
          <InfluencerField value={value} options={options} error={err} autoFocus
                           // 고치는 중에도 빨간 문구가 붙어 있으면 "고쳤는데 여전히 틀렸다"로 읽힌다 — 타이핑과 함께 지운다.
                           onChange={(v) => { setValue(v); setErr(null); }}
                           // 제안 목록에서 Enter로 고른 직후에는 state가 아직 그 값이 아니다 — 입력칸의 현재 값으로 저장한다.
                           onEnter={(v) => save(v)} />
          {/* '지우려면 어떻게 하지'로 막히지 않게. 칸이 빈 순간엔 저장 버튼이 스스로 '배정 해제'라고 말하므로 그때는 숨긴다. */}
          {handle && typed !== '' && (
            <p className="mt-1.5 text-caption text-x-muted">칸을 비우고 저장하면 배정이 해제돼요</p>
          )}
          <div className="mt-2 flex items-center justify-end gap-2">
            <button type="button" onClick={() => { setValue(handle ?? ''); setErr(null); close(); }}
                    className="rounded-full px-3 py-1 text-[13px] text-x-secondary hover:bg-x-text/5">취소</button>
            <button type="button" onClick={() => save()}
                    className="rounded-full bg-x-blue px-3 py-1 text-[13px] font-bold text-white hover:bg-x-blue-hover">
              {!typed && handle ? '배정 해제' : '저장'}
            </button>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

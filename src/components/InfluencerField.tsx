'use client';
import { useEffect, useId, useRef, useState } from 'react';
import type { InfluencerOption } from '@/lib/draftTypes';
import type { TaskType } from '@/lib/campaignJudgment';
import { formatAmount, suggestTaskCost } from '@/lib/campaignCost';
import { resolveRosterInput, rosterSuggestions, shouldCommitRegistration, ROSTER_FAILED_MESSAGE, type RosterGate } from '@/lib/rosterPick';
import { Avatar } from '@/components/Avatar';

// 원고를 게시할 인플루언서 한 명 — X 핸들 한 칸 (스펙 2026-08-11 §D).
//
// 이 컴포넌트는 옵션의 출처를 모른다. 지금은 인플루언서 명부 테이블에서 옵션을 읽어오지만,
// 그 사실도 이 파일은 모른다 — 옵션을 읽어오는 쪽이 또 바뀌어도 이 파일은 그대로 간다.
// 그래서 fetch를 하지 않고 prop으로만 받는다 — 교체 지점을 이 파일 밖에 가두기 위해서다.
//
// 정규화(parseXHandle)와 오류 판정도 여기서 하지 않는다. 저장되는 값의 근거는 서버 정규화이고,
// 호출부(편집창)가 같은 함수로 즉시 피드백을 만든다 — 이 필드는 받은 error를 표시만 한다.
export function InfluencerField({ value, options, onChange, error, autoFocus, onEnter, onBlur, hideLabel, hideHelp, roster, onCommit, commitOnBlur, priceType }: {
  value: string;                    // 핸들('@' 없음), '' = 미배정
  options: InfluencerOption[];
  onChange: (v: string) => void;
  error: string | null;
  autoFocus?: boolean;              // 팝오버처럼 이 칸 하나만 있는 자리에서 (편집창은 본문이 먼저 잡는다)
  onEnter?: (current: string) => void;  // 입력칸에서 Enter로 저장 — 저장 버튼이 팝오버 안에만 있어 손이 멀다
  // 칸을 떠날 때도 확정 — 한 명만 고르는 자리(작업 추가)에서 Enter를 안 누르고 [작업 만들기]를 누르면
  // 적어 둔 사람이 통째로 사라진다. blur가 click보다 먼저 오므로 만들기 버튼은 확정된 값을 본다.
  onBlur?: (current: string) => void;
  // 부르는 쪽이 이미 같은 말을 하는 자리(작업 추가 모달의 '인플루언서' 칸 = 칩 상자 안)에서 라벨·도움말이
  // 두 번 나오지 않게 감춘다. 라벨은 화면에서만 감추고 스크린리더에는 남긴다. 오류 줄은 감추지 않는다.
  hideLabel?: boolean;
  hideHelp?: boolean;
  // 명부 전용(설계 §9) — 사람이 입력하는 작업·원고 인플 칸. roster가 없으면 아래 datalist 모드(자유 입력) 그대로.
  roster?: RosterGate;
  onCommit?: (handle: string) => void;   // roster 모드의 확정 — 명부 표기 핸들, '' = 비우기(onEnter·onBlur 대신). 받는 쪽은 다시 판정하지 않는다
  commitOnBlur?: boolean;                // 칸을 떠날 때도 확정(한 칸짜리 폼). 팝오버 칩은 끈다 — 저장 버튼으로 가는 blur가 확정이 되면 안 된다
  priceType?: TaskType;                  // 후보 행에 그 유형의 명부 단가
}) {
  // useId: 편집창은 열 때마다 새로 마운트되고 한 화면에 여러 번 뜰 수 있어, 고정 id면 label-input 연결이 깨진다.
  const inputId = useId();
  const listId = useId();
  const helpId = useId();
  const errId = useId();

  // 분기는 훅 호출 뒤에 둔다 — 모드에 따라 훅 호출 순서가 바뀌면 안 된다
  if (roster) {
    return <RosterCombobox value={value} options={options} onChange={onChange} error={error} autoFocus={autoFocus}
                           hideLabel={hideLabel} roster={roster} onCommit={onCommit ?? (() => {})}
                           commitOnBlur={!!commitOnBlur} priceType={priceType} />;
  }

  return (
    <div>
      <label htmlFor={inputId} className={hideLabel ? 'sr-only' : 'block text-caption text-x-muted'}>게시할 인플루언서</label>
      <input id={inputId} list={listId} value={value} onChange={(e) => onChange(e.target.value)}
             placeholder="@핸들 또는 프로필 링크 붙여넣기"
             autoFocus={autoFocus}
             // 한글·일본어 입력에서 조합을 확정하는 Enter가 저장으로 새면 안 된다(저장소 관례: nativeEvent.isComposing).
             // 값은 state가 아니라 입력칸에서 읽는다 — 제안 목록을 Enter로 고른 직후엔 state가 아직 그 값이 아니다.
             onKeyDown={onEnter && ((e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) onEnter(e.currentTarget.value); })}
             onBlur={onBlur && ((e) => onBlur(e.currentTarget.value))}
             // 핸들은 대소문자 그대로 보존해야 하고 사전에 없는 문자열이라, 모바일 자동 대문자·자동 교정이 값을 망친다.
             // autoComplete="off": 브라우저 저장값(이름·주소) 팝업이 배정 후보 위에 겹쳐 뜨는 걸 막는다.
             autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false}
             aria-invalid={error ? true : undefined}
             aria-describedby={[hideHelp ? null : helpId, error ? errId : null].filter(Boolean).join(' ') || undefined}
             className="mt-0.5 w-full rounded-md border border-x-border-strong bg-white px-2 py-1.5 text-ui outline-none focus:border-x-blue" />
      {/* datalist는 '고르는 목록'이 아니라 '좁혀주는 제안'이라 목록에 없는 값도 그대로 입력된다 —
          후보는 등록된 인플루언서 명단(인플루언서 DB)에서 오므로, 도움말이 그 사실을 그대로 말한다. */}
      <datalist id={listId}>
        {options.map((o) => <option key={o.handle} value={o.handle} label={o.name} />)}
      </datalist>
      {!hideHelp && (
        <p id={helpId} className="mt-1 text-caption text-x-muted">
          X 프로필 주소를 그대로 붙여넣어도 돼요 — 등록된 인플루언서가 아래에 제안됩니다
        </p>
      )}
      {/* role="alert": 이 오류는 저장 버튼을 눌렀을 때 뜬다 — 그때 포커스는 버튼에 있어
          입력칸에 걸어둔 aria-describedby만으로는 읽히지 않는다(ColumnSettings 선례). */}
      {error && <p id={errId} role="alert" className="mt-1 text-caption text-red-600">{error}</p>}
    </div>
  );
}

// 명부 전용 콤보박스(설계 §9·§10, 시안 influencer-v1). 동작:
//  1) 입력하면 명부 후보(사진·이름·핸들·단가). 방향키로 고르고 Enter, 또는 눌러서 확정.
//  2) 정확히 같은 명부 핸들이 없으면 후보 아래에 `@핸들 명부에 등록하고 배정` 한 줄 — Enter·blur로는 배정하지 않는다
//     (X 프로필 조회 비용 → 누르는 opt-in, UX 원칙 6). 누르면 그 줄이 '불러오는 중…', 성공하면 명부 표기로 확정.
//  3) 명부를 못 읽었으면 한 줄 안내 + 배정 막음(서버가 어차피 거부한다).
// 후보 목록은 칸 아래 흐름 안에 그린다(absolute로 띄우지 않는다) — 패널 본문(overflow-y-auto)·교체 창 안에서 잘리지 않게.
// 후보를 누를 때 onMouseDown에서 기본 동작을 막아 입력칸 포커스를 지킨다 — 안 막으면 blur(commitOnBlur)가 클릭보다 먼저 돈다.
function RosterCombobox({ value, options, onChange, error, autoFocus, hideLabel, roster, onCommit, commitOnBlur, priceType }: {
  value: string; options: InfluencerOption[]; onChange: (v: string) => void; error: string | null;
  autoFocus?: boolean; hideLabel?: boolean; roster: RosterGate; onCommit: (handle: string) => void;
  commitOnBlur: boolean; priceType?: TaskType;
}) {
  const inputId = useId();
  const listId = useId();
  const errId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);   // 방향키로 고른 후보(-1 = 없음)
  const [localErr, setLocalErr] = useState<string | null>(null);
  const [reg, setReg] = useState<{ handle: string; busy: boolean; error: string | null } | null>(null);
  // 늦게 온 등록 응답 막기 — 지금 유효한 등록 요청(없으면 null)과 마운트 여부. 쓰기는 핸들러·이펙트 정리에서만(렌더 중 읽지 않는다).
  const regTokenRef = useRef<object | null>(null);
  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; regTokenRef.current = null; };   // 칸이 닫히면(칩 취소·바깥 클릭) 진행 중 등록은 무효
  }, []);
  // 칸 값이 밖에서 바뀌면(등록 중엔 입력칸이 읽기 전용이라 바뀌었다면 부모가 바꾼 것) 진행 중 등록은 무효 — setState 없는 정리만
  useEffect(() => () => { regTokenRef.current = null; }, [value]);
  const busy = !!reg?.busy;   // 등록은 한 번에 하나 — 도는 동안 입력칸은 읽기 전용, 등록 줄은 전부 비활성

  const resolved = resolveRosterInput(value, options, roster.status);
  const list = roster.status === 'ok' ? rosterSuggestions(options, value) : [];
  const outside = resolved.kind === 'outside' ? resolved.handle : null;
  // 등록 상태는 그 핸들에만 붙는다 — 다른 핸들로 고쳐 치면 옛 '불러오는 중…'·오류가 남지 않는다
  const regFor = reg && outside && reg.handle.toLowerCase() === outside.toLowerCase() ? reg : null;
  const showList = open && list.length > 0 && !busy;   // 등록 중엔 다른 후보를 고를 수 없다
  const shownErr = regFor?.error ?? localErr ?? error;
  // 명부 상태 안내(실패·읽는 중)는 한 번만 — 칩 [저장]이 같은 문구를 오류로 올렸으면(빨강) 안내 줄은 숨긴다
  const statusMsg = roster.status === 'failed' ? ROSTER_FAILED_MESSAGE : resolved.kind === 'unavailable' ? resolved.message : null;
  const showStatus = statusMsg !== null && shownErr !== statusMsg;

  // 고른 핸들을 입력칸에도 명부 표기로 채운다 — 안 채우면 친 글자('coc')가 남아, 한 칸짜리 폼에서 나중 blur가
  // 그 글자를 다시 판정해 방금 고른 사람을 다른 사람(정확히 'coc'인 명부 행)으로 덮을 수 있다.
  function pick(handle: string) { setOpen(false); setActive(-1); setLocalErr(null); onChange(handle); onCommit(handle); }
  function commitTyped(raw: string) {
    const r = resolveRosterInput(raw, options, roster.status);
    if (r.kind === 'empty') { setLocalErr(null); onCommit(''); return; }
    if (r.kind === 'roster') { pick(r.handle); return; }
    if (r.kind === 'invalid') { setLocalErr(r.message); return; }
    // outside·unavailable — 확정하지 않는다. 등록 줄·안내 줄이 이미 이유를 말한다.
  }
  async function registerAndPick(h: string) {
    if (regTokenRef.current) return;   // 이미 하나 도는 중 — 두 번째 POST를 내지 않는다
    const token = {};
    regTokenRef.current = token;
    setReg({ handle: h, busy: true, error: null });
    let r: Awaited<ReturnType<RosterGate['register']>>;
    try { r = await roster.register(h); }
    catch (e) {   // 로그인으로 보내는 중(unauthorized) — 잠금만 풀고 그대로 던진다
      if (regTokenRef.current === token) regTokenRef.current = null;
      if (mountedRef.current) setReg(null);
      throw e;
    }
    if (!shouldCommitRegistration(token, regTokenRef.current, mountedRef.current)) {
      // 그사이 마음을 바꿨다(칸 닫힘·값이 밖에서 바뀜) — 배정하지 않는다. 칸이 살아 있으면 '불러오는 중'만 푼다
      if (mountedRef.current) setReg(null);
      return;
    }
    regTokenRef.current = null;
    if (!r.ok) { setReg({ handle: h, busy: false, error: r.error }); return; }   // 서버 문구 그대로(X에 없는 계정·조회 실패) — 다시 누를 수 있다
    setReg(null);
    pick(r.handle);
  }

  return (
    <div>
      <label htmlFor={inputId} className={hideLabel ? 'sr-only' : 'block text-ui text-x-muted'}>게시할 인플루언서</label>
      <input id={inputId} role="combobox" aria-expanded={showList} aria-controls={showList ? listId : undefined} aria-autocomplete="list"
             aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
             value={value} readOnly={busy} autoFocus={autoFocus} placeholder="@핸들 또는 프로필 링크 붙여넣기"
             onChange={(e) => { onChange(e.target.value); setOpen(true); setActive(-1); setLocalErr(null); }}
             onFocus={() => setOpen(true)}
             onBlur={(e) => { setOpen(false); setActive(-1); if (commitOnBlur && !busy) commitTyped(e.currentTarget.value); }}
             onKeyDown={(e) => {
               // 한글·일본어 조합을 확정하는 Enter가 저장으로 새면 안 된다(저장소 관례: nativeEvent.isComposing)
               if (e.nativeEvent.isComposing) return;
               // 목록이 닫혀 있으면 ↑/↓는 다시 열기만 한다 — 보이지 않는 후보를 고른 상태로 두지 않는다
               if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && list.length && !showList) { e.preventDefault(); setOpen(true); setActive(-1); return; }
               if (e.key === 'ArrowDown' && showList) { e.preventDefault(); setActive((i) => Math.min(i + 1, list.length - 1)); return; }
               if (e.key === 'ArrowUp' && showList) { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); return; }
               // 목록이 열려 있으면 Esc는 목록만 닫는다 — 패널·교체 창의 document Esc까지 가지 않게 전파를 끊는다
               if (e.key === 'Escape' && showList) { e.stopPropagation(); setOpen(false); setActive(-1); return; }
               if (e.key === 'Enter') {
                 e.preventDefault();
                 if (busy) return;   // 등록이 도는 중엔 다른 확정을 받지 않는다
                 if (showList && active >= 0 && list[active]) pick(list[active].handle);
                 else commitTyped(e.currentTarget.value);   // 값은 state가 아니라 입력칸에서 읽는다(목록을 고른 직후 state가 늦다)
               }
             }}
             // 핸들은 대소문자 그대로 보존 — 모바일 자동 대문자·교정·브라우저 저장값 팝업을 끈다
             autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false}
             aria-invalid={shownErr ? true : undefined} aria-describedby={shownErr ? errId : undefined}
             className="mt-0.5 h-10 w-full rounded-md border border-x-border-strong bg-white px-2.5 text-content outline-none focus:border-x-blue" />
      {showList && (
        <ul id={listId} role="listbox" aria-label="명부 후보"
            className="mt-1 max-h-72 overflow-y-auto rounded-lg border border-x-border-strong bg-white py-1 shadow-sm">
          {list.map((o, i) => {
            const name = o.name?.trim();
            const price = priceType ? suggestTaskCost(o.pricing, priceType) : null;
            return (
              <li key={o.handle} id={`${listId}-${i}`} role="option" aria-selected={i === active}
                  onMouseDown={(e) => e.preventDefault()} onClick={() => pick(o.handle)}
                  className={`flex min-h-11 cursor-pointer items-center gap-2.5 px-3 py-1.5 ${i === active ? 'bg-x-hover' : 'hover:bg-x-hover'}`}>
                <Avatar url={o.avatarUrl} name={name || o.handle} size={28} />
                <span className="min-w-0 flex-1 truncate text-content">
                  {name ? <><b className="font-semibold">{name}</b> <span className="text-ui text-x-secondary">@{o.handle}</span></> : <b className="font-semibold">@{o.handle}</b>}
                </span>
                {price && <span className="shrink-0 text-ui text-x-secondary">{formatAmount(price.amount, price.currency)}</span>}
              </li>
            );
          })}
        </ul>
      )}
      {/* 등록 줄은 listbox 밖의 진짜 버튼이다 — 키보드(Tab)로도 닿고, 명시적으로 눌러야만 X 조회가 나간다 */}
      {outside && (
        <button type="button" onMouseDown={(e) => e.preventDefault()} disabled={busy}
                onClick={() => void registerAndPick(outside)}
                className="mt-1 flex min-h-11 w-full items-center rounded-lg border border-dashed border-x-border-strong px-3 text-left text-content text-x-blue-text hover:bg-x-hover disabled:cursor-default disabled:text-x-muted">
          {regFor?.busy ? '불러오는 중…' : `@${outside} 명부에 등록하고 배정`}
        </button>
      )}
      {showStatus && <p className={`mt-1 text-ui ${roster.status === 'failed' ? 'text-amber-700' : 'text-x-muted'}`}>{statusMsg}</p>}
      {/* role="alert": 오류는 버튼(등록·저장)을 누른 뒤 뜬다 — 포커스가 버튼에 있어 describedby만으로는 안 읽힌다 */}
      {shownErr && <p id={errId} role="alert" className="mt-1 text-ui text-red-600">{shownErr}</p>}
    </div>
  );
}

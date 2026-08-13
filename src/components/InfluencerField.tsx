'use client';
import { useId } from 'react';
import type { InfluencerOption } from '@/lib/draftTypes';

// 원고를 게시할 인플루언서 한 명 — X 핸들 한 칸 (스펙 2026-08-11 §D).
//
// 이 컴포넌트는 옵션의 출처를 모른다. 지금은 '이미 배정한 적 있는 계정'을 초안에서 파생하지만,
// 나중에 인플루언서 목록 DB가 생기면 바뀌는 건 옵션을 읽어오는 쪽뿐이고 이 파일은 그대로 간다.
// 그래서 fetch를 하지 않고 prop으로만 받는다 — 교체 지점을 이 파일 밖에 가두기 위해서다.
//
// 정규화(parseXHandle)와 오류 판정도 여기서 하지 않는다. 저장되는 값의 근거는 서버 정규화이고,
// 호출부(편집창)가 같은 함수로 즉시 피드백을 만든다 — 이 필드는 받은 error를 표시만 한다.
export function InfluencerField({ value, options, onChange, error, autoFocus, onEnter }: {
  value: string;                    // 핸들('@' 없음), '' = 미배정
  options: InfluencerOption[];
  onChange: (v: string) => void;
  error: string | null;
  autoFocus?: boolean;              // 팝오버처럼 이 칸 하나만 있는 자리에서 (편집창은 본문이 먼저 잡는다)
  onEnter?: (current: string) => void;  // 입력칸에서 Enter로 저장 — 저장 버튼이 팝오버 안에만 있어 손이 멀다
}) {
  // useId: 편집창은 열 때마다 새로 마운트되고 한 화면에 여러 번 뜰 수 있어, 고정 id면 label-input 연결이 깨진다.
  const inputId = useId();
  const listId = useId();
  const helpId = useId();
  const errId = useId();

  return (
    <div>
      <label htmlFor={inputId} className="block text-caption text-x-muted">게시할 인플루언서</label>
      <input id={inputId} list={listId} value={value} onChange={(e) => onChange(e.target.value)}
             placeholder="@핸들 또는 프로필 링크 붙여넣기"
             autoFocus={autoFocus}
             // 한글·일본어 입력에서 조합을 확정하는 Enter가 저장으로 새면 안 된다(저장소 관례: nativeEvent.isComposing).
             // 값은 state가 아니라 입력칸에서 읽는다 — 제안 목록을 Enter로 고른 직후엔 state가 아직 그 값이 아니다.
             onKeyDown={onEnter && ((e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) onEnter(e.currentTarget.value); })}
             // 핸들은 대소문자 그대로 보존해야 하고 사전에 없는 문자열이라, 모바일 자동 대문자·자동 교정이 값을 망친다.
             // autoComplete="off": 브라우저 저장값(이름·주소) 팝업이 배정 후보 위에 겹쳐 뜨는 걸 막는다.
             autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false}
             aria-invalid={error ? true : undefined}
             aria-describedby={error ? `${helpId} ${errId}` : helpId}
             className="mt-0.5 w-full rounded-md border border-x-border-strong bg-white px-2 py-1.5 text-ui outline-none focus:border-x-blue" />
      {/* datalist는 '고르는 목록'이 아니라 '좁혀주는 제안'이라 목록에 없는 값도 그대로 입력된다 —
          후보는 등록된 인플루언서 명단(인플루언서 DB)에서 오므로, 도움말이 그 사실을 그대로 말한다. */}
      <datalist id={listId}>
        {options.map((o) => <option key={o.handle} value={o.handle} label={o.name} />)}
      </datalist>
      <p id={helpId} className="mt-1 text-caption text-x-muted">
        X 프로필 주소를 그대로 붙여넣어도 돼요 — 등록된 인플루언서가 아래에 제안됩니다
      </p>
      {/* role="alert": 이 오류는 저장 버튼을 눌렀을 때 뜬다 — 그때 포커스는 버튼에 있어
          입력칸에 걸어둔 aria-describedby만으로는 읽히지 않는다(ColumnSettings 선례). */}
      {error && <p id={errId} role="alert" className="mt-1 text-caption text-red-600">{error}</p>}
    </div>
  );
}

'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, PANEL, PANEL_TITLE } from '@/components/ui';
import { EDIT_INPUT as INPUT, useProductUnsaved } from '@/components/product/EditorParts';
import { productFetch, useProductSave } from '@/lib/extensionProductClient';
type Language = 'KO' | 'JA' | 'EN';
type Message = { id?: string; title: string; language: Language; body: string; order: number; active: boolean; version?: number };
// 언어는 익스텐션 목록에서 제목 옆 표시로만 쓰인다(필터 아님) — 같은 안내를 언어별로 둘 때 구분용.
const LANGUAGES: Array<[Language, string]> = [['JA', '일본어'], ['KO', '한국어'], ['EN', '영어']];
const languageName = (code: Language) => LANGUAGES.find(([c]) => c === code)?.[1] ?? code;
const HANDLE = '{{handle}}';
const SAMPLE_HANDLE = '@tokyo_beauty';
// 새 메시지는 목록 맨 아래에 붙는다 — 순서는 목록의 ▲▼로 바꾼다(숫자 입력 없음).
const empty = (items: Message[]): Message => ({ title: '', language: 'JA', body: '', order: items.reduce((max, m) => Math.max(max, m.order), -1) + 1, active: true });
const SELECT_CHIP = 'rounded-full border px-3 py-1 text-ui transition-colors';

export default function MessagesPage() {
  const [items, setItems] = useState<Message[]>([]), [draft, setDraft] = useState<Message | null>(null), [baseline, setBaseline] = useState('');
  const [q, setQ] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const save = useProductSave(), dirty = !!draft && JSON.stringify(draft) !== baseline;
  useProductUnsaved(dirty);
  const load = useCallback(async () => { try { setItems((await productFetch<{ items: Message[] }>('quick-messages?includeInactive=true')).items); setError(''); } catch (e) { setError(e instanceof Error ? e.message : '메시지를 불러오지 못했어요. 다시 시도해 주세요.'); } }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- 마운트 시 목록 최초 로드(기존 코드베이스 관례)
  useEffect(() => { void load(); }, [load]);
  function open(value: Message) { setDraft({ ...value }); setBaseline(JSON.stringify(value)); setNotice(''); }
  function leave() { return !dirty || window.confirm('저장하지 않은 입력이 있어요. 지금 이동하면 사라져요. 이동할까요?'); }
  function edit(value: Message) { if (busy) return; if (!leave()) return; open(value); }
  function close() { if (busy || !leave()) return; setDraft(null); setBaseline(''); }
  async function store() { if (!draft || busy) return; setBusy(true); setError(''); try {
    const value = await save<Message>(`quick-messages${draft.id ? `/${draft.id}` : ''}`, draft, draft.version, draft.id ? 'PATCH' : 'POST');
    open(value); setNotice('빠른 메시지를 저장했어요. 익스텐션에서 빠른 메시지를 다시 열면 반영돼요.'); await load();
  } catch (e) { setError(e instanceof Error ? e.message : '메시지를 저장하지 못했어요.'); } finally { setBusy(false); } }
  // 목록 ▲▼ — 전체를 0부터 다시 번호 매기고 바뀐 행만 저장한다(초기엔 모두 0이라 첫 이동 때 전부 번호가 생긴다).
  // 편집 중인 메시지가 그 안에 있으면 순서·버전만 갱신해 입력은 지키고 다음 저장이 버전 충돌로 막히지 않게 한다.
  async function move(index: number, delta: number) {
    const target = index + delta; if (busy || target < 0 || target >= items.length) return;
    const next = [...items]; [next[index], next[target]] = [next[target], next[index]];
    setBusy(true); setError(''); setNotice('');
    try {
      for (const [order, m] of next.entries()) {
        if (m.order === order) continue;
        const saved = await save<Message>(`quick-messages/${m.id}`, { ...m, order }, m.version, 'PATCH');
        if (draft?.id === saved.id) { const patch = { order: saved.order, version: saved.version };
          setDraft((d) => d && { ...d, ...patch }); setBaseline((b) => JSON.stringify({ ...JSON.parse(b) as Message, ...patch })); }
      }
      setNotice('순서를 저장했어요. 익스텐션에서 빠른 메시지를 다시 열면 반영돼요.');
    } catch (e) { setError(e instanceof Error ? e.message : '순서를 바꾸지 못했어요.'); } finally { setBusy(false); await load(); }
  }
  function insertHandle() { const el = bodyRef.current; if (!el || !draft) return;
    const start = el.selectionStart ?? draft.body.length, end = el.selectionEnd ?? start;
    const body = draft.body.slice(0, start) + HANDLE + draft.body.slice(end); setDraft({ ...draft, body });
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(start + HANDLE.length, start + HANDLE.length); }); }
  const filtered = items.filter((m) => `${m.title} ${m.body}`.toLowerCase().includes(q.toLowerCase()));
  const canReorder = !q;   // 검색 중엔 목록이 일부만 보여 ▲▼ 의미가 흐려진다
  return <div className="min-h-full bg-x-surface px-4 py-5 sm:px-6 lg:px-8"><div className="mx-auto w-full max-w-5xl space-y-5">
    <header><h1 className="text-[24px] font-semibold">빠른 메시지</h1><p className="mt-1 text-ui text-x-secondary">X 대화창(크롬 익스텐션)의 빠른 메시지 버튼으로 꺼내 쓰는 팀 공용 안내 문구예요. 여기 목록 순서 그대로 익스텐션에 보여요.</p></header>
    {error && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-ui text-amber-800">{error}<Button className="ml-2" onClick={() => void load()}>다시 불러오기</Button></p>}
    {notice && <p role="status" className="text-ui text-green-800">{notice}</p>}
    <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
      <aside className={`${PANEL} space-y-3`}>
        <Button variant="primary" onClick={() => edit(empty(items))}>새 메시지 작성</Button>
        <input type="search" aria-label="빠른 메시지 검색" placeholder="제목·본문 검색" value={q} onChange={(e) => setQ(e.target.value)} className={INPUT} />
        {!!items.length && <p className="text-caption text-x-muted">{canReorder ? '▲▼로 익스텐션에 보이는 순서를 바꿔요.' : '검색 중에는 순서를 바꿀 수 없어요.'}</p>}
        <ul className="space-y-2">{filtered.map((m) => { const selected = !!draft?.id && draft.id === m.id, index = items.indexOf(m);
          return <li key={m.id} className={`flex items-stretch overflow-hidden rounded-lg border ${selected ? 'border-x-blue bg-x-blue/5' : 'border-x-border'}`}>
            <button type="button" aria-current={selected ? 'true' : undefined} onClick={() => edit(m)} className="min-w-0 flex-1 rounded-l-lg p-3 text-left hover:bg-x-hover">
              <span className={`block truncate text-content font-medium ${m.active ? '' : 'text-x-secondary'}`}>{m.title}</span>
              <span className="text-ui text-x-secondary">{languageName(m.language)} · {m.active ? '사용 중' : '미사용'}</span>
            </button>
            {canReorder && <span className="flex flex-col justify-center border-l border-x-border">
              <button type="button" aria-label={`${m.title} 위로`} disabled={busy || index === 0} onClick={() => void move(index, -1)} className="px-2 text-x-secondary hover:bg-x-hover disabled:opacity-30">▲</button>
              <button type="button" aria-label={`${m.title} 아래로`} disabled={busy || index === items.length - 1} onClick={() => void move(index, 1)} className="px-2 text-x-secondary hover:bg-x-hover disabled:opacity-30">▼</button>
            </span>}
          </li>; })}</ul>
        {!filtered.length && <p className="text-ui text-x-secondary">{items.length ? '검색 결과가 없어요.' : '아직 저장된 메시지가 없어요. 새 메시지를 작성해 주세요.'}</p>}
      </aside>
      {draft ? <fieldset disabled={busy} className={`${PANEL} space-y-4`}>
        <div className="flex items-center justify-between"><h2 className={PANEL_TITLE}>{draft.id ? '메시지 편집' : '새 메시지'}</h2><Button variant="ghost" onClick={close}>닫기</Button></div>
        <label className="block text-ui">제목<input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="예: 방문 예약 안내" className={`${INPUT} mt-1`} />
          <span className="mt-1 block text-caption text-x-muted">익스텐션 목록에서 고를 때 보는 이름이에요.</span></label>
        <div className="text-ui"><span className="block">언어</span>
          <div className="mt-1 flex flex-wrap gap-2" role="radiogroup" aria-label="언어">{LANGUAGES.map(([code, name]) => <button key={code} type="button" role="radio" aria-checked={draft.language === code} onClick={() => setDraft({ ...draft, language: code })}
            className={`${SELECT_CHIP} ${draft.language === code ? 'border-x-blue bg-x-blue/10 font-medium text-x-blue-text' : 'border-x-border-strong bg-white hover:bg-x-hover'}`}>{name}</button>)}</div>
          <span className="mt-1 block text-caption text-x-muted">익스텐션 목록에서 제목 옆에 이 표시가 붙어요. 같은 안내를 언어별로 나눠 둘 때 구분용이에요.</span></div>
        <label className="block text-ui">메시지 본문<textarea ref={bodyRef} rows={10} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} className={`${INPUT} mt-1`} /></label>
        <div className="flex flex-wrap items-center gap-2 text-caption text-x-muted"><Button onClick={insertHandle}>상대 핸들 자리 넣기</Button><span>커서 위치에 {HANDLE}이 들어가요. 익스텐션이 대화 상대의 핸들로 바꿔 넣어요.</span></div>
        <details className="rounded-lg bg-x-surface p-3 text-ui"><summary className="cursor-pointer">익스텐션에서 넣으면 이렇게 보여요</summary>
          <pre className="mt-2 whitespace-pre-wrap font-sans">{draft.body.replaceAll(HANDLE, SAMPLE_HANDLE) || '본문을 입력하면 여기에 보여요.'}</pre>
          <p className="mt-2 text-caption text-x-muted">{draft.body.includes(HANDLE) ? `예시로 ${SAMPLE_HANDLE}을 넣어 봤어요. 실제로는 대화 상대의 핸들이 들어가요.` : '핸들 자리가 없어서 입력한 그대로 들어가요.'}</p></details>
        <div><label className="text-ui"><input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} /> 익스텐션에서 사용</label>
          <p className="mt-1 text-caption text-x-muted">끄면 저장은 남고 익스텐션 목록에서만 숨겨져요. 잠시 빼둘 때 쓰세요.</p></div>
        <div className="flex items-center gap-3"><Button variant="primary" disabled={!draft.title.trim() || !draft.body.trim()} onClick={() => void store()}>{busy ? '저장 중…' : '메시지 저장'}</Button>
          {dirty && !busy && <span className="text-caption text-x-muted">저장하지 않은 변경이 있어요.</span>}</div>
      </fieldset> : <div className={`${PANEL} text-ui text-x-secondary`}>왼쪽에서 메시지를 고르거나 새 메시지를 작성해 주세요.</div>}
    </div>
  </div></div>;
}

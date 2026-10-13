'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, PANEL } from '@/components/ui';
import { EDIT_INPUT as INPUT, ProductDialog } from '@/components/product/EditorParts';
import type { Register } from './ClientDetail';
import { productFetch, useProductSave } from '@/lib/extensionProductClient';
import type { ClinicDetail, ClinicSettings, ClinicTemplate } from '@/lib/clinicStore';
import { applyWeekHours, DEFAULT_HOURS, describeHours, groupWeek, hoursError, operatingOn, OPERATING_STATE_LABEL,
  readHours, WEEKDAYS, WEEK_ORDER, weekdayLabel, writeHours, type HolidayCalendar, type HoursSelection } from '@/lib/clinicHours';
import { kstToday } from '@/lib/datetime';

type Edit = { scope: 'week'; days: number[] } | { scope: 'holiday' } | { scope: 'date'; date: string };
type Calendar = { holidays: HolidayCalendar; source: string | null };
const errText = (e: unknown) => e instanceof Error ? e.message : '저장하지 못했어요. 입력은 유지했으니 다시 시도해 주세요.';
// 클라이언트 상세의 '운영시간'·'방문 안내·양식' 탭 — 본점 한 곳의 설정을 웹·익스텐션이 함께 쓴다.
// 기본 정보(소개·금지 표현)는 클라이언트 상세의 기본 정보 상자가 이미 편집하므로 여기서 다시 두지 않는다(중복 저장 방지).
export type ClinicTab = 'hours' | 'forms';
// 미저장 입력은 ClientDetail의 편집기 레지스트리(register)에 올린다 — 클라이언트 전환·사이드바 이동·새로고침 확인과
// '저장하고 이동'을 기본 정보 편집기와 같은 길로 탄다(이 화면에서 따로 navGuard를 걸면 페이지의 가드를 덮어쓴다).
export function ClinicSettingsTab({ clientId, tab, register }: { clientId: string; tab: ClinicTab; register: Register }) {
  const [id, setId] = useState(''), [error, setError] = useState('');
  const load = useCallback(async () => {
    try { const r = await productFetch<{ items: { id: string; clientId: string }[] }>('clinics'); setId(r.items.find((c) => c.clientId === clientId)?.id ?? ''); setError(''); }
    catch (e) { setError(errText(e)); }
  }, [clientId]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- 마운트 시 설정 최초 로드(기존 코드베이스 관례)
  useEffect(() => { void load(); }, [load]);
  if (error) return <div className={PANEL}><p role="alert" className="text-content text-amber-800">{error}</p><Button onClick={() => void load()}>다시 불러오기</Button></div>;
  if (!id) return <div className={PANEL}><p className="text-content text-x-secondary">클리닉 설정을 불러오는 중…</p></div>;
  return <ClinicEditor key={id} id={id} tab={tab} register={register} />;
}
function ClinicEditor({ id, tab, register }: { id: string; tab: ClinicTab; register: Register }) {
  const [clinic, setClinic] = useState<ClinicDetail | null>(null), [draft, setDraft] = useState<ClinicSettings | null>(null);
  const [forms, setForms] = useState({ form: '', sheet: '' });
  const [subtab, setSubtab] = useState('map'), [language, setLanguage] = useState<'KO' | 'JA' | 'EN'>('JA');
  const [month, setMonth] = useState(() => kstToday().slice(0, 7)), [calendar, setCalendar] = useState<Calendar>({ holidays: { names: {}, coveredYears: [] }, source: null });
  const [calendarError, setCalendarError] = useState(''), [calendarLoading, setCalendarLoading] = useState(true);
  const [calendarRetry, setCalendarRetry] = useState(0);
  const [editing, setEditing] = useState<Edit | null>(null), [templatePending, setTemplatePending] = useState<'form' | 'sheet' | null>(null);
  const [templateEditing, setTemplateEditing] = useState({ form: false, sheet: false });
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const sheetRef = useRef<HTMLTextAreaElement>(null), save = useProductSave();
  const initialized = useRef(false);
  const load = useCallback(async () => { try { const value = await productFetch<ClinicDetail>(`clinics/${id}`); setClinic(value);
    if (!initialized.current) { setDraft(value.settings);
      setForms({ form: value.templates.form?.body ?? '', sheet: value.templates.sheet?.body ?? '' }); initialized.current = true; }
    setError('');
  } catch (e) { setError(errText(e)); } }, [id]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- 마운트 시 설정 최초 로드(기존 코드베이스 관례)
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (tab !== 'hours' || !clinic?.id) return;
    let active = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 다른 달을 불러오는 동안 이전 공휴일 정보로 판정하지 않는다
    setCalendarLoading(true);
    setCalendarError('');
    setCalendar({ holidays: { names: {}, coveredYears: [] }, source: null });
    productFetch<Calendar>(`clinics/${id}/calendar?month=${month}`).then((value) => {
      if (active) { setCalendar(value); setCalendarError(''); }
    }).catch(() => {
      if (active) setCalendarError('공휴일 정보를 불러오지 못했어요. 다시 불러와 주세요.');
    }).finally(() => { if (active) setCalendarLoading(false); });
    return () => { active = false; };
  }, [id, month, tab, clinic?.id, clinic?.version, calendarRetry]);
  const dirty = !!clinic && (!!draft && JSON.stringify(draft) !== JSON.stringify(clinic.settings) || forms.form !== (clinic.templates.form?.body ?? '') || forms.sheet !== (clinic.templates.sheet?.body ?? ''));
  // 레지스트리는 등록 시점의 함수를 들고 있으므로 최신 상태는 ref로 읽는다.
  const dirtyRef = useRef(false), saveAllRef = useRef<() => Promise<boolean>>(async () => true);
  useEffect(() => {
    dirtyRef.current = dirty || busy;
    // 페이지의 '저장하고 이동' — 바뀐 것(설정·양식)만 저장한다. 양식 저장 전 안내 창은 건너뛴다(사용자가 저장을 골랐다).
    saveAllRef.current = async () => {
      if (!clinic || !draft) return true;
      try {
        if (JSON.stringify(draft) !== JSON.stringify(clinic.settings)) {
          const updated = await save<ClinicDetail>(`clinics/${id}/settings`, { settings: draft }, clinic.version, 'PATCH');
          setClinic(updated); setDraft(updated.settings);
        }
        for (const kind of ['form', 'sheet'] as const) {
          if (forms[kind] === (clinic.templates[kind]?.body ?? '')) continue;
          const saved = await save<ClinicTemplate>(`clinics/${id}/templates/${kind}`, { body: forms[kind] }, clinic.templates[kind]?.revision ?? 1, 'PATCH');
          setClinic((c) => c ? { ...c, templates: { ...c.templates, [kind]: saved } } : c);
        }
        return true;
      } catch (e) { setError(errText(e)); return false; }
    };
  });
  useEffect(() => register('clinic', { isDirty: () => dirtyRef.current, save: () => saveAllRef.current() }), [register]);
  async function run(fn: () => Promise<void>) { if (busy) return; setBusy(true); setError(''); setNotice(''); try { await fn(); } catch (e) { setError(errText(e)); } finally { setBusy(false); } }
  if (!clinic || !draft) return <div className={PANEL}><p className="text-content">{error || '클리닉 설정을 불러오는 중…'}</p>{error && <Button onClick={() => void load()}>다시 불러오기</Button>}</div>;
  const currentClinic = clinic, currentDraft = draft;
  const patch = (p: Partial<ClinicSettings>) => setDraft({ ...draft, ...p });
  async function storeTemplate(kind: 'form' | 'sheet') { await run(async () => {
    const saved = await save<ClinicTemplate>(`clinics/${id}/templates/${kind}`, { body: forms[kind] }, currentClinic.templates[kind]?.revision ?? 1, 'PATCH');
    setClinic((c) => c ? { ...c, templates: { ...c.templates, [kind]: saved } } : c); setTemplatePending(null); setTemplateEditing((v) => ({ ...v, [kind]: false })); setNotice('양식을 저장했어요. 기존 예약의 기재 시트는 그대로 유지돼요.');
  }); }
  async function storeHours(value: ClinicSettings) {
    setBusy(true); setError(''); setNotice('');
    try {
      const settings = { ...currentClinic.settings, week: value.week, holidayPolicy: value.holidayPolicy,
        holidayIntervals: value.holidayIntervals, exceptions: value.exceptions };
      const updated = await save<ClinicDetail>(`clinics/${id}/settings`, { settings }, currentClinic.version, 'PATCH');
      setClinic(updated);
      setDraft((previous) => ({ ...(previous ?? updated.settings), week: updated.settings.week,
        holidayPolicy: updated.settings.holidayPolicy, holidayIntervals: updated.settings.holidayIntervals,
        exceptions: updated.settings.exceptions }));
      setEditing(null);
      setNotice('운영시간을 저장했어요. 예약 화면과 익스텐션의 운영시간 안내에 적용돼요.');
    } finally { setBusy(false); }
  }
  const monthDate = new Date(`${month}-01T00:00:00Z`), offset = monthDate.getUTCDay(), total = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5), 0)).getUTCDate();
  return <div className="space-y-5"><p className="text-ui text-x-secondary">본점 한 곳의 설정이에요. 저장하면 웹의 예약 화면과 익스텐션이 같은 내용을 사용해요.</p>
    {error && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-ui text-amber-800">{error} <Button disabled={busy} onClick={() => void load()}>최신 저장 내용 불러오기</Button></p>}{notice && <p role="status" className="rounded-lg bg-green-50 p-3 text-ui text-green-800">{notice}</p>}
    <fieldset disabled={busy} className="min-w-0 space-y-4">
      {tab === 'hours' && <div className="grid gap-5 xl:grid-cols-[minmax(260px,0.8fr)_minmax(380px,1.2fr)]"><div className="space-y-4"><section className={PANEL}><div className="mb-3 flex items-center justify-between"><h3 className="text-content font-semibold">매주 운영시간</h3><Button onClick={() => setEditing({ scope: 'week', days: [1, 2, 3, 4, 5] })}>시간 설정</Button></div><p className="mb-3 text-ui text-x-secondary">같은 시간에 운영하는 요일을 묶어 한 번에 설정해요.</p>{groupWeek(draft.week).map((group) => <div key={group.days.join(',')} className="flex items-center justify-between gap-3 border-t border-x-border py-3 text-ui"><div><p className="font-medium">{weekdayLabel(group.days)}</p><p>{group.schedule.closed ? '휴무' : describeHours(group.schedule.intervals).range}</p>{!group.schedule.closed && <p className="text-x-secondary">{describeHours(group.schedule.intervals).break}</p>}</div><Button onClick={() => setEditing({ scope: 'week', days: group.days })}>변경</Button></div>)}</section><section className={PANEL}><div className="mb-3 flex items-center justify-between"><h3 className="text-content font-semibold">공휴일 기본 운영</h3><Button onClick={() => setEditing({ scope: 'holiday' })}>시간 설정</Button></div><p className="text-ui">{draft.holidayPolicy === 'unknown' ? '운영 방침을 아직 정하지 않았어요.' : draft.holidayPolicy === 'closed' ? '공휴일 휴무' : `공휴일 운영 · ${describeHours(draft.holidayIntervals).range}`}</p><p className="mt-2 text-ui text-x-secondary">대체공휴일에도 같은 방침이 적용돼요. 특정 날짜만 바꾸려면 날짜별 운영시간에서 날짜를 눌러 주세요.</p></section></div><section className={PANEL}><div className="mb-4 flex items-center justify-between gap-2"><h3 className="text-content font-semibold">날짜별 운영시간</h3><input type="month" value={month} onChange={(e) => { if (e.target.value) setMonth(e.target.value); }} aria-label="캘린더 달" className="rounded-md border border-x-border p-2 text-ui" /></div>{calendarLoading && <p role="status" className="mb-3 text-ui text-x-secondary">공휴일 정보를 불러오는 중이에요.</p>}{calendarError && <div role="alert" className="mb-3 flex flex-wrap items-center gap-2 text-ui text-amber-800"><p>{calendarError}</p><Button onClick={() => setCalendarRetry((value) => value + 1)}>공휴일 다시 불러오기</Button></div>}{!calendarLoading && !calendarError && !calendar.holidays.coveredYears.includes(+month.slice(0, 4)) && <p className="mb-3 text-ui text-amber-800">이 연도 공휴일 자료가 아직 없어 운영 여부는 확인이 필요해요. 날짜별로 직접 설정한 시간은 유지돼요.</p>}<div className="grid grid-cols-7 gap-1">{WEEKDAYS.map((day) => <span key={day} className="pb-2 text-center text-ui text-x-secondary">{day}</span>)}{Array.from({ length: offset }, (_, i) => <span key={`empty${i}`} />)}{Array.from({ length: total }, (_, i) => { const date = `${month}-${String(i + 1).padStart(2, '0')}`, day = operatingOn(draft, draft.exceptions, calendar.holidays, date), special = draft.exceptions.some((e) => e.date === date); return <button key={date} onClick={() => setEditing({ scope: 'date', date })} aria-label={`${date} ${day.holidayName ?? ''} ${OPERATING_STATE_LABEL[day.state]} 운영 설정`} className={`min-h-20 rounded-md border p-1 text-left hover:border-x-blue md:min-h-24 md:p-2 ${special ? 'border-x-blue bg-x-blue/5' : day.holidayName ? 'border-amber-200 bg-amber-50' : 'border-x-border'}`}><span className="block text-ui font-medium">{i + 1}{special && <span className="ml-1 text-x-blue-text">•</span>}</span><span className="block text-caption text-x-secondary">{OPERATING_STATE_LABEL[day.state]}</span><span className="hidden text-caption text-x-muted md:block">{day.intervals}</span>{day.holidayName && <span className="block break-words text-caption text-amber-800">{day.holidayName}</span>}</button>; })}</div></section></div>}
      {tab === 'forms' && <><nav className="flex gap-2" aria-label="방문 안내 세부 항목"><Button variant={subtab === 'map' ? 'primary' : 'subtle'} onClick={() => setSubtab('map')}>지도·방문 안내</Button><Button variant={subtab === 'templates' ? 'primary' : 'subtle'} onClick={() => setSubtab('templates')}>고객 예약 양식·기재 시트</Button></nav>{subtab === 'map' ? <div className="grid gap-4 lg:grid-cols-2"><section className={`${PANEL} space-y-3`}><h3 className="font-semibold">지도 주소</h3>{(['naver', 'google'] as const).map((key) => <label key={key} className="block text-ui">{key === 'naver' ? '네이버 지도' : 'Google 지도'}<input value={draft[key]} onChange={(e) => patch({ [key]: e.target.value })} className={`${INPUT} mt-1`} /></label>)}<h3 className="pt-2 font-semibold">언어별 방문 안내</h3><select value={language} onChange={(e) => setLanguage(e.target.value as typeof language)} className={INPUT}><option value="KO">한국어</option><option value="JA">일본어</option><option value="EN">영어</option></select><textarea rows={8} value={draft.instructions[language]} onChange={(e) => patch({ instructions: { ...draft.instructions, [language]: e.target.value } })} className={INPUT} aria-label="방문 안내 본문" /></section><section className={PANEL}><h3 className="font-semibold">고객에게 보낼 안내 미리보기</h3><p className="mt-3 whitespace-pre-wrap text-content">{draft.instructions[language] || '방문 안내를 입력하면 여기에 보여요.'}</p><div className="mt-3 space-y-2 text-ui">{(['naver', 'google'] as const).map((key) => /^https?:\/\//.test(draft[key]) && <a key={key} href={draft[key]} target="_blank" rel="noopener noreferrer" className="block text-x-blue-text underline">{key === 'naver' ? '네이버 지도 열기' : 'Google 지도 열기'}</a>)}</div></section></div> : <div className="grid gap-4 lg:grid-cols-2">{(['form', 'sheet'] as const).map((kind) => <section key={kind} className={`${PANEL} space-y-3`}><div className="flex items-center justify-between"><h3 className="text-content font-semibold">{kind === 'form' ? '고객 예약 양식' : '클리닉 기재 시트'}</h3><Button onClick={() => { if (templateEditing[kind]) { if (forms[kind] !== (clinic.templates[kind]?.body ?? '')) setTemplatePending(kind); else setTemplateEditing((v) => ({ ...v, [kind]: false })); } else setTemplateEditing((v) => ({ ...v, [kind]: true })); }}>{templateEditing[kind] ? '저장' : '수정'}</Button></div><p className="text-ui text-x-secondary">{kind === 'form' ? '고객에게 보내서 예약 응답을 받는 양식이에요.' : '응답을 정리해 클리닉에 전달하는 최종 문서의 양식이에요.'}</p>{templateEditing[kind] ? <><textarea ref={kind === 'sheet' ? sheetRef : undefined} rows={15} value={forms[kind]} onChange={(e) => setForms({ ...forms, [kind]: e.target.value })} className={`${INPUT} font-mono`} aria-label={kind === 'form' ? '고객 예약 양식 본문' : '기재 시트 양식 본문'} />{kind === 'sheet' && <Button onClick={() => { const input = sheetRef.current, start = input?.selectionStart ?? forms.sheet.length, end = input?.selectionEnd ?? start; setForms({ ...forms, sheet: forms.sheet.slice(0, start) + '@{{handle}}' + forms.sheet.slice(end) }); requestAnimationFrame(() => { input?.focus(); input?.setSelectionRange(start + 11, start + 11); }); }}>[인플핸들]</Button>}</> : <pre className="whitespace-pre-wrap text-ui">{forms[kind] || '저장된 양식이 없어요. 수정 버튼으로 작성해 주세요.'}</pre>}</section>)}</div>}</>}
      {tab === 'forms' && subtab === 'map' && <div className="flex flex-col gap-3 border-t border-x-border pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-ui text-x-secondary">지도 주소와 모든 언어의 방문 안내를 함께 저장해요.</p>
        <Button variant="primary" className="self-end shrink-0" onClick={() => void run(async () => {
          const settings = { ...currentClinic.settings, naver: currentDraft.naver, google: currentDraft.google, instructions: currentDraft.instructions };
          const updated = await save<ClinicDetail>(`clinics/${id}/settings`, { settings }, currentClinic.version, 'PATCH');
          setClinic(updated);
          setDraft({ ...currentDraft, naver: updated.settings.naver, google: updated.settings.google, instructions: updated.settings.instructions });
          setNotice('지도·방문 안내를 저장했어요. 새로 만드는 안내부터 적용돼요.');
        })}>{busy ? '저장 중…' : '지도·방문 안내 저장'}</Button>
      </div>}
    </fieldset>
    {editing && <HoursDialog edit={editing} settings={draft} holidays={calendar.holidays} onClose={() => setEditing(null)} onSave={storeHours} />}
    {templatePending && <ProductDialog title="예약 파싱 형식도 함께 수정해야 해요" onClose={() => setTemplatePending(null)}><p className="text-content leading-relaxed">예약 양식이나 기재 시트의 항목을 수정할 경우, 예약 파싱도 동일한 형식으로 수정해야 합니다. 변경한 내용을 개발자에게 전달하세요.</p><p className="mt-3 text-ui text-x-secondary">저장으로 개발자에게 메시지를 보내거나 파싱 코드를 자동 변경하지는 않아요. 기존 예약 시트는 유지돼요.</p><div className="mt-5 flex gap-2"><Button variant="primary" disabled={busy} onClick={() => void storeTemplate(templatePending)}>확인하고 저장</Button><Button disabled={busy} onClick={() => setTemplatePending(null)}>계속 수정</Button></div></ProductDialog>}
  </div>;
}
function HoursDialog({ edit, settings, holidays, onSave, onClose }: { edit: Edit; settings: ClinicSettings; holidays: HolidayCalendar; onSave: (s: ClinicSettings) => Promise<void>; onClose: () => void }) {
  const isWeek = edit.scope === 'week', isDate = edit.scope === 'date', date = isDate ? edit.date : '';
  const existing = settings.exceptions.find((e) => e.date === date), base = isDate ? operatingOn(settings, settings.exceptions, holidays, date) : null;
  const raw = isWeek ? settings.week[edit.days[0]].intervals : isDate ? base?.intervals ?? '' : settings.holidayIntervals;
  const [hours, setHours] = useState<HoursSelection>(() => readHours(raw) ?? DEFAULT_HOURS), [days, setDays] = useState(isWeek ? edit.days : []);
  const [closed, setClosed] = useState<boolean | null>(isWeek ? settings.week[edit.days[0]].closed : isDate ? existing?.closed ?? (base?.state === 'unknown' ? null : base?.state === 'closed') : settings.holidayPolicy === 'unknown' ? null : settings.holidayPolicy === 'closed');
  const [note, setNote] = useState(existing?.note ?? ''), [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const close = () => { if (!savingRef.current) onClose(); };
  async function persist(next: ClinicSettings) {
    if (savingRef.current) return;
    savingRef.current = true; setSaving(true); setError('');
    try { await onSave(next); }
    catch (e) { setError(`${errText(e)} 입력은 유지되어 있어요.`); }
    finally { savingRef.current = false; setSaving(false); }
  }
  function apply() { try { if (closed === null) throw new Error('운영할지 휴무일지 선택해 주세요.'); if (!closed && hoursError(hours)) throw new Error(hoursError(hours));
    const next = isWeek ? { ...settings, week: applyWeekHours(settings.week, days, closed, hours) }
      : isDate ? { ...settings, exceptions: [...settings.exceptions.filter((e) => e.date !== date), { date, closed, intervals: closed ? '' : writeHours(hours), note }] }
      : { ...settings, holidayPolicy: closed ? 'closed' as const : 'special' as const, holidayIntervals: closed ? settings.holidayIntervals : writeHours(hours) };
    void persist(next); } catch (e) { setError(errText(e)); } }
  return <ProductDialog side={isDate} title={isWeek ? '매주 운영시간 설정' : isDate ? `${date} 운영 설정` : '공휴일 운영 설정'} onClose={close}><fieldset disabled={saving} aria-busy={saving} className="min-w-0 space-y-4">
    {isWeek && <div><p className="mb-2 text-ui">적용할 요일</p><div className="flex flex-wrap gap-2">{WEEK_ORDER.map((day) => <label key={day} className="text-ui"><input type="checkbox" checked={days.includes(day)} onChange={(e) => setDays(e.target.checked ? [...days, day] : days.filter((d) => d !== day))} /> {WEEKDAYS[day]}</label>)}</div><div className="mt-2 flex gap-1"><Button onClick={() => setDays([1, 2, 3, 4, 5])}>평일</Button><Button onClick={() => setDays([0, 6])}>주말</Button><Button onClick={() => setDays(WEEK_ORDER)}>매일</Button></div></div>}
    {isDate && <p className="text-ui text-x-secondary">기본 운영: {base ? OPERATING_STATE_LABEL[base.state] : '확인 필요'} {base?.intervals} {base?.holidayName}</p>}
    <div className="flex gap-4 text-ui"><label><input type="radio" name="operating" checked={closed === false} onChange={() => setClosed(false)} /> 운영</label><label><input type="radio" name="operating" checked={closed === true} onChange={() => setClosed(true)} /> 휴무</label></div>
    {closed === false && <><div className="grid grid-cols-2 gap-3">{[['opens', '운영 시작'], ['closes', '운영 종료']].map(([key, label]) => <label key={key} className="text-ui">{label}<input type="time" className={`${INPUT} mt-1`} value={hours[key as 'opens' | 'closes']} onChange={(e) => setHours({ ...hours, [key]: e.target.value })} /></label>)}</div><label className="block text-ui"><input type="checkbox" checked={hours.lunch} onChange={(e) => setHours({ ...hours, lunch: e.target.checked })} /> 점심시간 있음</label>{hours.lunch && <div className="grid grid-cols-2 gap-3">{[['lunchStarts', '점심 시작'], ['lunchEnds', '점심 종료']].map(([key, label]) => <label key={key} className="text-ui">{label}<input type="time" className={`${INPUT} mt-1`} value={hours[key as 'lunchStarts' | 'lunchEnds']} onChange={(e) => setHours({ ...hours, [key]: e.target.value })} /></label>)}</div>}</>}
    {isDate && <><label className="block text-ui">메모<textarea rows={3} className={`${INPUT} mt-1`} value={note} onChange={(e) => setNote(e.target.value)} /></label><p className="text-ui text-x-secondary">날짜별 변경을 없애려면 기본 운영으로 되돌려 저장해 주세요.</p><Button disabled={!existing} onClick={() => void persist({ ...settings, exceptions: settings.exceptions.filter((e) => e.date !== date) })}>기본 운영으로 되돌려 저장</Button></>}
    {error && <p role="alert" className="text-ui text-amber-800">{error}</p>}<p className="text-ui text-x-secondary">저장하면 예약 화면과 익스텐션의 운영시간 안내에 바로 반영돼요.</p><div className="flex gap-2"><Button variant="primary" onClick={apply}>{saving ? '저장 중…' : '저장'}</Button><Button onClick={close}>취소</Button></div>
  </fieldset></ProductDialog>;
}

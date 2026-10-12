'use client';
import { useState } from 'react';
import type { Branch } from '../model';
import { HOLIDAYS, operating } from '../policy';
import { locationLabel } from '../clinic-policy';
import {
  DEFAULT_HOURS,
  WEEKDAYS,
  WEEK_ORDER,
  readHours,
  writeHours,
  hoursError,
  applyWeekHours,
  weekdayLabel,
  describeHours,
  type HoursSelection,
} from '../hours';
import { Badge, Button, Field, Modal, Notice } from './shared';
export type HoursEdit =
  { scope: 'week'; days: number[] } | { scope: 'holiday' } | { scope: 'date'; date: string };

export function HoursEditor({
  edit,
  draft,
  onApply,
  onClose,
  clientName,
  holidayLoaded = true,
}: {
  edit: HoursEdit;
  draft: Branch;
  onApply: (draft: Branch, date?: string) => void;
  onClose: () => void;
  clientName: string;
  holidayLoaded?: boolean;
}) {
  const existing = edit.scope === 'date' ? draft.exceptions.find((e) => e.date === edit.date) : undefined;
  const scope = edit.scope;
  const firstDay = edit.scope === 'week' ? edit.days[0] : 1;
  const initial = edit.scope === 'date' ? operating(draft, edit.date, holidayLoaded) : null;
  const raw =
    scope === 'week'
      ? draft.week[firstDay].intervals
      : scope === 'holiday'
        ? draft.holidayHours
        : (initial?.hours ?? '');
  const [hours, setHours] = useState<HoursSelection>(readHours(raw) ?? DEFAULT_HOURS);
  const [closed, setClosed] = useState<boolean | null>(
    scope === 'week'
      ? draft.week[firstDay].closed
      : scope === 'holiday'
        ? draft.holiday === 'unknown'
          ? null
          : draft.holiday === 'closed'
        : initial?.state === '휴무',
  );
  const [days, setDays] = useState(edit.scope === 'week' ? edit.days : []);
  const date = edit.scope === 'date' ? edit.date : '';
  const [note, setNote] = useState(existing?.note ?? '');
  const [error, setError] = useState('');
  const isWeek = scope === 'week',
    isHoliday = scope === 'holiday';
  const patch = (p: Partial<HoursSelection>) => {
    setHours({ ...hours, ...p });
    setError('');
  };
  const changeDays = (next: number[]) => {
    setDays(next);
    setError('');
  };
  const dateTitle = date
    ? `${Number(date.slice(5, 7))}월 ${Number(date.slice(8))}일 (${WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()]})`
    : '';
  const title = isWeek ? '매주 운영시간 설정' : isHoliday ? '공휴일 운영 설정' : `${dateTitle} 운영 설정`;
  const label = isWeek ? weekdayLabel(days) || '요일 미선택' : isHoliday ? '공휴일' : date || '날짜 미선택';
  function apply() {
    try {
      if (!isWeek && !isHoliday && !/^\d{4}-\d{2}-\d{2}$/.test(date))
        throw new Error('변경할 날짜를 선택해 주세요.');
      if (closed === null) throw new Error('공휴일에 운영할지, 휴무일지 선택해 주세요.');
      if (isWeek) onApply({ ...draft, week: applyWeekHours(draft.week, days, closed, hours) });
      else if (isHoliday)
        onApply({
          ...draft,
          holiday: closed ? 'closed' : 'special',
          holidayHours: closed ? draft.holidayHours : writeHours(hours),
        });
      else
        onApply(
          {
            ...draft,
            exceptions: [
              ...draft.exceptions.filter((e) => e.date !== date),
              { date, closed: !!closed, intervals: closed ? '' : writeHours(hours), note: note.trim() },
            ],
          },
          date,
        );
    } catch (e) {
      setError(e instanceof Error ? e.message : '선택한 시간을 확인해 주세요.');
    }
  }
  const baseline = date
    ? operating(
        { ...draft, exceptions: draft.exceptions.filter((e) => e.date !== date) },
        date,
        holidayLoaded,
      )
    : null;
  return (
    <Modal title={title} onClose={onClose} side={edit.scope === 'date'}>
      <div className="mock-modal-body mock-hours-editor">
        <div>
          {edit.scope === 'date' && (
            <>
              <p className="mock-muted">
                {locationLabel(draft, clientName)} · {date} · 한국 시간
              </p>
              <div className="mock-date-setting-context">
                <div className="mock-section-head">
                  <b>{HOLIDAYS[date] ?? '선택한 날짜'}</b>
                  <Badge tone={existing ? 'blue' : ''}>
                    {existing ? '이 날짜만 별도 설정' : '기본 운영 적용'}
                  </Badge>
                </div>
                <p>
                  기본 운영:{' '}
                  <strong>
                    {baseline?.state === '운영' ? describeHours(baseline.hours).range : baseline?.state}
                  </strong>
                </p>
                {baseline?.state === '운영' && <small>{describeHours(baseline.hours).break}</small>}
                <p className="mock-muted">아래에서 변경한 내용은 이 날짜에만 적용돼요.</p>
                {existing && (
                  <Button
                    variant="ghost"
                    onClick={() =>
                      onApply({ ...draft, exceptions: draft.exceptions.filter((e) => e.date !== date) }, date)
                    }
                  >
                    기본 운영으로 되돌리기
                  </Button>
                )}
              </div>
            </>
          )}
          {isHoliday && (
            <p className="mock-holiday-help">
              모든 공휴일에 같은 시간을 적용해요. 특정 날짜만 다르게 운영하려면 캘린더에서 변경하세요.
            </p>
          )}
          <div className="mock-choice-row" role="group" aria-label="운영 여부">
            <button
              className={closed === false ? 'selected' : ''}
              aria-pressed={closed === false}
              onClick={() => {
                setClosed(false);
                setError('');
              }}
            >
              운영
            </button>
            <button
              className={closed === true ? 'selected' : ''}
              aria-pressed={closed === true}
              onClick={() => {
                setClosed(true);
                setError('');
              }}
            >
              휴무
            </button>
          </div>
          {closed === false ? (
            <>
              <div className="mock-grid two mock-hour-inputs">
                <Field label="운영 시작">
                  <input type="time" value={hours.opens} onChange={(e) => patch({ opens: e.target.value })} />
                </Field>
                <Field label="운영 종료">
                  <input
                    type="time"
                    value={hours.closes}
                    onChange={(e) => patch({ closes: e.target.value })}
                  />
                </Field>
              </div>
              <div className="mock-lunch-toggle">
                <b>점심시간</b>
                <div className="mock-choice-row" role="group" aria-label="점심시간 유무">
                  <button
                    className={!hours.lunch ? 'selected' : ''}
                    aria-pressed={!hours.lunch}
                    onClick={() => patch({ lunch: false })}
                  >
                    없음
                  </button>
                  <button
                    className={hours.lunch ? 'selected' : ''}
                    aria-pressed={hours.lunch}
                    onClick={() => patch({ lunch: true })}
                  >
                    있음
                  </button>
                </div>
              </div>
              {hours.lunch && (
                <div className="mock-grid two mock-hour-inputs">
                  <Field label="점심 시작">
                    <input
                      type="time"
                      value={hours.lunchStarts}
                      onChange={(e) => patch({ lunchStarts: e.target.value })}
                    />
                  </Field>
                  <Field label="점심 종료">
                    <input
                      type="time"
                      value={hours.lunchEnds}
                      onChange={(e) => patch({ lunchEnds: e.target.value })}
                    />
                  </Field>
                </div>
              )}
              {raw && !readHours(raw) && (
                <Notice>여러 구간으로 등록된 시간이에요. 적용할 새 운영시간을 확인해 주세요.</Notice>
              )}
            </>
          ) : (
            <p className="mock-muted">
              {closed === null
                ? '공휴일 운영 여부를 선택해 주세요.'
                : isHoliday
                  ? '공휴일은 쉬어요. 운영할 날짜만 캘린더에서 따로 정할 수 있어요.'
                  : `선택한 ${isWeek ? '요일은 매주' : '날짜는'} 하루 동안 쉬어요.`}
            </p>
          )}
          {isWeek && (
            <fieldset className="mock-days-field">
              <legend>적용할 요일</legend>
              <div className="mock-days-presets">
                <Button variant="ghost" onClick={() => changeDays([1, 2, 3, 4, 5])}>
                  평일
                </Button>
                <Button variant="ghost" onClick={() => changeDays([6, 0])}>
                  주말
                </Button>
                <Button variant="ghost" onClick={() => changeDays(WEEK_ORDER)}>
                  매일
                </Button>
              </div>
              <div className="mock-day-picks">
                {WEEK_ORDER.map((d) => (
                  <label key={d} className={days.includes(d) ? 'selected' : ''}>
                    <input
                      type="checkbox"
                      aria-label={`${WEEKDAYS[d]}요일에 적용`}
                      checked={days.includes(d)}
                      onChange={(e) => {
                        changeDays(e.target.checked ? [...days, d] : days.filter((item) => item !== d));
                      }}
                    />
                    <span>{WEEKDAYS[d]}</span>
                  </label>
                ))}
              </div>
              <p className="mock-muted">선택한 요일의 기존 운영시간을 변경해요.</p>
            </fieldset>
          )}
          {!isWeek && !isHoliday && (
            <Field label="안내 메모 (선택)">
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="예: 한글날 오전 운영, 내부 교육으로 휴무"
              />
            </Field>
          )}
          <div className="mock-hours-apply-preview">
            <b>{label}</b>
            <span>
              {closed === null
                ? '운영 여부 미설정'
                : closed
                  ? '휴무'
                  : hoursError(hours)
                    ? '시간을 확인해 주세요'
                    : `${hours.opens}–${hours.closes} 운영`}
            </span>
            {closed === false && hours.lunch && !hoursError(hours) && (
              <small>
                점심 {hours.lunchStarts}–{hours.lunchEnds}
              </small>
            )}
          </div>
        </div>
        {error && <Notice danger>{error}</Notice>}
        <p className="mock-muted">적용 후 캘린더를 확인하고, 클리닉 설정을 저장해 주세요.</p>
      </div>
      <footer>
        <Button onClick={onClose}>돌아가기</Button>
        <Button variant="primary" onClick={apply}>
          {isWeek ? '선택한 요일에 적용' : isHoliday ? '공휴일에 적용' : '이 날짜에만 적용'}
        </Button>
      </footer>
    </Modal>
  );
}

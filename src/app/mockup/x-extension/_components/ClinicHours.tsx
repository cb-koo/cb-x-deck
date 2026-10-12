'use client';
import { useState } from 'react';
import type { Branch } from '../model';
import { HOLIDAYS, operating } from '../policy';
import { WEEKDAYS, describeHours, groupWeek, weekdayLabel } from '../hours';
import { Badge, Button, Notice, Section } from './shared';
import { HoursEditor, type HoursEdit } from './HoursEditor';

function ScheduleText({ closed, intervals }: { closed: boolean; intervals: string }) {
  const h = describeHours(intervals);
  return (
    <div className="mock-schedule-text">
      <strong className={closed ? 'mock-muted' : ''}>{closed ? '휴무' : h.range}</strong>
      {!closed && (h.break || !intervals) && <small>{h.break || '운영시간을 설정해 주세요.'}</small>}
    </div>
  );
}
export function ClinicHours({
  draft,
  clientName,
  onDraft,
}: {
  draft: Branch;
  clientName: string;
  onDraft: (draft: Branch) => void;
}) {
  const [edit, setEdit] = useState<HoursEdit | null>(null);
  const [month, setMonth] = useState('2026-10');
  const [selected, setSelected] = useState('');
  const [holidayLoaded, setHolidayLoaded] = useState(true);
  const [notice, setNotice] = useState('');
  const monthDate = new Date(`${month}-01T00:00:00Z`);
  const offset = monthDate.getUTCDay();
  const total = new Date(Date.UTC(monthDate.getUTCFullYear(), monthDate.getUTCMonth() + 1, 0)).getUTCDate();
  function moveMonth(delta: number) {
    const date = new Date(monthDate);
    date.setUTCMonth(date.getUTCMonth() + delta);
    setMonth(date.toISOString().slice(0, 7));
    setSelected('');
  }
  return (
    <>
      <div className="mock-hours-intro">
        <div>
          <p className="mock-muted">
            기본 시간을 정하고, 특정 날짜만 다르게 운영할 때는 캘린더를 눌러 주세요.
          </p>
        </div>
        <Badge>한국 시간</Badge>
      </div>
      {notice && (
        <div className="mock-hours-notice" role="status">
          {notice}
          <button aria-label="운영시간 안내 닫기" onClick={() => setNotice('')}>
            ✕
          </button>
        </div>
      )}
      <div className="mock-hours-layout">
        <div className="mock-hours-basics" aria-label="기본 운영시간 설정">
          <div className="mock-card">
            <Section
              title="매주 운영시간"
              aside={
                <Button onClick={() => setEdit({ scope: 'week', days: [1, 2, 3, 4, 5] })}>시간 설정</Button>
              }
            >
              <p className="mock-muted">같은 시간에 운영하는 요일을 묶어 한 번에 설정할 수 있어요.</p>
              <div className="mock-week-summary">
                {groupWeek(draft.week).map(({ days, schedule }) => (
                  <div className="mock-schedule-row" key={days.join(',')}>
                    <b className="mock-week-label">{weekdayLabel(days)}</b>
                    <ScheduleText closed={schedule.closed} intervals={schedule.intervals} />
                    <Button
                      variant="ghost"
                      aria-label={`${weekdayLabel(days)} 운영시간 변경`}
                      onClick={() => setEdit({ scope: 'week', days })}
                    >
                      변경
                    </Button>
                  </div>
                ))}
              </div>
            </Section>
          </div>
          <div className="mock-card">
            <Section
              title="공휴일 기본 운영"
              aside={
                <Button aria-label="공휴일 시간 설정" onClick={() => setEdit({ scope: 'holiday' })}>
                  시간 설정
                </Button>
              }
            >
              <p className="mock-muted">요일과 관계없이 모든 공휴일에 적용해요.</p>
              {draft.holiday === 'unknown' && (
                <Notice>아직 정하지 않았어요. 시간 설정에서 운영 또는 휴무를 선택해 주세요.</Notice>
              )}
              {draft.holiday !== 'unknown' && (
                <div className="mock-holiday-summary">
                  <Badge tone={draft.holiday === 'special' ? 'green' : ''}>
                    {draft.holiday === 'special' ? '공휴일 운영' : '공휴일 휴무'}
                  </Badge>
                  {draft.holiday === 'special' && (
                    <ScheduleText closed={false} intervals={draft.holidayHours} />
                  )}
                </div>
              )}
              <p className="mock-hours-note">특정 공휴일만 변경하려면 캘린더에서 날짜를 선택하세요.</p>
            </Section>
          </div>
        </div>
        <div className="mock-card mock-hours-calendar mock-hours-calendar-full">
          <Section
            title="운영 캘린더"
            aside={
              <div className="mock-calendar-nav">
                <Button aria-label="이전 달" onClick={() => moveMonth(-1)}>
                  ‹
                </Button>
                <h3>{month.replace('-', '년 ')}월</h3>
                <Button aria-label="다음 달" onClick={() => moveMonth(1)}>
                  ›
                </Button>
              </div>
            }
          >
            <p className="mock-muted">날짜를 누르면 그날의 운영시간을 변경할 수 있어요.</p>
            {(!holidayLoaded || month !== '2026-10') && (
              <Notice>
                이달의 공휴일 정보를 확인할 수 없어요. 날짜를 눌러 운영 여부와 시간을 직접 정할 수 있어요.
              </Notice>
            )}
            <div className="mock-calendar mock-schedule-calendar">
              {WEEKDAYS.map((d) => (
                <span className="weekday" key={d}>
                  {d}
                </span>
              ))}
              {Array.from({ length: offset }, (_, i) => (
                <span className="mock-calendar-blank" key={`blank-${i}`} />
              ))}
              {Array.from({ length: total }, (_, i) => {
                const date = `${month}-${String(i + 1).padStart(2, '0')}`,
                  o = operating(draft, date, holidayLoaded),
                  custom = draft.exceptions.find((e) => e.date === date),
                  h = describeHours(o.hours);
                return (
                  <button
                    key={date}
                    className={`${selected === date ? 'selected' : ''} ${o.state === '운영' ? 'open' : o.state === '휴무' ? 'closed' : 'unknown'}`}
                    aria-label={`${date}${HOLIDAYS[date] ? ` ${HOLIDAYS[date]}` : ''} ${o.state}${custom ? ' · 별도 설정' : ''} 운영 설정`}
                    aria-haspopup="dialog"
                    aria-pressed={selected === date}
                    onClick={() => {
                      setSelected(date);
                      setEdit({ scope: 'date', date });
                    }}
                  >
                    <span className="mock-calendar-day">
                      <b>{i + 1}</b>
                      {custom && <i className="mock-date-dot" aria-hidden />}
                      <span className="mock-calendar-state">{o.state}</span>
                    </span>
                    {HOLIDAYS[date] && <span className="mock-calendar-holiday">{HOLIDAYS[date]}</span>}
                    {o.state === '운영' && <span className="mock-calendar-hours">{h.range}</span>}
                  </button>
                );
              })}
            </div>
            <p className="mock-calendar-key">
              <span className="mock-date-dot" /> 별도 설정한 날짜 · 날짜를 눌러 기본 운영으로 되돌릴 수
              있어요.
            </p>
            <details className="mock-hours-demo">
              <summary>목업 데이터 안내</summary>
              <p className="mock-muted">
                공휴일은 2026년 10월 샘플이에요. 다른 달은 확인 필요로 표시해요. 저장 전 변경도 캘린더에
                표시돼요.
              </p>
              <Button onClick={() => setHolidayLoaded((v) => !v)}>
                {holidayLoaded ? '공휴일 갱신 실패 체험' : '샘플 공휴일 복원'}
              </Button>
            </details>
          </Section>
        </div>
      </div>
      {edit && (
        <HoursEditor
          edit={edit}
          draft={draft}
          clientName={clientName}
          holidayLoaded={holidayLoaded}
          onClose={() => setEdit(null)}
          onApply={(next, date) => {
            const restored =
              date &&
              draft.exceptions.some((e) => e.date === date) &&
              !next.exceptions.some((e) => e.date === date);
            onDraft(next);
            setEdit(null);
            setNotice(
              restored
                ? '선택한 날짜를 기본 운영 설정으로 되돌렸어요. 확인 후 클리닉 설정을 저장해 주세요.'
                : '변경한 시간을 캘린더에 반영했어요. 확인 후 클리닉 설정을 저장해 주세요.',
            );
          }}
        />
      )}
    </>
  );
}

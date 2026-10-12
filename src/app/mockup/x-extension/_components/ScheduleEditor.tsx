'use client';
import { useState } from 'react';
import type { Branch, Reason } from '../model';
import { koreanDay, timeGuidance, uploadWindow } from '../policy';
import { Badge, Button, Field, Modal, Notice } from './shared';

export function ScheduleEditor({
  title,
  hasReservation,
  initialValue,
  withTime,
  branch,
  minimumDate = '',
  defaultDeadline,
  reason,
  count,
  onApply,
  onClose,
  onLimit,
}: {
  title: string;
  hasReservation: boolean;
  initialValue: string;
  withTime: boolean;
  branch?: Branch;
  minimumDate?: string;
  defaultDeadline?: string;
  reason: Reason;
  count: number;
  onApply: (value: string, reason: Reason) => string | void;
  onClose: () => void;
  onLimit: () => void;
}) {
  const [date, setDate] = useState(initialValue.slice(0, 10));
  const [time, setTime] = useState(initialValue.slice(11, 16));
  const [month, setMonth] = useState(() =>
    (uploadWindow(initialValue) ? initialValue : minimumDate || koreanDay(Date.now())).slice(0, 7),
  );
  const [error, setError] = useState('');
  const first = new Date(`${month}-01T00:00:00Z`);
  const total = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const value = withTime ? `${date}T${time}` : date;
  function move(delta: number) {
    const next = new Date(first);
    next.setUTCMonth(next.getUTCMonth() + delta);
    setMonth(next.toISOString().slice(0, 7));
  }
  function select(next: string) {
    setDate(next);
    if (uploadWindow(next)) setMonth(next.slice(0, 7));
    setError('');
  }
  function apply() {
    if (!uploadWindow(date) || (minimumDate && date < minimumDate)) {
      setError(minimumDate ? '방문일 이후의 올바른 날짜를 선택해 주세요.' : '올바른 날짜를 선택해 주세요.');
      return;
    }
    if (withTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
      setError('방문 시간을 선택해 주세요.');
      return;
    }
    if (value === initialValue) {
      onClose();
      return;
    }
    if (reason === 'customer_request' && count >= 3 && value !== initialValue) {
      onLimit();
      return;
    }
    const message = onApply(value, reason);
    if (message) setError(message);
  }
  return (
    <Modal title={title} onClose={onClose}>
      <div className="mock-modal-body mock-schedule-editor">
        <p className="mock-muted">
          한국 시간 ·{' '}
          {hasReservation
            ? '저장하면 일정과 예약 폼·기재 시트에 함께 반영해요.'
            : '날짜를 선택한 뒤 일정을 저장해 주세요.'}
        </p>
        {reason !== 'waiting_edit' && (
          <Badge tone="blue">
            {reason === 'customer_request'
              ? `인플루언서 요청 · 현재 ${count}/3회`
              : '내 입력 정정 · 횟수 제외'}
          </Badge>
        )}
        <div className="mock-date-calendar" aria-label="일정 달력">
          <div className="mock-date-calendar-nav">
            <Button variant="icon" aria-label="이전 달" onClick={() => move(-1)}>
              ‹
            </Button>
            <strong aria-live="polite">
              {first.getUTCFullYear()}년 {first.getUTCMonth() + 1}월
            </strong>
            <Button variant="icon" aria-label="다음 달" onClick={() => move(1)}>
              ›
            </Button>
          </div>
          <div className="mock-date-calendar-grid">
            {['일', '월', '화', '수', '목', '금', '토'].map((d) => (
              <span className="mock-muted" key={d}>
                {d}
              </span>
            ))}
            {Array.from({ length: first.getUTCDay() }, (_, i) => (
              <span key={`empty-${i}`} />
            ))}
            {Array.from({ length: total }, (_, i) => {
              const day = `${month}-${String(i + 1).padStart(2, '0')}`;
              return (
                <button
                  key={day}
                  aria-label={day}
                  aria-pressed={date === day}
                  className={date === day ? 'selected' : ''}
                  disabled={!!minimumDate && day < minimumDate}
                  onClick={() => select(day)}
                >
                  {i + 1}
                </button>
              );
            })}
          </div>
        </div>
        <div className={`mock-grid ${withTime ? 'two' : ''}`}>
          <Field label="날짜">
            <input
              type="date"
              value={date}
              min={minimumDate || undefined}
              onChange={(e) => select(e.target.value)}
            />
          </Field>
          {withTime && (
            <Field label="방문 시간">
              <input
                type="time"
                value={time}
                onChange={(e) => {
                  setTime(e.target.value);
                  setError('');
                }}
              />
            </Field>
          )}
        </div>
        {defaultDeadline && (
          <div className="mock-deadline-default">
            <small>방문 후 14일 기준: {defaultDeadline}</small>
            <Button variant="ghost" onClick={() => select(defaultDeadline)}>
              기본 기한으로
            </Button>
          </div>
        )}
        {withTime && branch && date && time && <Notice>{timeGuidance(branch, value)}</Notice>}
        {error && <Notice danger>{error}</Notice>}
      </div>
      <footer>
        <Button onClick={onClose}>돌아가기</Button>
        <Button variant="primary" onClick={apply}>
          일정 저장
        </Button>
      </footer>
    </Modal>
  );
}

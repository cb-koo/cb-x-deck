'use client';
import { useState } from 'react';

import { formatDateKo } from '@/lib/campaignJudgment';
import type { DemoTask } from '../model';
import { preferredAt, uploadWindow } from '../policy';
import { readClientSheetInputs } from '../sheet';

function CalendarDays({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden
    >
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M7 3v5M17 3v5M3 11h18" />
    </svg>
  );
}
function Clock3({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}
export function TaskSchedule({
  task,
  locked,
  onEditDate,
  onChange,
}: {
  task: DemoTask;
  locked: boolean;
  onEditDate: (field: 'preferred' | 'uploadDeadline') => void;
  onChange: (task: DemoTask) => void;
}) {
  const [addingTime, setAddingTime] = useState(!!task.scheduledTime);
  const preferred = preferredAt(task);
  const deadline = task.reservation
    ? readClientSheetInputs(task.reservation.sheet).uploadDeadline
    : task.scheduledOn;
  const defaultDeadline = uploadWindow(preferred)?.end;
  return (
    <>
      <div className="mock-task-dates">
        {task.type === 'visit' && (
          <div className="mock-field">
            <span>
              방문일{' '}
              <small className="mock-date-label-hint">
                ({task.reservation?.phase === 'waiting' ? '희망 일시' : '방문 일시'})
              </small>
            </span>
            <div className="mock-date-control">
              {task.reservation ? (
                <>
                  <button aria-label="방문일 수정" disabled={locked} onClick={() => onEditDate('preferred')}>
                    <CalendarDays size={17} />
                    <span>{preferred ? formatDateKo(preferred.slice(0, 10)) : '날짜 미정'}</span>
                  </button>
                  <button
                    aria-label="방문 시간 수정"
                    disabled={locked}
                    onClick={() => onEditDate('preferred')}
                  >
                    <Clock3 size={17} />
                    <span>{preferred.slice(11, 16) || '시간 추가'}</span>
                  </button>
                </>
              ) : (
                <>
                  <button aria-label="방문일 수정" disabled={locked} onClick={() => onEditDate('preferred')}>
                    <CalendarDays size={17} />
                    <span>{task.visitOn ? formatDateKo(task.visitOn) : '날짜 추가'}</span>
                  </button>
                  <span className="mock-date-placeholder">
                    <Clock3 size={17} />
                    예약에서 시간 설정
                  </span>
                </>
              )}
            </div>
          </div>
        )}
        {task.type === 'visit' ? (
          <div className="mock-field">
            <span>
              게시 예정일 <small className="mock-date-label-hint">(업로드 기한)</small>
            </span>
            <div className="mock-date-control mock-deadline-control">
              <button
                aria-label="업로드 기한 수정"
                disabled={locked}
                onClick={() => onEditDate('uploadDeadline')}
              >
                <CalendarDays size={17} />
                <span>{deadline ? formatDateKo(deadline) : '날짜 추가'}</span>
              </button>
              <span className="mock-date-placeholder">
                {deadline && deadline === defaultDeadline
                  ? '방문 후 14일'
                  : deadline
                    ? '직접 설정한 기한'
                    : '방문일 선택 후 설정'}
              </span>
            </div>
          </div>
        ) : (
          <div className="mock-field">
            <span>게시 예정일</span>
            <div className="mock-date-control">
              <label className="mock-date-picker">
                <CalendarDays size={17} />
                <span>{task.scheduledOn ? formatDateKo(task.scheduledOn) : '날짜 추가'}</span>
                <input
                  aria-label="게시 예정일"
                  type="date"
                  value={task.scheduledOn}
                  disabled={locked}
                  onChange={(e) => onChange({ ...task, scheduledOn: e.target.value })}
                />
              </label>
              {addingTime || task.scheduledTime ? (
                <label>
                  <Clock3 size={17} />
                  <input
                    aria-label="게시 예정 시간"
                    type="time"
                    value={task.scheduledTime ?? ''}
                    disabled={locked}
                    onChange={(e) => onChange({ ...task, scheduledTime: e.target.value })}
                  />
                </label>
              ) : (
                <button disabled={locked} onClick={() => setAddingTime(true)}>
                  <Clock3 size={17} />
                  시간 추가
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

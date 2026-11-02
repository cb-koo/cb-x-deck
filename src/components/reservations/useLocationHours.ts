'use client';
import { useEffect, useState } from 'react';
import { productFetch } from '@/lib/extensionProductClient';
import type { HolidayCalendar } from '@/lib/clinicHours';
import type { ClinicDetail } from '@/lib/clinicStore';

type Loaded<T> = { key: string; value: T | null; error: string };
export type HoursState =
  | { status: 'none' }                       // 지점 없음(미선택·미등록)
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; clinic: ClinicDetail; holidays: HolidayCalendar };
const EMPTY: HolidayCalendar = { names: {}, coveredYears: [] };
const errorText = (e: unknown) => e instanceof Error ? e.message : '운영시간을 불러오지 못했어요.';

// 고른 지점의 클리닉 상세(운영시간)와 그 달 공휴일. 응답마다 요청 키를 붙여 두고 지금 키와 같은 것만 쓴다 —
// 지점을 바꾸면 이전 지점 판정이 남지 않고(D23), 늦게 온 이전 지점 응답은 버려지고(D25), 실패는 다시 시도로 보인다(D24).
// refresh — 부르는 쪽이 다시 읽을 때(포커스 복귀 등) 올린다. 같은 지점을 다시 읽는 동안은 지금 값을 그대로 보여 준다(깜빡임 없이).
export function useLocationHours(locationId: string | null, month: string, refresh: number) {
  const [detail, setDetail] = useState<Loaded<ClinicDetail> | null>(null);
  const [calendar, setCalendar] = useState<Loaded<HolidayCalendar> | null>(null);
  const [retry, setRetry] = useState(0);
  const detailKey = locationId ? `${locationId}|${refresh}|${retry}` : '';
  useEffect(() => {
    if (!locationId) return;
    let alive = true;
    productFetch<ClinicDetail>(`clinics/${locationId}`)
      .then((value) => { if (alive) setDetail({ key: detailKey, value, error: '' }); })
      // 같은 지점을 다시 읽다 실패하면 갖고 있던 값은 둔다 — 다른 지점 값은 아래에서 id로 걸러진다
      .catch((e) => { if (alive) setDetail((prev) => ({ key: detailKey, value: prev?.value?.id === locationId ? prev.value : null, error: errorText(e) })); });
    return () => { alive = false; };
  }, [locationId, detailKey]);
  const clinic = locationId && detail?.value?.id === locationId ? detail.value : null;
  const clinicId = clinic?.id, validMonth = /^\d{4}-\d{2}$/.test(month);
  const calendarKey = clinic && validMonth ? `${clinic.id}|${clinic.version}|${month}|${retry}` : '';
  useEffect(() => {
    if (!clinicId || !calendarKey) return;
    let alive = true;
    productFetch<{ holidays: HolidayCalendar }>(`clinics/${clinicId}/calendar?month=${month}`)
      .then((value) => { if (alive) setCalendar({ key: calendarKey, value: value.holidays, error: '' }); })
      .catch((e) => { if (alive) setCalendar({ key: calendarKey, value: null, error: errorText(e) }); });
    return () => { alive = false; };
  }, [clinicId, month, calendarKey]);

  let hours: HoursState;
  if (!locationId) hours = { status: 'none' };
  else if (!clinic) hours = detail?.key === detailKey && detail.error ? { status: 'error', message: detail.error } : { status: 'loading' };
  // 희망 일시가 날짜 형식이 아니면(고객 요청 문구 등) 공휴일 없이 판정한다 — 예전 동작 그대로
  else if (!validMonth) hours = { status: 'ready', clinic, holidays: EMPTY };
  else if (calendar?.key !== calendarKey) hours = { status: 'loading' };
  else hours = calendar.value ? { status: 'ready', clinic, holidays: calendar.value } : { status: 'error', message: calendar.error };
  return { clinic, hours, retry: () => setRetry((n) => n + 1) };
}

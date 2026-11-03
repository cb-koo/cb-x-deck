'use client';
import type { ReactNode } from 'react';
import { formatReservationName, normalizeFollowerTier, readClientSheetInput, readClientSheetInputs, splitReservationName, type SheetInputKey } from '@/lib/reservationSheet';
import { isDateOnlyString } from '@/lib/campaignJudgment';
import type { BranchOption } from '@/lib/reservationBranch';
import { BranchSelect } from './BranchSelect';

const INPUT = 'w-full min-w-0 rounded-md border border-x-border-strong bg-white px-2.5 py-1.5 text-ui outline-none focus:border-x-blue';
// 양식에 그 줄이 있을 때만 보이는 칸 — 없는 양식에 칸을 띄우면 고칠 때 새 줄이 덧붙는다
const OPTIONAL: [SheetInputKey, string][] = [['preferred2', '제2희망 일시'], ['budget', '예산'], ['treatmentHistory', '기왕력'],
  ['companion', '동반자'], ['nationality', '국적'], ['doctorPreference', '원장님 지정'], ['note', '메모']];
const TIERS = ['나노', '마이크로', '메가'] as const;

export type FieldWarning = { field: 'branch' | 'preferred'; text: string };

// 예약 창 2단계 가운데 열 — 기재 시트를 항목별로 보여 주고, 고치면 시트의 그 줄을 바꾼다(시트가 원본, 칸은 파생값 — UX 원칙 4).
// 경고(운영시간 밖·없는 지점)는 그 칸 라벨을 주황으로 바꾸고 칸 아래에 판단과 다음 행동을 적는다(UX 원칙 3).
export function ParsedFields({ sheet, onPatch, branch, warnings, hoursStatus }: {
  sheet: string;
  onPatch: (key: SheetInputKey, value: string) => void;
  branch: { id: string; options: BranchOption[]; value: string | null; hint: { warn: boolean; text: string } | null; onChange: (id: string) => void } | null;
  warnings: FieldWarning[];
  hoursStatus: ReactNode;   // 운영시간 확인 중·실패(다시 시도) — 경고가 아닌 상태 줄
}) {
  const fields = readClientSheetInputs(sheet), names = splitReservationName(fields.name);
  const structured = /^(?:\d{4}-\d{2}-\d{2})?(?:[ T](?:\d{2}:\d{2})?)?$/.test(fields.preferred);
  const [date = '', time = ''] = structured ? fields.preferred.replace(' ', 'T').split('T') : [fields.preferred, ''];
  const warnOf = (field: FieldWarning['field']) => warnings.find((w) => w.field === field)?.text ?? null;
  const tier = readClientSheetInput(sheet, 'followerTier');

  const row = (label: string, control: ReactNode, opts: { htmlFor?: string; warn?: string | null; after?: ReactNode } = {}) => (
    <div className="grid grid-cols-[96px_1fr] items-start gap-x-3 gap-y-1">
      <label htmlFor={opts.htmlFor} className={`pt-2 text-ui ${opts.warn ? 'font-semibold text-amber-700' : 'text-x-secondary'}`}>
        {label}{opts.warn && <span aria-hidden> ⚠</span>}
      </label>
      <div className="grid min-w-0 gap-1">{control}{opts.warn && <small className="text-caption text-amber-700">{opts.warn}</small>}{opts.after}</div>
    </div>
  );
  const text = (key: SheetInputKey, label: string, value: string) =>
    row(label, <input id={`pf-${key}`} className={INPUT} value={value} onChange={(e) => onPatch(key, e.target.value)} />, { htmlFor: `pf-${key}` });

  return (
    <div className="grid content-start gap-2.5">
      {branch && row('방문 지점',
        <BranchSelect id={branch.id} options={branch.options} value={branch.value} hint={branch.hint} onChange={branch.onChange} />,
        { htmlFor: branch.id, warn: null })}
      {row('희망 일시',
        <div className="grid grid-cols-[1fr_128px] gap-1.5">
          <input id="pf-preferred" aria-label="희망 날짜" type={date && !isDateOnlyString(date) ? 'text' : 'date'} className={INPUT} value={date}
                 onChange={(e) => onPatch('preferred', time && isDateOnlyString(e.target.value) ? `${e.target.value}T${time}` : e.target.value)} />
          <input aria-label="희망 시간" type="time" className={INPUT} value={time} disabled={!structured || !date}
                 onChange={(e) => onPatch('preferred', e.target.value ? `${date}T${e.target.value}` : date)} />
        </div>,
        { htmlFor: 'pf-preferred', warn: warnOf('preferred'), after: hoursStatus })}
      {row('이름 (한국어)', <input id="pf-name-ko" className={INPUT} value={names.korean} onChange={(e) => onPatch('name', formatReservationName({ ...names, korean: e.target.value }))} />, { htmlFor: 'pf-name-ko' })}
      {row('이름 (로마자)', <input id="pf-name-ro" className={INPUT} value={names.roman} onChange={(e) => onPatch('name', formatReservationName({ ...names, roman: e.target.value }))} />, { htmlFor: 'pf-name-ro' })}
      {text('visitType', '초진/재진', fields.visitType)}
      {text('gender', '성별', fields.gender)}
      {row('생년월일', <input id="pf-birth" type={!fields.birthDate || isDateOnlyString(fields.birthDate) ? 'date' : 'text'} className={INPUT}
                            value={fields.birthDate} onChange={(e) => onPatch('birthDate', e.target.value)} />, { htmlFor: 'pf-birth' })}
      {text('koreanAbility', '한국어', fields.koreanAbility)}
      {text('treatment', '시술 내용', fields.treatment)}
      {OPTIONAL.map(([key, label]) => {
        const value = readClientSheetInput(sheet, key);
        return value === null ? null : <div key={key}>{text(key, label, value.replace('T', ' '))}</div>;
      })}
      {/* 등급은 AI가 고르지 않는다 — 담당자가 직접 고른다. 양식에 줄이 없으면 고를 때 '인플루언서 팔로워' 줄이 시트 끝에 붙는다 */}
      {row('팔로워 등급',
        <div role="radiogroup" aria-label="팔로워 등급" className="flex gap-1.5">
          {TIERS.map((t) => {
            const on = normalizeFollowerTier(tier ?? '') === t;
            return <button key={t} type="button" role="radio" aria-checked={on} onClick={() => onPatch('followerTier', t)}
                           className={`rounded-full border px-3 py-1 text-ui ${on ? 'border-x-blue bg-x-blue/10 font-semibold text-x-blue-text' : 'border-x-border-strong text-x-secondary hover:bg-x-hover'}`}>{t}</button>;
          })}
        </div>,
        { after: <small className="text-caption text-x-muted">팔로워 수를 보고 직접 골라 주세요.</small> })}
    </div>
  );
}

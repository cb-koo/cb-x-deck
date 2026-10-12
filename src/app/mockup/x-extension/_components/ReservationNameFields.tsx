'use client';
import { useState } from 'react';
import { formatReservationName, splitReservationName, type ReservationNameParts } from '../sheet';
import { Field } from './shared';

export function ReservationNameFields({
  value,
  onChange,
}: {
  value: string;
  onChange: (name: string) => void;
}) {
  const [draft, setDraft] = useState(() => ({ source: value, parts: splitReservationName(value) }));
  // Full-sheet edits can replace the name. Local input state preserves spaces
  // while typing either part, even though the combined saved value is trimmed.
  if (draft.source !== value) setDraft({ source: value, parts: splitReservationName(value) });

  function change(part: keyof ReservationNameParts, value: string) {
    const parts = { ...draft.parts, [part]: value };
    const source = formatReservationName(parts);
    setDraft({ source, parts });
    onChange(source);
  }

  return (
    <>
      <Field label="이름(한글)">
        <input value={draft.parts.korean} onChange={(e) => change('korean', e.target.value)} />
      </Field>
      <Field label="이름(로마자)">
        <input value={draft.parts.roman} onChange={(e) => change('roman', e.target.value)} />
      </Field>
    </>
  );
}

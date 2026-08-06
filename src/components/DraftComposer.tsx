'use client';
import { useState } from 'react';
import { Button } from '@/components/ui';
import type { ClientRow, ProcedureRow } from '@/lib/clientStore';
import type { ReferenceRow } from '@/lib/referenceStore';
import type { DraftFormat, ReferenceMode } from '@/lib/draftTypes';

export interface ComposerState {
  clientId: string | null; procedureIds: string[];
  format: DraftFormat; mode: ReferenceMode; constraintsOn: boolean; direction: string;
}
export const DEFAULT_COMPOSER: ComposerState = {
  clientId: null, procedureIds: [], format: 'single', mode: 'both', constraintsOn: false, direction: '',
};
const MODE_LABEL: Record<ReferenceMode, string> = { off: '참고 안 함', form: '형식만', angle: '앵글만', both: '형식+앵글' };
// CONTENT_MODEL 변경 시 함께 갱신 (스펙 3-6 — sonnet 실측 ≈$0.015의 보수적 반올림)
const COST_CAPTION = '생성 1회 ≈ $0.02';

// 작업대 상단 — 노출 컨트롤 4개(방향성·바꾸기·원고 만들기·레퍼런스 추가), 나머지는 접힌 요약 (스펙 §4)
export function DraftComposer({ clients, value, onChange, refRows, onOpenPicker, onRemoveRef, generating, onGenerate, onCancel }: {
  clients: Array<{ client: ClientRow; procedures: ProcedureRow[] }>;
  value: ComposerState; onChange: (v: ComposerState) => void;
  refRows: ReferenceRow[]; onOpenPicker: () => void; onRemoveRef: (tweetId: string) => void;
  generating: boolean; onGenerate: () => void; onCancel: () => void;
}) {
  const [open, setOpen] = useState(false);
  const cur = clients.find((c) => c.client.id === value.clientId) ?? null;
  const canGenerate = !!value.clientId || (refRows.length > 0 && value.mode !== 'off') || value.direction.trim().length > 0;

  const summary = [
    cur ? cur.client.name : '클라이언트 없음',
    ...(cur ? cur.procedures.filter((p) => value.procedureIds.includes(p.id)).map((p) => p.name) : []),
    value.format === 'single' ? '단문' : '스레드',
    `참고: ${refRows.length > 0 ? MODE_LABEL[value.mode] : '없음'}`,
    value.constraintsOn ? '생성 제약 켬' : null,
  ].filter(Boolean).join(' · ');

  return (
    <div className="w-full max-w-[600px] rounded-2xl border border-x-border-strong bg-white">
      {/* 진입 컨텍스트 — 레퍼런스 연결 상태 */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-x-border bg-x-surface px-4 py-2 text-[13px] text-x-secondary">
        {refRows.length > 0 ? (
          <>
            <span>레퍼런스 {refRows.length}건 연결됨</span>
            {refRows.map((r) => (
              <span key={r.tweetId} className="flex items-center gap-1 rounded-full border border-x-border-strong bg-white px-2 py-0.5 text-caption">
                @{r.authorHandle}
                <button onClick={() => onRemoveRef(r.tweetId)} aria-label={`@${r.authorHandle} 레퍼런스 빼기`} className="text-x-muted hover:text-red-500">✕</button>
              </span>
            ))}
          </>
        ) : (
          <span>레퍼런스 없이 시작 — 보관함의 좋았던 포스트를 참고하면 원고가 더 좋아져요</span>
        )}
        <button onClick={onOpenPicker} className="ml-auto shrink-0 text-x-blue-text hover:underline">
          {refRows.length > 0 ? '+ 레퍼런스 추가' : '보관함에서 고르기'}
        </button>
      </div>

      <div className="px-4 py-3">
        <label className="block">
          <span className="text-[13px] text-x-secondary">이번 초안은 어떤 방향으로 만들까요? (비워도 돼요 — 레퍼런스나 클라이언트 정보만으로도 만들 수 있어요)</span>
          <textarea value={value.direction} onChange={(e) => onChange({ ...value, direction: e.target.value })}
                    rows={2} placeholder="예: 여름 전 시술을 고민하는 20대에게, 다운타임이 짧다는 점을 강조"
                    className="mt-1 w-full rounded-lg border border-x-border-strong p-2.5 text-[15px] leading-normal outline-none focus:border-x-blue" />
        </label>

        <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px]">
          <span className="text-x-secondary">{summary}</span>
          <button onClick={() => setOpen(!open)} className="text-x-blue-text hover:underline">{open ? '접기' : '바꾸기'}</button>
          <span className="ml-auto" />
          {generating ? (
            <Button onClick={onCancel}>취소</Button>
          ) : (
            <button onClick={onGenerate} disabled={!canGenerate}
                    className="h-9 rounded-full bg-x-blue px-[17px] text-[15px] font-bold text-white hover:bg-x-blue-hover disabled:opacity-50">
              원고 만들기
            </button>
          )}
        </div>
        {!generating && (
          <p className="mt-1 text-caption text-x-muted">
            {canGenerate ? COST_CAPTION : '클라이언트·레퍼런스·방향성 중 하나는 있어야 원고를 만들 수 있어요'}
          </p>
        )}

        {open && (
          <div className="mt-3 space-y-3 rounded-lg bg-x-surface p-3 text-ui">
            <label className="flex items-center gap-2">
              <span className="w-20 shrink-0 text-caption text-x-muted">클라이언트</span>
              <select value={value.clientId ?? ''} className="rounded-md border border-x-border-strong bg-white px-2 py-1 outline-none focus:border-x-blue"
                      onChange={(e) => onChange({ ...value, clientId: e.target.value || null, procedureIds: [] })}>
                <option value="">반영 안 함</option>
                {clients.map(({ client }) => <option key={client.id} value={client.id}>{client.name}</option>)}
              </select>
              {clients.length === 0 && <a href="/clients" className="text-caption text-x-blue-text hover:underline">클라이언트를 먼저 등록하세요 →</a>}
            </label>
            {cur && cur.procedures.length > 0 && (
              <div className="flex items-start gap-2">
                <span className="w-20 shrink-0 pt-0.5 text-caption text-x-muted">시술</span>
                <span className="flex flex-wrap gap-1.5">
                  {cur.procedures.map((p) => {
                    const on = value.procedureIds.includes(p.id);
                    return (
                      <button key={p.id}
                              onClick={() => onChange({ ...value, procedureIds: on ? value.procedureIds.filter((x) => x !== p.id) : [...value.procedureIds, p.id] })}
                              className={`rounded-full border px-2.5 py-0.5 text-caption ${on ? 'border-x-blue bg-x-blue/10 text-x-blue-text' : 'border-x-border-strong text-x-muted'}`}>
                        {p.name}
                      </button>
                    );
                  })}
                </span>
              </div>
            )}
            <div className="flex items-center gap-2">
              <span className="w-20 shrink-0 text-caption text-x-muted">형식</span>
              {(['single', 'thread'] as const).map((f) => (
                <button key={f} onClick={() => onChange({ ...value, format: f })}
                        className={`rounded-full border px-3 py-0.5 ${value.format === f ? 'border-x-blue bg-x-blue text-white' : 'border-x-border-strong text-x-secondary'}`}>
                  {f === 'single' ? '단문 (트윗 1개, X 기준 280 이내)' : '스레드 (트윗 3~5개)'}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <span className="w-20 shrink-0 text-caption text-x-muted">참고 방식</span>
              {(['form', 'angle', 'both'] as const).map((m) => (
                <button key={m} onClick={() => onChange({ ...value, mode: m })}
                        className={`rounded-full border px-3 py-0.5 ${value.mode === m ? 'border-x-blue bg-x-blue text-white' : 'border-x-border-strong text-x-secondary'}`}>
                  {MODE_LABEL[m]}
                </button>
              ))}
              <span className="text-caption text-x-muted">— 레퍼런스에서 무엇을 가져올지</span>
            </div>
            <label className="flex items-center gap-2">
              <span className="w-20 shrink-0 text-caption text-x-muted">생성 제약</span>
              <input type="checkbox" checked={value.constraintsOn}
                     onChange={(e) => onChange({ ...value, constraintsOn: e.target.checked })} />
              <span className="text-caption text-x-secondary">금지 표현을 생성 단계부터 피하기 — 끄면 자유롭게 만들고, 검수 표식은 항상 표시돼요</span>
            </label>
          </div>
        )}
      </div>
    </div>
  );
}

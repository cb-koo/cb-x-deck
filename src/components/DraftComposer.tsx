'use client';
import { useState } from 'react';
import { Button } from '@/components/ui';
import type { ClientRow, ProcedureRow } from '@/lib/clientStore';
import type { ReferenceRow } from '@/lib/referenceStore';
import type { DraftFormat, ReferenceMode } from '@/lib/draftTypes';

export interface ComposerState {
  clientId: string | null; procedureIds: string[];
  format: DraftFormat; mode: ReferenceMode; constraintsOn: boolean; direction: string;
  count: number; // 시안 수 (1~5) — 저장하지 않고 생성 후 1로 리셋 (스펙 §1, 비용 opt-in)
}
export const DEFAULT_COMPOSER: ComposerState = {
  clientId: null, procedureIds: [], format: 'single', mode: 'both', constraintsOn: false, direction: '',
  count: 1,
};
const MODE_LABEL: Record<ReferenceMode, string> = { off: '참고 안 함', form: '형식만', angle: '앵글만', both: '형식+앵글' };
// CONTENT_MODEL 변경 시 함께 갱신 (스펙 3-6 — sonnet 실측 ≈$0.015의 보수적 반올림)
const COST_CAPTION = '생성 1회 ≈ $0.02';

// 클라이언트·레퍼런스·방향성 중 하나는 있어야 생성 가능 — 섹션부/풋터가 같은 판정을 쓴다
export function canGenerate(value: ComposerState, refCount: number): boolean {
  return !!value.clientId || (refCount > 0 && value.mode !== 'off') || value.direction.trim().length > 0;
}

// 섹션 래퍼 — 카드 섹션 관례(테두리 + 제목 헤더, /prompt 선례)
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-x-border bg-white">
      <h3 className="border-b border-x-border px-3 py-1.5 text-caption font-bold text-x-secondary">{title}</h3>
      <div className="space-y-2.5 p-3 text-ui">{children}</div>
    </section>
  );
}

// 좌 생성 패널의 섹션부 — 조건은 항상 펼침, '생성 제약'만 고급 옵션으로 접힘 (스펙 B-2)
export function DraftComposer({ clients, value, onChange, refRows, onOpenPicker, onRemoveRef, onClearRefs }: {
  clients: Array<{ client: ClientRow; procedures: ProcedureRow[] }>;
  value: ComposerState; onChange: (v: ComposerState) => void;
  refRows: ReferenceRow[]; onOpenPicker: () => void; onRemoveRef: (tweetId: string) => void; onClearRefs: () => void;
}) {
  const [advOpen, setAdvOpen] = useState(false);
  const cur = clients.find((c) => c.client.id === value.clientId) ?? null;
  const hasRefs = refRows.length > 0;

  return (
    <div className="space-y-3">
      <Section title="생성 조건">
        <label className="block">
          <span className="text-caption text-x-muted">클라이언트</span>
          <div className="mt-1 flex items-center gap-2">
            <select value={value.clientId ?? ''}
                    className="w-full rounded-md border border-x-border-strong bg-white px-2 py-1 outline-none focus:border-x-blue"
                    onChange={(e) => onChange({ ...value, clientId: e.target.value || null, procedureIds: [] })}>
              <option value="">반영 안 함</option>
              {clients.map(({ client }) => <option key={client.id} value={client.id}>{client.name}</option>)}
            </select>
          </div>
          {clients.length === 0 && <a href="/clients" className="text-caption text-x-blue-text hover:underline">클라이언트를 먼저 등록하세요 →</a>}
        </label>
        {cur && cur.procedures.length > 0 && (
          <div>
            <span className="text-caption text-x-muted">시술</span>
            <div className="mt-1 flex flex-wrap gap-1.5">
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
            </div>
          </div>
        )}
        <div>
          <span className="text-caption text-x-muted">형식</span>
          <div className="mt-1 flex gap-2">
            {(['single', 'thread'] as const).map((f) => (
              <button key={f} onClick={() => onChange({ ...value, format: f })}
                      className={`rounded-full border px-3 py-0.5 ${value.format === f ? 'border-x-blue bg-x-blue text-white' : 'border-x-border-strong text-x-secondary'}`}>
                {f === 'single' ? '단문' : '스레드'}
              </button>
            ))}
          </div>
          <p className="mt-1 text-caption text-x-muted">단문 = 트윗 1개(X 기준 280 이내) · 스레드 = 트윗 3~5개</p>
        </div>
        <div>
          <span className="text-caption text-x-muted">참고 방식 — 레퍼런스에서 무엇을 가져올지</span>
          <div className="mt-1 flex gap-2">
            {(['form', 'angle', 'both'] as const).map((m) => (
              <button key={m} disabled={!hasRefs} onClick={() => onChange({ ...value, mode: m })}
                      className={`rounded-full border px-3 py-0.5 ${hasRefs && value.mode === m ? 'border-x-blue bg-x-blue text-white' : 'border-x-border-strong text-x-secondary'} disabled:opacity-40`}>
                {MODE_LABEL[m]}
              </button>
            ))}
          </div>
          {!hasRefs && <p className="mt-1 text-caption text-x-muted">레퍼런스를 연결하면 선택할 수 있어요</p>}
        </div>
        <label className="block">
          <span className="text-caption text-x-muted">시안 수</span>
          <div className="mt-1 flex items-center gap-2">
            <input type="number" min={1} max={5} value={value.count}
                   onChange={(e) => onChange({ ...value, count: Math.min(5, Math.max(1, Math.trunc(Number(e.target.value) || 1))) })}
                   className="w-16 rounded-md border border-x-border-strong bg-white px-2 py-1 outline-none focus:border-x-blue" />
            <span className="text-caption text-x-secondary">서로 다른 앵글로 여러 개 만들어 하나 이상 골라요 — 개수만큼 비용·시간이 늘어요</span>
          </div>
        </label>
      </Section>

      <Section title="레퍼런스">
        {hasRefs ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {refRows.map((r) => (
              <span key={r.tweetId} className="flex items-center gap-1 rounded-full border border-x-border-strong bg-white px-2 py-0.5 text-caption">
                @{r.authorHandle}
                <button onClick={() => onRemoveRef(r.tweetId)} aria-label={`@${r.authorHandle} 레퍼런스 빼기`} className="text-x-muted hover:text-red-500">✕</button>
              </span>
            ))}
            {refRows.length >= 2 && (
              <button onClick={onClearRefs} className="shrink-0 text-caption text-x-muted hover:text-red-500 hover:underline">모두 빼기</button>
            )}
          </div>
        ) : (
          <p className="text-caption text-x-secondary">레퍼런스 없이 시작 — 보관함의 좋았던 포스트를 참고하면 원고가 더 좋아져요</p>
        )}
        <button onClick={onOpenPicker} className="text-caption text-x-blue-text hover:underline">
          {hasRefs ? '+ 레퍼런스 추가' : '보관함에서 고르기'}
        </button>
      </Section>

      <Section title="방향성">
        <label className="block">
          <span className="text-caption text-x-muted">이번 초안은 어떤 방향으로 만들까요? (비워도 돼요 — 레퍼런스나 클라이언트 정보만으로도 만들 수 있어요)</span>
          <textarea value={value.direction} onChange={(e) => onChange({ ...value, direction: e.target.value })}
                    rows={3} placeholder="예: 여름 전 시술을 고민하는 20대에게, 다운타임이 짧다는 점을 강조"
                    className="mt-1 w-full rounded-lg border border-x-border-strong p-2.5 text-[15px] leading-normal outline-none focus:border-x-blue" />
        </label>
      </Section>

      <div>
        <button onClick={() => setAdvOpen(!advOpen)} className="text-caption text-x-blue-text hover:underline">
          {advOpen ? '▾ 고급 옵션 접기' : '▸ 고급 옵션'}
        </button>
        {advOpen && (
          <label className="mt-2 flex items-start gap-2 rounded-lg bg-x-surface p-3">
            <input type="checkbox" checked={value.constraintsOn}
                   onChange={(e) => onChange({ ...value, constraintsOn: e.target.checked })} />
            <span className="text-caption text-x-secondary">
              <b className="text-x-text">생성 제약</b> — 금지 표현을 생성 단계부터 피하기. 끄면 자유롭게 만들고, 검수 표식은 항상 표시돼요
            </span>
          </label>
        )}
      </div>
    </div>
  );
}

// 좌 패널 하단 고정부 — 무엇으로 생성되는지(파생 요약)와 비용을 버튼 옆에 (원칙 2·4·6)
export function ComposerFooter({ clients, value, refRows, generating, onGenerate, onCancel }: {
  clients: Array<{ client: ClientRow; procedures: ProcedureRow[] }>;
  value: ComposerState; refRows: ReferenceRow[];
  generating: boolean; onGenerate: () => void; onCancel: () => void;
}) {
  const cur = clients.find((c) => c.client.id === value.clientId) ?? null;
  const ok = canGenerate(value, refRows.length);
  const summary = [
    cur ? cur.client.name : '클라이언트 없음',
    ...(cur ? cur.procedures.filter((p) => value.procedureIds.includes(p.id)).map((p) => p.name) : []),
    value.format === 'single' ? '단문' : '스레드',
    refRows.length > 0 ? `참고: ${MODE_LABEL[value.mode]}` : null,
    value.count > 1 ? `시안 ${value.count}개` : null,
    value.constraintsOn ? '생성 제약 켬' : null,
  ].filter(Boolean).join(' · ');

  return (
    <div className="border-t border-x-border bg-x-surface px-4 py-3">
      {ok ? (
        <>
          <p className="text-caption text-x-secondary">{summary}</p>
          <p className="mt-0.5 text-caption text-x-muted">
            {COST_CAPTION}{value.count > 1 ? ` × ${value.count}` : ''} · 15~30초
            {clients.length > 0 && !value.clientId ? ' · 클라이언트 정보 없이 만들어요 — 위 생성 조건에서 선택할 수 있어요' : ''}
          </p>
        </>
      ) : (
        <p className="text-caption text-x-muted">클라이언트·레퍼런스·방향성 중 하나는 있어야 원고를 만들 수 있어요</p>
      )}
      {generating ? (
        <Button onClick={onCancel} className="mt-2 w-full">취소</Button>
      ) : (
        <button onClick={onGenerate} disabled={!ok}
                className="mt-2 h-9 w-full rounded-full bg-x-blue px-[17px] text-[15px] font-bold text-white hover:bg-x-blue-hover disabled:opacity-50">
          원고 만들기
        </button>
      )}
    </div>
  );
}

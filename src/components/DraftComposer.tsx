'use client';
import { Button } from '@/components/ui';
import { InfoTip } from '@/components/InfoTip';
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

// 섹션 래퍼 — 카드 섹션 관례(테두리 + 제목 헤더, /prompt 선례).
// 제목을 11px→13px로 올렸다: 이전엔 제목·라벨·설명·버튼이 전부 11px이라 층위가 없어
// "빽빽하다"는 피드백을 받았다. 대비는 다 키워서가 아니라 '차이'에서 생긴다.
function Section({ title, right, children }: {
  title: string; right?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-x-border-strong bg-white">
      <div className="flex items-center gap-1.5 border-b border-x-border bg-x-surface/60 px-3 py-2">
        <h3 className="text-ui font-bold text-x-text">{title}</h3>
        {right}
      </div>
      <div className="space-y-3.5 p-3.5">{children}</div>
    </section>
  );
}

// ⓘ — 이름만으로 알 수 없는 것에만 붙인다. 서술형 설명을 패널 본문에 늘어놓지 않기 위한 장치.
function Label({ children, info }: { children: React.ReactNode; info?: string }) {
  return (
    <span className="flex items-center gap-1 text-ui font-medium text-x-text">
      {children}{info && <InfoTip text={info} label={`${typeof children === 'string' ? children : ''} 설명 보기`.trim()} />}
    </span>
  );
}

// '선택 사항'을 문장이 아니라 한 단어로 — "비워도 돼요 — 레퍼런스나 클라이언트 정보만으로도…" 같은
// 안내문이 섹션마다 붙어 있던 것을 대체한다.
const Optional = () => <span className="text-caption text-x-muted">선택</span>;

// 실제로 프롬프트에 실리는 금지어 수 — 클라이언트 것 + '선택한' 시술 것.
// generate.ts가 procedureIds로 시술을 거르므로 같은 집합을 세야 표시와 동작이 일치한다.
// 섹션부(잠금·개수 표시)와 풋터(요약)가 같은 판정을 써야 해서 함수로 뽑았다 — canGenerate와 같은 이유.
function bannedPhraseCount(
  cur: { client: ClientRow; procedures: ProcedureRow[] } | null, procedureIds: string[],
): number {
  if (!cur) return 0;
  return cur.client.bannedPhrases.length
    + cur.procedures.filter((p) => procedureIds.includes(p.id))
        .reduce((n, p) => n + p.bannedPhrases.length, 0);
}

// 🔗 진입점 — 빈 상태·선택 후 두 자리에 같은 모습으로 나온다. 마크업을 한 곳에 두어 톤 수정이 한쪽만 반영되는 일을 막는다.
function AddLinkButton({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick}
            className="flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-x-border-strong bg-white text-ui text-x-blue-text hover:bg-x-hover">
      🔗 링크로 추가
    </button>
  );
}

// 좌 생성 패널의 섹션부 — 사용 흐름 순: 누구 것인지 → 무엇을 참고할지 → 무엇을 말할지 → 어떤 모양·몇 개로.
// 서술형 설명은 두지 않는다: 이름만으로 알 수 있으면 이름만, 알 수 없으면 ⓘ, 선택 사항은 '선택' 한 단어.
// (이전엔 설명 문장 9개가 전부 11px로 깔려 있어 "투머치"·"빽빽하다"는 피드백을 받았다.)
export function DraftComposer({ clients, value, onChange, refRows, onOpenPicker, onOpenAddLink, onPreviewRef, onRemoveRef, onClearRefs }: {
  clients: Array<{ client: ClientRow; procedures: ProcedureRow[] }>;
  value: ComposerState; onChange: (v: ComposerState) => void;
  refRows: ReferenceRow[]; onOpenPicker: () => void; onOpenAddLink: () => void;
  onPreviewRef: (tweetId: string) => void;
  onRemoveRef: (tweetId: string) => void; onClearRefs: () => void;
}) {
  const cur = clients.find((c) => c.client.id === value.clientId) ?? null;
  const hasRefs = refRows.length > 0;
  const bannedCount = bannedPhraseCount(cur, value.procedureIds);

  return (
    <div className="space-y-4">
      <Section title="클라이언트 정보">
        <label className="block">
          <Label>클라이언트</Label>
          <select value={value.clientId ?? ''}
                  className="mt-1.5 h-9 w-full rounded-lg border border-x-border-strong bg-white px-2.5 text-ui outline-none focus:border-x-blue"
                  onChange={(e) => onChange({ ...value, clientId: e.target.value || null, procedureIds: [] })}>
            <option value="">반영 안 함</option>
            {clients.map(({ client }) => <option key={client.id} value={client.id}>{client.name}</option>)}
          </select>
        </label>
        {cur && cur.procedures.length > 0 && (
          <div>
            <Label>시술</Label>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {cur.procedures.map((p) => {
                const on = value.procedureIds.includes(p.id);
                return (
                  <button key={p.id}
                          onClick={() => onChange({ ...value, procedureIds: on ? value.procedureIds.filter((x) => x !== p.id) : [...value.procedureIds, p.id] })}
                          className={`inline-flex h-7 items-center rounded-full border px-3 text-ui ${on ? 'border-x-blue bg-x-blue/10 font-medium text-x-blue-text' : 'border-x-border-strong text-x-secondary hover:bg-x-hover'}`}>
                    {p.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </Section>

      <Section title="참고할 레퍼런스" right={<Optional />}>
        {hasRefs ? (
          <>
            <div className="flex flex-wrap items-center gap-1.5">
              {refRows.map((r) => (
                <span key={r.tweetId} className="inline-flex h-7 items-center gap-1 rounded-full border border-x-border-strong bg-white px-2.5 text-ui">
                  {/* 본문 클릭=미리보기, ✕=빼기 — 링크+닫기 조합이라 타깃 둘이어도 관례적(스펙 §C) */}
                  <button onClick={() => onPreviewRef(r.tweetId)} title="클릭해서 내용 보기" className="hover:underline">
                    @{r.authorHandle}
                  </button>
                  <button onClick={() => onRemoveRef(r.tweetId)} aria-label={`@${r.authorHandle} 레퍼런스 빼기`} className="text-x-muted hover:text-red-500">✕</button>
                </span>
              ))}
              {refRows.length >= 2 && (
                <button onClick={onClearRefs} className="shrink-0 text-caption text-x-muted hover:text-red-500 hover:underline">모두 빼기</button>
              )}
            </div>
            <button onClick={onOpenPicker}
                    className="flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-x-border-strong bg-white text-ui text-x-blue-text hover:bg-x-hover">
              ＋ 레퍼런스 더 고르기
            </button>
            {/* 시트 안에만 있던 링크 추가를 패널로도 — X에서 방금 본 트윗을 시트를 거치지 않고 바로 (스펙 §A) */}
            <AddLinkButton onClick={onOpenAddLink} />
            {/* 참고 방식은 레퍼런스가 있을 때만 나타난다 — 예전엔 레퍼런스보다 '위'에서 비활성으로 먼저 보였다.
                못 누르는 버튼을 먼저 보여주고 그걸 켜는 스위치를 아래에 두는 구조였다. */}
            <div className="border-t border-x-border pt-3">
              <Label info="형식 = 문장 구조·길이. 앵글 = 소재를 다루는 접근 관점. 둘을 함께 고르면 구조와 관점을 모두 참고합니다.">
                이 레퍼런스에서 무엇을 가져올까요
              </Label>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {(['form', 'angle', 'both'] as const).map((m) => (
                  <button key={m} onClick={() => onChange({ ...value, mode: m })}
                          className={`inline-flex h-7 items-center rounded-full border px-2.5 text-ui ${value.mode === m ? 'border-x-blue bg-x-blue font-medium text-white' : 'border-x-border-strong text-x-secondary hover:bg-x-hover'}`}>
                    {MODE_LABEL[m]}
                  </button>
                ))}
              </div>
            </div>
          </>
        ) : (
          // 텍스트 링크였던 것을 실제 버튼으로 — 레퍼런스 기반 생성이 이 도구의 차별점인데
          // 진입점이 11px 파란 밑줄이라 각주처럼 보였다.
          <>
            <button onClick={onOpenPicker}
                    className="flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-x-blue bg-x-blue/5 text-ui font-bold text-x-blue-text hover:bg-x-blue/10">
              <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] fill-current" aria-hidden><path d="M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z" /></svg>
              보관함에서 고르기
            </button>
            {/* 보조 진입점 — 주 진입점(보관함)보다 낮은 위계의 흰 배경. 도움말은 모달 안에 이미 있다(스펙 §A) */}
            <AddLinkButton onClick={onOpenAddLink} />
          </>
        )}
      </Section>

      <Section title="이번 원고의 방향" right={<Optional />}>
        <textarea value={value.direction} onChange={(e) => onChange({ ...value, direction: e.target.value })}
                  rows={3} aria-label="이번 원고의 방향"
                  placeholder="예: 여름 전 시술을 고민하는 20대에게, 다운타임이 짧다는 점을 강조"
                  className="w-full rounded-lg border border-x-border-strong p-2.5 text-[15px] leading-normal outline-none focus:border-x-blue" />
      </Section>

      <Section title="형식과 개수">
        <div>
          <Label info="단문 = 트윗 1개(X 기준 280자 이내). 스레드 = 이어지는 트윗 3~5개.">형식</Label>
          <div className="mt-1.5 flex gap-1.5">
            {(['single', 'thread'] as const).map((f) => (
              <button key={f} onClick={() => onChange({ ...value, format: f })}
                      className={`inline-flex h-8 flex-1 items-center justify-center rounded-lg border text-ui ${value.format === f ? 'border-x-blue bg-x-blue font-bold text-white' : 'border-x-border-strong bg-white text-x-secondary hover:bg-x-hover'}`}>
                {f === 'single' ? '단문' : '스레드'}
              </button>
            ))}
          </div>
        </div>
        <label className="flex items-center justify-between gap-2 border-t border-x-border pt-3">
          <Label info="같은 조건으로 서로 다른 앵글의 원고를 여러 개 만들어 그중 하나를 고릅니다. 개수만큼 비용과 시간이 늘어납니다.">시안 수</Label>
          <span className="flex items-center gap-1.5">
            <input type="number" min={1} max={5} value={value.count}
                   onChange={(e) => onChange({ ...value, count: Math.min(5, Math.max(1, Math.trunc(Number(e.target.value) || 1))) })}
                   className="h-9 w-14 rounded-lg border border-x-border-strong bg-white px-2 text-center text-ui outline-none focus:border-x-blue" />
            <span className="text-ui text-x-secondary">개</span>
          </span>
        </label>
        {/* 금지어가 0개면 프롬프트에 아무것도 안 실린다(generatePrompt의 banned.length 가드) —
            켜도 아무 일이 없는데 켤 수 있게 두면 지켜지는 줄 알고 안심하게 되므로 잠근다. */}
        <label className={`flex items-center gap-2 border-t border-x-border pt-3 ${bannedCount === 0 ? 'opacity-60' : ''}`}>
          <input type="checkbox" checked={value.constraintsOn} disabled={bannedCount === 0}
                 onChange={(e) => onChange({ ...value, constraintsOn: e.target.checked })}
                 className="h-4 w-4 shrink-0" />
          <span className="flex flex-1 items-center gap-1 text-ui text-x-text">
            금지 표현 피하기
            <InfoTip label="금지 표현 피하기 설명 보기" text={bannedCount > 0
              ? '등록해둔 금지 표현을 AI에게 미리 알려줘 처음부터 쓰지 않게 합니다. 꺼도 완성된 원고에 금지 표현이 있으면 노란 밑줄로 표시됩니다.'
              : '이 클라이언트와 선택한 시술에 등록된 금지 표현이 없어 지금은 켜도 달라지는 것이 없습니다. 클라이언트 관리에서 추가할 수 있습니다.'} />
            <span className="ml-auto shrink-0 text-caption tabular-nums text-x-muted">
              {bannedCount > 0 ? `${bannedCount}개` : '없음'}
            </span>
          </span>
        </label>
      </Section>
    </div>
  );
}

// 좌 패널 하단 고정부 — 무엇으로 생성되는지(파생 요약)와 비용을 버튼 옆에 (원칙 2·4·6)
export function ComposerFooter({ clients, value, refRows, generating, onGenerate, onCancel, onWrite }: {
  clients: Array<{ client: ClientRow; procedures: ProcedureRow[] }>;
  value: ComposerState; refRows: ReferenceRow[];
  generating: boolean; onGenerate: () => void; onCancel: () => void;
  onWrite: () => void; // 직접 쓰기 — LLM 없는 두 번째 입구 (설계 §C)
}) {
  const cur = clients.find((c) => c.client.id === value.clientId) ?? null;
  const ok = canGenerate(value, refRows.length);
  const summary = [
    cur ? cur.client.name : '클라이언트 없음',
    ...(cur ? cur.procedures.filter((p) => value.procedureIds.includes(p.id)).map((p) => p.name) : []),
    value.format === 'single' ? '단문' : '스레드',
    refRows.length > 0 ? `참고: ${MODE_LABEL[value.mode]}` : null,
    value.count > 1 ? `시안 ${value.count}개` : null,
    // 금지어가 0개면 켜져 있어도 프롬프트에 실리는 게 없다 — 요약이 "피하는 중"이라고 말하면 거짓이 된다
    value.constraintsOn && bannedPhraseCount(cur, value.procedureIds) > 0 ? '금지 표현 피함' : null,
  ].filter(Boolean).join(' · ');

  return (
    <div className="border-t border-x-border bg-x-surface px-4 py-3">
      {ok ? (
        <>
          {/* 요약은 13px — 무엇으로 만들어지는지가 버튼 바로 위에서 읽혀야 하고, 비용·소요는 보조라 11px로 남긴다 */}
          <p className="text-ui text-x-secondary">{summary}</p>
          <p className="mt-0.5 text-caption text-x-muted">
            {COST_CAPTION}{value.count > 1 ? ` × ${value.count}` : ''} · 15~30초
            {clients.length > 0 && !value.clientId ? ' · 클라이언트 정보 없이 만들어요' : ''}
          </p>
        </>
      ) : (
        // 버튼이 안 눌리는 이유는 툴팁으로 숨기지 않는다 — 막힌 자리에서 바로 읽혀야 한다
        <p className="text-caption text-x-muted">클라이언트·레퍼런스·방향성 중 하나는 있어야 원고를 만들 수 있어요</p>
      )}
      {generating ? (
        <>
          <Button onClick={onCancel} className="mt-2 w-full">취소</Button>
          <p className="mt-1 text-caption text-x-muted">취소해도 완성되면 목록에 저장됩니다 — 생성 자체는 멈추지 않아요</p>
        </>
      ) : (
        <button onClick={onGenerate} disabled={!ok}
                className="mt-2.5 h-11 w-full rounded-full bg-x-blue px-[17px] text-[15px] font-bold text-white hover:bg-x-blue-hover disabled:opacity-50">
          원고 만들기
        </button>
      )}
      {/* 직접 쓰기 — canGenerate 게이트를 타지 않는다(백지 허용). generating 중에도 누를 수 있다:
          생성을 기다리는 동안 직접 쓰는 걸 막을 이유가 없다(설계 §C). 위 버튼과 같은 크기·다른 무게 —
          같은 결과물(초안 한 건)을 만드는 두 번째 길이지 부차적인 부속 동작이 아니다. */}
      <button onClick={onWrite}
              className="mt-2 h-11 w-full rounded-full border border-x-border-strong bg-white px-[17px] text-[15px] font-bold text-x-secondary hover:bg-x-hover">
        직접 쓰기
      </button>
    </div>
  );
}

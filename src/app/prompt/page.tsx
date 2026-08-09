'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import { Button } from '@/components/ui';
import { relTime } from '@/lib/relTime';
import {
  buildUserPrompt, draftSystem, PROMPT_DEFAULTS,
  type PromptFieldKey, type PromptInput, type PromptOverrides,
} from '@/lib/generatePrompt';

// 필드 메타 — 라벨은 사용자 언어, help는 "이 문장이 언제 들어가는지"
const FIELDS: Array<{ key: PromptFieldKey; label: string; help: string; rows: number }> = [
  { key: 'system', label: '역할 지시', help: 'AI가 어떤 사람으로서 쓰는지 — 원고 전체의 톤을 정해요. 모든 생성·다시 쓰기에 들어가요.', rows: 3 },
  { key: 'hook', label: '첫 문장(훅) 지시', help: '모든 생성에 들어가요 — 첫 단락을 어떻게 쓰라고 시킬지.', rows: 2 },
  { key: 'noCopy', label: '레퍼런스 베끼기 금지', help: '레퍼런스를 참고하는 생성에 항상 함께 들어가요.', rows: 2 },
  { key: 'modeForm', label: '레퍼런스 "형식만" 규칙', help: '생성 화면에서 참고 방식으로 "형식만"을 골랐을 때 들어가요.', rows: 2 },
  { key: 'modeAngle', label: '레퍼런스 "앵글만" 규칙', help: '참고 방식 "앵글만"일 때 들어가요.', rows: 2 },
  { key: 'modeBoth', label: '레퍼런스 "형식+앵글" 규칙', help: '참고 방식 "형식+앵글"일 때 들어가요.', rows: 2 },
];
const KEYS = FIELDS.map((f) => f.key);
const LABEL = Object.fromEntries(FIELDS.map((f) => [f.key, f.label])) as Record<PromptFieldKey, string>;

// 미리보기용 샘플 재료 — 실제 생성에선 그때 고른 클라이언트·레퍼런스·방향성이 이 자리에 들어간다
const SAMPLE: PromptInput = {
  client: { name: '(샘플) 가온피부과', info: '강남역 3번 출구 도보 2분. 피부과 전문의 2인 진료.',
            bannedPhrases: ['완치', '부작용 없음'] },
  procedures: [{ name: '보톡스', description: '이마·미간 주름 부위에 소량 주사.',
                 effectPhrases: '주름이 옅어 보이는 효과, 개인차 있음', bannedPhrases: ['주름 제거'] }],
  references: [{ tweetId: '0', handle: 'sample_account', name: null,
                 excerpt: '(샘플) 실제로는 보관함에서 고른 레퍼런스 원문이 들어가요',
                 memos: [{ member: '팀', text: '(샘플) 레퍼런스에 단 팀 메모가 참고 포인트로 들어가요' }] }],
  mode: 'both', direction: '(샘플) 여름 이벤트 안내', format: 'single', constraintsOn: true,
};

type VersionRow = { id: string; overrides: PromptOverrides; memberName: string | null; createdAt: string };
type Values = Record<PromptFieldKey, string>;
const toValues = (o: PromptOverrides): Values =>
  Object.fromEntries(KEYS.map((k) => [k, o[k] ?? PROMPT_DEFAULTS[k]])) as Values;

export default function PromptPage() {
  const [values, setValues] = useState<Values | null>(null); // null = 로딩 전
  const [loadErr, setLoadErr] = useState(false);
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState('');
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (savedTimer.current) clearTimeout(savedTimer.current); }, []);

  const load = useCallback(async () => {
    try {
      const r = await apiFetch('/api/prompt-settings');
      if (!r.ok) throw new Error(String(r.status));
      const data = (await r.json()) as { overrides: PromptOverrides; versions: VersionRow[] };
      setValues(toValues(data.overrides));
      setVersions(data.versions);
      setLoadErr(false);
    } catch { setLoadErr(true); }
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- 마운트 시 1회 로드, setState는 전부 비동기 콜백(기존 코드베이스 관례)
  useEffect(() => { load(); }, [load]);

  // 편집 중 값 → diff 오버라이드 (저장·미리보기가 같은 계산을 공유)
  const overrides = useMemo<PromptOverrides>(() => {
    if (!values) return {};
    const out: PromptOverrides = {};
    for (const k of KEYS) { const t = values[k].trim(); if (t && t !== PROMPT_DEFAULTS[k]) out[k] = t; }
    return out;
  }, [values]);
  const [previewMode, setPreviewMode] = useState<'form' | 'angle' | 'both'>('both');
  const preview = useMemo(
    () => (values ? buildUserPrompt({ ...SAMPLE, mode: previewMode }, overrides) : ''),
    [values, overrides, previewMode],
  );
  const previewSystem = draftSystem(overrides);

  async function save() {
    if (!values || saving) return;
    setSaving(true);
    try {
      const r = await apiFetch('/api/prompt-settings', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ overrides: Object.fromEntries(KEYS.map((k) => [k, values[k]])) }),
      });
      if (!r.ok) { setErr(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `오류 ${r.status}`); return; }
      setErr(''); setSaved(true);
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSaved(false), 2500);
      await load(); // 이력 갱신
    } finally { setSaving(false); }
  }

  return (
    <main className="mx-auto max-w-[720px] px-6 py-8">
      <h1 className="text-[20px] font-bold">AI 지시문</h1>
      <p className="mt-1 text-ui text-x-secondary">
        원고를 만들 때 AI에게 주는 지시문이에요. 여기서 바꾸면 팀 전체의 이후 생성에 바로 적용돼요.
        비워두면 그 문장은 기본값으로 동작해요.
      </p>

      {!values && !loadErr && <p className="py-8 text-center text-ui text-x-muted">불러오는 중…</p>}
      {loadErr && (
        <div className="py-8 text-center">
          <p className="mb-2 text-ui text-x-secondary">지시문을 불러오지 못했습니다</p>
          <Button onClick={load}>다시 시도</Button>
        </div>
      )}

      {values && (
        <>
          <div className="mt-5 space-y-4">
            {FIELDS.map((f) => (
              <div key={f.key}>
                <div className="flex items-baseline justify-between">
                  <label htmlFor={`pf-${f.key}`} className="text-ui font-bold">{f.label}</label>
                  {values[f.key].trim() !== PROMPT_DEFAULTS[f.key] && (
                    <button onClick={() => { setValues({ ...values, [f.key]: PROMPT_DEFAULTS[f.key] }); setSaved(false); }}
                            className="text-caption text-x-blue-text hover:underline">기본값 복원</button>
                  )}
                </div>
                <p className="text-caption text-x-muted">{f.help}</p>
                <textarea id={`pf-${f.key}`} value={values[f.key]} rows={f.rows}
                          onChange={(e) => { setValues({ ...values, [f.key]: e.target.value }); setSaved(false); }}
                          className="mt-1 w-full rounded-md border border-x-border-strong p-2 text-ui leading-normal outline-none focus:border-x-blue" />
              </div>
            ))}
          </div>
          {err && <p className="mt-3 text-ui text-red-500">{err}</p>}
          <div className="mt-4 flex items-center gap-2.5">
            <Button variant="primary" onClick={save} disabled={saving}>{saving ? '저장 중…' : '저장'}</Button>
            {saved && <span className="text-ui font-medium text-x-green">저장됨 ✓ — 다음 생성부터 적용돼요</span>}
          </div>

          <div className="mt-8">
            <h2 className="text-content font-bold">AI에게 전달되는 모습 (샘플)</h2>
            <p className="text-caption text-x-muted">
              지금 편집 중인 문장이 들어간 실제 전달 형태예요. 실제 생성에선 (샘플) 자리에 그때 고른
              클라이언트·시술·레퍼런스·방향성이 들어가요. 고른 방식의 규칙 문장이 본문 미리보기에 들어가요.
            </p>
            <div className="mt-2 flex items-center gap-1.5 text-caption text-x-muted">
              <span>샘플의 참고 방식:</span>
              {([
                ['form', '형식만'],
                ['angle', '앵글만'],
                ['both', '형식+앵글'],
              ] as const).map(([m, label]) => (
                <button key={m} onClick={() => setPreviewMode(m)}
                        className={`rounded-full border border-x-border px-2.5 py-0.5 text-caption ${
                          previewMode === m
                            ? 'bg-[#e3f1fb] text-x-blue-text'
                            : 'text-x-secondary hover:bg-x-hover'
                        }`}>
                  {label}
                </button>
              ))}
            </div>
            <p className="mt-2 text-caption font-bold text-x-muted">역할 지시 (시스템)</p>
            <pre className="mt-1 whitespace-pre-wrap rounded-lg bg-x-surface p-3 text-ui leading-normal">{previewSystem}</pre>
            <p className="mt-2 text-caption font-bold text-x-muted">본문</p>
            <pre className="mt-1 whitespace-pre-wrap rounded-lg bg-x-surface p-3 text-ui leading-normal">{preview}</pre>
          </div>

          {versions.length > 0 && (
            <details className="mt-8">
              <summary className="cursor-pointer text-content font-bold">변경 이력 ({versions.length})</summary>
              <div className="mt-2 space-y-2">
                {versions.map((v) => {
                  const keys = Object.keys(v.overrides) as PromptFieldKey[];
                  return (
                    <div key={v.id} className="flex items-baseline justify-between gap-3 rounded-lg border border-x-border px-3 py-2">
                      <div className="min-w-0">
                        <p className="text-ui">
                          {relTime(v.createdAt, '저장')}{v.memberName ? ` · ${v.memberName}` : ''}
                        </p>
                        <p className="truncate text-caption text-x-muted">
                          {keys.length > 0 ? `직접 쓴 문장: ${keys.map((k) => LABEL[k]).join(', ')}` : '전부 기본값'}
                        </p>
                      </div>
                      <Button className="shrink-0" onClick={() => { setValues(toValues(v.overrides)); setSaved(false); }}>
                        이 버전 불러오기
                      </Button>
                    </div>
                  );
                })}
              </div>
              <p className="mt-1 text-caption text-x-muted">불러온 버전은 저장을 눌러야 적용돼요.</p>
            </details>
          )}
        </>
      )}
    </main>
  );
}

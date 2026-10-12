'use client';
import { useState } from 'react';
import type { DemoData, QuickMessage } from '../model';
import { fillTemplate } from '../policy';
import { Badge, Button, CopyButton, Field, Notice, Section } from './shared';
export function MessageManager({
  data,
  onMessages,
  notify,
}: {
  data: DemoData;
  onMessages: (messages: QuickMessage[]) => void;
  notify: (s: string) => void;
}) {
  const [selected, setSelected] = useState(data.messages[0].id),
    [search, setSearch] = useState(''),
    [showArchived, setArchived] = useState(false);
  const visible = data.messages
    .filter(
      (m) =>
        (showArchived || m.active) && `${m.title} ${m.body}`.toLowerCase().includes(search.toLowerCase()),
    )
    .sort((a, b) => a.order - b.order);
  const message = data.messages.find((m) => m.id === selected);
  return (
    <div className="mock-management">
      <aside className="mock-management-list">
        <h2>팀 빠른 메시지</h2>
        <Field label="메시지 검색">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="제목·본문 검색" />
        </Field>
        <label className="mock-check">
          <input type="checkbox" checked={showArchived} onChange={(e) => setArchived(e.target.checked)} />
          사용 중지 포함
        </label>
        {visible.map((m) => (
          <button
            key={m.id}
            className={selected === m.id ? 'selected' : ''}
            onClick={() => setSelected(m.id)}
          >
            <b>{m.title}</b>
            <small>
              {m.language} · 순서 {m.order}
              {!m.active && ' · 사용 중지'}
            </small>
          </button>
        ))}
        {!visible.length && <p className="mock-empty-small">검색 결과가 없어요.</p>}
        <Button
          onClick={() => {
            const m: QuickMessage = {
              id: crypto.randomUUID(),
              title: '새 메시지',
              body: '{{handle}} 様\n',
              language: 'JA',
              order: data.messages.length + 1,
              active: true,
            };
            onMessages([...data.messages, m]);
            setSelected(m.id);
          }}
        >
          + 메시지 추가
        </Button>
      </aside>
      <div className="mock-management-body">
        <div className="mock-page-title">
          <div>
            <p className="mock-eyebrow">팀 공용 관리 · 제안 기능</p>
            <h2>빠른 메시지</h2>
          </div>
          <Badge>직접 전송 없음</Badge>
        </div>
        {message && (
          <MessageEditor
            key={message.id}
            message={message}
            data={data}
            onSave={(next) => {
              onMessages(data.messages.map((m) => (m.id === next.id ? next : m)));
              notify('빠른 메시지를 샘플에 저장했어요.');
            }}
          />
        )}
      </div>
    </div>
  );
}
function MessageEditor({
  message,
  data,
  onSave,
}: {
  message: QuickMessage;
  data: DemoData;
  onSave: (m: QuickMessage) => void;
}) {
  const [draft, setDraft] = useState(message),
    [personId, setPerson] = useState('hana'),
    [error, setError] = useState('');
  const person = data.people.find((p) => p.id === personId),
    preview = person ? fillTemplate(draft.body, { handle: `@${person.handle}` }) : draft.body;
  const patch = (p: Partial<QuickMessage>) => setDraft((d) => ({ ...d, ...p }));
  return (
    <>
      <div className="mock-grid two">
        <div className="mock-card">
          <Section title="메시지 편집">
            <Field label="메시지 제목">
              <input value={draft.title} onChange={(e) => patch({ title: e.target.value })} />
            </Field>
            <div className="mock-grid two">
              <Field label="메시지 언어">
                <select
                  value={draft.language}
                  onChange={(e) => patch({ language: e.target.value as QuickMessage['language'] })}
                >
                  <option>JA</option>
                  <option>KO</option>
                  <option>EN</option>
                </select>
              </Field>
              <Field label="메시지 표시 순서">
                <input
                  type="number"
                  min={1}
                  value={draft.order}
                  onChange={(e) => patch({ order: Number(e.target.value) })}
                />
              </Field>
            </div>
            <Field label="메시지 본문" hint="{{handle}}은 확인된 상대의 @핸들로 바뀌어요.">
              <textarea rows={10} value={draft.body} onChange={(e) => patch({ body: e.target.value })} />
            </Field>
            <label className="mock-check">
              <input
                type="checkbox"
                checked={draft.active}
                onChange={(e) => patch({ active: e.target.checked })}
              />
              사용
            </label>
            <p className="mock-muted">지도·고객 예약 양식은 클리닉 지점 설정에서 관리해요.</p>
          </Section>
        </div>
        <div className="mock-card">
          <Section title="현재 상대에게 보일 내용" aside={<Badge>{draft.language}</Badge>}>
            <Field label="미리보기 상대">
              <select value={personId} onChange={(e) => setPerson(e.target.value)}>
                {data.people.map((p) => (
                  <option value={p.id} key={p.id}>
                    @{p.handle}
                  </option>
                ))}
                <option value="unknown">상대 확인 안 됨</option>
              </select>
            </Field>
            <pre className="mock-message-preview">{preview}</pre>
            {person ? (
              <CopyButton text={preview} label="메시지 복사" />
            ) : (
              <Notice danger>상대가 확인되지 않아 핸들을 치환하거나 복사할 수 없어요.</Notice>
            )}
            <p className="mock-muted">언어와 줄바꿈을 그대로 유지해요. 복사 후 직접 보내 주세요.</p>
          </Section>
        </div>
      </div>
      <div className="mock-save-bar">
        {error && (
          <span role="alert" className="mock-danger-text">
            {error}
          </span>
        )}
        <Button
          variant="primary"
          onClick={() => {
            if (
              !draft.title.trim() ||
              !draft.body.trim() ||
              draft.order < 1 ||
              !Number.isInteger(draft.order)
            ) {
              setError('제목·본문과 1 이상의 표시 순서를 입력해 주세요.');
              return;
            }
            setError('');
            onSave(draft);
          }}
        >
          메시지 저장
        </Button>
      </div>
    </>
  );
}

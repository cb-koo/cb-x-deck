'use client';
import { useState } from 'react';
import { STATUS_LABEL } from '@/lib/draftStatus';
import type { AvailableDraft, DemoTask, TaskDraftContent } from '../model';
import { Button, Field, Modal, Section, type DisclosureControl } from './shared';

type Mode = 'generate' | 'write' | 'pick';
export function TaskDraft({
  task,
  locked,
  available,
  onSave,
  disclosure,
}: {
  task: DemoTask;
  locked: boolean;
  available: AvailableDraft[];
  onSave: (content?: TaskDraftContent, pickedId?: string) => void;
  disclosure?: DisclosureControl;
}) {
  const [mode, setMode] = useState<Mode | null>(null);
  const [title, setTitle] = useState(task.draft?.title ?? '');
  const [body, setBody] = useState(task.draft?.body ?? '');
  const [direction, setDirection] = useState('');
  const [search, setSearch] = useState('');
  const [discard, setDiscard] = useState(false);
  const dirty = title !== (task.draft?.title ?? '') || body !== (task.draft?.body ?? '');
  const results = available.filter((d) =>
    `${d.title} ${d.body}`.toLowerCase().includes(search.toLowerCase()),
  );
  function close() {
    if (dirty && !locked) setDiscard(true);
    else setMode(null);
  }
  function save() {
    if (locked || !title.trim() || !body.trim()) return;
    onSave({
      title: title.trim(),
      body: body.trim(),
      status: task.draft?.status ?? 'draft',
      createdOn: task.draft?.createdOn ?? new Date().toISOString(),
    });
    setMode(null);
  }
  return (
    <Section
      title="원고"
      id="task-draft"
      disclosure={disclosure}
      actionLabel={task.draft || locked ? '보기' : '원고 추가'}
      summary={
        task.draft ? (
          <span title={task.draft.title}>
            {task.draft.title} · {STATUS_LABEL[task.draft.status]}
          </span>
        ) : (
          '연결된 원고 없음'
        )
      }
    >
      {task.draft ? (
        <div className="mock-task-draft-row">
          <div>
            <strong>{task.draft.title}</strong>
            <small>{STATUS_LABEL[task.draft.status]}</small>
          </div>
          <Button
            onClick={() => {
              setTitle(task.draft!.title);
              setBody(task.draft!.body);
              setMode('write');
            }}
          >
            열기
          </Button>
          {!locked && (
            <Button
              variant="ghost"
              onClick={() => {
                onSave();
                setTitle('');
                setBody('');
              }}
            >
              떼기
            </Button>
          )}
        </div>
      ) : locked ? (
        <p className="mock-muted">연결된 원고가 없어요.</p>
      ) : (
        <div className="mock-draft-options">
          <Button className="mock-draft-generate" onClick={() => setMode('generate')}>
            AI로 만들기
          </Button>
          <Button onClick={() => setMode('write')}>직접 쓰기</Button>
          <Button onClick={() => setMode('pick')}>있는 원고 {available.length}</Button>
        </div>
      )}
      {mode && (
        <Modal title="원고" onClose={close} side>
          <div className="mock-modal-body">
            {!task.draft && (
              <div className="mock-draft-options mock-draft-tabs" role="group" aria-label="원고 작성 방법">
                {(['generate', 'write', 'pick'] as Mode[]).map((tab, i) => (
                  <Button
                    key={tab}
                    aria-pressed={mode === tab}
                    className={mode === tab ? 'mock-draft-generate' : ''}
                    onClick={() => setMode(tab)}
                  >
                    {['AI로 만들기', '직접 쓰기', `있는 원고 ${available.length}`][i]}
                  </Button>
                ))}
              </div>
            )}
            {mode === 'generate' && (
              <>
                <Field label="원고 방향" hint="목업에서는 실제 AI 생성 대신 준비된 샘플 시안을 보여줘요.">
                  <textarea
                    value={direction}
                    onChange={(e) => setDirection(e.target.value)}
                    rows={4}
                    placeholder="예: 방문 당일의 경험, 담담한 톤, 가격 언급 없이"
                  />
                </Field>
                <Button
                  variant="primary"
                  onClick={() => {
                    if (!title.trim()) setTitle('クリニック訪問レポート');
                    if (!body.trim())
                      setBody(
                        '【PR】韓国のクリニックを訪問しました。\n［カウンセリングで相談した内容］\n［当日の流れと実際に感じたこと］',
                      );
                    setMode('write');
                  }}
                >
                  샘플 시안 보기
                </Button>
              </>
            )}
            {mode === 'write' && (
              <>
                <Field label="원고 제목">
                  <input value={title} readOnly={locked} onChange={(e) => setTitle(e.target.value)} />
                </Field>
                <Field label="원고 내용">
                  <textarea
                    rows={14}
                    value={body}
                    readOnly={locked}
                    onChange={(e) => setBody(e.target.value)}
                    placeholder="인플루언서에게 전달할 원고를 작성해 주세요."
                  />
                </Field>
                {direction && <p className="mock-muted">원고 방향: {direction}</p>}
              </>
            )}
            {mode === 'pick' && (
              <>
                <Field label="원고 찾기">
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="제목·내용으로 찾기"
                  />
                </Field>
                <p className="mock-muted">이 인플루언서의 원고 중 작업에 연결되지 않은 원고예요.</p>
                {results.map((item) => (
                  <article className="mock-draft-candidate" key={item.id}>
                    <strong>{item.title}</strong>
                    <p>{item.body}</p>
                    <div>
                      <small>{STATUS_LABEL[item.status]}</small>
                      <Button
                        onClick={() => {
                          onSave(item, item.id);
                          setTitle(item.title);
                          setBody(item.body);
                          setMode(null);
                        }}
                      >
                        붙이기
                      </Button>
                    </div>
                  </article>
                ))}
                {!results.length && (
                  <p className="mock-empty-small">
                    {search ? '검색 결과가 없어요.' : '붙일 수 있는 원고가 없어요. 새 원고를 만들어 주세요.'}
                  </p>
                )}
              </>
            )}
          </div>
          <footer>
            <Button onClick={close}>작업으로</Button>
            {mode === 'write' && !locked && (
              <Button variant="primary" disabled={!title.trim() || !body.trim()} onClick={save}>
                {task.draft ? '저장' : '저장·붙이기'}
              </Button>
            )}
          </footer>
        </Modal>
      )}
      {discard && (
        <Modal title="작성 중인 원고를 닫을까요?" onClose={() => setDiscard(false)}>
          <div className="mock-modal-body">
            <p>저장하지 않은 내용은 사라져요.</p>
          </div>
          <footer>
            <Button onClick={() => setDiscard(false)}>계속 작성</Button>
            <Button
              onClick={() => {
                setTitle(task.draft?.title ?? '');
                setBody(task.draft?.body ?? '');
                setDiscard(false);
                setMode(null);
              }}
            >
              저장하지 않고 닫기
            </Button>
          </footer>
        </Modal>
      )}
    </Section>
  );
}

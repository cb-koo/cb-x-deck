'use client';
import { useEffect, useRef, useState } from 'react';
import { seedData, campaigns } from './data';
import type { DemoTask } from './model';
import type { TaskSectionPrefs } from './task-presentation';
import { stage } from './policy';
import { applyAutomaticVisit, bucket, nextKoreanMidnight } from './policy';
import { Badge, Button, Modal } from './_components/shared';
import { CampaignWorkspace } from './_components/CampaignWorkspace';
import { ReservationPanel } from './_components/ReservationPanel';
import { Registration } from './_components/Registration';
import { ClinicManager } from './_components/ClinicManager';
import { PeopleManager } from './_components/PeopleManager';
import { MessageManager } from './_components/MessageManager';
import { ConnectionPreview } from './_components/ConnectionPreview';
const TABS = [
  { id: 'tasks', label: '캠페인 작업', icon: '▦' },
  { id: 'clinics', label: '클리닉 설정', icon: '▤' },
  { id: 'people', label: '인플루언서', icon: '◎' },
  { id: 'messages', label: '빠른 메시지', icon: '☷' },
  { id: 'connection', label: '연결 미리보기', icon: '⇄' },
];
export default function MockupApp({
  initialTask,
  initialCampaign,
  initialView,
}: {
  initialTask?: string;
  initialCampaign?: string;
  initialView?: string;
}) {
  const [data, setData] = useState(seedData),
    [tab, setTab] = useState(
      initialTask ? 'tasks' : ['clinics', 'tasks'].includes(initialView ?? '') ? initialView! : 'people',
    );
  const [personId, setPerson] = useState('hana');
  const [sectionPrefs, setSectionPrefs] = useState<Record<string, TaskSectionPrefs>>({});
  const [taskPersonId, setTaskPerson] = useState('');
  const [now, setNow] = useState<number | null>(null);
  const validInitial = data.tasks.find(
    (t) => t.id === initialTask && (!initialCampaign || t.campaignId === initialCampaign),
  );
  const [selectedId, setSelected] = useState(validInitial?.id ?? '');
  const [linkError, setLinkError] = useState(
    initialTask && !validInitial
      ? '이 캠페인에서 작업을 찾을 수 없어요. 삭제되었거나 다른 캠페인의 작업인지 확인해 주세요.'
      : '',
  );
  const [campaignId, setCampaign] = useState(
    validInitial?.campaignId ?? campaigns.find((c) => c.id === initialCampaign)?.id ?? campaigns[0].id,
  );
  const [drafts, setDrafts] = useState<Record<string, string | undefined>>({}),
    [registration, setRegistration] = useState<string | null>(null);
  const [toast, setToast] = useState(''),
    [resetting, setResetting] = useState(false);
  const urls = useRef(new Set<string>());
  useEffect(() => {
    let timer: number;
    const refreshVisits = () => {
      const time = Date.now();
      setNow(time);
      setData((d) => {
        const tasks = d.tasks.map((t) => applyAutomaticVisit(t, time));
        return tasks.some((t, i) => t !== d.tasks[i]) ? { ...d, tasks } : d;
      });
      window.clearTimeout(timer);
      timer = window.setTimeout(refreshVisits, nextKoreanMidnight(time) - time);
    };
    timer = window.setTimeout(refreshVisits, 0);
    window.addEventListener('focus', refreshVisits);
    document.addEventListener('visibilitychange', refreshVisits);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('focus', refreshVisits);
      document.removeEventListener('visibilitychange', refreshVisits);
    };
  }, []);
  useEffect(() => {
    const all = urls.current;
    return () => {
      all.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);
  const notify = (message: string) => setToast(message);
  const selected = data.tasks.find((t) => t.id === selectedId);
  const updateTask = (task: DemoTask) =>
    setData((d) => ({
      ...d,
      tasks: d.tasks.map((t) => (t.id === task.id ? applyAutomaticVisit(task, Date.now()) : t)),
    }));
  const personFor = (task: DemoTask) => data.people.find((p) => p.id === task.personId)!;
  function openTask(id: string, fromPerson?: string) {
    const task = data.tasks.find((t) => t.id === id);
    if (!task) return;
    setSelected(id);
    setTab('tasks');
    setCampaign(task.campaignId);
    setTaskPerson(fromPerson ? task.personId : '');
    setRegistration(null);
    setLinkError('');
    if (window.matchMedia('(max-width: 980px)').matches)
      requestAnimationFrame(() =>
        document.querySelector('.mock-task-panel')?.scrollIntoView({ block: 'start' }),
      );
  }
  function openParticipation(id: string) {
    const tasks = data.tasks.filter((t) => t.campaignId === id && t.personId === personId);
    const first = tasks.find((t) => bucket(t) === 'active') ?? tasks[0];
    if (first) openTask(first.id, personId);
  }
  function reset() {
    urls.current.forEach((url) => URL.revokeObjectURL(url));
    urls.current.clear();
    const fresh = seedData();
    setData({ ...fresh, tasks: fresh.tasks.map((t) => applyAutomaticVisit(t, Date.now())) });
    setDrafts({});
    setSectionPrefs({});
    setSelected('');
    setTab('people');
    setPerson('hana');
    setTaskPerson('');
    setCampaign(campaigns[0].id);
    setLinkError('');
    setRegistration(null);
    setResetting(false);
    notify('모든 샘플을 처음 상태로 되돌렸어요.');
  }
  return (
    <div className="xmock mock-shell" lang="ko">
      <aside className="mock-sidebar">
        <div className="mock-brand">
          <span>cb</span>
          <b>× deck</b>
        </div>
        <div className="mock-workspace">
          <span className="mock-workspace-icon">C</span>
          <div>
            <strong>콘텐츠브릿지</strong>
            <small>협찬 운영 목업</small>
          </div>
        </div>
        <p className="mock-sidebar-label">업무 관리</p>
        <nav aria-label="목업 메뉴">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={tab === t.id ? 'active' : ''}
              aria-current={tab === t.id ? 'page' : undefined}
              onClick={() => {
                setTab(t.id);
                if (t.id === 'tasks') {
                  setTaskPerson('');
                  setSelected('');
                }
              }}
            >
              <span aria-hidden>{t.icon}</span>
              {t.label}
            </button>
          ))}
        </nav>
        <div className="mock-sidebar-bottom">
          <Badge tone="blue">FRONTEND DEMO</Badge>
          <p>
            화면의 인물·예약은 샘플이에요.
            <br />
            새로고침하면 초기화돼요.
          </p>
          <span className="mock-operator">
            기획 담당자 <b>CB</b>
          </span>
        </div>
      </aside>
      <main className="mock-main">
        <div className="mock-demo-bar">
          <div>
            <Badge tone="blue">체험 모드</Badge>
            <span>샘플 데이터로 동작해요 · 실제 저장·전송·업로드 없음</span>
          </div>
          <Button variant="ghost" onClick={() => setResetting(true)}>
            샘플 초기화 ↺
          </Button>
        </div>
        {tab === 'tasks' && (
          <CampaignWorkspace
            key={`${campaignId}:${taskPersonId}`}
            data={data}
            campaignId={campaignId}
            personId={taskPersonId}
            selectedId={selectedId}
            now={now}
            error={linkError}
            onDismissError={() => setLinkError('')}
            onCampaign={(id) => {
              setCampaign(id);
              setTaskPerson('');
              setSelected('');
              setLinkError('');
            }}
            onTask={(id) => openTask(id, taskPersonId || undefined)}
            onBack={() => {
              setPerson(taskPersonId);
              setTab('people');
            }}
            onClearPerson={() => setTaskPerson('')}
            onCloseTask={() => setSelected('')}
            onAdd={(task) => {
              setData((d) => ({ ...d, tasks: [...d.tasks, task] }));
              setSelected(task.id);
              if (taskPersonId && task.personId !== taskPersonId) setTaskPerson('');
              notify('캠페인에 작업을 추가했어요.');
            }}
          >
            {(visible) =>
              selected &&
              selected.campaignId === campaignId && (
                <ReservationPanel
                  key={selected.id}
                  task={selected}
                  now={now}
                  person={personFor(selected)}
                  sectionPrefs={sectionPrefs[selected.id] ?? {}}
                  onSectionChange={(key, open) =>
                    setSectionPrefs((prefs) => ({
                      ...prefs,
                      [selected.id]: { ...prefs[selected.id], [key]: { open, stage: stage(selected) } },
                    }))
                  }
                  availableDrafts={data.draftLibrary.filter((d) => d.personId === selected.personId)}
                  onContentDraft={(content, pickedId) => {
                    setData((d) => {
                      const current = d.tasks.find((t) => t.id === selected.id);
                      if (!current) return d;
                      const picked = pickedId
                        ? d.draftLibrary.find(
                            (item) => item.id === pickedId && item.personId === current.personId,
                          )
                        : undefined;
                      if (pickedId && !picked) return d;
                      const library = d.draftLibrary.filter((item) => item.id !== pickedId);
                      if (!content && current.draft)
                        library.push({
                          ...current.draft,
                          id: crypto.randomUUID(),
                          personId: current.personId,
                        });
                      return {
                        ...d,
                        draftLibrary: library,
                        tasks: d.tasks.map((t) =>
                          t.id === current.id ? { ...t, draft: picked ?? content } : t,
                        ),
                      };
                    });
                  }}
                  navigation={{
                    index: visible.findIndex((t) => t.id === selected.id),
                    total: visible.length,
                    previous: () => {
                      const i = visible.findIndex((t) => t.id === selected.id);
                      if (i > 0) setSelected(visible[i - 1].id);
                    },
                    next: () => {
                      const i = visible.findIndex((t) => t.id === selected.id);
                      if (i >= 0 && i < visible.length - 1) setSelected(visible[i + 1].id);
                    },
                  }}
                  branches={data.branches}
                  draft={drafts[selected.id]}
                  onDraft={(value) => setDrafts((d) => ({ ...d, [selected.id]: value }))}
                  onChange={updateTask}
                  onClose={() => setSelected('')}
                  onRegister={() => setRegistration(selected.id)}
                  onDelete={() => {
                    if (!window.confirm('이 작업을 삭제할까요? 예약·첨부·변경 내역도 함께 사라져요.')) return;
                    setData((d) => ({ ...d, tasks: d.tasks.filter((t) => t.id !== selected.id) }));
                    setSelected('');
                    notify('작업을 삭제했어요.');
                  }}
                  notify={notify}
                  trackUrl={(url) => urls.current.add(url)}
                />
              )
            }
          </CampaignWorkspace>
        )}
        {tab === 'clinics' && (
          <ClinicManager
            data={data}
            onBranches={(branches) => setData((d) => ({ ...d, branches }))}
            onClinicInfo={(id, info) =>
              setData((d) => ({ ...d, clinicInfo: { ...d.clinicInfo, [id]: info } }))
            }
            notify={notify}
          />
        )}
        {tab === 'people' && (
          <PeopleManager
            data={data}
            personId={personId}
            now={now}
            onSelectPerson={setPerson}
            onPerson={(p) =>
              setData((d) => ({ ...d, people: d.people.map((item) => (item.id === p.id ? p : item)) }))
            }
            onCampaign={openParticipation}
            onTask={(id) => openTask(id, personId)}
            notify={notify}
          />
        )}
        {tab === 'messages' && (
          <MessageManager
            data={data}
            onMessages={(messages) => setData((d) => ({ ...d, messages }))}
            notify={notify}
          />
        )}
        {tab === 'connection' && <ConnectionPreview data={data} onTask={openTask} />}
      </main>
      {registration && (
        <Registration
          data={data}
          existing={data.tasks.find((t) => t.id === registration)}
          initialCampaignId={campaignId}
          initialPersonId={taskPersonId || undefined}
          onClose={() => setRegistration(null)}
          onOpen={(id) => openTask(id, taskPersonId || undefined)}
          onSave={(task) => {
            setData((d) => ({
              ...d,
              tasks: d.tasks.some((t) => t.id === task.id)
                ? d.tasks.map((t) => (t.id === task.id ? task : t))
                : [...d.tasks, task],
            }));
            setSelected(task.id);
            setTab('tasks');
            setTaskPerson(taskPersonId ? task.personId : '');
            setCampaign(task.campaignId);
            setRegistration(null);
            notify('기재 시트를 복사하고 대기 예약으로 저장했어요.');
          }}
        />
      )}
      {toast && (
        <div className="mock-toast" role="status">
          ✓ {toast}
          <button aria-label="알림 닫기" onClick={() => setToast('')}>
            ✕
          </button>
        </div>
      )}
      {resetting && (
        <Modal title="샘플을 처음 상태로 되돌릴까요?" onClose={() => setResetting(false)}>
          <div className="mock-modal-body">
            <p>이 목업에서 바꾼 예약·설정·초안·첨부 파일이 초기화돼요.</p>
          </div>
          <footer>
            <Button onClick={() => setResetting(false)}>돌아가기</Button>
            <Button variant="primary" onClick={reset}>
              초기화
            </Button>
          </footer>
        </Modal>
      )}
    </div>
  );
}

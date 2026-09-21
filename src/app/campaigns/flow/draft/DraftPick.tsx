'use client';
import { useState, type ReactNode } from 'react';
import type { DraftRow } from '@/lib/draftStore';
import type { DraftHost } from '@/lib/draftHost';
import { candidateLine, searchDraftCandidates } from '@/lib/draftPickView';
import { Button } from '@/components/ui';

// 원고 모드 · 있는 원고 고르기(C 원고 모드 Task 5) — 이미 만들어진 원고 중 아직 이 작업에 없는 것을
// 골라 붙인다. 후보는 부모(FlowDetail)가 캠페인 단위로 한 번 읽어 candidates로 내려준다(§Produces 정정,
// c-task-5-brief.md 위 컨텍스트) — 이 컴포넌트는 후보를 스스로 읽지 않고 검색·표시·붙이기 요청만 진다.
// 붙이기 자체(PATCH + 재조회 + onChanged + reloadCandidates)도 부모가 진다('AI로 만들기'·'직접 쓰기'와
// 같은 재조회 경로, onDraftAttached) — 여기는 picking(진행 중인 원고 id)을 받아 그 행만 "붙이는 중…"으로
// 바꾸고 나머지 [붙이기]도 함께 잠근다. 'AI로 만들기'의 만들어진 시안 목록(DraftGenerate.attach)과 같은
// 계약이다 — boolean 하나만 받으면 어느 행이 실제로 움직이는지 옆에서 말할 수 없어(탭 바의 busy.label은
// "붙이는 중이에요"만 말할 뿐 어느 원고인지는 말 안 한다) 눌러도 반응 없는 버튼처럼 보인다(원칙 1·2).
//
// 검색 한 칸이 두 묶음(형제 시안·작업 없는 원고)에 함께 걸린다 — searchDraftCandidates(draftPickView.ts)가
// 제목·본문 첫 줄을 본다. 빈 상태 다섯:
//  1) candidates===undefined → 아직 후보를 못 읽음(로딩 중) → '불러오는 중…'(브리프 §Step1 문구 그대로).
//  2) candidates===null → 읽다가 실패(리뷰 지적 2 — clientData와 같은 모양, FlowDetail 참고) → c-task-5b
//     브리프가 요구한 새 실패 문구 + [다시 시도](onRetry). 실패를 로딩 중이라고 말하지 않는다 — 다시
//     시도할 길이 없었다.
//  3) 두 묶음이 원래(검색 전)부터 모두 비면 → 검색해도 나올 게 없으므로 검색칸 자체를 그리지 않고
//     안내만 보여준다(제목만 있고 아무것도 못 거를 입력칸은 UX 원칙 1 위반 — 행동해도 아무 일도 안 일어난다,
//     브리프 §Step1 문구 그대로).
//  4) 검색 결과만(둘 다) 비면 → 그 검색어를 문구에 되비춘다(다듬은 문자열로 — 리뷰 minor).
//  5) 한쪽 묶음만 비면(검색 전이든 후든) → 그 묶음은 제목째로 그리지 않는다(빈 제목만 남기지 않는다).
export function DraftPick({ host, candidates, onPick, picking, onRetry }: {
  // 이 원고 모드가 저장된 작업 밑에서 열렸는지(고르면 그 자리에서 붙는다), 아직 안 만든 새 작업 폼 밑에서
  // 열렸는지(고르면 붙이지 않고 폼으로 돌아간다) — draftHost.ts 참고. 행 라벨만 이 값을 본다(Task 4 §3) —
  // 작업 호스트에서 '붙이기'라고 말하던 것이 폼에 물리면 거짓이 된다(아직 안 붙는다).
  host: DraftHost;
  candidates: { siblings: DraftRow[]; others: DraftRow[] } | null | undefined;
  onPick: (d: DraftRow) => void;
  picking: string | null;   // 붙이는 중인 원고의 id — 그 행만 "붙이는 중…"으로 바꾸고 나머지도 함께 잠근다
  onRetry: () => void;        // 후보를 못 읽었을 때(candidates===null) [다시 시도]가 부른다(FlowDetail.reloadCandidates)
}): ReactNode {
  const [q, setQ] = useState('');

  if (candidates === undefined) return <p className="text-ui text-x-muted">불러오는 중…</p>;
  if (candidates === null) {
    return (
      <div className="space-y-2">
        <p className="text-ui text-x-secondary" role="alert">원고 목록을 불러오지 못했어요</p>
        <Button variant="subtle" onClick={onRetry} className="h-8 px-2.5 text-ui">다시 시도</Button>
      </div>
    );
  }

  // 검색 전부터 두 묶음이 모두 비어 있으면 붙일 원고 자체가 없다 — 검색칸을 보여줘도 아무것도 못 거른다.
  if (candidates.siblings.length === 0 && candidates.others.length === 0) {
    return <p className="text-ui text-x-muted">{"붙일 수 있는 원고가 없어요 — 'AI로 만들기'나 '직접 쓰기'로 만들어요"}</p>;
  }

  const siblings = searchDraftCandidates(candidates.siblings, q);
  const others = searchDraftCandidates(candidates.others, q);
  const searchedEmpty = q.trim() !== '' && siblings.length === 0 && others.length === 0;

  return (
    <div className="space-y-4">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="제목·내용으로 찾기" aria-label="원고 찾기"
             className="h-9 w-full rounded-md border border-x-border-strong px-3 text-ui outline-none focus:border-x-blue" />
      {searchedEmpty ? (
        <p className="text-ui text-x-muted">{`'${q.trim()}'에 맞는 원고가 없어요`}</p>
      ) : (
        <>
          <Group host={host} title="같은 재료로 만든 시안" rows={siblings} onPick={onPick} picking={picking} />
          <Group host={host} title="작업 없는 원고" rows={others} onPick={onPick} picking={picking} />
        </>
      )}
    </div>
  );
}

// 묶음 하나 — 행이 없으면(검색으로 걸러졌든 원래 없든) 통째로 그리지 않는다(위 빈 상태 5).
function Group({ host, title, rows, onPick, picking }: {
  host: DraftHost; title: string; rows: DraftRow[]; onPick: (d: DraftRow) => void; picking: string | null;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <p className="text-ui text-x-secondary">{title} <span className="text-x-muted">{rows.length}</span></p>
      <div className="divide-y divide-x-border rounded-lg border border-x-border">
        {rows.map((d) => <Row key={d.id} host={host} d={d} onPick={onPick} picking={picking} />)}
      </div>
    </div>
  );
}

// 행 하나 = 한 줄(koo 반복 피드백, 여러 줄 쌓는 카드형 행 거절) — title·body·meta를 한 줄에 나란히 두고
// 각각 말줄임한다(브리프 §Step1). body는 회색(부제 톤)으로 title과 구분한다. 버튼 라벨은 host를 본다
// (Task 4 §3) — 작업 호스트는 그 자리에서 붙고, 폼 호스트는 고르기만 할 뿐 아직 안 붙는다.
function Row({ host, d, onPick, picking }: { host: DraftHost; d: DraftRow; onPick: (d: DraftRow) => void; picking: string | null }) {
  const { title, body, meta } = candidateLine(d);
  const isForm = host.kind === 'form';
  return (
    <div className="flex h-11 items-center gap-2.5 px-3">
      <span className="min-w-0 flex-[3] truncate text-content">{title}</span>
      <span className="min-w-0 flex-[4] truncate text-ui text-x-secondary">{body}</span>
      <span className="shrink-0 text-caption text-x-muted">{meta}</span>
      <Button variant="subtle" disabled={!!picking} onClick={() => onPick(d)} className="h-8 shrink-0 px-2.5 text-ui">
        {picking === d.id ? (isForm ? '고르는 중…' : '붙이는 중…') : (isForm ? '고르기' : '붙이기')}
      </Button>
    </div>
  );
}

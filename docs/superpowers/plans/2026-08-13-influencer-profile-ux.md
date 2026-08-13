# 인플루언서 프로필 UI/UX 개선 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 프로필 패널에 현황 스트립·타임라인 시각 위계·컴포저 마찰 축소·갱신 넛지를 적용하고 리스트에 팔로업 경고를 반영. 스펙: `docs/superpowers/specs/2026-08-13-influencer-profile-ux-design.md`

**Architecture:** 마이그레이션 없음. 서버는 파생값 2개만 추가(`lastContactAt`, `draftStatusCounts`), 판단 로직(배지 상태·문구)은 신규 `src/lib/influencerJudgment.ts`에 모아 프로필·리스트가 같은 판단을 공유. UI 변경은 `src/app/influencers/` 내부.

**Tech Stack:** 기존과 동일 (postgres 태그드 템플릿, node:test + tsx, Next.js 커스텀 빌드).

## Global Constraints

- AGENTS.md UX 원칙 전체 (특히 3: 숫자만 던지지 말고 판단까지 / 4: 라벨-값 일치 — "연락 기록"은 manual만, "마지막 기록"은 auto 포함으로 라벨 구분 유지).
- 상수: `FOLLOWUP_DAYS = 14`, `PROFILE_STALE_DAYS = 30` — influencerJudgment.ts에서만 정의.
- 테스트: 단일 파일 `node --import tsx --env-file-if-exists=.env --test <파일>`, 린트 기준선 24, 커밋 푸터 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- 시간 계산은 서울 시간대 관례의 기존 유틸을 따르되, 일수 경계는 ms 차이 ÷ 86400000 내림으로 단순 계산(경계 테스트로 고정).

## 실행: T1 → T2 순차. T1 sonnet, T2 opus. 태스크별 리뷰 게이트.

---

### Task 1: 서버 파생값 + 판단 라이브러리

**Files:**
- Modify: `src/lib/influencerStore.ts` (공용 SELECT에 last_contact_at 서브쿼리, getInfluencerDetail에 draftStatusCounts)
- Create: `src/lib/influencerJudgment.ts`, `src/lib/influencerJudgment.test.ts`
- Modify: `src/lib/influencerStore.test.ts` (파생값 케이스 추가)

**Interfaces (Produces — T2가 소비):**

```ts
// influencerStore.ts 추가분
export interface InfluencerRow { /* 기존 + */ lastContactAt: string | null }  // manual 로그 최신 created_at
export interface InfluencerDetail { /* 기존 + */ draftStatusCounts: Partial<Record<DraftStatus, number>> }

// influencerJudgment.ts (신규 — 전부 순수 함수, DB 접근 없음)
export const FOLLOWUP_DAYS = 14;
export const PROFILE_STALE_DAYS = 30;
export interface ContactJudgment {
  daysSince: number | null;        // lastContactAt 기준 경과일 (기록 없으면 null)
  label: string;                   // '연락 기록 N일 전' | '연락 기록 없음' | '오늘 연락 기록'
  needsFollowup: boolean;          // now - (lastContactAt ?? createdAt) > FOLLOWUP_DAYS일
}
export function judgeContact(lastContactAt: string | null, createdAt: string, now?: Date): ContactJudgment
export function isProfileStale(profileRefreshedAt: string | null, now?: Date): boolean  // null → false (미조회는 별도 문구)
export function summarizeDraftStatuses(counts: Partial<Record<DraftStatus, number>>): string  // '게시완료 3 · 진행중 1' — 0/부재 상태 생략, 표시 순서는 draftStatus.ts의 상태 순서
```

- [ ] **Step 1: 실패하는 테스트.** influencerJudgment.test.ts — 14일 경계(13.9일 false/14.1일 true), 기록 없음→createdAt 기준, daysSince null, 오늘(0일) 라벨, isProfileStale 30일 경계와 null→false, summarizeDraftStatuses(빈 객체→'', 2개 상태 조합, 상태 라벨은 기존 draftStatus 한국어 라벨 재사용). influencerStore.test.ts에 추가: manual 로그만 lastContactAt에 반영(auto만 있으면 null), draftStatusCounts가 lower 조인·상태별 카운트.
- [ ] **Step 2: RED 확인** (모듈 없음 / 필드 없음)
- [ ] **Step 3: 구현.** SELECT 서브쿼리: `(select max(l2.created_at) from influencer_log l2 where l2.influencer_id = i.id and l2.kind = 'manual') as last_contact_at`. draftStatusCounts: `select status, count(*) from draft where lower(influencer_handle) = lower(${handle}) group by status` → 객체로 변환(Number 캐스팅). 상태 한국어 라벨은 기존 `draftStatus.ts`의 매핑을 임포트(중복 정의 금지 — 없으면 DraftStatusChip에서 쓰는 소스를 찾아 재사용).
- [ ] **Step 4: GREEN + 기존 회귀** — influencerJudgment·influencerStore 테스트 전체, `npx tsc --noEmit`
- [ ] **Step 5: Commit** — `feat(influencer): 연락 판단 파생값 — lastContactAt·draftStatusCounts·judgment 순수 함수`

---

### Task 2: 프로필 패널 개편 + 리스트 경고

**Files:**
- Modify: `src/app/influencers/InfluencerProfile.tsx`, `src/app/influencers/page.tsx`

**Interfaces (Consumes):** T1의 `judgeContact`/`isProfileStale`/`summarizeDraftStatuses`/상수, `InfluencerRow.lastContactAt`, `InfluencerDetail.draftStatusCounts`.

- [ ] **Step 1: 현황 스트립** — 헤더 바로 아래: `judgeContact` 결과로 배지(`연락 기록 5일 전` 중립 / 초과 시 경고색 + `→ 팔로업 필요`), 그 아래 `summarizeDraftStatuses` 한 줄(빈 문자열이면 줄 자체 생략). 원고 목록 헤더는 `draftCount > drafts.length`일 때 `최근 50건` 라벨 추가(스펙의 자기모순 해소).
- [ ] **Step 2: 타임라인 위계** — auto 항목: 카드 제거, 회색 한 줄(`text-x-secondary` 계열, 아이콘 없음). manual: 기존 카드 유지. 인접 동일 event_type auto 2건 이상은 `원고 3건 배정 (8/8~8/10)`으로 접고 클릭 시 펼침(개별 행에 기존 제목 링크 유지, 접힘 상태 aria-expanded). manual이 사이에 끼면 묶지 않음.
- [ ] **Step 3: 컴포저** — 목록 상단(최신 쪽) 상시 노출 유지·이동, 채널 select 기본값 = logs에서 최신 manual의 channel(없으면 미선택). 빈 상태: 안내 문구 + 같은 컴포저 노출, 별도 CTA 제거.
- [ ] **Step 4: 갱신 넛지** — `isProfileStale`이면 "○일 전 기준" 옆 `오래된 정보예요 — 갱신 권장`(중립 톤, 경고색 아님 — 비용 유발 액션 강요로 읽히지 않게). null 미조회 문구는 기존 유지.
- [ ] **Step 5: 리스트 경고** — page.tsx 행: `judgeContact(...).needsFollowup`이면 마지막 기록 옆에 경고색 점+`팔로업 필요` 텍스트(색만으로 전달 금지 — 접근성). 정렬 변경은 하지 않는다.
- [ ] **Step 6: 검증** — `npx tsc --noEmit` · `npm run lint`(24 정확히) · `npm run build`
- [ ] **Step 7: Commit** — `feat(influencer): 프로필 현황 스트립·타임라인 위계·컴포저 개선 (UX 리서치 반영)`

## Self-Review 결과

스펙 ①→T1+T2 Step1·5, ②→T2 Step2, ③→T2 Step3, ④→T2 Step4, 리스트→T2 Step5, 데이터 변경→T1, 테스트→T1 Step1. 갭 없음. 타입 이름 일치 확인(ContactJudgment·상수 2종).

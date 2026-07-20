# 멤버를 로그인 사용자로 자동 결정 — 설계

날짜: 2026-07-20 · 상태: 설계(승인됨, 박구건) · 배경: 배포 스펙의 백로그 "로그인 사용자 ↔ member 매핑" 실행

## 문제

사이드바 하단 "멤버 (내가 누구인지)" 선택기는 로그인 이전 유물이다. 지금은:
- **위조 구멍**: 서버가 클라이언트가 보낸 `memberId`를 그대로 신뢰 → 로그인한 누구나 아무 멤버로 행세 가능(소유·댓글 귀속 신뢰 불가).
- **중복 마찰**: 로그인으로 이미 누구인지 아는데 또 수동 선택.
- **낡은 문구**: "멤버를 선택해야 저장·봤음이 기록됩니다" — 멤버별 '봤음'은 마이그레이션 003에서 제거됨(NEW 배지로 대체).

## 목표

멤버를 **로그인한 구글 사용자로 서버에서 자동 결정**한다. 선택 드롭다운·수동 추가 UI를 없애고, 본인 이름만 읽기전용으로 표시한다.

확정 결정:
- 멤버 표시 이름 = **구글 표시이름**(`user_metadata.full_name`/`name`; 없으면 이메일 앞부분).
- 기존 '박구건' 멤버(후보 4개)는 **박구건 로그인(gugeon.park@clinicbridge.co.kr)에 연결**해 데이터 보존.
- 빈 테스트 멤버 '멤버 2'(후보 0개)는 **삭제**.

## 범위

**포함**
- `member`에 `email` 추가 + 이메일 기준 유니크. 기존 name 유니크는 제거(동명이인 대비).
- 로그인 사용자 → 멤버 서버측 결정/자동생성: `resolveMember(sql, user)`.
- API 가드 확장 `requireMember()`: 인증 통과 + 멤버 해석까지. 멤버가 필요한 API는 **클라이언트 memberId 대신 서버 해석값 사용**(위조 차단).
- 신규 `GET /api/me`: 현재 로그인 멤버 반환(없으면 생성) — 클라이언트 부트스트랩용.
- 사이드바: 드롭다운·"+ 멤버 추가" 제거 → "나: {이름}" 읽기전용. 낡은 '봤음' 문구 제거.
- `memberContext`: localStorage 선택 로직 제거 → `/api/me`로 현재 멤버 로드.
- 데이터 마이그레이션(박구건 연결, 멤버 2 삭제).

**제외(변경 없음)**
- 보관함의 "사람별 필터"(다른 사람이 담은 걸 보는 읽기 필터)는 유지. 멤버 목록은 계속 `GET /api/members`로 가져옴. "내가 누구인지"와 "누구 걸 볼지"는 별개.
- 관리자/권한 등급은 이번 범위 아님.

## 데이터 모델 (마이그레이션 `009_member_auth.sql`, 재실행 안전)

```sql
alter table member add column if not exists email text;
-- 동명이인 대비: name 유니크 제거, email 유니크 신설
alter table member drop constraint if exists member_name_key;
create unique index if not exists idx_member_email on member(email) where email is not null;
-- 기존 박구건 → 로그인 연결(데이터 보존)
update member set email = 'gugeon.park@clinicbridge.co.kr' where name = '박구건' and email is null;
-- 빈 테스트 멤버 삭제(후보 0개; scout/dismissed/briefing FK는 set null)
delete from member where name = '멤버 2';
```

## 멤버 해석 로직

`resolveMember(sql, user)`:
1. `select ... from member where email = user.email` → 있으면 반환.
2. 없으면 insert: `name = user_metadata.full_name || user_metadata.name || email 앞부분`, `email = user.email`, color = 팔레트에서 배정. 이름 충돌 방지를 위해 name 유니크는 제거됨.
3. 반환 `{id, name, color, email}`.

`requireMember()`(authGuard 확장): `requireAllowedUser()` 통과 후 `resolveMember` 호출 → `{member, user, response}`. 실패 시 401 그대로.

## 게이팅/위조 차단

멤버가 필요한 라우트(`/api/candidates` POST·DELETE, `/api/dismissed`, `/api/scouts`, `/api/briefings`, 후보 메모/태그)는 **`requireMember()`의 `member.id`를 사용**하고, 요청 본문의 `memberId`는 무시(하위호환으로 받되 사용 안 함). 이로써 클라이언트가 남의 멤버로 위조 저장하는 경로가 닫힌다.

## 클라이언트

- `memberContext`: 마운트 시 `GET /api/me` → 현재 멤버 세팅. `selectMember`/localStorage 제거. `member`는 항상 로그인 본인.
- `Sidebar`: 드롭다운·추가 입력 제거 → "나: {member.name}" 표시(색 점 유지). 미로그인 상태는 프록시가 막으므로 member는 사실상 항상 존재.
- `CandidateCard`: `meId = member.id`(로그인 본인) — "내 댓글" 편집 판정이 이제 신뢰 가능.
- 라이브러리 "사람별 필터": 그대로(별도 필터 상태, `/api/members` 목록 사용).
- 클라이언트가 보내던 `memberId` 필드는 남겨도 서버가 무시 → 점진 제거 가능(YAGNI: 이번엔 서버에서 무시만 확실히).

## 오류 처리

- `/api/me`가 멤버 생성 실패(예: 이메일 유니크 경합) → 재조회로 복구, 그래도 없으면 500 + 사용자 언어 메시지.
- `user_metadata`에 이름이 전혀 없으면 이메일 앞부분으로 폴백(빈 이름 방지).

## 테스트

- `resolveMember`: 기존 이메일 매칭 반환 / 신규 생성 / 이름 폴백 — DB 테스트(기존 node:test 패턴, prefix로 격리 후 cleanup).
- 위조 차단 회귀: `/api/candidates` POST에 남의 memberId를 보내도 저장은 로그인 본인 멤버로 귀속되는지.
- 마이그레이션 후: 박구건 후보 4개 유지, 멤버 2 사라짐.

## 배포/운영

- 마이그레이션은 **기존 Supabase(prod) DB에 1회 적용** — 실행 전 사용자 확인. 로컬=prod 동일 DB.
- 코드 반영 후 `npx vercel --prod` 재배포.
- 검증: 본인 로그인 시 이름 자동 세팅 + 후보 4개 보존, (가능하면) 다른 팀원 로그인 시 멤버 자동 생성.

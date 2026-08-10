# /generate 원고 제목 구현 계획 (워크벤치 5차)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 대역 호출에 한국어 제목(15자 내외 명사구)을 동승시켜 저장하고, 테이블·칸반 라벨을 "제목 → 🌐대역 첫 줄 → 원문 첫 줄" 폴백 체인으로 교체. 스펙: `docs/superpowers/specs/2026-08-10-generate-ko-title-design.md`

**Architecture:** `translateDraftPosts` 반환형을 `{ posts, title } | null`로 확장(추가 LLM 호출 없음). draft에 `ko_title`/`ko_title_hash` 컬럼(마이그레이션 016, 이 프로젝트 첫 스키마 변경), toRow가 최신 버전 해시와 대조해 유효할 때만 `koTitle` 노출(koLatest 패턴). 저장 지점 4곳(generate·rewrite·regen·translate 라우트).

## Global Constraints

- 컬럼은 nullable·기본 null(구버전 코드와 공존 안전). 마이그레이션은 `npm run migrate`로 적용(기존 015 관례를 파일에서 확인 후 동일 형식).
- 제목은 부가물의 부가물: **제목 실패·누락이 번역 저장을, 번역 실패가 생성·다시쓰기를 절대 막지 않는다.**
- 제목 프롬프트 규칙(스펙 §원칙 verbatim): 필드 중복 금지(클라이언트·시술·형식은 넣지 않음, 앵글·소구점 중심)·15자 내외 한국어 명사구·이모지/해시태그/괄호/마침표 금지·용어집 우선.
- 기존 테스트는 반환형 변경에 따른 **호출부 수정만** 허용(assertion 의도 불변).
- 검증: tsc 0 / lint 24 기준선 / 단일 파일 테스트(실 DB, .env). 작업자 git 커밋 금지 — 조율자가 커밋. 주석 한국어.
- 순차 실행: T1(서버) → T2(프론트).

---

### Task 1: 서버 — 제목 동승 생성·저장 + koTitle 파생 — 권장 모델: sonnet

**Files:**
- Create: `migrations/016_draft_ko_title.sql`
- Modify: `src/lib/translateDraft.ts` / `src/lib/translateDraft.test.ts`
- Modify: `src/lib/draftStore.ts`, `src/lib/generate.ts`, `src/app/api/drafts/[id]/translate/route.ts`
- Modify: `src/lib/generate.test.ts` (신규 검증 추가 + fake의 번역 응답에 title 키 추가 등 호출부 정합)

**Interfaces:**
- Produces (T2가 사용): `DraftRow.koTitle: string | null`.
- Produces (내부): `translateDraftPosts(texts, client): Promise<{ posts: string[]; title: string | null } | null>` / `insertDraft`·`updateDraft`에 `koTitle?: string | null; koTitleHash?: string | null`.

- [ ] **Step 1: 마이그레이션** — `migrations/015_*.sql`을 읽어 형식(주석·idempotency 관례)을 따라 `016_draft_ko_title.sql` 작성:

```sql
-- 원고 제목(한국어 라벨) — 테이블·칸반 식별용. hash는 제목이 만들어진 버전의 draftVersionHash
--   (최신 버전과 불일치하면 표시하지 않는다 — 편집 후 낡은 제목 방지, koLatest와 동일 패턴)
alter table draft add column if not exists ko_title text;
alter table draft add column if not exists ko_title_hash text;
```

Run: `npm run migrate` → 적용 확인.

- [ ] **Step 2: translateDraft.ts 확장** — 프롬프트에 제목 지시 추가, 반환형 변경:

프롬프트의 규칙 목록에 추가(용어집 항목 다음):

```
- 마지막으로, 전체 내용을 대표하는 한국어 제목 1개를 만드세요:
  · 15자 내외의 명사구 — 이 원고만의 앵글·소구점 중심 (예: "다운타임 3일 후기형", "가격 비교로 불안 해소")
  · 병원 이름·시술 나열·"단문/스레드" 같은 속성 표기는 넣지 않기 (별도 필드에 이미 있음)
  · 이모지·해시태그·괄호·마침표 금지
```

출력 지시를 `{"title":"...","1":"...","2":"..."}` 형태로 변경. 파싱:

```ts
export async function translateDraftPosts(
  texts: string[], client?: AnthropicLike,
): Promise<{ posts: string[]; title: string | null } | null> {
  if (texts.length === 0) return { posts: [], title: null };
  /* …프롬프트·callLLM 기존 구조… */
  const j = extractJson(res) as Record<string, unknown> | null;
  if (!j) return null;
  const out: string[] = [];
  for (let i = 0; i < texts.length; i++) {
    const v = j[String(i + 1)];
    if (typeof v !== 'string' || !v.trim()) return null; // 번역 전량 요구는 기존 계약 그대로
    out.push(v.trim());
  }
  // 제목은 부가물의 부가물 — 없거나 비면 번역만 반환
  const t = j['title'];
  return { posts: out, title: typeof t === 'string' && t.trim() ? t.trim() : null };
}
```

translateDraft.test.ts: 기존 테스트의 반환값 검증을 `.posts`로 조정(의도 불변), 신규 2건 — title 정상 파싱 / title 누락 시 `{posts, title: null}`.

- [ ] **Step 3: draftStore.ts** — Row·DraftRow·toRow·insertDraft·updateDraft:

```ts
// DraftRow에 추가
koTitle: string | null; // 최신 버전과 해시가 일치할 때만 값 — 아니면 null(스테일 방지)
// Row에 ko_title: string | null; ko_title_hash: string | null; 추가, select 목록에도 추가
// toRow에서:
koTitle: r.ko_title && r.ko_title_hash === draftVersionHash(latest.posts) ? r.ko_title : null,
```

`insertDraft` 입력에 `koTitle?: string | null; koTitleHash?: string | null` + insert 컬럼. `updateDraft` patch에 동일 2필드(+coalesce 갱신식은 기존 translation 패턴을 따르되, **둘은 항상 쌍으로 세팅**).

- [ ] **Step 4: generate.ts 배선** — 4차 구조 위에 title 동승:

- generateDraft: `glosses[i]`가 이제 `{posts,title}|null`. `glossOf(i)`는 `g.posts` 사용. `insertOne`에 `koTitle: glosses[i]?.title ?? null, koTitleHash: glosses[i]?.title ? draftVersionHash(variants[i].posts) : null` 추가.
- rewriteDraft/regeneratePost: `gloss` 변수형을 결과 객체로. 캐시 선조회 히트 시(`draft.translation?.[h]`) 번역 재사용·제목은 미생성(스펙 허용) — 이 경우 koTitle patch 생략. LLM 호출 성공 시 `updateDraft`에 `koTitle: gloss.title, koTitleHash: gloss.title ? h : null` 포함(제목이 null이면 koTitle patch 생략 — 이전 제목을 지우지 않는다: 해시 불일치로 자연 무효되므로).
- 침묵 계약·타임아웃·warn 로그는 기존 그대로(반환형만 적응).

- [ ] **Step 5: translate 라우트** — 캐시 미스 경로에서 결과의 title도 저장:

```ts
    const r = await translateDraftPosts(texts);
    if (!r) return NextResponse.json({ error: '번역에 실패했어요 — 잠시 후 다시 시도해주세요' }, { status: 502 });
    await updateDraft(sql, id, {
      translation: { ...cache, [hash]: r.posts },
      ...(r.title ? { koTitle: r.title, koTitleHash: hash } : {}),
    });
    return NextResponse.json({ posts: r.posts });
```

(응답 형태는 불변 — 클라이언트 DraftCard 무영향. 단 hash가 최신 버전이 아닌 과거 버전 번역이면 제목 저장이 부적절 — `hash === draftVersionHash(versions[versions.length - 1].posts)`일 때만 title을 저장하도록 조건을 붙여라.)

- [ ] **Step 6: generate.test.ts** — fakeWithGloss의 번역 응답에 `"title":"다운타임 후기형"` 추가. 신규 검증: ① 생성 후 koTitle === '다운타임 후기형' ② 편집(updateDraft로 edited 변경)하면 koTitle이 null로 파생 ③ 번역 응답에 title이 없으면 koTitle null·translation은 저장. 기존 테스트는 fake 응답 JSON에 title 키가 추가되어도 영향 없어야 함(확인).

- [ ] **Step 7: 검증** — `node --import tsx --env-file-if-exists=.env --test src/lib/translateDraft.test.ts src/lib/generate.test.ts src/lib/draftStore.test.ts` 전부 PASS, `npx tsc --noEmit` 0건, `npm run lint` 24 기준선.

---

### Task 2: 프론트 — 라벨 폴백 체인 — 권장 모델: haiku

**Files:**
- Modify: `src/lib/draftViews.ts` / `src/lib/draftViews.test.ts`
- Modify: `src/components/DraftTable.tsx`, `src/components/DraftKanban.tsx`

**Interfaces:**
- Consumes: T1의 `DraftRow.koTitle`.

- [ ] **Step 1: draftViews.ts**

```ts
// 목록·보드의 항목 라벨 — 제목(생성 라벨) → 한국어 대역 첫 줄(번역) → 원문 첫 줄 (5차 스펙 §표시)
export function draftLabel(d: { koTitle: string | null; koLatest: string[] | null; content: PreviewSource; edited: PreviewSource | null }):
  { text: string; kind: 'title' | 'ko' | 'original' } {
  if (d.koTitle) return { text: d.koTitle, kind: 'title' };
  const ko = draftKoLine(d);
  if (ko) return { text: ko, kind: 'ko' };
  return { text: draftPreviewLine(d) || '(내용 없음)', kind: 'original' };
}
```

테스트 3건: 제목 우선 / 제목 없으면 ko / 둘 다 없으면 원문·빈 값 '(내용 없음)'.

- [ ] **Step 2: DraftKanban.tsx** — 미니 카드: `const label = draftLabel(d);`로 교체.

```tsx
                {label.kind === 'title' ? (
                  <>
                    <p className="text-ui font-medium">{label.text}</p>
                    {/* 제목이 있으면 본문 미리보기는 보조로 강등(대역 우선) — 제목은 생성 라벨이라 🌐 없음 */}
                    <p className="mt-0.5 truncate text-caption text-x-muted">{draftKoLine(d) ?? draftPreviewLine(d)}</p>
                  </>
                ) : (
                  <p className="line-clamp-2 text-ui">
                    {label.kind === 'ko' ? <><span title="한국어 번역으로 표시 중 — 원문은 카드에서">🌐 </span><span className="sr-only">한국어 번역: </span>{label.text}</> : label.text}
                  </p>
                )}
```

(기존 마커 주석·속성 칩 블록은 그대로.)

- [ ] **Step 3: DraftTable.tsx** — 원고 셀: `const label = draftLabel(d);`

```tsx
              <td className="max-w-[360px] truncate px-3 py-2"
                  title={label.kind === 'title' ? (draftKoLine(d) ?? draftPreviewLine(d)) : undefined}>
                {label.kind === 'title' ? <span className="font-medium">{label.text}</span>
                 : label.kind === 'ko' ? <><span title="한국어 번역으로 표시 중 — 원문은 카드에서">🌐 </span><span className="sr-only">한국어 번역: </span>{label.text}</>
                 : label.text}
              </td>
```

- [ ] **Step 4: 검증** — draftViews 단일 테스트 PASS, `npx tsc --noEmit` 0건, `npm run lint` 24 기준선.

---

## 실행 순서

| Wave | Task | 모델 |
|---|---|---|
| 1 | T1 서버(마이그레이션+동승 생성+koTitle) | sonnet |
| 2 | T2 프론트(라벨 체인) | haiku |

마감: 전체 `npm test` 회귀 + 최종 리뷰(opus — 스키마·비용 경로 포함).

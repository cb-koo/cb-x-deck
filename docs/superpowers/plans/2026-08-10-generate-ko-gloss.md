# /generate 한국어 대역 구현 계획 (워크벤치 4차)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 생성·다시쓰기·부분 재생성 시 한국어 대역을 자동 생성해 기존 번역 캐시에 저장(B)하고, 테이블·칸반 미리보기가 캐시된 한국어를 우선 표시(A). 스펙: `docs/superpowers/specs/2026-08-10-generate-ko-gloss-design.md`

**Architecture:** 번역은 기존 `translateDraftPosts`(경량 모델·용어집 동일)를 재사용하고 실패는 조용히 생략. 캐시 키는 현행 원문 해시 그대로, 클라이언트 조회는 서버 파생 필드 `DraftRow.koLatest`로 해결(해시 계산은 서버에만).

## Global Constraints

- DB 마이그레이션 금지(translation 컬럼 기존 존재). API 응답 형태는 additive 변경만(koLatest 추가).
- **번역 실패가 생성·다시쓰기를 실패시키면 안 된다** — try/catch + null 생략이 계약.
- 기존 `generate.test.ts` 테스트는 무변경 통과해야 한다(기존 fake가 번역 프롬프트에 posts JSON을 돌려줘도 translateDraftPosts가 null 반환 → 조용히 생략되는 것 자체가 검증).
- 검증: `npx tsc --noEmit` 0건, `npm run lint` 24 기준선, 단일 파일 테스트는 `node --import tsx --env-file-if-exists=.env --test <파일>` (실 DB — .env 필요).
- 작업자 git 커밋 금지 — 조율자가 커밋. 주석 한국어·제약과 이유만.
- 순차 실행: T1(서버) → T2(프론트, T1의 koLatest 타입 의존).

---

### Task 1: 서버 — 자동 대역 저장 + koLatest 파생 필드 — 권장 모델: sonnet

**Files:**
- Modify: `src/lib/draftStore.ts` (DraftRow.koLatest, toRow, insertDraft)
- Modify: `src/lib/generate.ts` (generateDraft·rewriteDraft·regeneratePost)
- Modify: `src/lib/generate.test.ts` (신규 테스트 추가 — 기존 테스트 무변경)

**Interfaces:**
- Produces: `DraftRow.koLatest: string[] | null` (T2가 사용), `insertDraft(input: { …, translation?: DraftTranslation | null })`.

- [ ] **Step 1: draftStore.ts**

`DraftRow`에 `koLatest: string[] | null;` 추가(translation 옆). import에 `import { hashSource } from './translationStore.ts';` 추가. `toRow`에서:

```ts
const toRow = (r: Row): DraftRow => {
  const translation = normalizeTranslation(r.translation);
  const latest = r.edited ?? r.content;
  return ({
    /* …기존 필드 그대로… */
    translation,
    // 최신 버전의 캐시 번역 — 해시 계산은 서버 소관(node:crypto), 클라이언트는 이 필드만 읽는다 (4차 스펙)
    koLatest: translation?.[hashSource(JSON.stringify(latest.posts.map((p) => p.text)), null)] ?? null,
    /* … */
  });
};
```

`insertDraft` 입력에 `translation?: DraftTranslation | null` 추가, insert 컬럼·값에 `translation` 포함:

```ts
    insert into draft (client_id, …, batch_id, variant_index, translation)
    values (…, ${input.batchId ?? null}, ${input.variantIndex ?? null},
            ${input.translation ? sql.json(input.translation as never) : null})
```

- [ ] **Step 2: generate.ts — generateDraft**

import 추가: `translateDraftPosts`(./translateDraft.ts), `hashSource`(./translationStore.ts), `type DraftTranslation`(./draftStore.ts).

variants 파싱·slice 이후, batchId 선언 전에:

```ts
  // 한국어 대역 — 부가물이라 실패(null·예외)해도 생성을 막지 않는다. mock client를 그대로 전달(테스트 가능성)
  const glosses = await Promise.all(variants.map(async (v) => {
    try { return await translateDraftPosts(v.posts.map((p) => p.text), client); } catch { return null; }
  }));
  const glossOf = (i: number): DraftTranslation | null => {
    const g = glosses[i];
    if (!g) return null;
    return { [hashSource(JSON.stringify(variants[i].posts.map((p) => p.text)), null)]: g };
  };
```

`insertOne`의 insertDraft 입력에 `translation: glossOf(i),` 추가.

- [ ] **Step 3: generate.ts — rewriteDraft·regeneratePost**

두 함수 모두, `edited` 확정 직후·`updateDraft` 직전에:

```ts
  // 새 버전의 한국어 대역 — 실패 시 기존 캐시 그대로(생략), 번역 버튼 경로가 커버
  let gloss: string[] | null = null;
  try { gloss = await translateDraftPosts(edited.posts.map((p) => p.text), client); } catch { gloss = null; }
```

`updateDraft` 호출을 다음처럼 확장(기존 인자 유지):

```ts
  await updateDraft(sql, draftId, {
    edited, history: [...draft.history, /* 기존 그대로 */],
    ...(gloss ? { translation: { ...(draft.translation ?? {}), [hashSource(JSON.stringify(edited.posts.map((p) => p.text)), null)]: gloss } } : {}),
  });
```

(regeneratePost의 history 인자는 기존 `[...draft.history, base]` 그대로.)

- [ ] **Step 4: 신규 테스트** — `generate.test.ts` 끝에 추가. **파일 상단의 기존 DB 셋업·정리 헬퍼와 테스트 작성 관례를 먼저 읽고 그대로 따르라.** 추가할 검증 3건:

```ts
// 프롬프트로 분기하는 fake — 원고 요청은 posts JSON, 번역 요청(translateDraftPosts의 프롬프트에 '번역가' 포함)은 번호 키 JSON
function fakeWithGloss(): AnthropicLike {
  return { messages: { create: async (p: unknown) => {
    const prompt = String((p as { messages: Array<{ content: unknown }> }).messages[0].content);
    if (prompt.includes('번역가')) {
      return { content: [{ type: 'text', text: JSON.stringify({ '1': '한국어 대역입니다' }) }] } as never;
    }
    return { content: [{ type: 'text', text: JSON.stringify({ posts: [{ text: '日本語の本文' }] }) }] } as never;
  } } };
}

test('생성 시 한국어 대역이 번역 캐시에 저장되고 koLatest로 노출된다', async () => { /* 관례대로 sql 준비 */
  // generateDraft(…, fakeWithGloss()) → getDraft:
  //   translation이 null이 아니고 키 1개, 값 deep equal ['한국어 대역입니다']
  //   listDrafts(또는 getDraft 경유 toRow)의 koLatest deep equal ['한국어 대역입니다']
});

test('번역이 실패해도 생성은 성공하고 캐시만 비어 있다', async () => {
  // 기존 fakeLLM(모든 호출에 posts JSON) → generateDraft 성공, getDraft().translation === null, koLatest === null
});

test('다시 쓰기의 새 버전에도 대역이 저장된다', async () => {
  // fakeWithGloss로 생성 → rewriteDraft(fakeWithGloss) → 최신 버전 koLatest === ['한국어 대역입니다'],
  //   translation 키 2개(원본 버전 + 새 버전)
});
```

(주석 처리된 부분은 파일의 기존 테스트가 쓰는 셋업·정리 코드를 그대로 복제해 완성하라 — 헬퍼 이름을 임의로 발명하지 말 것.)

- [ ] **Step 5: 검증**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/generate.test.ts` → 기존+신규 전부 PASS (기존 테스트 무변경 확인).
Run: `node --import tsx --env-file-if-exists=.env --test src/lib/draftStore.test.ts` → 회귀 없음.
Run: `npx tsc --noEmit && npm run lint` → 0건 / 24 기준선.

---

### Task 2: 프론트 — 미리보기 한국어 우선 + 🌐 마커 — 권장 모델: haiku

**Files:**
- Modify: `src/lib/draftViews.ts` / `src/lib/draftViews.test.ts`
- Modify: `src/components/DraftTable.tsx`, `src/components/DraftKanban.tsx`

**Interfaces:**
- Consumes: T1의 `DraftRow.koLatest: string[] | null`.
- Produces: `draftKoLine(d: { koLatest: string[] | null }): string | null`.

- [ ] **Step 1: draftViews.ts에 추가 + 테스트**

```ts
// 캐시된 한국어 대역의 첫 줄 — 없으면 null(호출부가 원문 미리보기로 폴백)
export function draftKoLine(d: { koLatest: string[] | null }): string | null {
  const t = d.koLatest?.[0];
  if (!t) return null;
  const line = (t.split('\n')[0] ?? '').trim();
  return line || null;
}
```

테스트(draftViews.test.ts에 추가):

```ts
test('draftKoLine: 캐시 없으면 null, 있으면 첫 줄만', () => {
  assert.equal(draftKoLine({ koLatest: null }), null);
  assert.equal(draftKoLine({ koLatest: ['첫 줄\n둘째 줄'] }), '첫 줄');
  assert.equal(draftKoLine({ koLatest: ['  '] }), null);
});
```

Run: `node --import tsx --test src/lib/draftViews.test.ts` → PASS.

- [ ] **Step 2: DraftKanban.tsx 미리보기 교체**

미니 카드 map 콜백을 블록 바디로 바꾸고 첫 `<p>`를:

```tsx
            {byStatus[s].map((d) => {
              const ko = draftKoLine(d);
              return (
              <div key={d.id} /* …기존 속성 전부 그대로… */>
                {/* 캐시된 한국어 대역 우선 — 번역본임은 🌐로 명시(원문인 척하면 라벨-값 불일치, 원칙 4) */}
                <p className="line-clamp-2 text-ui">
                  {ko ? <><span aria-hidden title="한국어 번역으로 표시 중 — 원문은 카드에서">🌐 </span>{ko}</> : (draftPreviewLine(d) || '(내용 없음)')}
                </p>
                {/* …이하 기존 그대로… */}
              </div>
              );
            })}
```

import에 `draftKoLine` 추가.

- [ ] **Step 3: DraftTable.tsx 원고 셀 교체**

행 map을 블록 바디로 바꾸고 원고 `<td>`를:

```tsx
          {rows.map((d) => {
            const ko = draftKoLine(d);
            return (
            <tr key={d.id} /* …기존 속성 전부 그대로… */>
              <td className="max-w-[360px] truncate px-3 py-2">
                {ko ? <><span aria-hidden title="한국어 번역으로 표시 중 — 원문은 카드에서">🌐 </span>{ko}</> : (draftPreviewLine(d) || '(내용 없음)')}
              </td>
              {/* …이하 셀 기존 그대로… */}
            </tr>
            );
          })}
```

import에 `draftKoLine` 추가.

- [ ] **Step 4: 검증** — `npx tsc --noEmit && npm run lint && npx eslint src/components/DraftTable.tsx src/components/DraftKanban.tsx src/lib/draftViews.ts` → 0건 / 24 기준선.

---

## 실행 순서

| Wave | Task | 파일 | 모델 |
|---|---|---|---|
| 1 | T1 서버 대역 저장+koLatest | draftStore·generate(+test) | sonnet |
| 2 | T2 미리보기 한국어 우선 | draftViews(+test)·DraftTable·DraftKanban | haiku |

마감: 전체 `npm test` 회귀 + 최종 리뷰(opus — 서버·비용 경로 포함).

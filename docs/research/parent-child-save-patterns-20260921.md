# 부모가 아직 없는 자식 레코드를 만드는 폼 — 다른 제품·API의 처리 방식

- 작성일: 2026-09-21
- 목적: "작업(부모) 만들기" 폼에서 "원고(자식)"까지 같이 만들려 할 때, 원고는 작업 없이도 '미부착' 상태로 존재할 수 있고 작업은 저장돼야만 원고를 붙일 수 있는 우리 상황에 참고할, 다른 제품·API의 1차 출처 기반 처리 패턴 조사
- 1차 출처만 근거로 삼음: 공식 API 레퍼런스(docs.x.com, developer.x.com, docs.stripe.com, shopify.dev, developers.google.com, developers.notion.com, developer.atlassian.com), 공식 제품 블로그(linear.app). 서드파티 블로그·튜토리얼·Stack Overflow류는 1차 출처 URL을 찾는 단서로만 썼고 근거로 인용하지 않음.
- 표기 원칙: 문서에서 명시적으로 확인한 것만 적음. 확인 못 한 것은 "확인 못 함" 또는 "명시 없음"으로 표기.

---

## 세 갈래 분류 기준 (다시 확인)

1. **부모 선생성(draft/optimistic)** — 부모를 먼저 초안 상태로 실제 저장, 자식은 처음부터 진짜 부모에 붙음
2. **자식 선생성 후 부착** — 자식을 부모 없이 먼저 만들고(고아 가능 상태), 부모 저장 시 참조 ID로 붙임
3. **단일 요청 저장** — 클라이언트가 전부 들고 있다가 한 번의 트랜잭션 요청으로 부모+자식을 함께 생성

---

## 1. X(Twitter) API v2 — 미디어 업로드 → 트윗 생성

**갈래: 2 (자식 선생성 후 부착)**

- 흐름: `POST /2/media/upload/initialize`(INIT) → `POST /2/media/upload/{id}/append`(APPEND, 청크 업로드) → `POST /2/media/upload/{id}/finalize`(FINALIZE)로 `media_id`를 먼저 발급받고, 이후 `POST /2/tweets` 생성 시 `{"media": {"media_ids": ["..."]}}`로 참조한다.
  출처: [Chunked Media Upload](https://docs.x.com/x-api/media/quickstart/media-upload-chunked), [Initialize a media upload request](https://docs.x.com/x-api/media/media-upload-initialize)
- INIT 응답 필드: `id`(media_id), `media_key`, **`expires_after_secs`**("Seconds until the upload session expires"). 문서의 예시 응답값은 `"expires_after_secs": 86400`(24시간).
  출처: [Initialize a media upload request](https://docs.x.com/x-api/media/media-upload-initialize), [Chunked Media Upload](https://docs.x.com/x-api/media/quickstart/media-upload-chunked)
- **고아 자식(부모 미생성) 처리 규칙**: v1.1 레거시 문서(현재도 게시 중인 공식 문서)에 명시적 문장이 있다 — *"The returned media_id and media_key are only valid for expires_after_secs seconds, and any attempt to use either after this time period in other endpoints will result in an HTTP 4xx Bad Request."*
  출처: [POST media/upload | X Developer Platform](https://developer.x.com/en/docs/x-api/v1/media/upload-media/api-reference/post-media-upload), [POST media/upload (FINALIZE)](https://developer.x.com/en/docs/x-api/v1/media/upload-media/api-reference/post-media-upload-finalize)
  → 즉 **자동 삭제가 아니라 "시간 초과 시 참조 실패(4xx)"로 처리**한다. 서버가 실제로 파일을 지우는지, 아니면 단순히 미디어 ID를 더 이상 유효하지 않게 취급하는지는 문서에 구분되어 있지 않음(**확인 못 함**) — 사용자 관점에서는 "영구 보존"이 아니라 "일정 시간 후 재사용 불가"라는 결과만 보장됨.
- **부분 실패 시 무엇이 남는가**: APPEND 도중 실패하거나 트윗 생성이 실패해도 이미 FINALIZE된 media_id 자체는 (만료 전까지는) 그대로 유효하게 남는다 — 문서가 "재시도 시 같은 media_id로 다시 트윗 생성을 시도할 수 있다"는 취지로 median_id를 세션이 아니라 참조 가능한 리소스로 다루고 있음. 다만 "재사용해서 다른 트윗에 붙일 수 있다"고 명시적으로 쓰여 있진 않음(**확인 못 함** — 정황상 가능해 보이나 문서가 이를 보장하는 문장은 찾지 못함).
- **이 선택의 대가로 문서가 인정하는 단점**: 문서 자체에 "단점"으로 서술된 문장은 없음. 다만 만료 시간이 있다는 것 자체가 "폼을 오래 열어두면 다시 업로드해야 한다"는 제약을 내포함(개발자 커뮤니티에서 `expires_after_secs`를 늘려달라는 요청이 있었으나, 이는 1차 출처가 아니므로 참고만 함).

---

## 2. Stripe — Invoice Item(자식) → Invoice(부모)

**갈래: 혼합(기본은 2, `invoice` 파라미터를 채우면 즉시 부모에 부착됨) — 다만 우리 질문에 가장 가까운 건 "자식이 부모 없이도 유효한 최종 상태로 존재할 수 있다"는 점에서 2에 더 가깝다.**

- Invoice item 생성 시 `invoice` 파라미터는 선택(optional). **비워두면**: *"If no invoice is specified, the item will be on the next invoice created for the customer specified."* — 즉 특정 부모에 묶이지 않고 "미래의 아무 인보이스에나 자동으로 편입되는 대기 상태(pending item)"로 존재한다.
  출처: [Create an invoice item](https://docs.stripe.com/api/invoiceitems/create)
- Invoice 객체 자체도 `status: draft`로 생성되며, **draft는 완전히 수정 가능**하고 `finalize`를 호출하기 전까지는 `open`으로 전이되지 않는다. `auto_advance=false`면 "명시적 액션 없이는 상태가 자동으로 진행되지 않는다."
  출처: [The Invoice object](https://docs.stripe.com/api/invoices/object) (`status`, `auto_advance`, `status_transitions` 필드 설명)
- Invoice line은 정렬 순서 자체가 "(1) pending invoice items(대기 항목)가 역시간순으로 먼저, (2) subscription 항목, (3) invoice 생성 후 추가된 item 순"으로 문서화되어 있어, **"부모 없는 자식(pending item)"이 정식으로 존재하는 상태로 다뤄진다**는 것을 확인.
  출처: [The Invoice object](https://docs.stripe.com/api/invoices/object) (`lines` 필드 설명)
- **고아 자식(부모가 끝내 안 생긴 경우) 처리 규칙**: pending item이 만료되거나 자동 삭제된다는 문장은 이 두 문서에서 찾지 못함(**확인 못 함**) — 오히려 "다음에 생성되는 인보이스에 편입된다"는 표현은 **무기한 대기(사실상 영구 보존에 가까움)**를 시사한다. 명시적 TTL·자동 정리 문장은 없음.
- **부분 실패 시 무엇이 남는가**: Draft invoice는 최대 250개 item까지 담을 수 있고(`up to 250 items per invoice`), 특정 invoice item 생성에 실패해도 이미 만들어진 item·invoice는 각각 독립된 리소스로 남는다 — Stripe API는 "invoice item 생성"과 "invoice에 편입"을 별개 리소스·별개 API 콜로 분리해뒀기 때문에, 이 구조 자체가 원자적 트랜잭션이 아니라 **부분 상태가 항상 남을 수 있는 설계**임이 리소스 모델에서 드러남(명시적으로 "부분 실패 시 롤백 없음"이라고 쓴 문장은 못 찾음 — **확인 못 함**, 리소스 분리 구조로부터의 추론).
- **대가로 인정된 단점**: 문서에 "단점"으로 명시된 서술은 없음. 다만 draft invoice가 왜 존재하는지에 대한 정당화는 명확함 — draft 상태에서 항목을 자유롭게 더하고 빼고 세율·기간을 조정할 수 있어야 하기 때문(청구 확정 전 편집 가능성이 핵심 이유).

---

## 3. Shopify Admin API — Draft Order → Order

**갈래: 1 (부모 선생성) — DraftOrder 자체가 이미 "주문의 초안" 리소스이며, line item은 DraftOrder 생성 요청 안에 함께 들어간다.**

- 상태값: `open`(기본, 미완료 초안), `invoice_sent`(청구서 발송됨), `completed`(완료되어 정식 Order로 전환됨).
  출처: [DraftOrder — Admin REST API](https://shopify.dev/docs/api/admin-rest/latest/resources/draftorder)
- `draftOrderComplete` (GraphQL) 뮤테이션이 draft order를 정식 order로 전환한다 — *"완료되면 merchant의 주문 목록에 나타나고, 고객에게 알림이 갈 수 있다."*
  출처: [draftOrderComplete — GraphQL Admin](https://shopify.dev/docs/api/admin-graphql/latest/mutations/draftOrderComplete)
- **삭제 엔드포인트 존재**: `DELETE /admin/api/latest/draft_orders/{draft_order_id}.json` — *"Remove an existing DraftOrder."*
  출처: [DraftOrder — Admin REST API](https://shopify.dev/docs/api/admin-rest/latest/resources/draftorder)
- **고아 자식(여기서는 "완료되지 않은 채 남는 draft order" 자체) 처리 규칙**: 두 문서 모두에 **자동 삭제·만료 정책에 대한 언급이 없다.** `open` 상태로 무기한 남을 수 있는 것으로 보이며(명시적 TTL 없음), 정리는 수동 `DELETE` 호출에 의존하는 구조로 읽힌다. **확인 못 함**: "N일 후 자동 정리"류의 배치 잡이 Shopify 쪽에 있는지는 이 두 문서에서 확인되지 않음.
- **부분 실패 시 무엇이 남는가**: DraftOrder는 애초에 "주문 전체(라인 아이템 포함)"를 하나의 리소스로 만드는 구조라, 라인 아이템만 따로 존재하다 고아가 되는 케이스 자체가 설계상 없음 — 즉 Shopify는 이 문제를 "자식을 부모 없이 만들 수 있는 API 자체를 제공하지 않음"으로 해결한 사례. 이는 Notion의 필수 parent 규칙과 같은 계열의 해법.
- **대가로 인정된 단점**: 문서에 명시된 단점 서술 없음(**확인 못 함**). 다만 이 설계의 구조적 귀결로, "먼저 상품 없이 라인 아이템만 저장해뒀다가 나중에 주문에 붙이는" 유즈케이스 자체가 Draft Order API로는 불가능 — 그런 용도라면 별도 초안 저장(예: 앱 자체 DB)을 만들어야 한다.

---

## 4. Gmail API — Draft(부모=자식과 동일 리소스)

**갈래: 1에 가까움, 그러나 정확히는 "부모/자식 분리가 없는" 특수 사례** — Draft 자체가 곧 (아직 발송되지 않은) 메시지이므로, 우리 질문의 "부모 없이 못 붙는 자식" 문제가 애초에 발생하지 않는 설계.

- *"Email drafts represent unsent messages with the `DRAFT` system label applied."*
  출처: [Create and send draft emails](https://developers.google.com/workspace/gmail/api/guides/drafts)
- `users.drafts.create`로 만든 Draft는 그 자체로 완결된 리소스이고, `users.drafts.send`로 "이미 존재하는 draft"를 발송한다. 즉 초안(부모격)을 먼저 만들고 그 위에서 계속 편집하다가, 준비되면 같은 리소스를 발송 상태로 전이시키는 구조 — 이는 우리가 검토 중인 "패턴 1(부모 선생성)"의 극단적 형태(부모와 자식을 애초에 나누지 않음)로 볼 수 있다.
  출처: [Method: users.drafts.create](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.drafts/create), [Method: users.drafts.send](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.drafts/send)
- **고아 자식 처리 규칙 / 자동 만료**: 가이드 문서에 draft의 보관 기간·자동 삭제 정책에 대한 언급 없음(**확인 못 함**). 문서상으로는 사용자가 명시적으로 삭제(`users.drafts.delete`)하기 전까지 무기한 보존되는 것으로 보이나, "무기한 보존"이라고 명시한 문장 자체는 찾지 못함.
- **부분 실패 시 무엇이 남는가**: 해당 없음 — 애초에 부모/자식 분리 트랜잭션이 아니므로 부분 실패 개념이 성립하지 않음.
- **대가로 인정된 단점**: 명시 없음.

---

## 5. Jira Cloud REST API — 첨부파일

**두 가지 다른 갈래가 공존:**

### 5-1. 일반 이슈 첨부(표준 Jira Cloud) — **갈래 3(단일 요청)**

- `POST /rest/api/3/issue/{issueIdOrKey}/attachments` — 이미 존재하는 이슈에 파일을 multipart/form-data로 바로 첨부하는 **단일 엔드포인트**. `X-Atlassian-Token: no-check` 헤더 필요, 파라미터명은 `file`.
  출처: [The Jira Cloud platform REST API — Issue attachments](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-attachments/), [How to add an attachment to Jira Cloud work items using the REST API](https://support.atlassian.com/jira/kb/how-to-add-an-attachment-to-a-jira-cloud-issue-using-rest-api/)
- 즉 표준 이슈 첨부는 "임시 업로드 후 부착" 2단계가 아니라, **이슈(부모)가 이미 존재해야만 호출 가능한 단일 요청**이다. 부모 없이 파일만 먼저 올려두는 경로 자체가 없음.

### 5-2. Jira Service Management(고객 요청) 첨부 — **갈래 2(자식 선생성 후 부착)**

- `POST /rest/servicedeskapi/servicedesk/{serviceDeskId}/attachTemporaryFile` — *"This method adds one or more temporary attachments to a service desk, which can then be permanently attached to a customer request."* 응답으로 `temporaryAttachmentId`(예: `temp8186986881700442965`)를 받는다.
  출처: [The Jira Service Management Cloud REST API](https://developer.atlassian.com/cloud/jira/service-desk/rest/api-group-servicedesk/)
- 이후 `servicedeskapi/request/{issueIdOrKey}/attachment`로 이 `temporaryAttachmentId`를 정식 요청(고객 요청 티켓)에 부착한다.
- **고아 자식(temporary file이 끝내 안 붙는 경우) 처리 규칙**: 문서에 **만료 시간·자동 정리 정책이 명시되어 있지 않음(확인 못 함)**. Atlassian 커뮤니티 포럼에도 이 부분에 대한 명확한 1차 답변을 찾지 못함.
- **부분 실패 시 무엇이 남는가**: 명시 없음.
- **대가로 인정된 단점**: 명시 없음. 다만 Jira 자체가 "표준 이슈는 단일 요청(3-1)", "Service Desk 고객 요청은 임시 업로드 후 부착(3-2)" 두 가지를 **용도별로 다르게** 채택했다는 점이 흥미로움 — 고객이 티켓(부모) 생성 폼을 작성하는 동안 파일을 먼저 올려야 하는 Service Desk의 UX 요구가 갈래 2를 쓰게 만든 것으로 보이며, 이는 우리 상황(작업 폼 작성 중 원고를 먼저 준비)과 구조적으로 가장 유사한 사례다.

---

## 6. Notion API — `pages.create`의 `parent` 규칙

**갈래: 해당 없음에 가까움(자식 선생성 자체를 막는 설계) — Shopify와 같은 계열.**

- *"In most cases, you should provide a page_id or data_source under the parent parameter to create a page under an existing page or data source."*
- **내부 연결(internal integration)의 경우 parent가 사실상 필수**: *"For internal connections, a page or data source parent is currently required in the API, because there is no one specific Notion user associated with them that could be used as the 'owner' of the new private page."*
- 예외적으로 **공개 연결(public integration)이나 개인 액세스 토큰(personal access token)**을 쓸 때만, `parent`를 생략하거나 `parent[workspace]=true`로 지정해 워크스페이스 레벨의 비공개 페이지(=사실상 최상위 부모 없는 페이지)를 만들 수 있다.
  출처: [Create a page — Notion API Reference](https://developers.notion.com/reference/post-page)
- **고아 자식 처리 규칙**: 애초에 대부분의 경로(내부 연결)에서 부모 없는 페이지 생성 자체를 API 레벨에서 막아버리므로, "고아 자식"이라는 상태가 성립하지 않는다. 이는 우리 질문에서 가장 중요한 시사점 — **Notion은 API 차원에서 "자식이 고아가 될 수 있는 경로"를 원천적으로 설계에서 제거**했다.
- **부분 실패**: 해당 없음(단일 페이지 생성 요청이므로).
- **대가로 인정된 단점**: 문서에 명시된 단점은 없음. 다만 이 제약 때문에 "부모를 아직 안 정했지만 콘텐츠부터 쓰고 싶다"는 UX(예: Notion 데스크톱 앱의 Quick Note 같은 기능)를 API로 그대로 흉내내려면, 결국 앱 쪽에서 임시 워크스페이스 루트 페이지 같은 "고정 부모"를 하나 만들어두고 나중에 `pages.move`류로 옮기는 우회가 필요해진다 — 이건 문서가 아니라 API 제약으로부터의 추론(**확인 못 함**: Notion이 실제로 이 우회를 권장하는 문서는 찾지 못함).

---

## 7. Google Drive API — Resumable Upload 세션

**갈래: 3에 가까움(세션이 커밋되기 전까지는 "파일"이라는 리소스 자체가 존재하지 않음) — 다만 메타데이터(부모 폴더 등)를 세션 시작 시점에 함께 보낼 수도 있어 실질적으로는 부모+자식을 한 세션 안에서 확정하는 구조.**

- *"A resumable session URI expires after one week."*
  출처: [Upload file data | Google Drive](https://developers.google.com/workspace/drive/api/guides/manage-uploads)
- *"the initial response for a resumable upload doesn't return a `files` resource"* — 즉 세션을 여는 시점에는 아직 정식 `File` 리소스가 존재하지 않고, 업로드가 완료되어야 `File` 리소스가 반환된다.
  출처: [Upload file data | Google Drive](https://developers.google.com/workspace/drive/api/guides/manage-uploads)
- **고아 자식(세션이 끝내 완료되지 않는 경우) 처리 규칙**: 세션 URI가 1주일 후 만료된다는 것은 명시돼 있으나, **만료된 세션에 이미 업로드된 바이트가 Drive 저장소에 부분 파일로 남는지, 아니면 애초에 커밋 전에는 아무 것도 저장되지 않는지는 이 문서에 명시되어 있지 않음(확인 못 함)**. "파일 리소스가 반환되지 않는다"는 문장은 "사용자에게 보이는 정식 파일이 없다"는 뜻이지, "서버에 바이트가 전혀 안 남는다"는 뜻과 동일하지 않아 구분이 필요함.
- **부분 실패 시 무엇이 남는가**: 명시 없음(위와 동일한 이유).
- **대가로 인정된 단점**: 명시 없음.

---

## 8. Linear — "즉시 로컬 생성 후 동기화"에 대해 확인 못 한 것

- Linear 공식 블로그([Scaling the Linear Sync Engine](https://linear.app/now/scaling-the-linear-sync-engine))는 동기화 엔진에 대한 **발표 영상을 소개하는 페이지**로, 이슈 생성이 로컬에서 즉시 낙관적으로 반영된다는 구체적 문장은 본문 텍스트에 없었다(영상 안에 있을 가능성은 있으나 영상 콘텐츠는 검증하지 않음).
- **결론: Linear의 "새 이슈를 누르면 즉시 로컬에 생성되고 백그라운드에서 서버와 동기화된다"는 통설은 이번 조사의 1차 출처 기준으로는 확인 못 함.** (서드파티 리버스엔지니어링 글·블로그에는 이런 서술이 여럿 있었으나, 지시사항에 따라 근거로 채택하지 않음.) 따라서 이번 문서에서는 Linear를 사례로 인용하지 않는다.

---

## 정리 표

| 제품/API | 갈래 | 고아 자식 처리 | 부분 실패 시 잔존물 | 문서가 인정한 단점 |
|---|:---:|---|---|---|
| X API v2 미디어 업로드 | 2 | `expires_after_secs`(기본 24h) 경과 시 4xx로 재사용 차단(삭제 여부는 확인 못 함) | media_id는 만료 전까지 유지(확인 못 함: 재사용 가능 명시는 없음) | 명시 없음 |
| Stripe Invoice/Invoice Item | 2에 가까움 | 명시 없음(사실상 무기한 대기 상태로 남는 것으로 읽힘) | item·invoice가 독립 리소스라 부분 상태 항상 가능(추론) | 명시 없음 |
| Shopify Draft Order | 1 (자식 분리 자체가 없음) | 자동 삭제 정책 명시 없음, 수동 `DELETE`만 존재 | 해당 없음(단일 리소스) | 명시 없음 |
| Gmail Draft | 1의 극단형(부모=자식) | 명시 없음(수동 삭제 전까지 유지되는 것으로 보임) | 해당 없음 | 명시 없음 |
| Jira 표준 이슈 첨부 | 3 | 해당 없음(부모 필수) | 해당 없음 | — |
| Jira Service Desk 첨부 | 2 | 명시 없음 | 명시 없음 | 명시 없음 |
| Notion `pages.create` | 자식 선생성 원천 차단 | 해당 없음(설계로 방지) | 해당 없음 | 명시 없음(우회 필요성은 추론) |
| Google Drive resumable upload | 3에 가까움 | 세션 1주일 만료, 커밋 전 파일 리소스 없음(부분 바이트 잔존 여부는 확인 못 함) | 명시 없음 | 명시 없음 |
| Linear | 확인 못 함(1차 출처 텍스트 없음) | — | — | — |

---

## § 우리 사례에 적용

우리 상황: 원고(자식)는 작업 없이도 미리 만들어질 수 있고 '미부착' 상태로 존재하며, 미부착 원고는 작업 폼의 '있는 원고 고르기'에 다시 나타나 재사용된다(관련 코드: `src/lib/draftStore.ts`, `src/app/api/drafts/route.ts`, `src/app/campaigns/flow/TaskPanel.tsx`). 즉 **우리는 이미 갈래 2(자식 선생성 후 부착) 모델을 쓰고 있고, 게다가 "미부착"이 사고가 아니라 정식 최종 상태(재사용 가능한 원고 풀)로 설계돼 있다.**

이 조사에서 가장 가까운 비교 대상은 **Stripe의 pending invoice item**과 **Jira Service Desk의 temporary attachment**다.

- **Stripe**: pending item(부모 없는 invoice item)을 "버그"나 "고아"로 취급하지 않고, 오히려 "다음에 만들어질 인보이스에 자동으로 편입되는 정식 대기 상태"로 문서화했다. 이게 우리의 '미부착 원고 = 재사용 가능한 자산' 모델과 정확히 같은 철학이다. Stripe 문서 어디에도 "pending item을 자동으로 지운다"는 서술이 없다는 것(확인 못 함 = 명시적 TTL이 없다는 뜻)도 참고할 만하다 — **부모 없는 자식을 굳이 시간 기반으로 청소하지 않는 선례**로 볼 수 있다.
- **Jira Service Desk**: temporary attachment도 만료 정책이 문서에 없다(확인 못 함). 다만 Jira는 이걸 "고객 요청 폼을 작성하는 짧은 세션 동안만 쓰는 임시 자산"으로 좁게 설계했고(첨부 즉시 부착을 유도), 우리처럼 "미부착 상태로 몇 주씩 재사용되는 자산 풀"을 만들 의도는 애초에 없어 보인다. 즉 Jira 사례는 "짧은 임시 보관"과 "장기 재사용 가능한 미부착 자산"이 서로 다른 문제라는 걸 보여준다 — **우리 문제는 Jira의 temporary file보다는 Stripe의 pending item, 혹은 Notion처럼 "부모를 아예 강제"하는 쪽보다는 완화된 형태**에 더 가깝다.
- **X API 미디어**는 정반대 선택지를 보여준다 — "재사용 자산 풀"을 만들 의도가 전혀 없고(트윗 하나에 즉시 붙이는 것이 유일한 목적), 그래서 24시간이라는 짧고 명시적인 TTL로 고아를 강하게 억제한다. 우리가 만약 "미부착 원고를 몇 달이고 재사용"하게 둘 계획이 아니라 "이 작업 폼 세션 동안만 임시로 들고 있다가 곧 붙일" 용도라면, X 모델(짧은 TTL)이 참고가 된다.
- **Notion·Shopify**는 우리와 반대 방향의 선택이다 — 아예 API 레벨에서 "부모 없는 자식 생성"을 막아서 고아 문제 자체를 없앴다. 이건 우리에게는 이미 늦은 선택지다: 미부착 원고가 '있는 원고 고르기'에서 재사용되는 게 이미 정식 기능이므로, 지금 와서 "원고는 작업 없이 못 만든다"로 되돌리는 건 기존 기능(원고 우선 작성 흐름)을 없애는 것과 같다.

**"고아 원고가 쌓이는 문제를 다른 제품들은 어떻게 막는가"에 대한 근거 기반 답:**

1차 출처들을 종합하면, **조사한 어떤 사례도 "고아 자식을 막기 위한 자동 청소(TTL 기반 삭제)"를 실제로 문서화해 보여주지 않았다** — 유일하게 명시적 TTL이 있는 X 미디어조차, 그 TTL이 "재사용 자산 풀을 막기 위한 청소"가 아니라 "한 번 쓰고 버리는 업로드 세션의 유효 기간"이라는 좁은 목적이다. 대신 관찰된 두 가지 실질적 전략은:

1. **애초에 부모 없는 자식을 만들지 못하게 한다** (Shopify Draft Order, Notion 내부 연결) — 고아가 구조적으로 발생하지 않음. 우리에게는 이미 채택 불가능(기존 기능과 충돌).
2. **부모 없는 자식을 "버그"가 아니라 "재사용 가능한 정식 자원 풀"로 인정하고, 그 풀 자체를 사용자에게 보여주는 목록(재고)으로 노출한다** (Stripe pending items — 다음 invoice 미리보기에 자동 노출됨). 이는 정확히 우리가 이미 하고 있는 것('있는 원고 고르기' 목록)과 같다.

즉 이번 조사 기준으로는, **"고아가 쌓이는 것 자체를 막는" 사례보다 "고아를 정식 재고로 관리 가능하게 노출하는" 사례가 우리 상황과 더 잘 맞는 선례**라고 판단된다. TTL 기반 자동 삭제로 미부착 원고를 정리하는 선례는 이번 조사의 1차 출처들에서 찾지 못했다 — 만약 미부착 원고 누적이 실제 문제라면(스토리지·목록 가독성), 그건 이번에 조사한 어떤 제품도 "만료"로 풀지 않았고, 대신 목록 UI에서의 필터링·정렬(오래된 미부착 원고를 눈에 덜 띄게)이나 사용자의 명시적 삭제 액션에 의존하는 것으로 보인다(다만 이 마지막 문장은 각 제품 문서에 명시된 결론이 아니라, 위 개별 사례들에서 공통적으로 관찰된 "명시적 자동 삭제 부재"로부터의 조사자 추론임 — 참고용으로만 사용할 것).

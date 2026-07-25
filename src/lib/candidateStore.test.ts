import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import { upsertTweets } from './tweetStore.ts';
import { createWorkspace, deleteWorkspace, createMember } from './workspaceStore.ts';
import { saveCandidate, removeCandidate, setMemo, addTag, removeTag, listCandidates, listAllTags,
         ensureLibraryItem, removeLibraryTweet, listLibraryTweets } from './candidateStore.ts';
import type { DeckTweet } from './types.ts';

const sql = getSql();
const P = 'test-cd-' + process.pid + '-';

function tw(id: string): DeckTweet {
  return {
    tweetId: P + id, authorHandle: 'tester', authorName: null, authorAvatarUrl: null, authorFollowers: null,
    text: 'saved ' + id, media: [], quoted: null,
    metrics: { views: 10, likes: null, retweets: null, replies: null, quotes: null, bookmarks: null },
    tweetUrl: null, tweetCreatedAt: null,
  };
}

after(async () => {
  await sql`delete from tweet where tweet_id like ${P + '%'}`;
  await sql`delete from workspace where name like ${P + '%'}`;
  await sql`delete from member where name like ${P + '%'}`;
  await sql`delete from tag where name like ${P + '%'}`;
  await sql.end();
});

test('멤버별 저장·중복 허용·필터·태그·워크스페이스 격리', async () => {
  const ws1 = await createWorkspace(sql, P + 'w1');
  const ws2 = await createWorkspace(sql, P + 'w2');
  const mA = await createMember(sql, P + 'A', '#111111');
  const mB = await createMember(sql, P + 'B', '#222222');
  try {
    await upsertTweets(sql, [tw('a'), tw('b')]);

    // 같은 트윗을 A·B가 각자 저장 (중복 허용) — 멱등: 같은 멤버 재저장은 기존 반환
    const cA = await saveCandidate(sql, { tweetId: P + 'a', workspaceId: ws1.id, memberId: mA.id });
    const cA2 = await saveCandidate(sql, { tweetId: P + 'a', workspaceId: ws1.id, memberId: mA.id });
    assert.equal(cA.id, cA2.id);
    const cB = await saveCandidate(sql, { tweetId: P + 'a', workspaceId: ws1.id, memberId: mB.id });
    assert.notEqual(cA.id, cB.id);
    assert.equal(cB.member.name, P + 'B');
    await saveCandidate(sql, { tweetId: P + 'b', workspaceId: ws1.id, memberId: mA.id });

    // 목록: 전체 3건 / 멤버 필터 A→2, B→1 / 다른 워크스페이스 0
    assert.equal((await listCandidates(sql, ws1.id)).length, 3);
    assert.equal((await listCandidates(sql, ws1.id, { memberId: mA.id })).length, 2);
    assert.equal((await listCandidates(sql, ws1.id, { memberId: mB.id })).length, 1);
    assert.equal((await listCandidates(sql, ws2.id)).length, 0);

    // 메모·태그 (모두 소유 멤버 id로 스코프)
    await setMemo(sql, cA.id, '포맷 참고', mA.id);
    const tag = await addTag(sql, cA.id, P + 'tag', mA.id);
    assert.ok(tag);
    const withTag = await listCandidates(sql, ws1.id, { tag: P + 'tag' });
    assert.equal(withTag.length, 1);
    assert.equal(withTag[0].memo, '포맷 참고');
    const tags = await listAllTags(sql, ws1.id);
    assert.ok(tags.some((t) => t.name === P + 'tag' && t.count === 1));
    // 같은 콘텐츠에 B도 같은 태그 → 카운트는 콘텐츠 수 기준이라 여전히 1
    const tagB = await addTag(sql, cB.id, P + 'tag', mB.id);
    assert.ok(tagB);
    assert.ok((await listAllTags(sql, ws1.id)).some((t) => t.name === P + 'tag' && t.count === 1));

    // 소유권 강제: 다른 멤버(mB)가 A의 후보(cA)를 건드리면 무효(false/null), 상태는 변경되지 않음
    const memoOk = await setMemo(sql, cA.id, '남의 메모 침해 시도', mB.id);
    assert.equal(memoOk, false);
    const afterBadMemo = (await listCandidates(sql, ws1.id, { memberId: mA.id })).find((c) => c.id === cA.id);
    assert.equal(afterBadMemo?.memo, '포맷 참고');
    const badTag = await addTag(sql, cA.id, P + 'tag-intrusion', mB.id);
    assert.equal(badTag, null);
    const badRemove = await removeTag(sql, cA.id, tag.id, mB.id);
    assert.equal(badRemove, false);
    const stillTagged = await listCandidates(sql, ws1.id, { tag: P + 'tag' });
    assert.ok(stillTagged.some((c) => c.id === cA.id));

    await removeTag(sql, cB.id, tagB.id, mB.id);
    await removeTag(sql, cA.id, tag.id, mA.id);

    // 자기 것만 해제 — B의 저장은 남음
    await removeCandidate(sql, { tweetId: P + 'a', workspaceId: ws1.id, memberId: mA.id });
    const remain = await listCandidates(sql, ws1.id);
    assert.deepEqual(remain.map((c) => c.member.name).sort(), [P + 'A', P + 'B'].sort()); // b(A) + a(B)
    assert.equal(remain.length, 2);
  } finally {
    await deleteWorkspace(sql, ws1.id);
    await deleteWorkspace(sql, ws2.id);
  }
});

test('library_item: 소속 분리 · 저장취소 후 잔존 · 팀에서 빼기 · 0명 항목', async () => {
  const ws = await createWorkspace(sql, P + 'lw');
  const mA = await createMember(sql, P + 'LA', '#111111');
  const mB = await createMember(sql, P + 'LB', '#222222');
  try {
    await upsertTweets(sql, [tw('x'), tw('y')]);

    // 저장 = candidate + library_item
    const cA = await saveCandidate(sql, { tweetId: P + 'x', workspaceId: ws.id, memberId: mA.id });
    await ensureLibraryItem(sql, { workspaceId: ws.id, tweetId: P + 'x', addedBy: mA.id });
    await saveCandidate(sql, { tweetId: P + 'x', workspaceId: ws.id, memberId: mB.id });
    await ensureLibraryItem(sql, { workspaceId: ws.id, tweetId: P + 'x', addedBy: mB.id }); // idempotent

    let lib = await listLibraryTweets(sql, ws.id);
    assert.equal(lib.length, 1);
    assert.equal(lib[0].tweet.tweetId, P + 'x');
    assert.equal(lib[0].candidates.length, 2);
    assert.equal(lib[0].addedBy?.name, P + 'LA'); // 최초 저장자

    // 저장 취소(내 것만): candidate는 줄지만 library_item·트윗은 남음
    await removeCandidate(sql, { tweetId: P + 'x', workspaceId: ws.id, memberId: mA.id });
    lib = await listLibraryTweets(sql, ws.id);
    assert.equal(lib.length, 1);              // 트윗 잔존
    assert.equal(lib[0].candidates.length, 1); // B만 남음

    // 저장자 0명 항목: B도 취소 → candidate 0, 그래도 library_item 유지 → 카드 남음
    await removeCandidate(sql, { tweetId: P + 'x', workspaceId: ws.id, memberId: mB.id });
    lib = await listLibraryTweets(sql, ws.id);
    assert.equal(lib.length, 1);
    assert.equal(lib[0].candidates.length, 0); // 저장자 0명
    assert.equal(lib[0].tweet.tweetId, P + 'x');

    // 팀에서 빼기: library_item + 모든 candidate 삭제
    await saveCandidate(sql, { tweetId: P + 'x', workspaceId: ws.id, memberId: mA.id }); // 코멘트 하나 다시
    await removeLibraryTweet(sql, { workspaceId: ws.id, tweetId: P + 'x' });
    lib = await listLibraryTweets(sql, ws.id);
    assert.equal(lib.length, 0); // 완전 삭제
    assert.equal((await listCandidates(sql, ws.id)).length, 0);
  } finally {
    await deleteWorkspace(sql, ws.id);
  }
});

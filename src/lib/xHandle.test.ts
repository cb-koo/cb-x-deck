import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleParseMessage, parseXHandle } from './xHandle.ts';

test('핸들 그대로: @ 접두어와 앞뒤 공백은 떼어낸다', () => {
  assert.deepEqual(parseXHandle('hadakan__'), { ok: true, handle: 'hadakan__' });
  assert.deepEqual(parseXHandle('@hadakan__'), { ok: true, handle: 'hadakan__' });
  assert.deepEqual(parseXHandle('  @hadakan__  '), { ok: true, handle: 'hadakan__' });
});

test('프로필 링크: 스킴 없음·후행 슬래시·쿼리스트링·서브도메인 모두 핸들로', () => {
  assert.deepEqual(parseXHandle('https://x.com/hadakan__'), { ok: true, handle: 'hadakan__' });
  assert.deepEqual(parseXHandle('x.com/hadakan__/'), { ok: true, handle: 'hadakan__' });
  assert.deepEqual(parseXHandle('http://www.twitter.com/hadakan__?s=21'), { ok: true, handle: 'hadakan__' });
  assert.deepEqual(parseXHandle('mobile.twitter.com/hadakan__/with_replies'), { ok: true, handle: 'hadakan__' });
  assert.deepEqual(parseXHandle('m.x.com/hadakan__#top'), { ok: true, handle: 'hadakan__' });
});

// 경로 뒤 조각은 무엇이든 무시 — 트윗 링크도 첫 조각이 작성자다(추가 API 콜 없음)
test('트윗 링크: 경로에 핸들이 있으면 작성자로 해석', () => {
  assert.deepEqual(parseXHandle('https://x.com/hadakan__/status/1790123456789?s=20&t=abc'),
    { ok: true, handle: 'hadakan__' });
});

test('대소문자는 보존 — 정본 표기는 서버 getUserInfo가 확정', () => {
  assert.deepEqual(parseXHandle('https://x.com/HadaKan__'), { ok: true, handle: 'HadaKan__' });
});

test('빈 입력은 empty', () => {
  assert.deepEqual(parseXHandle(''), { ok: false, reason: 'empty' });
  assert.deepEqual(parseXHandle('   '), { ok: false, reason: 'empty' });
});

test('X 링크지만 계정을 알 수 없으면 notProfile', () => {
  assert.deepEqual(parseXHandle('https://x.com/'), { ok: false, reason: 'notProfile' });
  assert.deepEqual(parseXHandle('https://x.com/i/status/1790123456789'), { ok: false, reason: 'notProfile' });
  assert.deepEqual(parseXHandle('https://x.com/i/user/44196397'), { ok: false, reason: 'notProfile' });
  assert.deepEqual(parseXHandle('https://x.com/home'), { ok: false, reason: 'notProfile' });
  assert.deepEqual(parseXHandle('https://x.com/search?q=%E7%BE%8E%E5%AE%B9'), { ok: false, reason: 'notProfile' });
});

test('X가 아닌 주소·핸들 형식이 아닌 문자열은 invalid', () => {
  assert.deepEqual(parseXHandle('https://instagram.com/hadakan__'), { ok: false, reason: 'invalid' });
  assert.deepEqual(parseXHandle('hadakan hoge'), { ok: false, reason: 'invalid' });
  assert.deepEqual(parseXHandle('hada-kan'), { ok: false, reason: 'invalid' });
});

// 허용 호스트 목록은 접두어를 뗀 뒤 Set으로 '정확히' 비교한다 — endsWith/includes로
// 바뀌거나 접두어가 늘어나면 x.com처럼 보이는 다른 호스트가 몰래 통과할 수 있다.
test('허용 호스트 판정: 진짜 호스트만 통과 — 비슷하게 생긴 호스트는 통과 못 한다', () => {
  assert.deepEqual(parseXHandle('https://x.com.evil.com/hadakan__'), { ok: false, reason: 'invalid' }); // 접미어만 같음
  assert.deepEqual(parseXHandle('https://x.com@evil.com/hadakan__'), { ok: false, reason: 'invalid' }); // 진짜 호스트는 evil.com
  assert.deepEqual(parseXHandle('https://m.evil.com/hadakan__'), { ok: false, reason: 'invalid' }); // 허용 접두어 + 비허용 호스트
  assert.deepEqual(parseXHandle('https://evil.com@x.com/hadakan__'), { ok: true, handle: 'hadakan__' }); // 진짜 호스트는 x.com — 문자열 스캔이 아님을 확인
});

// 계정이 아닌 경로가 핸들 형식(영숫자·밑줄)이라 그대로 통과해버리던 두 가지 —
// 유료 getUserInfo 호출만 낭비하고 "계정을 찾을 수 없음"으로 혼동을 준다.
test('트윗 영구링크(/statuses/…)와 커뮤니티 링크(/communities/…)는 notProfile', () => {
  assert.deepEqual(parseXHandle('https://x.com/statuses/1790123456789'), { ok: false, reason: 'notProfile' });
  assert.deepEqual(parseXHandle('https://x.com/communities/1234'), { ok: false, reason: 'notProfile' });
});

test('핸들 길이 경계: 1자·15자는 통과, 16자는 invalid', () => {
  assert.deepEqual(parseXHandle('a'), { ok: true, handle: 'a' });
  assert.deepEqual(parseXHandle('abcdefghijklmno'), { ok: true, handle: 'abcdefghijklmno' });
  assert.deepEqual(parseXHandle('abcdefghijklmnop'), { ok: false, reason: 'invalid' });
  assert.deepEqual(parseXHandle('x.com/abcdefghijklmnop'), { ok: false, reason: 'invalid' });
});

test('문구는 사용자 언어로, reason마다 다르다', () => {
  assert.equal(handleParseMessage('empty'), '계정 핸들이나 프로필 링크를 넣어주세요');
  assert.match(handleParseMessage('notProfile'), /계정을 알 수 없는 주소/);
  assert.match(handleParseMessage('invalid'), /X 계정 주소나 @핸들이 아니에요/);
});

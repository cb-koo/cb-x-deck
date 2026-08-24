import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkLandingUrl, landingUrlMessage,
  buildTrackedUrl, suggestCampaign, checkCampaign, campaignMessage,
  generateWordCode, checkSlug, slugMessage,
} from './trackingLink.ts';

test('1) 링크 주소 — 단어형 코드 제안(자음·모음 교대·글자만), 수동 입력 검사·정규화', () => {
  // 숫자·자음 뒤섞임(a3k9x2)은 스팸 인상, 의미 조합은 규칙 노출 — 단어처럼 읽히되 뜻 없는 코드(koo QA 08-25)
  const codes = Array.from({ length: 200 }, () => generateWordCode());
  for (const c of codes) assert.match(c, /^([bdgkmnprstvz][aeiou]){3}$/); // 6자, 발음 가능 배열, 숫자 없음
  assert.ok(new Set(codes).size >= 199); // 21.6만 조합에서 200개가 대부분 달라야 정상(우연 1쌍까지 허용)
  assert.deepEqual(checkSlug('  '), { ok: false, reason: 'empty' });
  assert.deepEqual(checkSlug('한글주소'), { ok: false, reason: 'invalid' });
  assert.deepEqual(checkSlug(' Yonsei Event 2 '), { ok: true, slug: 'yonsei-event-2' }); // 소문자·공백 정규화
  for (const r of ['empty', 'invalid'] as const) assert.ok(slugMessage(r).length > 0);
});

test('2) 랜딩 URL 검사 — 빈 값·http·형식 오류를 구분한다', () => {
  assert.deepEqual(checkLandingUrl('  '), { ok: false, reason: 'empty' });
  assert.deepEqual(checkLandingUrl('http://example.com'), { ok: false, reason: 'not-https' });
  assert.deepEqual(checkLandingUrl('example.com/page'), { ok: false, reason: 'invalid' }); // 프로토콜 없음
  assert.deepEqual(checkLandingUrl('https://localhost'), { ok: false, reason: 'invalid' }); // 점 없는 호스트
  const ok = checkLandingUrl(' https://clinic.example.com/event?ref=a ');
  assert.equal(ok.ok, true);
  // 사유별 안내 문구가 비어 있지 않다 — 버튼 비활성의 이유를 항상 말한다(UX 원칙 2)
  for (const r of ['empty', 'not-https', 'invalid'] as const) assert.ok(landingUrlMessage(r).length > 0);
});

test('3) UTM 조립 — 표준형 4개 파라미터, 기존 쿼리 보존', () => {
  const u = new URL(buildTrackedUrl({
    landingUrl: 'https://clinic.example.com/event?ref=abc',
    campaign: '클리닉A-202608', content: 'yonsei-clinic-202608-hana_kim',
  }));
  assert.equal(u.searchParams.get('ref'), 'abc');            // 기존 쿼리 보존
  assert.equal(u.searchParams.get('utm_source'), 'x');
  assert.equal(u.searchParams.get('utm_medium'), 'influencer');
  assert.equal(u.searchParams.get('utm_campaign'), '클리닉A-202608'); // 한글 캠페인 왕복
  assert.equal(u.searchParams.get('utm_content'), 'yonsei-clinic-202608-hana_kim');
});

test('4) UTM 조립 — 기존 utm_*는 교체, fragment는 유지', () => {
  const out = buildTrackedUrl({
    landingUrl: 'https://c.example.com/p?utm_source=old&UTM_Campaign=stale&keep=1#section',
    campaign: 'camp', content: 'camp-h',
  });
  const u = new URL(out);
  assert.equal(u.searchParams.get('keep'), '1');
  assert.equal(u.searchParams.get('utm_source'), 'x');       // old가 아니라 교체됨
  assert.equal(u.searchParams.get('UTM_Campaign'), null);     // 대소문자 무관 제거
  assert.equal(u.searchParams.getAll('utm_campaign').length, 1);
  assert.equal(u.hash, '#section');                           // fragment 유지
});

test('5) 캠페인 제안 — 영문만 남기고 공백→하이픈 + KST YYYYMM, 남는 게 없으면 YYYYMM만', () => {
  // 2026-08-31 23:00 KST(= 14:00 UTC) — UTC로 계산하면 202608, KST 경계 검증은 아래에서
  const t = Date.parse('2026-08-31T14:00:00Z');
  assert.equal(suggestCampaign('Clinic A', t), 'Clinic-A-202608');
  assert.equal(suggestCampaign('연세 밝은 클리닉', t), '202608');   // 한글은 제안에 싣지 않는다(캠페인 영문 규칙)
  assert.equal(suggestCampaign('클리닉A', t), 'A-202608');          // 영문 부분만 남긴다
  assert.equal(suggestCampaign(null, t), '202608');
  assert.equal(suggestCampaign('  ', t), '202608');
  // KST 월 경계: 8/31 16:00 UTC = 9/1 01:00 KST → 202609
  assert.equal(suggestCampaign(null, Date.parse('2026-08-31T16:00:00Z')), '202609');
});

test('6) 캠페인 검사 — 영어·숫자·하이픈만 허용, 공백은 하이픈으로 정규화', () => {
  assert.deepEqual(checkCampaign('  '), { ok: false, reason: 'empty' });
  assert.deepEqual(checkCampaign('연세클리닉-202608'), { ok: false, reason: 'not-ascii' });
  assert.deepEqual(checkCampaign('clinic a 202608'), { ok: true, campaign: 'clinic-a-202608' }); // 공백 정규화
  assert.deepEqual(checkCampaign('Clinic_A.v2-202608'), { ok: true, campaign: 'Clinic_A.v2-202608' });
  // 사유별 안내 문구가 비어 있지 않다(UX 원칙 2)
  for (const r of ['empty', 'not-ascii'] as const) assert.ok(campaignMessage(r).length > 0);
});

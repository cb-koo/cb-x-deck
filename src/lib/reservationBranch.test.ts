import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ClinicSummary } from './clinicLocation.ts';
import { branchContext, branchFromSheet, branchHint, branchOptions, initialBranchId, isMultiBranch } from './reservationBranch.ts';

const loc = (id: string, branchName: string, position: number, active = true): ClinicSummary =>
  ({ id, clientId: 'c', name: '벤자민클리닉', configured: true, branchName, kind: position === 0 ? 'main' : 'branch', position, active });
const myeongdong = loc('md', '명동점', 0), sinsa = loc('ss', '신사점', 1), gangnam = loc('gn', '강남점', 2, false);

test('사용 중 지점만 순서대로, 저장된 예약의 중지 지점은 (사용 중지)로 남긴다', () => {
  assert.deepEqual(branchOptions([sinsa, gangnam, myeongdong]).map((o) => o.label), ['명동점', '신사점']);
  assert.deepEqual(branchOptions([sinsa, gangnam, myeongdong], 'gn').map((o) => o.label), ['명동점', '신사점', '강남점 (사용 중지)']);
});

test('지점명이 빈 본점은 본점으로 읽는다', () => {
  const [only] = branchOptions([loc('m', '', 0)]);
  assert.equal(only.name, '본점'); assert.equal(only.label, '본점');
});

test('드롭다운은 고를 게 2개 이상일 때만 — 1곳 클리닉은 숨김, 1곳 + 예약의 중지 지점이면 보인다', () => {
  assert.equal(isMultiBranch(branchOptions([myeongdong])), false);
  assert.equal(isMultiBranch(branchOptions([myeongdong, gangnam])), false);
  assert.equal(isMultiBranch(branchOptions([myeongdong, gangnam], 'gn')), true);
  assert.equal(isMultiBranch(branchOptions([myeongdong, sinsa])), true);
});

test('처음 고른 지점 — 저장된 예약은 그 지점, 새 예약은 1곳이면 그 지점·여러 곳이면 비움', () => {
  assert.equal(initialBranchId(branchOptions([myeongdong, sinsa]), 'ss'), 'ss');
  assert.equal(initialBranchId(branchOptions([myeongdong])), 'md');
  assert.equal(initialBranchId(branchOptions([myeongdong, sinsa])), null);
  assert.equal(initialBranchId([]), null);
});

test('파싱 안내 — 파싱 전엔 없고, 맞으면 자동 선택, 못 맞추면 직접 고르라고', () => {
  const [md] = branchOptions([myeongdong]);
  assert.equal(branchHint(null, md), null);
  assert.deepEqual(branchHint('신사점', { ...md, name: '신사점' }), { warn: false, text: '고객 답변 "신사점" → 신사점 자동 선택' });
  assert.deepEqual(branchHint('', null), { warn: true, text: '고객 답변과 맞는 지점이 없어요 · 직접 골라 주세요' });
});

test('시트 7. 지점을 직접 고치면 등록된 사용 중 지점과 같을 때만 따라간다', () => {
  const options = branchOptions([myeongdong, sinsa, gangnam], 'gn');
  assert.equal(branchFromSheet('7. 지점: 신사점\n', options)?.id, 'ss');
  assert.equal(branchFromSheet('7. 지점: 신사\n', options), null);
  assert.equal(branchFromSheet('7. 지점: 강남점\n', options), null);
  assert.equal(branchFromSheet('1. 희망 일시: \n', options), null);
});

test('{{branch}} — 1곳이면 본점, 여러 곳이면 고른 지점명 또는 빈 칸', () => {
  const single = branchOptions([myeongdong]), multi = branchOptions([myeongdong, sinsa]);
  assert.equal(branchContext(single, single[0]), '본점');
  assert.equal(branchContext(multi, multi[1]), '신사점');
  assert.equal(branchContext(multi, null), '');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MapTooltipContent } from '../app/market-map/MapTooltipContent.tsx';

test('지도 툴팁: 외부 이름·주소·역 정보와 CRM 값은 HTML이 아닌 텍스트로 표시한다', () => {
  const payload = '<img src=x onerror="document.documentElement.dataset.auditXss=1"><svg onload=alert(1)>';
  const html = renderToStaticMarkup(createElement(MapTooltipContent, {
    title: payload,
    lines: [payload, '역 & 노선 <script>alert(1)</script>'],
    status: payload,
    branch: payload,
  }));
  assert.doesNotMatch(html, /<(?:img|svg|script)\b/i);
  assert.equal(html.match(/&lt;img/g)?.length, 4);
  assert.ok(html.includes('역 &amp; 노선 &lt;script&gt;alert(1)&lt;/script&gt;'));
});

test('지도 툴팁: 정상 병원명·지점명·상태·지표의 순서와 줄바꿈을 유지한다', () => {
  const html = renderToStaticMarkup(createElement(MapTooltipContent, {
    title: '서울의원', branch: '강남점', status: '제안서 전달',
    lines: ['매출 1억 · 외국인 20%'],
  }));
  assert.equal(html, '제안서 전달<br/><b>서울의원</b> · 강남점<br/>매출 1억 · 외국인 20%');
});

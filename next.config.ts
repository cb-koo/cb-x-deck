import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 클리닉 지도 수집이 행정경계 파일로 병원의 행정동을 찾는다 — public/ 파일은 함수에 기본으로 담기지 않는다
  outputFileTracingIncludes: {
    '/api/market-map/collect': ['./public/market-map/dong.geojson'],
    // 캠페인 현황 슬랙 이미지 — 한글 글꼴은 ImageResponse 묶음 한도(약 500KB)보다 커서 실행 시점에 디스크에서 읽는다
    '/api/campaigns/overview/slack': ['./src/lib/statusImage/fonts/*.otf'],
    '/api/campaigns/overview/slack-image': ['./src/lib/statusImage/fonts/*.otf'],
  },
};

export default nextConfig;

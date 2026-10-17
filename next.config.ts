import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 클리닉 지도 수집이 행정경계 파일로 병원의 행정동을 찾는다 — public/ 파일은 함수에 기본으로 담기지 않는다
  outputFileTracingIncludes: {
    '/api/market-map/collect': ['./public/market-map/dong.geojson'],
  },
};

export default nextConfig;

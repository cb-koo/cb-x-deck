// 클리닉 지도 화면 쪽 타입 — 서버 완성본(ViewClinic)에 영업 상태를 붙인 모양
import type { ViewClinic, CrmInfo, CrmStatus } from '@/lib/marketClinic';

export type { CrmInfo, CrmStatus };
export type Clinic = ViewClinic & { crm?: CrmInfo };
export type RegionMetric = 'count' | 'sales' | 'foreignSales' | 'opportunity';
export type RegionUnit = 'sgg' | 'dong';
export type Segment = 'all' | 'underused' | 'domesticStrong' | 'growing' | 'new' | 'chain';

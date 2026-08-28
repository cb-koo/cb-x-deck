export type SettlementTab = 'candidates' | 'requests' | 'settings';
export const SETTLEMENT_TABS: readonly SettlementTab[] = ['candidates', 'requests', 'settings'];
export const SETTLEMENT_TAB_LABEL: Record<SettlementTab, string> = { candidates: '검토 대기', requests: '요청 내역', settings: '설정' };
export function parseSettlementTab(v: string | null): SettlementTab {
  return (SETTLEMENT_TABS as readonly string[]).includes(v ?? '') ? (v as SettlementTab) : 'candidates';
}

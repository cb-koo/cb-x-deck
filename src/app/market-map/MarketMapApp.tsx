'use client';
// 클리닉 지도 — 화면(스펙 docs/superpowers/specs/2026-10-17-clinic-map-design.md §2, 시안 3·4차 koo 10-17).
// 상단은 '무엇을 하러 왔는지'(목적)를 먼저 고르고 그 목적에 필요한 조건만 보인다.
//   영업 대상 찾기  "어느 병원에 먼저 연락하지?" → 분류 칩(숫자) · 점수순 목록 · [병원으로 보기 | 지역으로 묶어 보기]
//   우리 고객       "고객 근처 경쟁 병원은?"     → 영업 상태 칩 · 고객을 누르면 범위 안 경쟁 병원
// 지역 비교는 따로 탭을 두지 않는다 — 영업 대상을 찾는 첫 단계라 분류가 그대로 걸린다(넓게 보고 → 좁혀서 → 병원 고르기).
import { useEffect, useMemo, useRef, useState } from 'react';
import MapView, { type FlyTarget } from './MapView';
import Quadrant from './Quadrant';
import { GLOSSARY } from './glossary';
import type { Clinic, CrmInfo, CrmStatus, RegionMetric, Segment, Station } from './types';
import { won, pct, num, signed, monthLabel, distanceM, CRM_META } from './format';
import { decodeViewDoc, FOREIGN_LOW_PCT, type ViewDoc } from '@/lib/marketClinic';
import { Button } from '@/components/ui';

type Purpose = 'target' | 'clients';
type View = 'clinics' | 'regions';
type Tab = 'list' | 'clinic' | 'terms';
type SortKey = 'score' | 'sales' | 'salesForeign' | 'foreignPct' | 'growth';
type Bounds = [number, number, number, number];

const SEGMENTS: { key: Segment; label: string; desc: string }[] = [
  { key: 'all', label: '전체', desc: '' },
  { key: 'underused', label: '유치 등록 · 외국인 적음', desc: `외국인 환자 유치기관으로 등록했는데 외국인 매출이 ${FOREIGN_LOW_PCT}% 미만이에요. 우리 서비스가 바로 필요한 곳이에요.` },
  { key: 'domesticStrong', label: '국내 매출 상위', desc: `매출 상위 20%인데 외국인이 ${FOREIGN_LOW_PCT}% 미만이에요. 예산 여력이 있고 해외 확장 여지가 커요.` },
  { key: 'growing', label: '성장 중', desc: '전월보다 매출이 10% 이상 늘었어요.' },
  { key: 'new', label: '신규 개원', desc: '최근 1년 안에 문을 열었어요. 런칭 패키지를 제안하기 좋아요.' },
  { key: 'chain', label: '체인', desc: '본사 한 곳과 계약하면 여러 지점으로 이어질 수 있어요.' },
];
const STATUSES: { key: 'all' | CrmStatus; label: string }[] = [
  { key: 'all', label: '전체' }, { key: 'client', label: '서비스 중' }, { key: 'onboarding', label: '리포트 준비' }, { key: 'lead', label: '제안서 발송' },
];
// 지역을 무엇으로 견줄지 — 병원 수는 지금 고른 분류의 병원 수다
const METRICS: { key: RegionMetric; label: string; unit: (v: number) => string }[] = [
  { key: 'count', label: '병원 수', unit: (v) => `${num(v)}곳` },
  { key: 'foreignSales', label: '외국인 매출', unit: won },
  { key: 'sales', label: '전체 매출', unit: won },
];
const SORTS: { key: SortKey; label: string }[] = [
  { key: 'score', label: '기회 점수순' }, { key: 'sales', label: '매출순' }, { key: 'salesForeign', label: '외국인 매출순' },
  { key: 'foreignPct', label: '외국인 비중순' }, { key: 'growth', label: '성장률순' },
];
const STATUS_ORDER: Record<CrmStatus, number> = { client: 0, onboarding: 1, lead: 2 };
const SEOUL = { lng: 127.0, lat: 37.53, zoom: 11.2 };
const distLabel = (m: number) => (m >= 1000 ? `${m / 1000}km` : `${m}m`);
const sidoShort = (s: string) => s.replace(/특별자치시|특별자치도|특별시|광역시/g, '');
// 패널 크기는 브라우저마다 기억한다 — 저장소를 못 쓰는 창이어도 화면은 기본값으로 정상(이 화면은 브라우저에서만 그린다)
function stored(key: string, fallback: number): number {
  try { return Number(localStorage.getItem(key)) || fallback; } catch { return fallback; }
}

function matchSegment(c: Clinic, s: Segment) {
  switch (s) {
    case 'underused': return c.sigUnderused;
    case 'domesticStrong': return c.sigDomesticStrong;
    case 'growing': return (c.growth ?? -1) >= 10;
    case 'new': return c.isNew;
    case 'chain': return c.chain;
    default: return true;
  }
}
const inBounds = (c: Clinic, b: Bounds | null) => !b || (c.lat != null && c.lng! >= b[0] && c.lng! <= b[2] && c.lat >= b[1] && c.lat <= b[3]);

// 기회 점수를 만든 이유 — 점수만 던지지 않는다(UX 원칙 3)
function scoreReasons(c: Clinic): string[] {
  const r: string[] = [];
  if (c.salesPctl != null) r.push(`매출 상위 ${Math.max(1, Math.round((1 - c.salesPctl) * 100))}%`);
  if (c.foreignPct != null) r.push(`외국인 ${pct(c.foreignPct)}`);
  r.push(c.registered ? '유치 등록' : '유치 미등록');
  if (c.growth != null) r.push(`전월 ${signed(c.growth)}`);
  return r;
}
function verdict(c: Clinic): string | null {
  if (c.sigUnderused) return `유치 등록은 했는데 외국인 매출이 ${pct(c.foreignPct)}예요 → 외국인 유치 마케팅을 제안하기 좋은 병원이에요`;
  if (c.sigDomesticStrong) return `국내 매출은 상위권인데 외국인이 ${pct(c.foreignPct)}예요 → 해외 확장을 제안할 수 있어요`;
  if (c.isNew) return '최근 1년 안에 개원했어요 → 런칭 패키지를 제안할 수 있어요';
  if ((c.foreignPct ?? 0) >= 50) return `이미 외국인 매출이 ${pct(c.foreignPct)}예요 → 유지·고도화 쪽 제안이 맞아요`;
  return null;
}

function toCsv(rows: Clinic[]) {
  const cols: [string, (c: Clinic) => unknown][] = [
    ['기회점수', (c) => c.score], ['영업상태', (c) => (c.crm ? CRM_META[c.crm.status].label : '연락 전')], ['병원', (c) => c.name],
    ['시도', (c) => c.sido], ['시군구', (c) => c.gu], ['행정동', (c) => c.dong], ['주소', (c) => c.address], ['기준월', (c) => c.month],
    ['월매출', (c) => c.sales], ['국내매출', (c) => c.salesDomestic], ['외국인매출', (c) => c.salesForeign], ['외국인비중', (c) => c.foreignPct],
    ['전월대비', (c) => c.growth], ['구안순위', (c) => (c.guRank ? `${c.guRank}/${c.guCount}` : '')], ['의사수', (c) => c.doctors],
    ['유치기관', (c) => (c.registered ? 'Y' : 'N')], ['대상국가', (c) => c.countries.join('/')], ['체인', (c) => (c.chain ? c.brand : '')],
    ['지점수', (c) => c.branches], ['개원일', (c) => c.openedAt], ['추정매출', (c) => (c.exact ? '' : 'Y')],
  ];
  const esc = (v: unknown) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  return '﻿' + [cols.map((c) => c[0]).join(','), ...rows.map((r) => cols.map(([, fn]) => esc(fn(r))).join(','))].join('\n');
}

function StatusDot({ crm }: { crm?: CrmInfo }) {
  if (!crm) return <span className="inline-block size-2 shrink-0 rounded-full shadow-[inset_0_0_0_1.5px_#cfd9de]" title="연락 전" />;
  return <span className="inline-block size-2 shrink-0 rounded-full" style={{ background: CRM_META[crm.status].hex }} title={CRM_META[crm.status].label} />;
}
function ScorePill({ v, lg }: { v: number | null; lg?: boolean }) {
  return (
    <span className={`inline-grid shrink-0 place-items-center rounded-full font-bold tabular-nums ${lg ? 'h-9 min-w-12 text-[17px]' : 'h-6 min-w-8 text-ui'} ${(v ?? 0) >= 70 ? 'bg-red-50 text-red-700' : 'bg-x-surface'}`}>
      {v ?? '–'}
    </span>
  );
}

const chip = (on: boolean) =>
  `inline-flex h-8 items-center gap-1.5 rounded-full border px-3.5 text-ui ${on ? 'border-x-text bg-x-text text-white' : 'border-x-border-strong bg-white text-x-secondary hover:bg-x-hover'}`;
const select = (on = false) => `h-8 rounded-full border bg-white px-3 text-ui ${on ? 'border-x-text font-semibold' : 'border-x-border-strong'}`;
const rowBtn = (sel = false) =>
  `flex min-h-11 w-full items-center gap-2.5 border-b border-x-border px-1 text-left text-content hover:bg-x-hover ${sel ? 'bg-[#e8f5fd]' : ''}`;

export default function MarketMapApp() {
  const [dept, setDept] = useState('피부과');
  const [departments, setDepartments] = useState<string[]>(['피부과']);
  const [clinics, setClinics] = useState<Clinic[] | null>(null);
  const [months, setMonths] = useState<string[]>([]);
  const [builtAt, setBuiltAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [purpose, setPurpose] = useState<Purpose>('target');
  const [view, setView] = useState<View>('clinics');
  const [sido, setSido] = useState('');
  const [gu, setGu] = useState('');
  const [segment, setSegment] = useState<Segment>('all');
  const [more, setMore] = useState(false);
  const [minForeign, setMinForeign] = useState(0);
  const [minSalesEok, setMinSalesEok] = useState(0);
  const [registeredOnly, setRegisteredOnly] = useState(false);
  const [exactOnly, setExactOnly] = useState(false);
  const [hideClients, setHideClients] = useState(true);
  const [sort, setSort] = useState<SortKey>('score');
  const [metric, setMetric] = useState<RegionMetric>('count');
  const [status, setStatus] = useState<'all' | CrmStatus>('all');
  const [radiusM, setRadiusM] = useState(500);
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [bounds, setBounds] = useState<Bounds | null>(null);
  const [selected, setSelected] = useState<Clinic | null>(null);
  const [tab, setTab] = useState<Tab>('list');
  const [termQ, setTermQ] = useState('');
  const [chartOpen, setChartOpen] = useState(true);
  const [chartH, setChartH] = useState(() => stored('marketMap.chartH', 200));
  const [panelW, setPanelW] = useState(() => stored('marketMap.panelW', 420));
  const [fly, setFly] = useState<FlyTarget | null>(null);
  // 지하철 노선·역 — 상단 메뉴에서 켜고 끈다(koo 10-19). 역 목록은 한 번 받아 지도와 검색에 같이 쓴다
  const [subwayOn, setSubwayOn] = useState(() => stored('marketMap.subway', 1) === 1);
  const [stations, setStations] = useState<Station[]>([]);
  useEffect(() => {
    fetch('/market-map/subway-stations.geojson').then((r) => r.json())
      .then((g: { features: Array<{ properties: Omit<Station, 'position'>; geometry: { coordinates: [number, number] } }> }) =>
        setStations(g.features.map((f) => ({ ...f.properties, position: f.geometry.coordinates }))))
      .catch(() => { /* 역이 없어도 지도는 정상 */ });
  }, []);
  useEffect(() => { try { localStorage.setItem('marketMap.subway', subwayOn ? '1' : '2'); } catch { /* 저장소를 못 쓰는 창 */ } }, [subwayOn]);
  const flyKey = useRef(0); // 같은 곳으로 다시 이동해도 지도가 움직이게 매번 다른 값
  const flyTo = (t: Omit<FlyTarget, 'key'>) => setFly({ ...t, key: ++flyKey.current });
  useEffect(() => { try { localStorage.setItem('marketMap.chartH', String(chartH)); localStorage.setItem('marketMap.panelW', String(panelW)); } catch { /* 저장소를 못 쓰는 창 */ } }, [chartH, panelW]);

  useEffect(() => {
    let alive = true;
    fetch(`/api/market-map?dept=${encodeURIComponent(dept)}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? `불러오지 못했어요 (${r.status})`);
        return j as { builtAt: string; departments: string[]; doc: ViewDoc; crm: Record<string, CrmInfo> };
      })
      .then((j) => {
        if (!alive) return;
        const list: Clinic[] = decodeViewDoc(j.doc).map((c) => (j.crm[c.id] ? { ...c, crm: j.crm[c.id] } : c));
        setClinics(list);
        setMonths(j.doc.months);
        setBuiltAt(j.builtAt);
        setDepartments(j.departments);
      })
      .catch((e) => alive && setError(String(e.message ?? e)));
    return () => { alive = false; };
  }, [dept]);

  // 끌어서 크기 조절 — y: 차트 높이 / x: 패널 너비
  const drag = (axis: 'x' | 'y', start: number, set: (v: number) => void, min: number, max: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    const p0 = axis === 'y' ? e.clientY : e.clientX;
    const move = (ev: PointerEvent) => set(Math.max(min, Math.min(max, start + (axis === 'y' ? ev.clientY - p0 : p0 - ev.clientX))));
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); document.body.style.cursor = ''; };
    document.body.style.cursor = axis === 'y' ? 'row-resize' : 'col-resize';
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const all = useMemo(() => clinics ?? [], [clinics]);
  const sidos = useMemo(() => [...new Set(all.map((c) => c.sido).filter(Boolean))].sort(), [all]);
  const gus = useMemo(() => [...new Set(all.filter((c) => c.sido === sido).map((c) => c.gu))].sort(), [all, sido]);
  const latestMonth = months.at(-1) ?? null;
  const salesSplit = useMemo(() => {
    const s = all.map((c) => c.sales).filter((v): v is number => !!v).sort((a, b) => a - b);
    return s[Math.floor(s.length * 0.8)] ?? 1e9;
  }, [all]);
  const inRegion = useMemo(() => all.filter((c) => (!sido || c.sido === sido) && (!gu || c.gu === gu)), [all, sido, gu]);

  // 영업 대상: 분류를 빼고 거른 집합(칩 숫자용) → 분류까지 거른 집합
  const targetBase = useMemo(() => inRegion.filter((c) =>
    (!hideClients || !c.crm || c.crm.status === 'lead') &&
    (minForeign === 0 || (c.foreignPct ?? -1) >= minForeign) &&
    (minSalesEok === 0 || (c.sales ?? 0) >= minSalesEok * 1e8) &&
    (!registeredOnly || c.registered) && (!exactOnly || c.exact)),
  [inRegion, hideClients, minForeign, minSalesEok, registeredOnly, exactOnly]);
  const segCounts = useMemo(() => {
    const v = targetBase.filter((c) => inBounds(c, bounds));
    return Object.fromEntries(SEGMENTS.map((s) => [s.key, v.filter((c) => matchSegment(c, s.key)).length])) as Record<Segment, number>;
  }, [targetBase, bounds]);
  const targetFiltered = useMemo(() => targetBase.filter((c) => matchSegment(c, segment)), [targetBase, segment]);
  const list = useMemo(() => {
    const v = (c: Clinic) => (c[sort] as number | null) ?? -Infinity;
    return targetFiltered.filter((c) => inBounds(c, bounds)).sort((a, b) => v(b) - v(a));
  }, [targetFiltered, bounds, sort]);

  // 우리 고객
  const customers = useMemo(() => inRegion.filter((c) => c.crm && (status === 'all' || c.crm.status === status)), [inRegion, status]);
  const statusCounts = useMemo(() => {
    const cs = inRegion.filter((c) => c.crm);
    return { all: cs.length, client: cs.filter((c) => c.crm!.status === 'client').length, onboarding: cs.filter((c) => c.crm!.status === 'onboarding').length, lead: cs.filter((c) => c.crm!.status === 'lead').length };
  }, [inRegion]);
  const nearby = useMemo(() => {
    if (!selected?.lat) return [];
    const s = { lat: selected.lat, lng: selected.lng! };
    const dLat = radiusM / 111000, dLng = radiusM / 88000;
    return all
      .filter((c) => c.id !== selected.id && c.lat && Math.abs(c.lat - s.lat) < dLat && Math.abs(c.lng! - s.lng) < dLng)
      .map((c) => ({ ...c, dist: distanceM(s, { lat: c.lat!, lng: c.lng! }) }))
      .filter((c) => c.dist <= radiusM)
      .sort((a, b) => (b.sales ?? 0) - (a.sales ?? 0));
  }, [selected, all, radiusM]);

  const regionsView = purpose === 'target' && view === 'regions';
  const regionUnit = gu ? 'dong' : 'sgg'; // 지도 구역과 패널 순위가 같은 단위
  const mapClinics = useMemo(() => purpose === 'target' ? targetFiltered : [...customers, ...(selected?.crm ? nearby : [])],
    [purpose, targetFiltered, customers, selected, nearby]);

  // 지역 순위 — 지금 지도 범위 · 지금 고른 분류
  const regionRank = useMemo(() => {
    const agg = new Map<string, { name: string; sido: string; gu: string; count: number; sales: number; foreignSales: number; opportunity: number }>();
    for (const c of targetFiltered) {
      if (!inBounds(c, bounds)) continue;
      const name = regionUnit === 'dong' ? (c.dong ?? '행정동 모름') : `${sidoShort(c.sido)} ${c.gu}`;
      const a = agg.get(name) ?? { name, sido: c.sido, gu: c.gu, count: 0, sales: 0, foreignSales: 0, opportunity: 0 };
      a.count++; a.sales += c.sales ?? 0; a.foreignSales += c.salesForeign ?? 0; if ((c.score ?? 0) >= 70) a.opportunity++;
      agg.set(name, a);
    }
    return [...agg.values()].sort((a, b) => b[metric] - a[metric]);
  }, [targetFiltered, bounds, regionUnit, metric]);

  // 바로가기 — 역(앞, 3곳까지) + 병원(8곳까지). '강남'·'강남역' 둘 다 강남역을 찾는다
  const searchHits = useMemo(() => {
    const t = search.trim();
    if (!t) return { stations: [] as Station[], clinics: [] as Clinic[] };
    const tk = t.replace(/역$/, '');
    return {
      stations: stations.filter((s) => s.name.includes(tk)).sort((a, b) => a.name.length - b.name.length).slice(0, 3),
      clinics: all.filter((c) => c.name.includes(t)).slice(0, 8),
    };
  }, [search, all, stations]);
  const goStation = (s: Station) => {
    setSubwayOn(true);
    flyTo({ lng: s.position[0], lat: s.position[1], zoom: 15 });
  };

  const pick = (c: Clinic | null, move = false) => {
    setSelected(c);
    if (c) setTab('clinic');
    if (c?.lat && move) flyTo({ lng: c.lng!, lat: c.lat, zoom: 15 });
  };
  const focusRegion = (s: string, g: string) => {
    if (!s) return flyTo(SEOUL);
    const pts = all.filter((c) => c.sido === s && (!g || c.gu === g) && c.lat);
    if (!pts.length) return;
    flyTo({ lng: pts.reduce((a, c) => a + c.lng!, 0) / pts.length, lat: pts.reduce((a, c) => a + c.lat!, 0) / pts.length, zoom: g ? 12.5 : 9.8 });
  };
  const switchPurpose = (p: Purpose) => { setPurpose(p); setTab('list'); setSelected(null); };
  const switchView = (v: View) => {
    setView(v); setTab('list'); setSelected(null);
    if (v === 'regions' && !gu) flyTo({ lng: 127.0, lat: 37.55, zoom: 10 }); // 구 단위가 보이게 한 단계 물러선다
  };
  const openRegion = (s: string, g: string) => { setSido(s); setGu(g); setView('clinics'); setTab('list'); focusRegion(s, g); };
  const download = () => {
    // 매출 추정 원본이라 한 번 더 확인한다
    if (!window.confirm(`병원 ${num(list.length)}곳의 매출 추정 데이터를 내려받아요.\n회사 밖으로 보내면 안 되는 자료예요. 계속할까요?`)) return;
    const blob = new Blob([toCsv(list)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `클리닉지도_${dept}_${gu || sido || '화면'}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };
  const moreCount = [minForeign > 0, minSalesEok > 0, registeredOnly, exactOnly, !hideClients].filter(Boolean).length;
  const metricMeta = METRICS.find((m) => m.key === metric)!;

  if (error) return <div className="px-6 py-8 text-content text-x-secondary">클리닉 지도를 불러오지 못했어요 — {error}</div>;

  const regionSelect = (
    <>
      <select className={select(!!sido)} value={sido} onChange={(e) => { setSido(e.target.value); setGu(''); focusRegion(e.target.value, ''); }}>
        <option value="">전국</option>
        {sidos.map((x) => <option key={x}>{x}</option>)}
      </select>
      {sido && (
        <select className={select(!!gu)} value={gu} onChange={(e) => { setGu(e.target.value); focusRegion(sido, e.target.value); }}>
          <option value="">시군구 전체</option>
          {gus.map((g) => <option key={g}>{g}</option>)}
        </select>
      )}
    </>
  );
  const sep = <span className="h-5 w-px bg-x-border-strong" />;

  const row2 = purpose === 'target' ? (
    <>
      {regionSelect}{sep}
      <div className="flex flex-wrap items-center gap-1.5">
        {SEGMENTS.map((s) => (
          <button key={s.key} className={chip(segment === s.key)} onClick={() => setSegment(s.key)} title={s.desc}>
            {s.label} <span className={`tabular-nums ${segment === s.key ? 'text-white/75' : 'text-x-muted'}`}>{num(segCounts[s.key])}</span>
          </button>
        ))}
      </div>
      <div role="tablist" aria-label="보기 방식" className="ml-auto flex rounded-full border border-x-border-strong p-0.5 text-ui">
        {([['clinics', '병원으로 보기'], ['regions', '지역으로 묶어 보기']] as [View, string][]).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={view === k} onClick={() => switchView(k)}
                  className={`rounded-full px-3 py-1 ${view === k ? 'bg-x-text text-white' : 'text-x-secondary hover:bg-x-hover'}`}>{l}</button>
        ))}
      </div>
      {view === 'regions' && (
        <select className={select()} value={metric} onChange={(e) => setMetric(e.target.value as RegionMetric)} title="지역을 무엇으로 견줄지">
          {METRICS.map((m) => <option key={m.key} value={m.key}>{m.label}로 비교</option>)}
        </select>
      )}
      <div className="relative">
        <button className={`${select(moreCount > 0)} inline-flex items-center gap-1.5 font-semibold`} onClick={() => setMore((v) => !v)}>
          조건{moreCount > 0 && <span className="rounded-full bg-x-blue px-1.5 text-[12px] text-white">{moreCount}</span>} ▾
        </button>
        {more && (
          <div className="absolute right-0 top-10 z-30 flex w-80 flex-col gap-2 rounded-2xl border border-x-border-strong bg-white p-4 text-content shadow-lg">
            <label className="flex items-center gap-2"><input type="checkbox" checked={hideClients} onChange={(e) => setHideClients(e.target.checked)} /> 우리 고객 빼기 <span className="text-ui text-x-muted">(제안서만 보낸 곳은 남겨요)</span></label>
            <label>외국인 매출 비중 <b>{minForeign}%</b> 이상</label>
            <input type="range" min={0} max={90} step={5} value={minForeign} onChange={(e) => setMinForeign(Number(e.target.value))} className="accent-x-blue" />
            <label>월매출 <b>{minSalesEok}억</b> 이상</label>
            <input type="range" min={0} max={20} step={0.5} value={minSalesEok} onChange={(e) => setMinSalesEok(Number(e.target.value))} className="accent-x-blue" />
            <label className="flex items-center gap-2"><input type="checkbox" checked={registeredOnly} onChange={(e) => setRegisteredOnly(e.target.checked)} /> 외국인 환자 유치기관만</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={exactOnly} onChange={(e) => setExactOnly(e.target.checked)} /> 실제 매출만 <span className="text-ui text-x-muted">(추정 매출 빼기)</span></label>
            <div className="mt-1 flex items-center justify-between">
              <button className="text-ui font-semibold text-x-blue-text hover:underline"
                      onClick={() => { setMinForeign(0); setMinSalesEok(0); setRegisteredOnly(false); setExactOnly(false); setHideClients(true); }}>처음대로</button>
              <Button onClick={() => setMore(false)}>닫기</Button>
            </div>
          </div>
        )}
      </div>
    </>
  ) : (
    <>
      {regionSelect}{sep}
      <div className="flex flex-wrap items-center gap-1.5">
        {STATUSES.map((s) => (
          <button key={s.key} className={chip(status === s.key)} onClick={() => setStatus(s.key)}>
            {s.key !== 'all' && <span className="inline-block size-2 rounded-full" style={{ background: CRM_META[s.key].hex }} />}
            {s.label} <span className={`tabular-nums ${status === s.key ? 'text-white/75' : 'text-x-muted'}`}>{statusCounts[s.key]}</span>
          </button>
        ))}
      </div>
      <label className="ml-auto inline-flex items-center gap-2 text-ui text-x-secondary">경쟁 병원 범위
        <select className={select()} value={radiusM} onChange={(e) => setRadiusM(Number(e.target.value))}>
          {[300, 500, 1000].map((m) => <option key={m} value={m}>{distLabel(m)} 안</option>)}
        </select>
      </label>
    </>
  );

  // ── 오른쪽 패널
  const segLabel = segment === 'all' ? `${dept} 병원` : `'${SEGMENTS.find((x) => x.key === segment)!.label}' 병원`;
  const lede = regionsView ? (
    regionRank[0] ? (
      <p className="mb-3.5 rounded-2xl bg-x-surface px-3.5 py-3 text-content leading-relaxed text-x-secondary">
        지금 지도 범위에서 {metric === 'count' ? <>{segLabel}이 가장 많은 곳은</> : <>{segLabel}의 {metricMeta.label}이 가장 큰 곳은</>}{' '}
        <b className="text-x-text">{regionRank[0].name}</b>({metricMeta.unit(regionRank[0][metric])})예요{regionRank[2] && <>. 다음은 {regionRank[1].name} · {regionRank[2].name}</>}.
        {!gu && <span className="text-x-muted"> 지역 이름을 누르면 그 안의 동네끼리 견줘요.</span>}
      </p>
    ) : <p className="mb-3.5 rounded-2xl bg-x-surface px-3.5 py-3 text-content text-x-secondary">지금 지도 범위에 해당하는 병원이 없어요.</p>
  ) : purpose === 'target' ? (
    <p className="mb-3.5 rounded-2xl bg-x-surface px-3.5 py-3 text-content leading-relaxed text-x-secondary">
      {segment === 'all' ? (
        <>
          지금 화면에서 연락할 수 있는 {dept} <b className="text-x-text">{num(list.length)}곳</b> 중{' '}
          <b className="text-amber-700">유치 등록했는데 외국인 매출이 적은 곳이 {num(segCounts.underused)}곳</b>이에요.
          <button className="pl-2 font-semibold text-x-blue-text hover:underline" onClick={() => setSegment('underused')}>이 병원만 보기</button>
        </>
      ) : (
        <><b className="text-x-text">{SEGMENTS.find((s) => s.key === segment)!.label} {num(list.length)}곳</b> — {SEGMENTS.find((s) => s.key === segment)!.desc}</>
      )}
    </p>
  ) : (
    <p className="mb-3.5 rounded-2xl bg-x-surface px-3.5 py-3 text-content leading-relaxed text-x-secondary">
      고객 <b className="text-x-text">{statusCounts.client + statusCounts.onboarding}곳</b>, 제안서를 보낸 곳 <b className="text-x-text">{statusCounts.lead}곳</b>이에요.
      고객을 누르면 {distLabel(radiusM)} 안 경쟁 병원이 지도에 함께 나와요.
      {statusCounts.all === 0 && <span className="text-x-muted"> 아직 지도 병원과 연결된 고객이 없어요.</span>}
    </p>
  );

  const targetList = (
    <>
      {lede}
      <section className="mb-3">
        <button className="flex w-full items-center" onClick={() => setChartOpen((v) => !v)}>
          <span className="text-content font-bold">매출 × 외국인 비중</span>
          <span className="ml-auto text-ui font-semibold text-x-blue-text">{chartOpen ? '접기' : '펼치기'}</span>
        </button>
        {chartOpen && (
          <>
            <p className="mb-2 mt-1 text-ui leading-snug text-x-secondary">오른쪽 아래 칸(매출 큼 · 외국인 적음)이 해외 확장을 제안할 병원이에요. 점을 누르면 병원을 열어요.</p>
            <div style={{ height: chartH }}>
              <Quadrant clinics={list} selected={selected} salesSplit={salesSplit} onSelect={(c) => pick(c, true)} />
            </div>
            <div className="group grid h-3.5 cursor-row-resize touch-none place-items-center" title="끌어서 차트 크기 조절 · 두 번 누르면 원래대로"
                 onPointerDown={drag('y', chartH, setChartH, 140, 560)} onDoubleClick={() => setChartH(200)}>
              <span className="h-1 w-9 rounded-full bg-x-border-strong group-hover:bg-x-blue" />
            </div>
          </>
        )}
      </section>
      <div className="mb-1 flex items-center gap-2">
        <span className="mr-auto font-bold">화면 안 병원 <span className="font-normal text-x-muted">{num(list.length)}곳</span></span>
        <select className="h-7 rounded-full border border-x-border-strong bg-white px-2.5 text-ui" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
          {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <Button onClick={download} disabled={!list.length} title="외부 공유 금지 데이터예요">CSV 내보내기</Button>
      </div>
      <div>
        {list.slice(0, 200).map((c) => (
          <button key={c.id} className={rowBtn(selected?.id === c.id)} onClick={() => pick(c, true)}>
            <ScorePill v={c.score} />
            <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate"><StatusDot crm={c.crm} /><span className="truncate">{c.name}<span className="text-x-muted"> {c.gu}</span></span></span>
            <span className="w-16 shrink-0 text-right tabular-nums">{won(c.sales)}</span>
            <span className="w-12 shrink-0 text-right tabular-nums">{pct(c.foreignPct)}</span>
          </button>
        ))}
        {list.length > 200 && <p className="px-1 py-3 text-ui text-x-muted">점수가 높은 200곳만 보여요 — 전체는 CSV로 받거나 지도를 좁혀 주세요.</p>}
      </div>
    </>
  );

  const clientList = (
    <>
      {lede}
      {[...customers].sort((a, b) => STATUS_ORDER[a.crm!.status] - STATUS_ORDER[b.crm!.status] || (b.sales ?? 0) - (a.sales ?? 0)).map((c) => (
        <button key={c.id} className={rowBtn(selected?.id === c.id)} onClick={() => pick(c, true)}>
          <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate"><StatusDot crm={c.crm} /><span className="truncate">{c.name}{c.crm?.branch && <span className="text-x-muted"> · {c.crm.branch}</span>}</span></span>
          <span className="shrink-0 text-ui text-x-muted">{CRM_META[c.crm!.status].label}</span>
          <span className="w-16 shrink-0 text-right tabular-nums">{won(c.sales)}</span>
        </button>
      ))}
    </>
  );

  const regionList = (
    <>
      {lede}
      {regionRank.slice(0, 60).map((r, i) => (
        <div key={r.name} className="flex min-h-11 items-center gap-2.5 border-b border-x-border px-1 text-content">
          <span className="w-6 shrink-0 text-right tabular-nums text-x-muted">{i + 1}</span>
          <button className={`min-w-0 flex-1 truncate text-left ${gu ? 'cursor-default' : 'hover:underline'}`} title={gu ? undefined : '이 지역 안의 동네끼리 견주기'}
                  onClick={() => { if (!gu) { setSido(r.sido); setGu(r.gu); focusRegion(r.sido, r.gu); } }}>{r.name}</button>
          <span className="w-24 shrink-0 text-right tabular-nums">{metricMeta.unit(r[metric])}</span>
          <button className="shrink-0 pl-1 text-ui font-semibold text-x-blue-text hover:underline" onClick={() => openRegion(r.sido, r.gu)}>병원 보기 →</button>
        </div>
      ))}
    </>
  );

  const backLabel = regionsView ? '지역 순위' : purpose === 'target' ? '목록' : '고객';
  const clinicView = selected ? (
    <div>
      <button className="text-ui font-semibold text-x-blue-text" onClick={() => setTab('list')}>← {backLabel}</button>
      <h2 className="mb-0.5 mt-1 text-[20px] font-bold">{selected.name}</h2>
      <p className="mb-1.5 text-ui text-x-muted">{selected.address}</p>
      <div className="flex gap-3 text-ui font-semibold text-x-blue-text">
        {selected.lat && <a href={`https://map.kakao.com/link/map/${encodeURIComponent(selected.name)},${selected.lat},${selected.lng}`} target="_blank" rel="noreferrer">카카오맵 ↗</a>}
        <a href={`https://map.naver.com/p/search/${encodeURIComponent(selected.name + ' ' + selected.gu)}`} target="_blank" rel="noreferrer">네이버 지도 ↗</a>
      </div>

      <div className="my-3.5 rounded-2xl border border-x-border-strong p-3.5">
        {selected.crm && selected.crm.status !== 'lead' ? (
          <>
            <p className="flex items-center gap-1.5 font-semibold"><StatusDot crm={selected.crm} />{CRM_META[selected.crm.status].label}</p>
            <p className="mt-1 text-x-secondary">월간 리포트 {selected.crm.reports ?? 0}건{selected.crm.lastMonth ? ` · 마지막 ${monthLabel(selected.crm.lastMonth)}` : ''}</p>
          </>
        ) : (
          <>
            <div className="flex items-center gap-3">
              <ScorePill v={selected.score} lg />
              <div>
                <p className="font-semibold">기회 점수</p>
                <p className="text-ui text-x-muted">{scoreReasons(selected).join(' · ')}</p>
              </div>
            </div>
            {verdict(selected) && <p className="mt-2.5 leading-relaxed">{verdict(selected)}</p>}
            {selected.crm?.status === 'lead' && (
              <p className="mt-2 flex items-center gap-1.5 text-x-secondary"><StatusDot crm={selected.crm} />제안서 {selected.crm.proposals ?? 0}건 보냄 · 열람 {selected.crm.views ?? 0}회</p>
            )}
          </>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div><p className="text-ui text-x-muted">월매출 ({monthLabel(selected.month)})</p><p className="text-[17px] font-bold tabular-nums">{won(selected.sales)}</p></div>
        <div><p className="text-ui text-x-muted">전월 대비</p><p className={`text-[17px] font-bold tabular-nums ${(selected.growth ?? 0) >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{signed(selected.growth)}</p></div>
        <div><p className="text-ui text-x-muted">외국인 비중</p><p className="text-[17px] font-bold tabular-nums">{pct(selected.foreignPct, 1)}</p></div>
      </div>
      {!selected.exact && <p className="mt-2 rounded-xl bg-amber-50 px-2.5 py-2 text-ui leading-snug text-amber-800">추정 매출이에요 — 같은 건물 병원끼리 면적으로 나눈 값이라 규모 비교용으로만 봐 주세요.</p>}

      <div className="mt-3.5 flex items-end gap-3.5 text-ui">
        {(() => {
          const max = Math.max(...selected.series.map((s) => s.sales ?? 0), 1);
          return selected.series.map((s) => (
            <div key={s.m} className="flex w-16 flex-col items-center gap-1">
              <span className="text-x-muted">{won(s.sales)}</span>
              <div className="flex h-[90px] w-9 items-end">
                <div className="flex w-full items-start overflow-hidden rounded-t-md bg-[#9fd3f7]" style={{ height: `${((s.sales ?? 0) / max) * 100}%` }}>
                  {s.foreign != null && s.sales ? <div className="w-full bg-[#f08030]" style={{ height: `${(s.foreign / s.sales) * 100}%` }} /> : null}
                </div>
              </div>
              <span className="text-x-muted">{monthLabel(s.m)}</span>
            </div>
          ));
        })()}
        <span className="ml-auto flex items-center gap-1.5 text-x-muted"><span className="size-2.5 rounded-sm bg-[#9fd3f7]" />국내 <span className="size-2.5 rounded-sm bg-[#f08030]" />외국인</span>
      </div>

      <dl className="mt-4 grid grid-cols-[96px_1fr] gap-x-3 gap-y-2.5">
        {selected.guRank && <><dt className="pt-0.5 text-ui text-x-muted">구 안 순위</dt><dd>{selected.gu} {dept} {num(selected.guCount)}곳 중 <b>{selected.guRank}위</b></dd></>}
        <dt className="pt-0.5 text-ui text-x-muted">외국인 유치</dt><dd>{selected.registered ? `등록 · ${selected.countries.join(', ') || '대상국 없음'}` : '미등록'}</dd>
        {selected.chain && <><dt className="pt-0.5 text-ui text-x-muted">체인</dt><dd>{selected.brand} · 지점 {selected.branches}곳</dd></>}
        <dt className="pt-0.5 text-ui text-x-muted">의사</dt><dd>{selected.doctors}명 (전문의 {selected.specialists})</dd>
        <dt className="pt-0.5 text-ui text-x-muted">개원</dt><dd>{selected.openedAt ?? '–'}</dd>
      </dl>

      <h3 className="mb-1 mt-5 font-bold">{distLabel(radiusM)} 안 경쟁 병원 <span className="font-normal text-x-muted">{nearby.length}곳</span></h3>
      {nearby.slice(0, 8).map((c) => (
        <button key={c.id} className={rowBtn()} onClick={() => pick(c, true)}>
          <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate"><StatusDot crm={c.crm} /><span className="truncate">{c.name}</span></span>
          <span className="w-16 shrink-0 text-right tabular-nums">{won(c.sales)}</span>
          <span className="w-12 shrink-0 text-right tabular-nums text-x-muted">{Math.round(c.dist)}m</span>
        </button>
      ))}
    </div>
  ) : (
    <p className="mt-10 text-center text-x-muted">지도나 목록에서 병원을 누르면 여기에 열려요.</p>
  );

  const termsView = (
    <div>
      <input className="mb-2 h-9 w-full rounded-full border border-x-border-strong px-3.5 text-content" placeholder="모르는 말을 검색해 보세요 (예: 기회 점수)"
             value={termQ} onChange={(e) => setTermQ(e.target.value)} autoFocus />
      {GLOSSARY.map((g) => {
        const terms = g.terms.filter((t) => !termQ || t.term.includes(termQ) || t.desc.includes(termQ) || t.aka?.some((a) => a.includes(termQ)));
        if (!terms.length) return null;
        return (
          <section key={g.group}>
            <h3 className="mb-1.5 mt-4 text-ui font-semibold text-x-muted">{g.group}</h3>
            {terms.map((t) => (
              <div key={t.term} className="border-b border-x-border py-2.5">
                <p className="font-semibold">{t.term}</p>
                <p className="mt-1 leading-relaxed text-x-secondary">{t.desc}</p>
                {t.example && <p className="mt-1 leading-relaxed text-x-secondary">{t.example}</p>}
                {t.caution && <p className="mt-2 rounded-xl bg-amber-50 px-2.5 py-2 text-ui leading-snug text-amber-800">{t.caution}</p>}
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );

  const listLabel = regionsView ? '지역 순위' : purpose === 'target' ? `목록 ${num(list.length)}` : `고객 ${customers.length}`;

  return (
    <div className="flex h-screen min-h-0 flex-col pt-5">
      <header className="flex min-h-9 flex-wrap items-center gap-3 px-6">
        <h1 className="text-[20px] font-bold">클리닉 지도</h1>
        <div role="tablist" className="ml-4 flex gap-1">
          {([['target', '영업 대상 찾기'], ['clients', '우리 고객']] as [Purpose, string][]).map(([k, l]) => (
            <button key={k} role="tab" aria-selected={purpose === k} onClick={() => switchPurpose(k)}
                    className={`h-9 rounded-full px-3.5 text-content font-semibold ${purpose === k ? 'bg-x-text text-white' : 'text-x-secondary hover:bg-x-hover'}`}>{l}</button>
          ))}
        </div>
        <span className="ml-auto text-ui text-x-secondary">
          {latestMonth ? `${monthLabel(latestMonth)} 매출 기준` : ''}{builtAt ? ` · ${new Date(builtAt).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })} 갱신` : ''}
        </span>
        <select className={select()} value={dept} title="진료과" onChange={(e) => { setDept(e.target.value); setClinics(null); setError(null); setSelected(null); setSegment('all'); setSido(''); setGu(''); }}>
          {departments.map((d) => <option key={d}>{d}</option>)}
        </select>
        <div className="relative">
          <input className="h-8 w-56 rounded-full border border-x-border-strong px-3 text-ui" placeholder="병원·역 이름으로 바로가기" value={search}
                 onChange={(e) => { setSearch(e.target.value); setSearchOpen(true); }} onFocus={() => setSearchOpen(true)}
                 onBlur={() => setTimeout(() => setSearchOpen(false), 150)} />
          {searchOpen && (searchHits.stations.length > 0 || searchHits.clinics.length > 0) && (
            <div className="absolute right-0 top-10 z-40 w-80 rounded-2xl border border-x-border-strong bg-white p-1.5 shadow-lg">
              {searchHits.stations.map((st) => (
                <button key={st.name + st.position.join()} className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-content hover:bg-x-hover"
                        onMouseDown={() => { goStation(st); setSearch(''); setSearchOpen(false); }}>
                  <span className="inline-block size-2.5 shrink-0 rounded-full border-2 bg-white" style={{ borderColor: st.transfer ? '#536471' : st.colour }} />
                  <span className="font-semibold">{st.name}</span><span className="truncate text-ui text-x-muted">{st.lines}</span>
                </button>
              ))}
              {searchHits.stations.length > 0 && searchHits.clinics.length > 0 && <div className="mx-2 my-1 border-t border-x-border" />}
              {searchHits.clinics.map((c) => (
                <button key={c.id} className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-content hover:bg-x-hover"
                        onMouseDown={() => { pick(c, true); setSearch(''); setSearchOpen(false); }}>
                  <StatusDot crm={c.crm} /><span className="font-semibold">{c.name}</span><span className="truncate text-ui text-x-muted">{c.gu} {c.dong ?? ''}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <button onClick={() => setSubwayOn((v) => !v)} aria-pressed={subwayOn} title="지도에 지하철 노선과 역을 보여줘요"
                className={`${chip(subwayOn)} font-semibold`}>
          <span className="inline-block h-[3px] w-4 rounded-full" style={{ background: 'linear-gradient(90deg,#00A23F 50%,#ED6C00 50%)' }} />
          지하철 노선·역
        </button>
        <Button onClick={() => setTab('terms')}>용어 설명</Button>
      </header>
      <div className="my-3 flex flex-wrap items-center gap-2 px-6">{row2}</div>
      {dept !== '피부과' && (
        <p className="-mt-1 mb-2.5 px-6 text-ui text-amber-800">{dept}는 아직 국내·외국인 매출 구분이 일부만 있어요. 외국인 관련 분류·점수는 참고만 해 주세요.</p>
      )}

      <div className="flex min-h-0 flex-1 border-t border-x-border">
        <div className="relative min-w-0 flex-1">
          {clinics ? (
            <MapView clinics={mapClinics} mode={regionsView ? 'region' : 'points'} regionUnit={regionUnit} regionMetric={metric}
                     selected={selected} radiusM={radiusM} onSelect={(c) => pick(c)} onBounds={setBounds}
                     onRegionClick={(s, g) => { setSido(s); setGu(g); focusRegion(s, g); }} flyTarget={fly}
                     subwayOn={subwayOn} stations={stations} />
          ) : <p className="p-6 text-content text-x-muted">클리닉 지도를 불러오는 중…</p>}
        </div>
        <aside className="relative flex shrink-0 flex-col border-l border-x-border bg-white" style={{ width: panelW }}>
          <div className="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize touch-none hover:bg-x-blue/40" title="끌어서 패널 너비 조절 · 두 번 누르면 원래대로"
               onPointerDown={drag('x', panelW, setPanelW, 360, 720)} onDoubleClick={() => setPanelW(420)} />
          <div className="flex border-b border-x-border px-2">
            {([['list', listLabel], ['clinic', '병원'], ['terms', '용어']] as [Tab, string][]).map(([k, l]) => (
              <button key={k} onClick={() => setTab(k)}
                      className={`border-b-[3px] px-3 py-3 text-content ${tab === k ? 'border-x-blue font-bold text-x-text' : 'border-transparent text-x-secondary'}`}>{l}</button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-4 text-content">
            {tab === 'list' && (clinics ? (regionsView ? regionList : purpose === 'target' ? targetList : clientList) : null)}
            {tab === 'clinic' && clinicView}
            {tab === 'terms' && termsView}
          </div>
        </aside>
      </div>
    </div>
  );
}

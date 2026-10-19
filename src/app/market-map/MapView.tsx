'use client';
// 클리닉 지도 — 지도 그리기(MapLibre 배경 + deck.gl 점·구역). 프로토타입(~/orca/projects/clinic-map)에서 옮겼다.
// 바뀐 점(스펙 2026-10-17 §2): 밀도(입체) 보기 없음 · 구역 단위는 확대 정도가 아니라 화면이 정한다(패널 순위와 같은 단위) ·
// 구역 색은 파랑 계열(제안서 보낸 곳 보라 테두리와 겹치지 않게) · 선택 반경은 테두리만 · 범례 접기.
import { useEffect, useMemo, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { ScatterplotLayer, GeoJsonLayer, TextLayer } from '@deck.gl/layers';
import type { PickingInfo } from '@deck.gl/core';
import type { Clinic, RegionMetric, RegionUnit } from './types';
import { foreignColor, seqColor, won, pct, num, CRM_META } from './format';

type Bounds = [number, number, number, number];
type GeoFeature = { type: 'Feature'; properties: Record<string, string>; geometry: unknown };
type GeoCollection = { type: 'FeatureCollection'; features: GeoFeature[] };

export interface FlyTarget { lng: number; lat: number; zoom: number; key: number }
interface Station { name: string; lines: string; colour: string; transfer: boolean; position: [number, number] }
interface Props {
  clinics: Clinic[];
  mode: 'points' | 'region';
  regionUnit: RegionUnit;
  regionMetric: RegionMetric;
  selected: Clinic | null;
  radiusM: number;
  onSelect: (c: Clinic | null) => void;
  onBounds: (b: Bounds) => void;
  onRegionClick: (sido: string, gu: string) => void;
  flyTarget: FlyTarget | null;
}

// 배경지도: OpenFreeMap(무료 공용 서버, 키 없음 — koo 10-17). 바꿀 때는 이 주소만 바꾼다
const STYLE = 'https://tiles.openfreemap.org/styles/positron';
const START = { center: [127.0, 37.53] as [number, number], zoom: 11.2 }; // 서울 — 전국은 화면 대부분이 바다다
const METRIC_LABEL: Record<RegionMetric, string> = { count: '병원 수', sales: '전체 매출', foreignSales: '외국인 매출', opportunity: '기회 병원 수' };

function radiusPx(sales: number | null, zoom: number) {
  const base = sales ? Math.sqrt(sales / 1e8) : 0.4; // 1억 → 1, 100억 → 10
  const zf = Math.max(0.55, Math.min(2.2, (zoom - 6) / 4));
  return Math.max(2, Math.min(26, (2 + base * 2.2) * zf));
}

export default function MapView(p: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const overlay = useRef<MapboxOverlay | null>(null);
  const [zoom, setZoom] = useState(START.zoom);
  const [sgg, setSgg] = useState<GeoCollection | null>(null);
  const [dong, setDong] = useState<GeoCollection | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number; html: string } | null>(null);
  const [legendOpen, setLegendOpen] = useState(true);
  const [subwayOn, setSubwayOn] = useState(true);
  // 역(koo 10-19) — 오픈스트리트맵 역 중 노선 180m 안에 있는 것만(635곳, 환승역은 한 점). 병원이 몰린 강남·신사에서 이름이
  // 병원 점에 가려지지 않게 배경(MapLibre)이 아니라 deck.gl로 병원 점 위에 그린다.
  const [stations, setStations] = useState<Station[]>([]);
  const toggleSubway = (on: boolean) => {
    setSubwayOn(on);
    const m = map.current;
    for (const id of ['subway-line', 'subway-name']) if (m?.getLayer(id)) m.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
  };
  const onBounds = useRef(p.onBounds);
  useEffect(() => { onBounds.current = p.onBounds; }, [p.onBounds]);

  useEffect(() => {
    // 배경지도 계산용 worker — 기본값은 묶음 파일 옆에서 찾는데 Next 빌드가 그 파일을 빼먹어 배경이 하얗게 나온다(10-17 스테이징).
    // node_modules의 파일을 public에 복사해 두고 그 주소를 쓴다. 버전이 맞는지는 marketMapWorker.test.ts가 확인한다.
    maplibregl.setWorkerUrl('/market-map/maplibre-gl-worker.mjs');
    const m = new maplibregl.Map({
      container: container.current!, style: STYLE, center: START.center, zoom: START.zoom,
      minZoom: 5.5, maxZoom: 18, attributionControl: { compact: true },
    });
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    m.on('style.load', () => {
      // 한국어 이름 먼저
      for (const layer of m.getStyle().layers ?? []) {
        if (layer.type === 'symbol' && m.getLayoutProperty(layer.id, 'text-field')) {
          m.setLayoutProperty(layer.id, 'text-field', ['coalesce', ['get', 'name:ko'], ['get', 'name']]);
        }
      }
      // 지하철 노선·역(koo 10-19) — 배경 데이터에는 노선이 동네 수준 확대(줌 14)부터만 있고 지하 구간은 그리지도 않아서,
      // 오픈스트리트맵 노선(수도권 24개, 노선 색 포함)을 public/market-map/subway.geojson으로 따로 담았다(만든 법은 scripts/market-map-subway.md).
      // 배경 글자보다 아래, 병원 점(deck.gl 층)보다 아래에 깐다.
      const firstLabel = m.getStyle().layers?.find((l) => l.type === 'symbol')?.id;
      m.addSource('subway', { type: 'geojson', data: '/market-map/subway.geojson' });
      m.addLayer({
        id: 'subway-line', type: 'line', source: 'subway',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': ['get', 'colour'],
          'line-opacity': 0.6,
          'line-width': ['interpolate', ['linear'], ['zoom'], 9, 1, 12, 2.2, 15, 4],
        },
      }, firstLabel);
      m.addLayer({
        id: 'subway-name', type: 'symbol', source: 'subway', minzoom: 12,
        layout: {
          'symbol-placement': 'line', 'symbol-spacing': 400,
          'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'], 'text-size': 11,
        },
        paint: { 'text-color': ['get', 'colour'], 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 },
      });
    });
    const emit = () => {
      const b = m.getBounds();
      onBounds.current([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
      setZoom(m.getZoom());
    };
    m.on('moveend', emit);
    m.on('load', emit);
    const ov = new MapboxOverlay({ interleaved: false, layers: [] });
    m.addControl(ov);
    map.current = m;
    overlay.current = ov;
    // 오른쪽 패널 너비를 바꾸면 지도 크기를 다시 맞춘다
    const ro = new ResizeObserver(() => m.resize());
    ro.observe(container.current!);
    fetch('/market-map/subway-stations.geojson').then((r) => r.json())
      .then((g: { features: Array<{ properties: Omit<Station, 'position'>; geometry: { coordinates: [number, number] } }> }) =>
        setStations(g.features.map((f) => ({ ...f.properties, position: f.geometry.coordinates }))))
      .catch(() => {});
    fetch('/market-map/sgg.geojson').then((r) => r.json()).then(setSgg).catch(() => {});
    fetch('/market-map/dong.geojson').then((r) => r.json()).then(setDong).catch(() => {});
    return () => { ro.disconnect(); m.remove(); };
  }, []);

  useEffect(() => {
    if (p.flyTarget && map.current) map.current.flyTo({ center: [p.flyTarget.lng, p.flyTarget.lat], zoom: p.flyTarget.zoom, speed: 1.6 });
  }, [p.flyTarget]);

  const useDong = p.regionUnit === 'dong';
  // 구역 집계(지금 거른 병원 기준)
  const regionAgg = useMemo(() => {
    const agg = new Map<string, { count: number; sales: number; foreignSales: number; opportunity: number }>();
    for (const c of p.clinics) {
      const k = useDong ? c.dongCode : c.sgg;
      if (!k) continue;
      const a = agg.get(k) ?? { count: 0, sales: 0, foreignSales: 0, opportunity: 0 };
      a.count++;
      a.sales += c.sales ?? 0;
      a.foreignSales += c.salesForeign ?? 0;
      if ((c.score ?? 0) >= 70) a.opportunity++;
      agg.set(k, a);
    }
    let max = 0;
    for (const a of agg.values()) max = Math.max(max, a[p.regionMetric]);
    return { agg, max };
  }, [p.clinics, p.regionMetric, useDong]);

  const layers = useMemo(() => {
    const L: unknown[] = [];
    if (p.mode === 'region') {
      const geo = useDong ? dong : sgg;
      const keyOf = (f: GeoFeature) => (useDong ? f.properties.adm_cd2 : f.properties.sgg);
      if (geo) {
        L.push(new GeoJsonLayer({
          id: 'region', data: geo as never, pickable: true, stroked: true, filled: true,
          getLineColor: [255, 255, 255, 220], lineWidthMinPixels: 0.6,
          getFillColor: (f: GeoFeature) => {
            const a = regionAgg.agg.get(keyOf(f));
            if (!a || !a[p.regionMetric]) return [0, 0, 0, 0];
            // 제곱근 눈금: 강남 같은 극단값이 나머지를 다 흐리게 만들지 않게
            return seqColor(Math.sqrt(a[p.regionMetric] / (regionAgg.max || 1)));
          },
          updateTriggers: { getFillColor: [regionAgg, p.regionMetric] },
          onClick: (info: PickingInfo<GeoFeature>) => {
            const pr = info.object?.properties;
            if (pr) p.onRegionClick(pr.sidonm, pr.sggnm);
          },
          onHover: (info: PickingInfo<GeoFeature>) => {
            const pr = info.object?.properties;
            if (!pr) return setHover(null);
            const a = regionAgg.agg.get(keyOf(info.object!));
            const name = useDong ? pr.adm_nm.split(' ').slice(1).join(' ') : `${pr.sidonm} ${pr.sggnm}`;
            setHover({ x: info.x, y: info.y,
              html: `<b>${name}</b><br/>병원 ${num(a?.count ?? 0)}곳 · 매출 ${won(a?.sales ?? 0)}<br/>외국인 매출 ${won(a?.foreignSales ?? 0)}` });
          },
        }));
      }
    }
    if (p.mode === 'points') {
      const pts = p.clinics.filter((c) => c.lat);
      pts.sort((a, b) => (b.sales ?? 0) - (a.sales ?? 0)); // 큰 점을 먼저(아래에) 그린다
      L.push(new ScatterplotLayer<Clinic>({
        id: 'clinics', data: pts, getPosition: (c) => [c.lng!, c.lat!],
        getRadius: (c) => radiusPx(c.sales, zoom), radiusUnits: 'pixels',
        getFillColor: (c) => [...foreignColor(c.foreignPct), c.exact ? 215 : 120] as [number, number, number, number],
        stroked: true,
        getLineColor: (c) => (c.sigUnderused ? [250, 204, 21, 255] : [255, 255, 255, 200]),
        getLineWidth: (c) => (c.sigUnderused ? 2.5 : 0.8), lineWidthUnits: 'pixels',
        pickable: true, autoHighlight: true, highlightColor: [15, 20, 25, 120],
        updateTriggers: { getRadius: zoom },
        onClick: (info: PickingInfo<Clinic>) => p.onSelect(info.object ?? null),
        onHover: (info: PickingInfo<Clinic>) => {
          const c = info.object;
          if (!c) return setHover(null);
          setHover({ x: info.x, y: info.y,
            html: `<b>${c.name}</b><br/>${c.gu} ${c.dong ?? ''}<br/>매출 ${won(c.sales)} · 외국인 ${pct(c.foreignPct)}${c.score != null ? ` · 기회 ${c.score}점` : ''}` });
        },
      }));
    }
    // 역 — 병원 점 위, 영업 상태 고리 아래. 구 단위(11)부터 점, 조금 더(12.5) 확대하면 이름
    if (subwayOn && stations.length && zoom >= 11) {
      const hex = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), 255] as [number, number, number, number];
      L.push(new ScatterplotLayer<Station>({
        id: 'station', data: stations, getPosition: (d) => d.position, radiusUnits: 'pixels',
        getRadius: (d) => (d.transfer ? 1.35 : 1) * Math.max(2, Math.min(5, (zoom - 10) * 1.3)),
        getFillColor: [255, 255, 255, 255], stroked: true,
        getLineColor: (d) => (d.transfer ? [83, 100, 113, 255] : hex(d.colour)), lineWidthUnits: 'pixels', getLineWidth: zoom >= 14 ? 2 : 1.3,
        pickable: true, updateTriggers: { getRadius: zoom, getLineWidth: zoom },
        onHover: (info: PickingInfo<Station>) => {
          const d = info.object;
          setHover(d ? { x: info.x, y: info.y, html: `<b>${d.name}</b><br/>${d.lines}` } : null);
        },
      }));
      if (zoom >= 12.5) {
        L.push(new TextLayer<Station>({
          id: 'station-name', data: stations, getPosition: (d) => d.position, getText: (d) => d.name,
          getSize: zoom >= 14.5 ? 13 : 11.5, getColor: [15, 20, 25, 255], getPixelOffset: [0, 11],
          fontFamily: 'Pretendard Variable, Pretendard, sans-serif', fontWeight: 600, characterSet: 'auto',
          outlineWidth: 3, outlineColor: [255, 255, 255, 235], fontSettings: { sdf: true },
          getTextAnchor: 'middle', getAlignmentBaseline: 'top', updateTriggers: { getSize: zoom },
        }));
      }
    }
    // 영업 상태 고리 + 이름표 — 어느 보기에서나 맨 위
    const crm = p.clinics.filter((c) => c.crm && c.lat);
    if (crm.length) {
      const ring = (c: Clinic) => Math.max(radiusPx(c.sales, zoom), 5) + 4;
      L.push(new ScatterplotLayer<Clinic>({
        id: 'crm-ring', data: crm, getPosition: (c) => [c.lng!, c.lat!], getRadius: ring, radiusUnits: 'pixels',
        filled: true, getFillColor: [255, 255, 255, 60], stroked: true,
        getLineColor: (c) => [...CRM_META[c.crm!.status].color, 255] as [number, number, number, number],
        getLineWidth: 3.5, lineWidthUnits: 'pixels', pickable: true, updateTriggers: { getRadius: zoom },
        onClick: (info: PickingInfo<Clinic>) => p.onSelect(info.object ?? null),
        onHover: (info: PickingInfo<Clinic>) => {
          const c = info.object;
          if (!c) return setHover(null);
          setHover({ x: info.x, y: info.y,
            html: `${CRM_META[c.crm!.status].label}<br/><b>${c.name}</b>${c.crm!.branch ? ` · ${c.crm!.branch}` : ''}<br/>매출 ${won(c.sales)} · 외국인 ${pct(c.foreignPct)}` });
        },
      }));
      if (zoom >= 10.5) {
        L.push(new TextLayer<Clinic>({
          id: 'crm-label', data: crm, getPosition: (c) => [c.lng!, c.lat!],
          getText: (c) => (c.crm!.branch ? `${c.crm!.crmName.replace(/의원$/, '')} ${c.crm!.branch}` : c.crm!.crmName),
          getSize: 12, getColor: (c) => [...CRM_META[c.crm!.status].color, 255] as [number, number, number, number],
          getPixelOffset: (c) => [0, -(ring(c) + 10)],
          fontFamily: 'Pretendard Variable, Pretendard, sans-serif', fontWeight: 700, characterSet: 'auto',
          background: true, getBackgroundColor: [255, 255, 255, 235], backgroundPadding: [5, 2],
          updateTriggers: { getPixelOffset: zoom },
        }));
      }
    }
    if (p.selected?.lat) {
      const s = p.selected;
      L.push(
        // 반경은 테두리만 — 안쪽 경쟁 병원이 가려지지 않게
        new ScatterplotLayer({
          id: 'radius', data: [s], getPosition: () => [s.lng!, s.lat!], getRadius: p.radiusM, radiusUnits: 'meters',
          filled: false, stroked: true, getLineColor: [15, 20, 25, 150], lineWidthMinPixels: 1.5,
        }),
        new ScatterplotLayer({
          id: 'selected', data: [s], getPosition: () => [s.lng!, s.lat!], getRadius: radiusPx(s.sales, zoom) + 4,
          radiusUnits: 'pixels', filled: false, stroked: true, getLineColor: [15, 20, 25, 255], lineWidthMinPixels: 2.5,
          updateTriggers: { getRadius: zoom },
        }),
      );
    }
    return L;
  }, [p, zoom, sgg, dong, regionAgg, useDong, subwayOn, stations]);

  useEffect(() => {
    overlay.current?.setProps({ layers: layers as never, getCursor: ({ isHovering }) => (isHovering ? 'pointer' : 'grab') });
  }, [layers]);

  return (
    <div className="absolute inset-0">
      {/* maplibre CSS가 .maplibregl-map에 position: relative를 줘서 클래스 배치가 지면 높이가 0이 된다 — 인라인으로 고정 */}
      <div ref={container} style={{ position: 'absolute', inset: 0 }} />
      {hover && (
        <div className="pointer-events-none absolute z-10 rounded-lg bg-x-text/90 px-2.5 py-1.5 text-ui leading-snug text-white"
             style={{ left: hover.x + 14, top: hover.y + 14 }} dangerouslySetInnerHTML={{ __html: hover.html }} />
      )}
      <div className="absolute bottom-3 left-3 z-10 w-60 rounded-2xl border border-x-border-strong bg-white/95 text-ui shadow-sm">
        <button onClick={() => setLegendOpen((v) => !v)} className="flex w-full items-center px-3 py-2 font-semibold">
          {p.mode === 'points' ? '점 색 = 외국인 매출 비중' : `색 = ${METRIC_LABEL[p.regionMetric]} · ${useDong ? '행정동' : '시군구'}`}
          <span className="ml-auto text-caption font-normal text-x-blue-text">{legendOpen ? '접기' : '펼치기'}</span>
        </button>
        {legendOpen && (
          <div className="px-3 pb-3">
            {p.mode === 'points' ? (
              <>
                <div className="h-2 rounded" style={{ background: 'linear-gradient(90deg, rgb(37,99,235) 0%, rgb(125,146,196) 15%, rgb(176,168,160) 35%, rgb(240,128,48) 60%, rgb(214,64,12) 100%)' }} />
                <div className="mt-0.5 flex justify-between text-caption text-x-muted"><span>0%</span><span>15</span><span>35</span><span>60</span><span>100%</span></div>
                <p className="mt-1.5 text-x-secondary">원 크기 = 월매출</p>
                <p className="mt-1 flex items-center gap-1.5 text-x-secondary"><span className="inline-block size-3 rounded-full border-[2.5px] border-yellow-400" />유치 등록 · 외국인 적음</p>
                <p className="mt-1 flex items-center gap-1.5 text-x-secondary"><span className="inline-block size-3 rounded-full bg-x-muted/40" />흐린 점 = 추정 매출</p>
              </>
            ) : (
              <>
                <div className="h-2 rounded" style={{ background: 'linear-gradient(90deg, rgb(232,245,253), rgb(21,115,173))' }} />
                <div className="mt-0.5 flex justify-between text-caption text-x-muted"><span>적음</span><span>많음</span></div>
                <p className="mt-1.5 text-x-secondary">구역을 누르면 그 안의 동네끼리 견줘요</p>
              </>
            )}
            <label className="mt-2 flex cursor-pointer items-center gap-1.5 border-t border-x-border pt-2 text-x-secondary">
              <input type="checkbox" checked={subwayOn} onChange={(e) => toggleSubway(e.target.checked)} />
              <span className="inline-block h-[3px] w-4 rounded-full" style={{ background: 'linear-gradient(90deg,#00A23F 50%,#ED6C00 50%)' }} />
              지하철 노선 · 역
            </label>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 border-t border-x-border pt-2 text-x-secondary">
              {(Object.keys(CRM_META) as (keyof typeof CRM_META)[]).map((k) => (
                <span key={k} className="inline-flex items-center gap-1"><span className="inline-block size-2.5 rounded-full border-2" style={{ borderColor: CRM_META[k].hex }} />{CRM_META[k].label}</span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// 피부과 시술 분류 — 시술 분류표(procedureMaster.json, 키워드 마스터 v1 10-22 확정)의 소비자 대분류·중분류를 붙인다.
// 분류표는 리포트(b2b-marketing)와 대시보드가 같이 쓰는 원본이다. 기준·근거는 docs/superpowers/specs/2026-10-28-trends-taxonomy-brief.md
// - 소비자 대분류 11개: 대표 클리닉 3곳(블리비·톡스앤필·아비쥬) 메뉴 다수결, 갈리면 강남언니
//   색소·홍조 / 여드름·모공은 톡스앤필처럼 나눈다 — 세 곳이 갈렸고 일본 고민 태그도 따로다(koo 10-28, 처음엔 아비쥬처럼 하나였음)
// - 고민어(주름·탈모 등)는 대분류가 비어 있다 — 화면에서는 '피부 고민'으로 모은다
// - 시술 방식(의학 기준)은 분류표에 있지만 화면에는 아직 쓰지 않는다(koo 10-28)
import MASTER from './procedureMaster.json';

export const CATEGORIES = [
  '리프팅', '톡신·윤곽', '필러·볼륨', '스킨부스터', '색소·홍조', '여드름·모공', '스킨케어·필링', '안티에이징 주사', '바디', '제모', '기타',
  '피부 고민',
] as const;
export type Category = typeof CATEGORIES[number];

export interface MasterRow {
  id: string; bundle: string; jp: string;
  type: string;          // 시술 / 시술 통칭 / 고민·증상 / 질환·병변 / 약 / 일반어 / 다른 뜻 섞임
  area: string;          // 피부과 일반 / 피부과 일부 / 다른 과 (고민어는 빈칸)
  otherDept: string; major: string; sub: string; method: string; concernTags: string;
  rank: boolean; rankExcluded: string; countRule: string; ruleBasis: string; note: string;
}
export const PROCEDURE_MASTER = MASTER as MasterRow[];

export interface Classified {
  category: Category; sub: string;
  derm: boolean;   // 피부과 시술 — 유형이 시술·시술 통칭이고 진료 영역이 피부과 일반('피부과 시술만 보기'가 남기는 것)
  listed: boolean; // 분류표를 따르는 시술(분류표에 있거나 같은 이름의 묶음이 있음). 아니면 앱에서 고른 분류를 쓴다
}

export interface ProcedureRef { id: string; jp: string; major: string; middle: string; name: string }

const key = (jp: string) => jp.replace(/\s/g, '').toLowerCase();
const BY_ID = new Map(PROCEDURE_MASTER.map((m) => [m.id, m]));
// 같은 일본어 검색어가 두 줄인 시술(糸リフト 등 5개)은 분류표에 한 줄만 있다 — 일본어로 찾는다
const BY_JP = new Map(PROCEDURE_MASTER.map((m) => [key(m.jp), m]));
// 묶음 이름 → 처음 나온 줄. '새로 뜨는 검색'에서 기존 시술의 다른 표기로 더한 시술은 이름이 같아 그 묶음의 분류를 따른다
const BY_BUNDLE = new Map([...PROCEDURE_MASTER].reverse().filter((m) => m.major).map((m) => [m.bundle, m]));

// 옛 화면 분류(10-13~10-28) → 새 대분류. 앱에서 옛 분류 이름으로 더한 시술이 있어도 갈 곳이 있게
const LEGACY: Record<string, Category> = {
  '보톡스': '톡신·윤곽', '필러': '필러·볼륨', '색소·미백': '색소·홍조', '홍조·혈관': '색소·홍조', '여드름': '여드름·모공',
  '흉터·모공': '여드름·모공', '점·사마귀 제거': '색소·홍조', '문신·반영구': '색소·홍조', '피부 관리·필링': '스킨케어·필링',
  '바디·비만': '바디', '탈모·두피': '기타', '수액·주사': '안티에이징 주사', '재생 치료': '안티에이징 주사', '여성 시술': '기타', '다한증·액취증': '기타',
};

export function masterOf(p: Pick<ProcedureRef, 'id' | 'jp'>): MasterRow | null {
  return BY_ID.get(p.id) ?? BY_JP.get(key(p.jp)) ?? null;
}

export function classify(p: ProcedureRef): Classified {
  const m = masterOf(p);
  if (m) {
    if (!m.major) return { category: '피부 고민', sub: m.bundle, derm: false, listed: true };
    return { category: m.major as Category, sub: m.sub, derm: (m.type === '시술' || m.type === '시술 통칭') && m.area === '피부과 일반', listed: true };
  }
  // 앱에서 더한 시술 — 같은 이름의 묶음이 분류표에 있으면 그 분류, 없으면 고를 때 정한 분류(trend_procedure.major)
  const same = BY_BUNDLE.get(p.name);
  if (same) return { category: same.major as Category, sub: same.sub, derm: true, listed: true };
  const category = (CATEGORIES as readonly string[]).includes(p.major) ? p.major as Category : LEGACY[p.major] ?? '기타';
  return { category, sub: p.middle || p.name, derm: category !== '피부 고민', listed: false };
}

export const categoryOrder = (c: Category) => CATEGORIES.indexOf(c);

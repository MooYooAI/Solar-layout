// 도면 탭의 도면 목록, 용지, 축척. 화면 없이 값만 다룬다.

export type SheetId =
  | 'cover'
  | 'index'
  | 'site-plan'
  | 'array-plan'
  | 'set-plan'
  | 'side'
  | 'front'
  | 'section'
  | 'sld'
  | 'dc'
  | 'inverter-plan'
  | 'module'
  | 'inverter'
  | 'grading'
  | 'slope'
  | 'calc'
  | 'bom'
  | 'quantity'

export interface SheetDef {
  id: SheetId
  no: string
  title: string
  group: string
}

export const SHEET_GROUPS = ['목록', '구조물', '전기', '제품', '토목', '문서'] as const

export const SHEETS: SheetDef[] = [
  { id: 'cover', no: 'E-000', title: '표지', group: '목록' },
  { id: 'index', no: '001', title: '도면 목록표', group: '목록' },
  { id: 'site-plan', no: '002', title: '공사계획 평면도', group: '구조물' },
  { id: 'array-plan', no: '003', title: '모듈 배치 평면도', group: '구조물' },
  { id: 'set-plan', no: '004', title: '모듈 평면도(세트)', group: '구조물' },
  { id: 'side', no: '005', title: '구조물 측면도', group: '구조물' },
  { id: 'front', no: '006', title: '구조물 정면도', group: '구조물' },
  { id: 'section', no: '007', title: '구조물 간이 단면도', group: '구조물' },
  { id: 'sld', no: '008', title: '발전설비 단선결선도', group: '전기' },
  { id: 'dc', no: '009', title: 'DC 결선도', group: '전기' },
  { id: 'inverter-plan', no: '010', title: '인버터 구획 평면도', group: '전기' },
  { id: 'module', no: '011', title: '모듈 외형도', group: '제품' },
  { id: 'inverter', no: '012', title: '인버터 외형도', group: '제품' },
  { id: 'grading', no: 'C01', title: '절·성토 계획 평면도', group: '토목' },
  { id: 'slope', no: 'C02', title: '경사 분석도', group: '토목' },
  { id: 'calc', no: 'D01', title: '설계계산서', group: '문서' },
  { id: 'bom', no: 'D02', title: '자재목록표', group: '문서' },
  { id: 'quantity', no: 'D03', title: '물량산출서', group: '문서' },
]

/** 묶음 인쇄: 쓰임새별로 고른 도면 */
export const BUNDLES: Array<{ key: string; label: string; detail: string; ids: SheetId[] }> = [
  {
    key: 'permit',
    label: '허가용',
    detail: '개발행위·발전사업 허가 신청에 붙이는 배치·구조·결선 도면',
    ids: ['cover', 'index', 'site-plan', 'array-plan', 'side', 'front', 'sld', 'module', 'inverter', 'grading', 'slope'],
  },
  {
    key: 'build',
    label: '시공용',
    detail: '현장 시공에 쓰는 상세도·결선도와 계산서·자재목록·물량',
    ids: ['cover', 'index', 'site-plan', 'array-plan', 'set-plan', 'side', 'front', 'section', 'sld', 'dc', 'inverter-plan', 'grading', 'calc', 'bom', 'quantity'],
  },
  { key: 'all', label: '전체', detail: '모든 도면과 문서', ids: SHEETS.map((s) => s.id) },
]

export type Paper = 'A3' | 'A4'
/** 가로 방향 용지 크기(mm) */
export const PAPER: Record<Paper, { w: number; h: number }> = {
  A3: { w: 420, h: 297 },
  A4: { w: 297, h: 210 },
}

/** 도곽: 바깥 여백, 오른쪽 표제란 폭(mm) */
export const FRAME = { margin: 10, title: 62 }

/** 도면을 그릴 수 있는 칸(mm). 위쪽은 설계 개요, 아래쪽은 도면 제목을 둔다. */
export function drawArea(paper: Paper, top = 0) {
  const { w, h } = PAPER[paper]
  const m = FRAME.margin
  return { x: m + 6, y: m + 6 + top, w: w - m * 2 - FRAME.title - 12, h: h - m * 2 - 30 - top }
}

const SCALES = [20, 25, 30, 50, 80, 100, 150, 200, 250, 300, 400, 500, 600, 800, 1000, 1200, 1500, 2000, 2500, 3000, 4000, 5000, 6000, 8000, 10000]

/** 실제 크기 w×h(m)가 칸 aw×ah(mm)에 들어가는 가장 큰 표준 축척(1/S) */
export function fitScale(w: number, h: number, aw: number, ah: number): number {
  for (const s of SCALES) if ((w * 1000) / s <= aw && (h * 1000) / s <= ah) return s
  return SCALES[SCALES.length - 1]
}

/** 축척 막대 길이(m): 도면에서 25~50mm쯤 되는 둥근 값 */
export function scaleBar(scale: number): number {
  const target = (40 * scale) / 1000
  const p = 10 ** Math.floor(Math.log10(target))
  const m = target / p
  return (m >= 5 ? 5 : m >= 2 ? 2 : 1) * p
}

export type AnnotKind = 'line' | 'rect' | 'circle' | 'text' | 'dim'
export interface Annot {
  id: string
  kind: AnnotKind
  /** 용지 좌표(mm) */
  a: [number, number]
  b: [number, number]
  text?: string
}

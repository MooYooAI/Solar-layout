// 설계 파라미터 목록: 모듈 종류, 래킹(구조물) 방식, 인버터 종류.
// 모듈은 시장에서 흔한 규격대를 대표하는 일반 규격과, 제조사 데이터시트(STC) 값을 옮긴 제품을 함께 둔다.
// 제품 값은 출처 데이터시트 기준이며, 실제 발주 전에는 납품 제품의 최신 데이터시트로 다시 확인한다.

export interface ModuleSpec {
  id: string
  label: string
  /** 제조사. 없으면 일반 규격 */
  maker?: string
  /** 모델명 */
  model?: string
  /** mm */
  length: number
  width: number
  watt: number
  /** 개방전압·최대출력전압(V), 단락전류·최대출력전류(A) */
  voc: number
  vmp: number
  isc: number
  imp: number
  /** 개방전압 온도계수(%/°C) */
  betaVoc: number
  /** 최대출력 온도계수(%/°C) */
  gammaPmax: number
}

export const MODULES: ModuleSpec[] = [
  { id: 'm450', label: '450W급 단면 (1903×1134)', length: 1903, width: 1134, watt: 450, voc: 40.0, vmp: 33.6, isc: 14.2, imp: 13.4, betaVoc: -0.26, gammaPmax: -0.3 },
  { id: 'm550', label: '550W급 단면 (2278×1134)', length: 2278, width: 1134, watt: 550, voc: 49.9, vmp: 41.9, isc: 14.0, imp: 13.13, betaVoc: -0.27, gammaPmax: -0.35 },
  { id: 'm585', label: '585W급 N형 양면 (2278×1134)', length: 2278, width: 1134, watt: 585, voc: 51.6, vmp: 43.2, isc: 14.4, imp: 13.55, betaVoc: -0.25, gammaPmax: -0.29 },
  { id: 'm620', label: '620W급 N형 양면 (2382×1134)', length: 2382, width: 1134, watt: 620, voc: 55.4, vmp: 46.0, isc: 14.2, imp: 13.48, betaVoc: -0.25, gammaPmax: -0.29 },
  { id: 'm700', label: '700W급 대형 (2384×1303)', length: 2384, width: 1303, watt: 700, voc: 48.6, vmp: 40.4, isc: 18.4, imp: 17.33, betaVoc: -0.25, gammaPmax: -0.29 },
  // ── 제조사 제품(데이터시트 STC 값) ──
  // 한화큐셀 Q.TRON XL-G2.3/BFG 데이터시트(2026-02 Rev10)
  { id: 'qcells-qtron-xl-630', maker: '한화큐셀', model: 'Q.TRON XL-G2.3/BFG 630', label: '630W N형 양면 (2462×1134)', length: 2462, width: 1134, watt: 630, voc: 57.23, vmp: 47.89, isc: 13.88, imp: 13.15, betaVoc: -0.24, gammaPmax: -0.29 },
  { id: 'qcells-qtron-xl-640', maker: '한화큐셀', model: 'Q.TRON XL-G2.3/BFG 640', label: '640W N형 양면 (2462×1134)', length: 2462, width: 1134, watt: 640, voc: 57.79, vmp: 48.28, isc: 13.99, imp: 13.26, betaVoc: -0.24, gammaPmax: -0.29 },
  // HD현대에너지솔루션 HiN-TxxxNJ 데이터시트(2025-09)
  { id: 'hdhyundai-hin-t630nj', maker: 'HD현대에너지솔루션', model: 'HiN-T630NJ', label: '630W TOPCon 양면 (2465×1134)', length: 2465, width: 1134, watt: 630, voc: 55.9, vmp: 46.5, isc: 14.31, imp: 13.55, betaVoc: -0.25, gammaPmax: -0.3 },
  { id: 'hdhyundai-hin-t640nj', maker: 'HD현대에너지솔루션', model: 'HiN-T640NJ', label: '640W TOPCon 양면 (2465×1134)', length: 2465, width: 1134, watt: 640, voc: 56.3, vmp: 46.9, isc: 14.41, imp: 13.65, betaVoc: -0.25, gammaPmax: -0.3 },
  // 진코솔라 Tiger Neo 66HL4M-BDV
  { id: 'jinko-tigerneo-650', maker: '진코솔라', model: 'Tiger Neo JKM650N-66HL4M-BDV', label: '650W TOPCon 양면 (2382×1134)', length: 2382, width: 1134, watt: 650, voc: 50.28, vmp: 41.57, isc: 16.44, imp: 15.64, betaVoc: -0.25, gammaPmax: -0.29 },
  // 트리나솔라 Vertex N TSM-NFG19RC.20
  { id: 'trina-vertexn-620', maker: '트리나솔라', model: 'Vertex N TSM-NFG19RC.20 620W', label: '620W TOPCon 양면 (2390×1142)', length: 2390, width: 1142, watt: 620, voc: 48.5, vmp: 40.24, isc: 16.26, imp: 15.41, betaVoc: -0.24, gammaPmax: -0.29 },
]

/** 지금 설정과 같은 목록 모듈(규격·출력이 같으면 첫 항목) */
export const findModule = (length: number, width: number, watt: number) => MODULES.find((m) => m.length === length && m.width === width && m.watt === watt)

/** 제조사 제품이면 "제조사 모델명", 일반 규격이면 null */
export const moduleName = (m: ModuleSpec | undefined) => (m?.maker ? `${m.maker} ${m.model}` : null)

export type RackingType = 'pile' | 'concrete' | 'agri'

export interface RackingSpec {
  label: string
  detail: string
  /** 구조물이 지형을 따라갈 수 있는 경사 한도(%), 남북(경사 방향)·동서(세트 폭 방향) */
  nsSlopePct: number
  ewSlopePct: number
  /** 기초 높이 조절로 흡수하는 지반 요철(m). 넘는 만큼은 깎거나 쌓는다. */
  reveal: number
  /** 모듈 하단 지면 높이 기본값(m) */
  groundClearance: number
}

export const RACKING: Record<RackingType, RackingSpec> = {
  pile: {
    label: '지상 고정식 · 파일 기초',
    detail: '스크류·H형강 파일. 지형을 많이 따라가 토공이 적다.',
    nsSlopePct: 15,
    ewSlopePct: 10,
    reveal: 0.3,
    groundClearance: 0.5,
  },
  concrete: {
    label: '지상 고정식 · 콘크리트 기초',
    detail: '독립·줄기초. 바닥을 고르게 해야 해 토공이 많다.',
    nsSlopePct: 5,
    ewSlopePct: 5,
    reveal: 0.1,
    groundClearance: 0.5,
  },
  agri: {
    label: '영농형 · 고가 구조',
    detail: '모듈 하단 3m 이상, 농기계 통행. 기둥 기초라 요철 허용이 크다.',
    nsSlopePct: 10,
    ewSlopePct: 8,
    reveal: 0.3,
    groundClearance: 3.5,
  },
}

export interface InverterSpec {
  id: string
  label: string
  /** 정격 AC 출력(kW) */
  kw: number
  /** 최대 입력 DC 전압(V) */
  maxDcV: number
  mpptMinV: number
  mpptMaxV: number
  /** 계통측 AC 전압(V, 3상) */
  acV: number
}

export const INVERTERS: InverterSpec[] = [
  { id: 'i30', label: '30kW 스트링 (1000V, 380V)', kw: 30, maxDcV: 1000, mpptMinV: 200, mpptMaxV: 950, acV: 380 },
  { id: 'i50', label: '50kW 스트링 (1000V, 380V)', kw: 50, maxDcV: 1000, mpptMinV: 200, mpptMaxV: 950, acV: 380 },
  { id: 'i100', label: '100kW 스트링 (1100V, 380V)', kw: 100, maxDcV: 1100, mpptMinV: 200, mpptMaxV: 1000, acV: 380 },
  { id: 'i300', label: '300kW 스트링 (1500V, 800V)', kw: 300, maxDcV: 1500, mpptMinV: 500, mpptMaxV: 1500, acV: 800 },
]

/** 인버터 외형(mm, kg). 같은 용량대 스트링 인버터의 흔한 크기를 대표하는 참고값이다. */
export interface InverterSize {
  w: number
  h: number
  d: number
  kg: number
}

const INVERTER_SIZES: Array<[number, InverterSize]> = [
  [30, { w: 640, h: 530, d: 270, kg: 40 }],
  [50, { w: 1075, h: 555, d: 300, kg: 74 }],
  [100, { w: 1035, h: 700, d: 365, kg: 90 }],
  [300, { w: 1048, h: 732, d: 395, kg: 112 }],
]

/** 정격 출력(kW)에 가장 가까운 용량대의 외형 */
export function inverterSize(kw: number): InverterSize {
  let best = INVERTER_SIZES[0]
  for (const e of INVERTER_SIZES) if (Math.abs(e[0] - kw) < Math.abs(best[0] - kw)) best = e
  return best[1]
}

/** 모듈 두께(mm) 참고값 */
export const MODULE_THICKNESS = 35

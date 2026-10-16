// 설계 파라미터 목록: 모듈 종류, 래킹(구조물) 방식, 인버터 종류.
// 특정 제조사 제품이 아니라 시장에서 흔한 규격대를 대표하는 참고값이다. 실제 설계에는 선정한 제품의 데이터시트 값을 넣는다.

export interface ModuleSpec {
  id: string
  label: string
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
]

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

// 설계 기반 설치비(CAPEX) 산출. 배치·전기·토공 결과의 물량에 단가를 곱한다.
// 단가는 국내 지상형 태양광 시장의 대략적인 참고값이며 화면에서 고칠 수 있다. 금액 단위는 만원.

import type { RackingType } from './catalog'
import type { ElecResult } from './electrical'
import type { EarthworkResult } from './earthwork'

export interface CostParams {
  /** 모듈(원/W) */
  moduleWonPerW: number
  /** 인버터(만원/kW AC) */
  inverterPerKW: number
  /** 구조물(만원/kWp), 래킹 방식별 */
  racking: Record<RackingType, number>
  /** 접속반·모니터링·접지 등 기타 전기(만원/kWp) */
  bosPerKW: number
  /** 설치 공사(만원/kWp) */
  laborPerKW: number
  /** DC 케이블(원/m, 시공 포함) */
  dcCableWonPerM: number
  /** AC 케이블(원/m) = 기본 + ㎟당 */
  acCableBaseWonPerM: number
  acCableWonPerMm2M: number
  /** 절토·성토(원/㎥, 다짐·운반 포함) */
  cutWonPerM3: number
  fillWonPerM3: number
  /** 계통연계·수배전반 고정비(만원): 저압(100kW 미만)과 특고압 */
  gridFixedLV: number
  gridFixed: number
  /** 특고압 연계 변압기·수전설비(만원/kVA) */
  transformerPerKVA: number
  /** 설계·인허가·감리·일반관리(직접비 대비 %) */
  indirectPct: number
}

export const DEFAULT_COSTS: CostParams = {
  moduleWonPerW: 300,
  inverterPerKW: 8,
  racking: { pile: 18, concrete: 24, agri: 45 },
  bosPerKW: 6,
  laborPerKW: 18,
  dcCableWonPerM: 2500,
  acCableBaseWonPerM: 5000,
  acCableWonPerMm2M: 700,
  cutWonPerM3: 8000,
  fillWonPerM3: 12000,
  gridFixedLV: 300,
  gridFixed: 1500,
  transformerPerKVA: 4,
  indirectPct: 8,
}

export interface CapexItem {
  key: string
  label: string
  /** 만원 */
  amount: number
  /** 물량 설명 */
  basis: string
}

export interface Capex {
  items: CapexItem[]
  total: number
}

const n0 = (v: number) => Math.round(v).toLocaleString('ko-KR')

export function capexFor(
  kWp: number,
  racking: RackingType,
  elec: ElecResult | null,
  earth: EarthworkResult | null,
  c: CostParams,
): Capex {
  const kWac = elec?.kWac ?? kWp / 1.2
  const items: CapexItem[] = [
    { key: 'module', label: '모듈', amount: (kWp * 1000 * c.moduleWonPerW) / 10000, basis: `${n0(kWp)} kWp × ${c.moduleWonPerW}원/W` },
    { key: 'inverter', label: '인버터', amount: kWac * c.inverterPerKW, basis: `${n0(kWac)} kW × ${c.inverterPerKW}만원/kW` },
    { key: 'racking', label: '구조물', amount: kWp * c.racking[racking], basis: `${n0(kWp)} kWp × ${c.racking[racking]}만원/kWp` },
    { key: 'bos', label: '기타 전기', amount: kWp * c.bosPerKW, basis: `${n0(kWp)} kWp × ${c.bosPerKW}만원/kWp` },
    { key: 'labor', label: '설치 공사', amount: kWp * c.laborPerKW, basis: `${n0(kWp)} kWp × ${c.laborPerKW}만원/kWp` },
  ]
  if (elec) {
    items.push({
      key: 'dc',
      label: 'DC 케이블',
      amount: (elec.dcCableM * c.dcCableWonPerM) / 10000,
      basis: `${n0(elec.dcCableM)} m × ${n0(c.dcCableWonPerM)}원/m`,
    })
    const ac = elec.inverters.reduce((t, v) => t + v.acCableM * (c.acCableBaseWonPerM + c.acCableWonPerMm2M * v.acCableMm2), 0)
    items.push({ key: 'ac', label: 'AC 케이블', amount: ac / 10000, basis: `${n0(elec.acCableM)} m (규격별 단가)` })
  }
  if (earth) {
    items.push({
      key: 'earth',
      label: '토공',
      amount: (earth.cut * c.cutWonPerM3 + earth.fill * c.fillWonPerM3) / 10000,
      basis: `절토 ${n0(earth.cut)}㎥ · 성토 ${n0(earth.fill)}㎥`,
    })
  }
  const kva = elec?.transformerKVA ?? null
  items.push({
    key: 'grid',
    label: '계통연계·수배전',
    amount: kva ? c.gridFixed + kva * c.transformerPerKVA : c.gridFixedLV,
    basis: kva ? `특고압 고정 ${n0(c.gridFixed)}만원 + 변압기 ${n0(kva)} kVA` : `저압 연계 ${n0(c.gridFixedLV)}만원`,
  })
  const direct = items.reduce((t, i) => t + i.amount, 0)
  items.push({ key: 'indirect', label: '설계·인허가·감리', amount: (direct * c.indirectPct) / 100, basis: `직접비의 ${c.indirectPct}%` })
  return { items, total: items.reduce((t, i) => t + i.amount, 0) }
}

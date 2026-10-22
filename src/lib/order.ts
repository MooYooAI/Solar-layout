// 발주목록: 확정한 설계의 자재·공사를 발주 묶음(업체 단위)으로 나누고 수량과 예상 금액을 붙인다.
// 예상 금액은 설치비 산출과 같은 단가를 쓴다. 금액 단위는 만원.
import { INVERTERS, RACKING, findModule, moduleName } from './catalog'
import type { CostParams } from './costs'
import type { DesignMetrics } from './design'
import type { ElecParams, ElecResult } from './electrical'
import type { LayoutParams } from './layout'

export type OrderPackage = 'module' | 'inverter' | 'racking' | 'electric' | 'civil'

export const ORDER_PACKAGES: Record<OrderPackage, string> = {
  module: '모듈',
  inverter: '인버터',
  racking: '구조물',
  electric: '전기 자재·수배전',
  civil: '시공·토목',
}

export interface OrderLine {
  pkg: OrderPackage
  item: string
  spec: string
  unit: string
  qty: number
  /** 예상 금액(만원). 따로 값을 매기지 않는 부속은 null */
  amount: number | null
}

export interface OrderInput {
  params: LayoutParams
  elecParams: ElecParams
  elec: ElecResult | null
  metrics: DesignMetrics
  costs: CostParams
}

export function orderLines({ params: p, elecParams: e, elec, metrics: m, costs: c }: OrderInput): OrderLine[] {
  const capex = (key: string) => m.capex.items.find((i) => i.key === key)?.amount ?? null
  const lines: OrderLine[] = [
    {
      pkg: 'module',
      item: '태양광 모듈',
      spec: [moduleName(findModule(p.moduleLength, p.moduleWidth, p.moduleWatt)), `${p.moduleWatt} W, ${p.moduleLength}×${p.moduleWidth} mm`].filter(Boolean).join(', '),
      unit: '장',
      qty: m.modules,
      amount: capex('module'),
    },
    {
      pkg: 'inverter',
      item: '인버터',
      spec: INVERTERS.find((i) => i.id === e.inverterId)?.label ?? `${e.inverterKW} kW`,
      unit: '대',
      qty: m.inverters,
      amount: capex('inverter'),
    },
    {
      pkg: 'racking',
      item: '구조물',
      spec: `${RACKING[p.racking].label}, ${p.setCols}열×${p.setRows}단, 경사 ${p.tilt}°`,
      unit: '세트',
      qty: m.sets,
      amount: capex('racking'),
    },
  ]
  if (elec) {
    lines.push({ pkg: 'electric', item: 'DC 케이블', spec: `${e.dcCableMm2} ㎟ (H1Z2Z2-K 등)`, unit: 'm', qty: Math.round(elec.dcCableM), amount: capex('dc') })
    lines.push({ pkg: 'electric', item: 'MC4 커넥터', spec: '스트링 양 끝 1쌍씩', unit: '쌍', qty: elec.strings.length, amount: null })
    const bySize = new Map<number, number>()
    for (const v of elec.inverters) bySize.set(v.acCableMm2, (bySize.get(v.acCableMm2) ?? 0) + v.acCableM)
    for (const [mm2, len] of [...bySize].sort((a, b) => a[0] - b[0]))
      lines.push({ pkg: 'electric', item: 'AC 케이블', spec: `CV ${mm2} ㎟ 3상`, unit: 'm', qty: Math.round(len), amount: (len * (c.acCableBaseWonPerM + c.acCableWonPerMm2M * mm2)) / 10000 })
  }
  lines.push({ pkg: 'electric', item: '접속반·모니터링·접지', spec: '기타 전기 자재', unit: '식', qty: 1, amount: capex('bos') })
  lines.push({
    pkg: 'electric',
    item: elec?.transformerKVA ? '수배전반·변압기' : '수배전반',
    spec: elec?.transformerKVA ? `특고압 22.9 kV, 변압기 ${elec.transformerKVA} kVA` : '저압 연계',
    unit: '식',
    qty: 1,
    amount: capex('grid'),
  })
  lines.push({ pkg: 'civil', item: '설치 공사', spec: `${Math.round(m.kWp)} kWp 구조물·모듈·배선 시공`, unit: '식', qty: 1, amount: capex('labor') })
  if (m.cut !== null && (m.cut > 0 || (m.fill ?? 0) > 0)) {
    lines.push({ pkg: 'civil', item: '토공', spec: `절토 ${Math.round(m.cut)} ㎥ · 성토 ${Math.round(m.fill ?? 0)} ㎥`, unit: '식', qty: 1, amount: capex('earth') })
  }
  return lines
}

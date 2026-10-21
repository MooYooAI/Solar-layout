// 도면 묶음에 넣는 문서(설계계산서·자재목록표·물량산출서)의 표 내용. 화면 없이 값만 만든다.
import { LocalFrame } from './geo'
import { INVERTERS, RACKING } from './catalog'
import { rowSpacingForNoShade } from './sun'
import { stringRange, type ElecParams, type ElecResult } from './electrical'
import type { DesignMetrics } from './design'
import type { LayoutParams, LayoutStats, SetGeometry } from './layout'
import type { Parcel } from './parcel'

export interface DocBlock {
  heading: string
  /** 열 이름과 폭 비율 */
  cols: Array<[string, number]>
  rows: string[][]
}

export interface DocInput {
  parcel: Parcel | null
  params: LayoutParams
  geometry: SetGeometry
  stats: LayoutStats
  elec: ElecResult | null
  elecParams: ElecParams
  metrics: DesignMetrics | null
}

const fmt = (n: number, d = 0) => n.toLocaleString('ko-KR', { maximumFractionDigits: d })
const ITEM: Array<[string, number]> = [
  ['항목', 0.3],
  ['산식·근거', 0.45],
  ['값', 0.25],
]

/** 설계계산서: 스트링 전압, 인버터 용량, 케이블 손실, 열 이격, 발전량 */
export function calcBlocks(d: DocInput): DocBlock[] {
  const e = d.elecParams
  const p = d.params
  const r = stringRange(e)
  const blocks: DocBlock[] = [
    {
      heading: '1. 스트링 직렬 수',
      cols: ITEM,
      rows: [
        ['최저 기온 개방전압', `Voc × (1 + β × (${e.minTemp} − 25)) = ${e.voc} × (1 + ${e.betaVoc}% × ${e.minTemp - 25})`, `${fmt(r.vocCold, 2)} V`],
        ['고온 동작전압', `Vmp × (1 + γ × (${e.maxCellTemp} − 25)) = ${e.vmp} × (1 + ${e.gammaPmax}% × ${e.maxCellTemp - 25})`, `${fmt(r.vmpHot, 2)} V`],
        ['최대 직렬 수', `min(최대 DC ${e.maxDcV} V ÷ ${fmt(r.vocCold, 2)}, MPPT 최대 ${e.mpptMaxV} V ÷ ${e.vmp})`, `${r.maxLen} 장`],
        ['최소 직렬 수', `MPPT 최소 ${e.mpptMinV} V ÷ ${fmt(r.vmpHot, 2)}`, `${r.minLen} 장`],
        ['적용 직렬 수', d.elec ? `범위 ${r.minLen}~${r.maxLen}장 중 남는 모듈이 가장 적은 길이` : '배치 전', d.elec ? `${d.elec.stringLen} 장` : '-'],
        ['스트링 개방전압(최저 기온)', d.elec ? `${fmt(r.vocCold, 2)} V × ${d.elec.stringLen}장 ≤ ${e.maxDcV} V` : '-', d.elec ? `${fmt(r.vocCold * d.elec.stringLen, 0)} V` : '-'],
      ],
    },
  ]
  if (d.elec) {
    const el = d.elec
    blocks.push({
      heading: '2. 인버터와 계통연계',
      cols: ITEM,
      rows: [
        ['DC 설비용량', `${fmt(el.strings.length)}회로 × ${el.stringLen}장 × ${p.moduleWatt} W`, `${fmt(el.kWdc, 2)} kW`],
        ['인버터', `${INVERTERS.find((i) => i.id === e.inverterId)?.label ?? `${e.inverterKW} kW`} × ${el.inverters.length}대`, `AC ${fmt(el.kWac, 1)} kW`],
        ['DC/AC 비율', `${fmt(el.kWdc, 2)} ÷ ${fmt(el.kWac, 1)} (목표 ${e.dcAcRatio})`, fmt(el.dcAc, 2)],
        ['연계 방식', el.connection === 'LV' ? 'AC 100 kW 미만: 저압 연계' : 'AC 100 kW 이상: 특고압(22.9 kV) 연계', el.connection === 'LV' ? '저압' : `변압기 ${fmt(el.transformerKVA ?? 0)} kVA`],
      ],
    })
    const worst = el.inverters.reduce((a, v) => (v.acDropPct > a.acDropPct ? v : a), el.inverters[0])
    blocks.push({
      heading: '3. 케이블과 손실',
      cols: ITEM,
      rows: [
        ['DC 케이블', `${e.dcCableMm2} ㎟, 스트링별 왕복 길이 합`, `${fmt(el.dcCableM)} m`],
        ['DC 저항 손실(정격)', `Σ I² × ρ × L ÷ A (ρ = 0.021 Ω·㎟/m)`, `${fmt(el.dcLossPct, 2)} %`],
        ['AC 케이블', `인버터 → 수배전반, 전압강하 3% 이내 규격`, `${fmt(el.acCableM)} m`],
        ['AC 최대 전압강하', worst ? `인버터 ${worst.id + 1}: ${fmt(worst.acCableM)} m, ${worst.acCableMm2} ㎟` : '-', worst ? `${fmt(worst.acDropPct, 2)} %` : '-'],
        ['AC 저항 손실(정격)', '인버터별 손실 합 ÷ AC 출력', `${fmt(el.acLossPct, 2)} %`],
      ],
    })
  }
  if (d.parcel) {
    const lat = LocalFrame.around(d.parcel.rings).lat0
    const need = rowSpacingForNoShade(lat, d.geometry.height - p.groundClearance, p.azimuth)
    blocks.push({
      heading: `${blocks.length + 1}. 열 이격거리(동지 9~15시 무음영)`,
      cols: ITEM,
      rows: [
        ['위도', '부지 중심', `${fmt(lat, 3)}°`],
        ['그림자를 만드는 높이', `세트 상단 ${fmt(d.geometry.height, 2)} m − 하단 ${p.groundClearance} m`, `${fmt(d.geometry.height - p.groundClearance, 2)} m`],
        ['필요 이격거리', '동지 9~15시 중 가장 긴 남북 방향 그림자', `${fmt(need, 2)} m`],
        ['적용 이격거리', need <= p.rowSpacing + 0.005 ? '필요 이격거리 이상: 무음영' : '필요 이격거리보다 좁음: 음영 손실 반영', `${fmt(p.rowSpacing, 2)} m`],
      ],
    })
  }
  if (d.metrics) {
    const m = d.metrics
    blocks.push({
      heading: `${blocks.length + 1}. 발전량`,
      cols: ITEM,
      rows: [
        ['연간 발전량', '월별 경사면 일사 × 용량 × 성능계수 − 음영·온도·클리핑·케이블 손실', `${fmt(m.annualKWh)} kWh`],
        ['발전시간', `${fmt(m.specificYield)} kWh/kWp ÷ 365`, `${fmt(m.specificYield / 365, 2)} 시간/일`],
        ['음영 손실', '대표일 12개 × 30분 간격 그림자 계산', `${fmt(m.shadeLoss * 100, 1)} %`],
        ['클리핑 손실', 'DC 출력이 인버터 정격을 넘는 시간', `${fmt(m.clipLoss * 100, 1)} %`],
      ],
    })
  }
  return blocks
}

/** 자재목록표: 품목·규격·수량 */
export function bomBlocks(d: DocInput): DocBlock[] {
  const p = d.params
  const e = d.elecParams
  const cols: Array<[string, number]> = [
    ['품목', 0.22],
    ['규격', 0.48],
    ['단위', 0.1],
    ['수량', 0.2],
  ]
  const modules = d.elec ? d.elec.strings.length * d.elec.stringLen : d.stats.modules
  const main: string[][] = [
    ['태양광 모듈', `${p.moduleWatt} W, ${p.moduleLength}×${p.moduleWidth} mm`, '장', fmt(modules)],
    ['구조물', `${RACKING[p.racking].label}, ${p.setCols}열×${p.setRows}단, 경사 ${p.tilt}°`, '세트', fmt(d.stats.sets)],
  ]
  const elec: string[][] = []
  if (d.elec) {
    const el = d.elec
    main.push(['인버터', INVERTERS.find((i) => i.id === e.inverterId)?.label ?? `${e.inverterKW} kW`, '대', fmt(el.inverters.length)])
    elec.push(['DC 케이블', `${e.dcCableMm2} ㎟ (H1Z2Z2-K 등)`, 'm', fmt(el.dcCableM)])
    elec.push(['MC4 커넥터', '스트링 양 끝 1쌍씩', '쌍', fmt(el.strings.length)])
    const bySize = new Map<number, number>()
    for (const v of el.inverters) bySize.set(v.acCableMm2, (bySize.get(v.acCableMm2) ?? 0) + v.acCableM)
    for (const [mm2, len] of [...bySize].sort((a, b) => a[0] - b[0])) elec.push(['AC 케이블', `CV ${mm2} ㎟ 3상`, 'm', fmt(len)])
    elec.push(['접속반·수배전반', el.connection === 'LV' ? '저압 수배전반' : '특고압 수배전반', '식', '1'])
    if (el.transformerKVA) elec.push(['변압기', `${fmt(el.transformerKVA)} kVA, 22.9 kV`, '대', '1'])
  }
  const blocks: DocBlock[] = [{ heading: '1. 주요 기자재', cols, rows: main }]
  if (elec.length) blocks.push({ heading: '2. 전기 자재', cols, rows: elec })
  return blocks
}

/** 물량산출서: 설치비 항목별 물량·단가·금액 */
export function quantityBlocks(d: DocInput): DocBlock[] {
  if (!d.metrics) return []
  const m = d.metrics
  return [
    {
      heading: '1. 설치비 물량과 금액',
      cols: [
        ['항목', 0.25],
        ['물량 × 단가', 0.5],
        ['금액(만원)', 0.25],
      ],
      rows: [...m.capex.items.map((it) => [it.label, it.basis, fmt(it.amount)]), ['합계', `${fmt(m.kWp, 1)} kWp, kW당 ${fmt(m.capexPerKW)} 만원`, fmt(m.capex.total)]],
    },
    {
      heading: '2. 토공',
      cols: [
        ['항목', 0.25],
        ['근거', 0.5],
        ['물량', 0.25],
      ],
      rows:
        m.cut === null
          ? [['절토·성토', '지형 탭에서 표고를 불러오면 계산합니다', '-']]
          : [
              ['절토', '세트 자리 지반을 구조물 허용 경사로 맞춘 양', `${fmt(m.cut)} ㎥`],
              ['성토', '같은 기준', `${fmt(m.fill ?? 0)} ㎥`],
            ],
    },
  ]
}

// 결과 내보내기: 배치도 DXF(국내 TM 좌표), 각종 CSV, 파일 내려받기.

import type { BuildableResult } from '../buildable'
import type { DesignMetrics } from '../design'
import type { EarthworkResult } from '../earthwork'
import type { ElecResult } from '../electrical'
import { contours, gridFrame, type ElevGrid } from '../elevation'
import type { EconResult } from '../economics'
import { LocalFrame } from '../geo'
import { moduleQuadsLonLat, setQuadLonLat, type LayoutParams, type ModuleSet, type SetGeometry } from '../layout'
import type { Parcel } from '../parcel'
import type { Obstacle } from '../shading'
import { DxfWriter, type Pt } from './dxf'
import { toTm, zoneFor, type TmZone } from './tm'

export const setLabel = (i: number) => `A${String(i + 1).padStart(3, '0')}`

export function parcelZone(parcel: Parcel): TmZone {
  return zoneFor(LocalFrame.around(parcel.rings).lon0)
}

export interface LayoutDxfInput {
  parcel: Parcel
  sets: ModuleSet[]
  params: LayoutParams
  geometry: SetGeometry
  obstacles: Obstacle[]
  elec: ElecResult | null
  buildable: BuildableResult | null
  grid: ElevGrid | null
  kWp: number
  date: string
}

export function layoutDxf(d: LayoutDxfInput): { text: string; zone: TmZone } {
  const zone = parcelZone(d.parcel)
  const tm = (c: number[]): Pt => toTm(c, zone)
  const w = new DxfWriter()
    .layer('PARCEL', 1)
    .layer('LOT', 8)
    .layer('CONTOUR', 252)
    .layer('CONTOUR_MAJOR', 8)
    .layer('EXCL_SLOPE', 30)
    .layer('EXCL_DRAIN', 5)
    .layer('DRAINAGE', 4)
    .layer('OBSTACLE', 8)
    .layer('ARRAY', 3)
    .layer('MODULE', 150)
    .layer('ARRAY_TEXT', 7)
    .layer('INVERTER', 6)
    .layer('CABLE_AC', 1)
    .layer('SWITCHBOARD', 6)
    .layer('TITLE', 7)

  for (const ring of d.parcel.rings) w.polyline('PARCEL', ring.map(tm), true)
  if (d.parcel.lots && d.parcel.lots.length > 1)
    for (const lot of d.parcel.lots) for (const ring of lot.rings) w.polyline('LOT', ring.map(tm), true)

  const frame = LocalFrame.around(d.parcel.rings)
  const pts = d.parcel.rings.flat().map((c) => frame.toLocal(c))
  const [bx0, bx1, by0, by1] = [
    Math.min(...pts.map((p) => p[0])) - 30,
    Math.max(...pts.map((p) => p[0])) + 30,
    Math.min(...pts.map((p) => p[1])) - 30,
    Math.max(...pts.map((p) => p[1])) + 30,
  ]

  if (d.grid) {
    const gf = gridFrame(d.grid)
    let lo = Infinity
    let hi = -Infinity
    for (const v of d.grid.z) if (Number.isFinite(v)) [lo, hi] = [Math.min(lo, v), Math.max(hi, v)]
    const interval = hi - lo > 60 ? 5 : hi - lo > 20 ? 2 : 1
    for (const { z, seg } of contours(d.grid, interval)) {
      const a = frame.toLocal(gf.toLonLat(seg[0]))
      if (a[0] < bx0 || a[0] > bx1 || a[1] < by0 || a[1] > by1) continue
      const major = Math.round(z / interval) % 5 === 0
      w.line(major ? 'CONTOUR_MAJOR' : 'CONTOUR', tm(gf.toLonLat(seg[0])), tm(gf.toLonLat(seg[1])))
    }
  }

  if (d.buildable) {
    for (const e of d.buildable.excluded) w.polyline(e.kind === 'slope' ? 'EXCL_SLOPE' : 'EXCL_DRAIN', e.ring.map(tm), true)
    for (const [a, b] of d.buildable.channels) w.line('DRAINAGE', tm(a), tm(b))
  }

  for (const o of d.obstacles) {
    w.polyline('OBSTACLE', o.ring.map(tm), true)
    const c = o.ring.slice(0, -1).reduce((t, p) => [t[0] + p[0], t[1] + p[1]], [0, 0]).map((v) => v / (o.ring.length - 1))
    w.text('OBSTACLE', tm(c), 1, `${o.name} H=${o.height}m`, 'center')
  }

  const textH = Math.max(0.3, Math.min(0.8, d.geometry.depth / 5))
  d.sets.forEach((s, i) => {
    w.polyline('ARRAY', setQuadLonLat(s, d.geometry).map(tm), true)
    for (const q of moduleQuadsLonLat(s, d.params, d.geometry)) w.polyline('MODULE', q.map(tm), true)
    const inv = d.elec?.setInverter[s.id]
    w.text('ARRAY_TEXT', tm([s.lon, s.lat]), textH, inv !== undefined ? `${setLabel(i)} / INV-${inv + 1}` : setLabel(i), 'center')
  })

  if (d.elec) {
    for (const inv of d.elec.inverters) {
      const p = tm(inv.lonlat)
      w.circle('INVERTER', p, 0.6)
      w.text('INVERTER', [p[0] + 0.8, p[1] + 0.2], 0.7, `INV-${inv.id}`)
      w.polyline('CABLE_AC', inv.path.map(tm))
    }
    const sb = tm(d.elec.switchboard)
    w.polyline('SWITCHBOARD', [[sb[0] - 1.5, sb[1] - 1], [sb[0] + 1.5, sb[1] - 1], [sb[0] + 1.5, sb[1] + 1], [sb[0] - 1.5, sb[1] + 1]], true)
    w.text('SWITCHBOARD', [sb[0], sb[1] + 1.4], 0.8, '수배전반', 'center')
  }

  const sw = tm(frame.toLonLat([bx0 + 30, by0 + 30]))
  const lines = [
    `태양광 배치도 - ${d.parcel.address}`,
    `좌표계 EPSG:${zone.epsg} (GRS80 ${zone.name}), 단위 m`,
    `설비 ${d.kWp.toFixed(2)} kWp, 어레이 ${d.sets.length}개, 모듈 ${d.params.moduleWatt}W ${d.params.moduleLength}x${d.params.moduleWidth}mm, 경사 ${d.params.tilt}°`,
    d.date,
  ]
  lines.forEach((s, i) => w.text('TITLE', [sw[0], sw[1] - 6 - i * 2.2], 1.5, s))
  return { text: w.toString(), zone }
}

type Cell = string | number | null | undefined

export function toCsv(header: string[], rows: Cell[][]): string {
  const esc = (v: Cell) => {
    if (v === null || v === undefined) return ''
    const s = typeof v === 'number' ? (Number.isFinite(v) ? String(Math.round(v * 1000) / 1000) : '') : v
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  // 엑셀이 한글을 깨뜨리지 않도록 BOM을 붙인다.
  return '﻿' + [header, ...rows].map((r) => r.map(esc).join(',')).join('\r\n') + '\r\n'
}

export function arraysCsv(
  parcel: Parcel,
  sets: ModuleSet[],
  geometry: SetGeometry,
  moduleWatt: number,
  elec: ElecResult | null,
  earth: EarthworkResult | null,
): string {
  const zone = parcelZone(parcel)
  const ew = new Map(earth?.perSet.map((e) => [e.id, e]) ?? [])
  return toCsv(
    ['어레이', `X(EPSG:${zone.epsg})`, `Y(EPSG:${zone.epsg})`, '경도', '위도', '방위각(°)', '모듈(장)', 'kWp', '인버터', '지반고(m)', '남북경사(%)', '동서경사(%)', '절토(㎥)', '성토(㎥)'],
    sets.map((s, i) => {
      const [x, y] = toTm([s.lon, s.lat], zone)
      const e = ew.get(s.id)
      const inv = elec?.setInverter[s.id]
      return [
        setLabel(i), x, y, s.lon.toFixed(7), s.lat.toFixed(7), s.azimuth, geometry.modules, (geometry.modules * moduleWatt) / 1000,
        inv !== undefined ? `INV-${inv + 1}` : '', e?.ground, e?.slopeNS, e?.slopeEW, e?.cut, e?.fill,
      ]
    }),
  )
}

export function stringsCsv(sets: ModuleSet[], elec: ElecResult): string {
  const idx = new Map(sets.map((s, i) => [s.id, setLabel(i)]))
  return toCsv(
    ['스트링', '인버터', '모듈(장)', '어레이(장수)', 'DC 케이블 왕복(m)', '저항 손실(W)'],
    elec.strings.map((st) => [
      `S${String(st.id).padStart(3, '0')}`,
      `INV-${st.inverter + 1}`,
      st.modules,
      st.segments.map((sg) => `${idx.get(sg.setId)}(${sg.count})`).join(' '),
      st.dcCableM,
      st.lossW,
    ]),
  )
}

export function invertersCsv(elec: ElecResult): string {
  return toCsv(
    ['인버터', '스트링(회로)', '모듈(장)', 'DC(kWp)', '경도', '위도', 'AC 케이블(m)', 'AC 규격(㎟)', '전압강하(%)', 'AC 손실(W)'],
    elec.inverters.map((v) => [`INV-${v.id}`, v.strings, v.modules, v.kWdc, v.lonlat[0].toFixed(7), v.lonlat[1].toFixed(7), v.acCableM, v.acCableMm2, v.acDropPct, v.acLossW]),
  )
}

export function monthlyCsv(m: DesignMetrics): string {
  return toCsv(
    ['월', '수평면 일사(kWh/㎡)', '경사면 일사(kWh/㎡)', '발전량(kWh)', '음영 없을 때(kWh)'],
    m.monthly.map((x) => [x.month, x.ghi, x.poa, x.kWh, x.kWhNoShade]),
  )
}

export interface CompareRow {
  name: string
  m: DesignMetrics
  tilt: number
  azimuth: number
  rowSpacing: number
  pitch: number
  racking: string
}

export function compareCsv(rows: CompareRow[]): string {
  return toCsv(
    ['배치안', '래킹', '경사각(°)', '방위각(°)', '열 이격(m)', '피치(m)', '어레이', '모듈', 'DC(kWp)', 'AC(kW)', 'DC/AC', '연간 발전량(MWh)', '효율(kWh/kWp)', '음영 손실(%)', '클리핑(%)', '케이블 손실(%)', '절토(㎥)', '성토(㎥)', 'CAPEX(만원)', 'CAPEX(만원/kWp)', 'LCOE(원/kWh)', '사업 IRR(%)', '자기자본 IRR(%)', 'NPV(만원)', '회수기간(년)'],
    rows.map(({ name, m, ...p }) => [
      name, p.racking, p.tilt, p.azimuth, p.rowSpacing, p.pitch, m.sets, m.modules, m.kWp, m.kWac, m.dcAc, m.annualKWh / 1000, m.specificYield,
      m.shadeLoss * 100, m.clipLoss * 100, m.cableLoss * 100, m.cut, m.fill, m.capex.total, m.capexPerKW, m.lcoe,
      m.projectIrr === null ? null : m.projectIrr * 100, m.equityIrr === null ? null : m.equityIrr * 100, m.npv, m.payback,
    ]),
  )
}

export function capexCsv(m: DesignMetrics): string {
  return toCsv(
    ['항목', '금액(만원)', '산출 근거'],
    [...m.capex.items.map((i) => [i.label, i.amount, i.basis]), ['합계', m.capex.total, `${Math.round(m.capexPerKW)}만원/kWp`]],
  )
}

export function cashflowCsv(r: EconResult): string {
  return toCsv(
    ['연차', '발전량(kWh)', '매출(만원)', '운영비(만원)', '이자(만원)', '원금(만원)', '자기자본 현금흐름(만원)', '누적(만원)'],
    [[0, null, null, null, null, null, -r.equity, -r.equity], ...r.flows.map((f) => [f.year, f.kWh, f.revenue, f.opex, f.interest, f.principal, f.equityFlow, f.cumulative])],
  )
}

export function download(filename: string, text: string, mime: string) {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

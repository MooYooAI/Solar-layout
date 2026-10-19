// 전기 설계(개략): 직렬 장수(스트링 길이), 스트링 묶음, 인버터 대수와 DC/AC 비율, 케이블 경로·길이·규격·손실,
// 계통연계 방식. 세트를 열마다 뱀 모양(지그재그) 순서로 이어 스트링을 만들고, 이웃한 스트링끼리 인버터에 묶는다.
// 인버터는 묶인 세트 중 가운데 세트 뒤에 붙인다고 보고, AC 케이블은 세트 방향 축을 따라 ㄱ자로 수배전반까지 간다.

import { deg2rad, LocalFrame, rotate, type Vec } from './geo'
import type { LayoutParams, ModuleSet, SetGeometry } from './layout'
import type { Parcel } from './parcel'

export interface ElecParams {
  /** 모듈 전기 사양 */
  voc: number
  vmp: number
  isc: number
  imp: number
  betaVoc: number // %/°C
  gammaPmax: number // %/°C (Vmp 온도 변화 근사에 쓴다)
  /** 인버터 */
  inverterId: string
  inverterKW: number
  maxDcV: number
  mpptMinV: number
  mpptMaxV: number
  acV: number
  /** 목표 DC/AC 비율 */
  dcAcRatio: number
  /** 설계 최저 기온(°C), 개방전압 최대치 계산용 */
  minTemp: number
  /** 여름 최고 셀 온도(°C), 최소 동작전압 계산용 */
  maxCellTemp: number
  /** DC 케이블 단면적(㎟) */
  dcCableMm2: number
}

export const DEFAULT_ELEC: ElecParams = {
  voc: 49.9,
  vmp: 41.9,
  isc: 14.0,
  imp: 13.13,
  betaVoc: -0.27,
  gammaPmax: -0.35,
  inverterId: 'i50',
  inverterKW: 50,
  maxDcV: 1000,
  mpptMinV: 200,
  mpptMaxV: 950,
  acV: 380,
  dcAcRatio: 1.2,
  minTemp: -20,
  maxCellTemp: 70,
  dcCableMm2: 6,
}

/** 구리 저항률(Ω·㎟/m), 도체 70°C 기준 */
const RHO = 0.021
/** 3상 AC 케이블(CV) 단면적과 대략적 허용전류(A, 지중·관로 기준 보수적 값) */
const AC_SIZES: Array<[number, number]> = [
  [6, 41], [10, 57], [16, 76], [25, 101], [35, 125], [50, 151], [70, 192], [95, 232], [120, 269], [150, 300], [185, 341], [240, 400], [300, 455],
]
/** 태양광 DC 케이블(H1Z2Z2-K 등) 단면적과 대략적 허용전류(A) */
const DC_AMPACITY: Array<[number, number]> = [[2.5, 30], [4, 40], [6, 52], [10, 70], [16, 94]]
/** AC 케이블 전압강하 한도(%) */
const AC_DROP_LIMIT = 3
/** 저압 연계 상한(kW). 이 이상은 특고압(22.9kV) 연계로 본다. */
export const LV_LIMIT_KW = 100
const TRANSFORMER_KVA = [100, 150, 200, 300, 500, 750, 1000, 1500, 2000, 2500, 3000, 4000, 5000, 7500, 10000]

export interface StringInfo {
  id: number
  inverter: number
  modules: number
  /** 이 스트링이 지나는 세트와 장수 */
  segments: Array<{ setId: string; count: number }>
  /** 스트링 가운데(로컬 m) */
  center: Vec
  /** +/− 왕복 케이블 길이(m) */
  dcCableM: number
  /** 저항 손실(W, 정격 기준) */
  lossW: number
}

export interface InverterInfo {
  id: number
  /** 로컬 m, 경위도 */
  pos: Vec
  lonlat: Vec
  strings: number
  modules: number
  kWdc: number
  acCableM: number
  acCableMm2: number
  acDropPct: number
  acLossW: number
  /** 수배전반까지 경로(경위도) */
  path: Vec[]
}

export interface ElecResult {
  stringLen: number
  minLen: number
  maxLen: number
  vocCold: number
  vmpHot: number
  strings: StringInfo[]
  inverters: InverterInfo[]
  unusedModules: number
  kWdc: number
  kWac: number
  dcAc: number
  dcCableM: number
  acCableM: number
  dcLossPct: number
  acLossPct: number
  /** 수배전반 위치(경위도) */
  switchboard: Vec
  connection: 'LV' | 'MV'
  transformerKVA: number | null
  /** 세트 id → 인버터 번호(0부터) */
  setInverter: Record<string, number>
  warnings: string[]
}

export function stringRange(e: ElecParams) {
  const vocCold = e.voc * (1 + (e.betaVoc / 100) * (e.minTemp - 25))
  // Vmp 온도계수는 데이터시트에 잘 없어서 최대출력 온도계수로 근사한다.
  const vmpHot = e.vmp * (1 + (e.gammaPmax / 100) * (e.maxCellTemp - 25))
  const maxLen = Math.floor(Math.min(e.maxDcV / vocCold, e.mpptMaxV / e.vmp))
  const minLen = Math.ceil(e.mpptMinV / vmpHot)
  return { vocCold, vmpHot, minLen, maxLen }
}

export function designElectrical(
  parcel: Parcel,
  sets: ModuleSet[],
  p: LayoutParams,
  g: SetGeometry,
  e: ElecParams,
): ElecResult | null {
  if (!sets.length || g.modules <= 0) return null
  const warnings: string[] = []
  const { vocCold, vmpHot, minLen, maxLen } = stringRange(e)
  const total = sets.length * g.modules
  let stringLen = maxLen
  if (minLen > maxLen || maxLen < 1) {
    warnings.push(`모듈 전압과 인버터 입력 범위가 맞지 않습니다 (최소 ${minLen}장 > 최대 ${maxLen}장).`)
    stringLen = Math.max(1, maxLen)
  } else {
    // 긴 스트링일수록 전압이 높아 케이블·손실이 줄어든다. 남는 모듈이 전체의 1% 이하인 가장 긴 길이를 고르고,
    // 그런 길이가 없으면 남는 모듈이 가장 적은 길이를 고른다.
    const tolerance = Math.floor(total * 0.01)
    let found = false
    for (let L = maxLen; L >= minLen; L--)
      if (total % L <= tolerance && total >= L) {
        stringLen = L
        found = true
        break
      }
    if (!found) {
      let best = Infinity
      for (let L = maxLen; L >= minLen; L--) {
        const rest = total % L
        if (rest < best) {
          best = rest
          stringLen = L
        }
      }
    }
  }
  const nStrings = Math.floor(total / stringLen)
  if (nStrings === 0) return null
  const unusedModules = total - nStrings * stringLen
  if (unusedModules > 0) warnings.push(`스트링에 들어가지 못한 모듈 ${unusedModules}장은 연결하지 않았습니다.`)

  const kWdc = (nStrings * stringLen * p.moduleWatt) / 1000
  const nInv = Math.max(1, Math.round(kWdc / (e.dcAcRatio * e.inverterKW)))
  const kWac = nInv * e.inverterKW
  if (nStrings < nInv) warnings.push('스트링 수보다 인버터가 많습니다. 인버터 용량을 키우세요.')
  if (kWac >= 1000 && e.inverterKW < 100)
    warnings.push('1MW 이상 부지는 대용량 인버터(예: 300kW, 800V)를 쓰면 대수와 AC 케이블이 크게 줄어듭니다.')

  // 세트 방향 좌표계(+x 열 방향, +y 뒤쪽)로 돌려 열을 묶는다. 방위각이 섞인 배치는 방위각마다 따로 묶는다.
  const frame = LocalFrame.around(parcel.rings)
  // 케이블 경로는 기준 방위각 좌표계에서 꺾는다.
  const r = -deg2rad(p.azimuth)
  const toRow = (v: Vec) => rotate(v, -r)
  const fromRow = (v: Vec) => rotate(v, r)
  const items = sets.map((s) => {
    const local = frame.toLocal([s.lon, s.lat])
    return { s, local, row: rotate(local, deg2rad(s.azimuth)) }
  })
  items.sort((a, b) => a.s.azimuth - b.s.azimuth || a.row[1] - b.row[1])
  const rows: (typeof items)[] = []
  for (const it of items) {
    const last = rows.at(-1)
    if (last && last[0].s.azimuth === it.s.azimuth && Math.abs(it.row[1] - last[0].row[1]) < g.depth / 2) last.push(it)
    else rows.push([it])
  }
  const ordered = rows.flatMap((row, i) => row.sort((a, b) => (i % 2 ? b.row[0] - a.row[0] : a.row[0] - b.row[0])))

  // 모듈을 순서대로 스트링 길이만큼 잘라 스트링을 만든다.
  const strings: StringInfo[] = []
  let cur: StringInfo | null = null
  let jumper = 0
  let prevPos: Vec | null = null
  const stringJumpers: number[] = []
  for (const it of ordered) {
    let left = g.modules
    while (left > 0) {
      if (!cur) {
        if (strings.length >= nStrings) break
        cur = { id: strings.length + 1, inverter: 0, modules: 0, segments: [], center: [0, 0], dcCableM: 0, lossW: 0 }
        jumper = 0
        prevPos = null
      }
      const take = Math.min(left, stringLen - cur.modules)
      cur.segments.push({ setId: it.s.id, count: take })
      cur.center = [cur.center[0] + it.local[0] * take, cur.center[1] + it.local[1] * take]
      if (prevPos) jumper += Math.hypot(it.local[0] - prevPos[0], it.local[1] - prevPos[1])
      prevPos = it.local
      cur.modules += take
      left -= take
      if (cur.modules === stringLen) {
        cur.center = [cur.center[0] / stringLen, cur.center[1] / stringLen]
        strings.push(cur)
        stringJumpers.push(jumper)
        cur = null
      }
    }
  }

  // 인버터마다 이웃한 스트링을 고르게 나눈다.
  const inverters: InverterInfo[] = []
  const setInverter: Record<string, number> = {}
  const base = Math.floor(strings.length / nInv)
  const extra = strings.length % nInv
  let k = 0
  for (let i = 0; i < nInv; i++) {
    const count = base + (i < extra ? 1 : 0)
    const group = strings.slice(k, k + count)
    k += count
    group.forEach((st) => (st.inverter = i))
    for (const st of group) for (const seg of st.segments) setInverter[seg.setId] ??= i
    const cx = group.reduce((t, st) => t + st.center[0], 0) / Math.max(1, group.length)
    const cy = group.reduce((t, st) => t + st.center[1], 0) / Math.max(1, group.length)
    // 묶인 세트 중 가운데에 가장 가까운 세트의 뒤쪽 끝에 둔다.
    const ids = new Set(group.flatMap((st) => st.segments.map((sg) => sg.setId)))
    let best = items[0]
    let bestD = Infinity
    for (const it of items) {
      if (!ids.has(it.s.id)) continue
      const d = Math.hypot(it.local[0] - cx, it.local[1] - cy)
      if (d < bestD) {
        bestD = d
        best = it
      }
    }
    const pos = rotate([best.row[0], best.row[1] + g.depth / 2 + 0.5], -deg2rad(best.s.azimuth))
    inverters.push({
      id: i + 1,
      pos,
      lonlat: frame.toLonLat(pos),
      strings: group.length,
      modules: group.length * stringLen,
      kWdc: (group.length * stringLen * p.moduleWatt) / 1000,
      acCableM: 0,
      acCableMm2: 0,
      acDropPct: 0,
      acLossW: 0,
      path: [],
    })
  }

  // DC: 스트링 가운데 → 인버터 왕복(+/−) + 세트 사이 연결선
  const vString = e.vmp * stringLen
  let dcCableM = 0
  let dcLossW = 0
  strings.forEach((st, i) => {
    const inv = inverters[st.inverter]
    const a = toRow(st.center)
    const b = toRow(inv.pos)
    const run = Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1])
    st.dcCableM = 2 * run + stringJumpers[i] + 2 // 접속 여유 2m
    const R = (RHO * st.dcCableM) / e.dcCableMm2
    st.lossW = e.imp * e.imp * R
    dcCableM += st.dcCableM
    dcLossW += st.lossW
  })
  const pDc = strings.length * vString * e.imp
  const dcLossPct = pDc ? (100 * dcLossW) / pDc : 0
  const dcAmp = DC_AMPACITY.find(([mm2]) => mm2 >= e.dcCableMm2)?.[1] ?? 0
  if (dcAmp < 1.25 * e.isc) warnings.push(`DC 케이블 ${e.dcCableMm2}㎟는 단락전류 ${e.isc}A의 1.25배를 감당하기 어렵습니다.`)

  // 수배전반: 인버터들 가운데에서 가장 가까운 부지 경계 위의 점
  const mid: Vec = [
    inverters.reduce((t, v) => t + v.pos[0], 0) / inverters.length,
    inverters.reduce((t, v) => t + v.pos[1], 0) / inverters.length,
  ]
  const sb = nearestBoundaryPoint(parcel.rings.map((ring) => ring.map((c) => frame.toLocal(c))), mid)
  const sbRow = toRow(sb)

  let acCableM = 0
  let acLossW = 0
  for (const inv of inverters) {
    const a = toRow(inv.pos)
    const corner: Vec = [sbRow[0], a[1]]
    const L = Math.abs(a[0] - sbRow[0]) + Math.abs(a[1] - sbRow[1]) + 5 // 판넬 인입 여유 5m
    const I = (inv.kWdc >= e.inverterKW ? e.inverterKW : inv.kWdc) * 1000 / (Math.sqrt(3) * e.acV)
    const Irated = (e.inverterKW * 1000) / (Math.sqrt(3) * e.acV)
    let size = AC_SIZES[AC_SIZES.length - 1][0]
    for (const [mm2, amp] of AC_SIZES) {
      const drop = (100 * Math.sqrt(3) * Irated * L * (RHO / mm2)) / e.acV
      if (amp >= 1.25 * Irated && drop <= AC_DROP_LIMIT) {
        size = mm2
        break
      }
    }
    const drop = (100 * Math.sqrt(3) * Irated * L * (RHO / size)) / e.acV
    if (drop > AC_DROP_LIMIT) warnings.push(`INV-${inv.id} AC 케이블 전압강하가 ${drop.toFixed(1)}%입니다. 인버터를 수배전반 가까이 두거나 병렬 케이블을 쓰세요.`)
    inv.acCableM = L
    inv.acCableMm2 = size
    inv.acDropPct = drop
    inv.acLossW = 3 * I * I * ((RHO * L) / size)
    inv.path = [toLL(frame, inv.pos), toLL(frame, fromRow(corner)), toLL(frame, sb)]
    acCableM += L
    acLossW += inv.acLossW
  }
  const acLossPct = kWdc ? (100 * acLossW) / (Math.min(kWdc, kWac) * 1000) : 0
  const connection = kWac < LV_LIMIT_KW ? 'LV' : 'MV'
  const transformerKVA = connection === 'MV' ? (TRANSFORMER_KVA.find((v) => v >= kWac) ?? Math.ceil(kWac / 1000) * 1000) : null

  return {
    stringLen,
    minLen,
    maxLen,
    vocCold,
    vmpHot,
    strings,
    inverters,
    unusedModules,
    kWdc,
    kWac,
    dcAc: kWdc / kWac,
    dcCableM,
    acCableM,
    dcLossPct,
    acLossPct,
    switchboard: frame.toLonLat(sb),
    connection,
    transformerKVA,
    setInverter,
    warnings,
  }
}

const toLL = (f: LocalFrame, v: Vec) => f.toLonLat(v)

function nearestBoundaryPoint(rings: Vec[][], p: Vec): Vec {
  let best: Vec = rings[0][0]
  let bestD = Infinity
  for (const ring of rings)
    for (let i = 0; i < ring.length - 1; i++) {
      const [ax, ay] = ring[i]
      const [bx, by] = ring[i + 1]
      const dx = bx - ax
      const dy = by - ay
      const len2 = dx * dx + dy * dy
      const t = len2 ? Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / len2)) : 0
      const q: Vec = [ax + t * dx, ay + t * dy]
      const d = Math.hypot(q[0] - p[0], q[1] - p[1])
      if (d < bestD) {
        bestD = d
        best = q
      }
    }
  return best
}

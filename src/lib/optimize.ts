// 최적 배치 탐색.
// 모듈 규격·세트 구성·간격·경계 이격은 사용자가 정한 대로 두고, 경사각·방위각·열 이격거리와
// 첫 열 시작 위치를 바꿔 가며 필지에 채운 뒤 음영을 반영한 연간 발전량으로 점수를 매긴다.
// 1차는 빠른 근사(네 계절, 1시간 간격)로 넓게 훑고, 상위 후보만 정밀 계산으로 다시 평가한다.

import { buildScene, shadeTable } from './analysis'
import { KOREA_GHI, simulateEnergy, type EnergyResult } from './energy'
import { LocalFrame } from './geo'
import { autoLayout, layoutStats, setGeometry, type LayoutParams, type ModuleSet } from './layout'
import { parcelArea, type Parcel } from './parcel'
import type { Obstacle } from './shading'
import { rowSpacingForNoShade } from './sun'

export type Strategy = 'energy' | 'balanced' | 'yield'

export const STRATEGIES: Record<Strategy, { label: string; detail: string }> = {
  energy: { label: '발전량 최대', detail: '필지에서 나오는 연간 발전량이 가장 많은 안' },
  balanced: { label: '균형', detail: '효율(kWh/kWp)을 최고치의 97% 이상 지키면서 발전량이 가장 많은 안' },
  yield: { label: '효율 최대', detail: '모듈 1kW당 발전량이 가장 높은 안 (모듈 수 대비 수익성)' },
}

export interface OptimizeInput {
  parcel: Parcel
  base: LayoutParams
  obstacles: Obstacle[]
  performanceRatio: number
}

export interface Candidate {
  strategy: Strategy
  params: LayoutParams
  sets: ModuleSet[]
  rowOffset: number
  kWp: number
  annualKWh: number
  specificYield: number
  shadeLoss: number
  coverage: number
  monthly: EnergyResult['monthly']
}

type Evaluated = Omit<Candidate, 'strategy'>

export type Progress = (done: number, total: number, phase: string) => void

const TILTS = [10, 15, 20, 25, 30, 35]
/** 동지 9~15시 무음영 이격거리 대비 배율 */
const SPACING_RATIOS = [0.5, 0.65, 0.8, 1.0, 1.2]

/** 점검 통로로 최소한 남겨야 하는 열 이격거리(m) */
const MIN_ROW_SPACING = 1
const MIN_TILT = 10
const BALANCED_YIELD_RATIO = 0.97

function pick(pool: Evaluated[], strategy: Strategy): Evaluated | undefined {
  if (!pool.length) return undefined
  const byEnergy = (a: Evaluated, b: Evaluated) => b.annualKWh - a.annualKWh
  if (strategy === 'energy') return [...pool].sort(byEnergy)[0]
  const bestYield = Math.max(...pool.map((c) => c.specificYield))
  if (strategy === 'yield') return [...pool].sort((a, b) => b.specificYield - a.specificYield || byEnergy(a, b))[0]
  return pool.filter((c) => c.specificYield >= bestYield * BALANCED_YIELD_RATIO).sort(byEnergy)[0]
}

/** 필지의 긴 변 방향에 맞춘 방위각 후보 (정남에서 ±30° 이내만) */
function parcelAlignedAzimuths(parcel: Parcel): number[] {
  const frame = LocalFrame.around(parcel.rings)
  let best = { len: 0, ang: 0 }
  for (const ring of parcel.rings)
    for (let i = 0; i < ring.length - 1; i++) {
      const [x1, y1] = frame.toLocal(ring[i])
      const [x2, y2] = frame.toLocal(ring[i + 1])
      const len = Math.hypot(x2 - x1, y2 - y1)
      if (len > best.len) best = { len, ang: (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI }
    }
  // 변의 방향(동쪽 기준 각)을 세트 폭 방향으로 쓰면 세트는 그 수직을 바라본다.
  let az = -best.ang
  while (az > 90) az -= 180
  while (az < -90) az += 180
  const out = [0]
  if (Math.abs(az) >= 3 && Math.abs(az) <= 30) out.push(Math.round(az))
  return out
}

function evaluate(
  o: OptimizeInput,
  params: LayoutParams,
  rowOffset: number,
  area: number,
  quick: boolean,
): Evaluated | null {
  const sets = autoLayout(o.parcel, params, rowOffset)
  if (!sets.length) return null
  const g = setGeometry(params)
  const stats = layoutStats(sets, g, area)
  const scene = buildScene(o.parcel.rings, sets, o.obstacles, params, g)
  const e = simulateEnergy({
    latDeg: scene.frame.lat0,
    tilt: params.tilt,
    azimuth: params.azimuth,
    kWp: stats.kWp,
    performanceRatio: o.performanceRatio,
    albedo: 0.2,
    ghi: KOREA_GHI,
    shade: shadeTable(scene, quick),
  })
  return {
    params,
    sets,
    rowOffset,
    kWp: stats.kWp,
    annualKWh: e.annualKWh,
    specificYield: e.specificYield,
    shadeLoss: e.shadeLoss,
    coverage: stats.coverage,
    monthly: e.monthly,
  }
}

export function optimize(o: OptimizeInput, onProgress?: Progress): Candidate[] {
  const area = parcelArea(o.parcel)
  const { lat0 } = LocalFrame.around(o.parcel.rings)
  const azimuths = parcelAlignedAzimuths(o.parcel)

  // 1차: 빠른 근사로 넓게 훑기
  const grid: LayoutParams[] = []
  for (const azimuth of azimuths)
    for (const tilt of TILTS) {
      const trial = { ...o.base, tilt, azimuth }
      const g = setGeometry(trial)
      const noShade = rowSpacingForNoShade(lat0, g.height - trial.groundClearance, azimuth)
      const spacings = new Set(SPACING_RATIOS.map((k) => Math.max(MIN_ROW_SPACING, Math.round(noShade * k * 10) / 10)))
      for (const rowSpacing of spacings) grid.push({ ...trial, rowSpacing })
    }
  const coarse: Evaluated[] = []
  grid.forEach((params, i) => {
    onProgress?.(i, grid.length, '후보 훑는 중')
    const c = evaluate(o, params, 0, area, true)
    if (c) coarse.push(c)
  })

  // 2차: 전략마다 상위 2개 주변(경사각 ±2.5°, 첫 열 시작 위치)을 정밀 계산
  const seeds = new Map<string, Evaluated>()
  for (const strategy of Object.keys(STRATEGIES) as Strategy[]) {
    const rest = [...coarse]
    for (let k = 0; k < 2; k++) {
      const c = pick(rest, strategy)
      if (!c) break
      seeds.set(`${c.params.tilt}|${c.params.azimuth}|${c.params.rowSpacing}`, c)
      rest.splice(rest.indexOf(c), 1)
    }
  }
  const refine: Array<{ params: LayoutParams; rowOffset: number }> = []
  const queued = new Set<string>()
  for (const s of seeds.values()) {
    const pitch = setGeometry(s.params).depth + s.params.rowSpacing
    for (const dt of [-2.5, 0, 2.5]) {
      const params = { ...s.params, tilt: Math.max(MIN_TILT, s.params.tilt + dt) }
      for (const f of [0, 0.5]) {
        const rowOffset = Math.round(pitch * f * 10) / 10
        const key = `${params.tilt}|${params.azimuth}|${params.rowSpacing}|${rowOffset}`
        if (queued.has(key)) continue
        queued.add(key)
        refine.push({ params, rowOffset })
      }
    }
  }
  const fine: Evaluated[] = []
  refine.forEach((r, i) => {
    onProgress?.(i, refine.length, '상위 후보 정밀 계산 중')
    const c = evaluate(o, r.params, r.rowOffset, area, false)
    if (c) fine.push(c)
  })
  onProgress?.(1, 1, '완료')

  const out: Candidate[] = []
  for (const strategy of Object.keys(STRATEGIES) as Strategy[]) {
    const c = pick(fine, strategy)
    if (c) out.push({ ...c, strategy })
  }
  return out
}

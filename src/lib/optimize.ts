// 최적 배치 탐색(AI 설계).
// 모듈 종류·래킹·세트 구성·간격·경계 이격·전기 조건(인버터, DC/AC 비율)은 사용자가 정한 대로 두고,
// 경사각·방위각·열 이격거리(피치)와 첫 열 시작 위치를 바꿔 가며 설계 가능 영역에 채운다. 후보마다 전기 설계,
// 음영·클리핑·케이블 손실을 넣은 발전량, 토공량, 설치비와 LCOE를 계산해 기준별로 고른다.
// 1차는 빠른 근사(네 계절, 1시간 간격)로 넓게 훑고, 상위 후보만 정밀 계산으로 다시 평가한다.
// 용량 최대 기준은 동지 9~15시 무음영 이격거리를 지키는 안 가운데 설비용량이 가장 큰 안이다(업계에서 흔히 쓰는 가배치 기준).
// 3차로 기준별 최선안을 구역별 방위각 배치와 빈자리 채우기(zones.ts)로 바꿔 본 안도 정밀 계산해 함께 견준다.

import { LocalFrame } from './geo'
import type { TempModel } from './climate'
import type { BuildMask } from './buildable'
import type { CostParams } from './costs'
import { evaluateDesign, type DesignMetrics } from './design'
import type { Horizon } from './horizon'
import type { EconSettings } from './economics'
import type { ElecParams } from './electrical'
import type { ElevGrid } from './elevation'
import { autoLayout, setGeometry, type LayoutParams, type ModuleSet } from './layout'
import type { Parcel } from './parcel'
import type { Obstacle } from './shading'
import { rowSpacingForNoShade } from './sun'
import { zonedLayout, type ZoneMode } from './zones'

export type Strategy = 'capacity' | 'energy' | 'lcoe' | 'balanced' | 'yield'

export const STRATEGIES: Record<Strategy, { label: string; detail: string }> = {
  capacity: { label: '용량 최대', detail: '동지 9~15시에 앞 열 그림자가 뒷 열에 닿지 않는 간격을 지키면서 설비용량이 가장 큰 안' },
  energy: { label: '발전량 최대', detail: '필지에서 나오는 연간 발전량이 가장 많은 안' },
  lcoe: { label: 'LCOE 최저', detail: '설치비·운영비를 발전량으로 나눈 발전원가가 가장 낮은 안' },
  balanced: { label: '균형', detail: '효율(kWh/kWp)을 최고치의 97% 이상 지키면서 발전량이 가장 많은 안' },
  yield: { label: '효율 최대', detail: '모듈 1kW당 발전량이 가장 높은 안 (모듈 수 대비 수익성)' },
}

export interface OptimizeInput {
  parcel: Parcel
  base: LayoutParams
  obstacles: Obstacle[]
  performanceRatio: number
  temperature?: TempModel
  elec: ElecParams
  costs: CostParams
  econ: EconSettings
  grid?: ElevGrid | null
  /** 설계 가능 영역. 있으면 제외 구역을 피해 배치한다. */
  mask?: BuildMask | null
  /** 주변 지형 지평선 */
  horizon?: Horizon | null
}

export interface Candidate {
  strategy: Strategy
  params: LayoutParams
  sets: ModuleSet[]
  rowOffset: number
  /** 구역별 배치로 만든 안이면 그 방식 */
  zone?: ZoneMode
  /** 열 이격거리 ÷ 동지 9~15시 무음영 이격거리. 1 이상이면 무음영 간격을 지킨다. */
  spacingRatio: number
  metrics: DesignMetrics
}

export type Evaluated = Omit<Candidate, 'strategy'>

export type Progress = (done: number, total: number, phase: string) => void

const TILTS = [10, 15, 20, 25, 30, 35]
/** 동지 9~15시 무음영 이격거리 대비 배율 */
const SPACING_RATIOS = [0.5, 0.65, 0.8, 1.0, 1.2]
/** 무음영 간격(배율 1)은 경사각을 더 촘촘히 훑는다. 용량은 경사각에 민감하다. */
const NO_SHADE_TILTS = [10, 12.5, 15, 17.5, 20, 22.5, 25, 27.5, 30, 35]

/** 점검 통로로 최소한 남겨야 하는 열 이격거리(m) */
const MIN_ROW_SPACING = 1
const MIN_TILT = 10
const BALANCED_YIELD_RATIO = 0.97

function pick(pool: Evaluated[], strategy: Strategy): Evaluated | undefined {
  if (!pool.length) return undefined
  const byEnergy = (a: Evaluated, b: Evaluated) => b.metrics.annualKWh - a.metrics.annualKWh
  if (strategy === 'energy') return [...pool].sort(byEnergy)[0]
  if (strategy === 'capacity') {
    const ok = pool.filter((c) => c.spacingRatio >= 1)
    return [...(ok.length ? ok : pool)].sort((a, b) => b.metrics.kWp - a.metrics.kWp || byEnergy(a, b))[0]
  }
  if (strategy === 'lcoe') {
    const ok = pool.filter((c) => Number.isFinite(c.metrics.lcoe))
    return [...(ok.length ? ok : pool)].sort((a, b) => a.metrics.lcoe - b.metrics.lcoe || byEnergy(a, b))[0]
  }
  const bestYield = Math.max(...pool.map((c) => c.metrics.specificYield))
  if (strategy === 'yield')
    return [...pool].sort((a, b) => b.metrics.specificYield - a.metrics.specificYield || byEnergy(a, b))[0]
  return pool.filter((c) => c.metrics.specificYield >= bestYield * BALANCED_YIELD_RATIO).sort(byEnergy)[0]
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

/** 1차 훑기·2차 정밀 계산에서 그늘을 잴 세트 수 상한(고르게 뽑음) */
const COARSE_SHADE_SETS = 50
const FINE_SHADE_SETS = 100

export interface Task {
  params: LayoutParams
  rowOffset: number
  zone?: ZoneMode
  spacingRatio: number
}

/** 경사각·방위각에 맞는 동지 9~15시 무음영 이격거리(m) */
function noShadeSpacing(lat: number, p: LayoutParams): number {
  const g = setGeometry(p)
  return rowSpacingForNoShade(lat, g.height - p.groundClearance, p.azimuth)
}

/** 무음영 간격의 배율만큼 띄운 열 이격거리(m). 배율 1 이상은 올림해서 무음영 조건을 잃지 않게 한다. */
function spacingFor(lat: number, p: LayoutParams, ratio: number): number {
  const v = noShadeSpacing(lat, p) * ratio * 10
  return Math.max(MIN_ROW_SPACING, ratio >= 1 ? Math.ceil(v * 2 - 1e-6) / 20 : Math.round(v) / 10)
}

export function evaluateTask(o: OptimizeInput, t: Task, quick: boolean): Evaluated | null {
  const sets = t.zone
    ? zonedLayout(o.parcel, t.params, { mode: t.zone, rowOffset: t.rowOffset, mask: o.mask })
    : autoLayout(o.parcel, t.params, t.rowOffset, o.mask)
  if (!sets?.length) return null
  const { metrics } = evaluateDesign(
    {
      parcel: o.parcel,
      params: t.params,
      sets,
      obstacles: o.obstacles,
      performanceRatio: o.performanceRatio,
      temperature: o.temperature,
      elec: o.elec,
      costs: o.costs,
      econ: o.econ,
      grid: o.grid,
      horizon: o.horizon,
    },
    quick ? { shade: 'quick', maxShadeSets: COARSE_SHADE_SETS } : { shade: 'medium', maxShadeSets: FINE_SHADE_SETS },
  )
  return { params: t.params, sets, rowOffset: t.rowOffset, zone: t.zone, spacingRatio: t.spacingRatio, metrics }
}

/** 1차: 빠른 근사로 넓게 훑을 후보(경사각 × 방위각 × 열 이격거리) */
export function planCoarse(o: OptimizeInput): Task[] {
  const { lat0 } = LocalFrame.around(o.parcel.rings)
  const tasks: Task[] = []
  const queued = new Set<string>()
  const push = (trial: LayoutParams, ratio: number) => {
    const rowSpacing = spacingFor(lat0, trial, ratio)
    const key = `${trial.tilt}|${trial.azimuth}|${rowSpacing}`
    if (queued.has(key)) return
    queued.add(key)
    tasks.push({ params: { ...trial, rowSpacing }, rowOffset: 0, spacingRatio: rowSpacing / noShadeSpacing(lat0, trial) })
  }
  for (const azimuth of parcelAlignedAzimuths(o.parcel)) {
    for (const tilt of TILTS) for (const k of SPACING_RATIOS) push({ ...o.base, tilt, azimuth }, k)
    for (const tilt of NO_SHADE_TILTS) push({ ...o.base, tilt, azimuth }, 1)
  }
  return tasks
}

/**
 * 2차: 기준마다 상위 2개 주변(경사각 ±2.5°, 첫 열 시작 위치)을 정밀 계산할 후보.
 * 경사각을 바꾸면 그림자 길이가 달라지므로 무음영 간격 대비 배율을 유지하도록 열 이격거리도 다시 잡는다.
 * 용량 최대 후보는 첫 열 위치를 더 잘게 나눠 한 열이라도 더 들어가는 자리를 찾는다.
 */
export function planRefine(o: OptimizeInput, coarse: Evaluated[]): Task[] {
  const { lat0 } = LocalFrame.around(o.parcel.rings)
  const seeds = new Map<string, { c: Evaluated; offsets: number[] }>()
  for (const strategy of Object.keys(STRATEGIES) as Strategy[]) {
    const rest = [...coarse]
    for (let k = 0; k < 2; k++) {
      const c = pick(rest, strategy)
      if (!c) break
      const key = `${c.params.tilt}|${c.params.azimuth}|${c.params.rowSpacing}`
      const offsets = strategy === 'capacity' ? [0, 0.25, 0.5, 0.75] : (seeds.get(key)?.offsets ?? [0, 0.5])
      seeds.set(key, { c, offsets })
      rest.splice(rest.indexOf(c), 1)
    }
  }
  const refine: Task[] = []
  const queued = new Set<string>()
  for (const { c: s, offsets } of seeds.values()) {
    for (const dt of [-2.5, 0, 2.5]) {
      const tilt = Math.max(MIN_TILT, s.params.tilt + dt)
      const trial = { ...s.params, tilt }
      const rowSpacing = dt ? spacingFor(lat0, trial, s.spacingRatio) : s.params.rowSpacing
      const params = { ...trial, rowSpacing }
      const spacingRatio = rowSpacing / noShadeSpacing(lat0, params)
      const pitch = setGeometry(params).depth + rowSpacing
      for (const f of offsets) {
        const rowOffset = Math.round(pitch * f * 10) / 10
        const key = `${params.tilt}|${params.azimuth}|${params.rowSpacing}|${rowOffset}`
        if (queued.has(key)) continue
        queued.add(key)
        refine.push({ params, rowOffset, spacingRatio })
      }
    }
  }
  return refine
}

/** 3차: 기준별 최선안을 구역별 배치(경계 방향, 절충 방향)와 빈자리 채우기로 바꿔 볼 후보 */
export function planZoned(fine: Evaluated[]): Task[] {
  const seeds = new Map<string, Evaluated>()
  for (const strategy of Object.keys(STRATEGIES) as Strategy[]) {
    const c = pick(fine, strategy)
    if (c) seeds.set(`${c.params.tilt}|${c.params.azimuth}|${c.params.rowSpacing}|${c.rowOffset}`, c)
  }
  const modes: ZoneMode[] = ['edge', 'half', 'fill']
  return [...seeds.values()].flatMap((s) => modes.map((zone) => ({ params: s.params, rowOffset: s.rowOffset, zone, spacingRatio: s.spacingRatio })))
}

export function pickCandidates(fine: Evaluated[]): Candidate[] {
  const out: Candidate[] = []
  for (const strategy of Object.keys(STRATEGIES) as Strategy[]) {
    const c = pick(fine, strategy)
    if (c) out.push({ ...c, strategy })
  }
  return out
}

/** 한 스레드에서 끝까지 돌린다(시험용). 화면은 optimizePool로 여러 워커에 나눠 돌린다. */
export function optimize(o: OptimizeInput, onProgress?: Progress): Candidate[] {
  const coarseTasks = planCoarse(o)
  const coarse: Evaluated[] = []
  coarseTasks.forEach((t, i) => {
    onProgress?.(i, coarseTasks.length, '후보 훑는 중')
    const c = evaluateTask(o, t, true)
    if (c) coarse.push(c)
  })
  const refine = planRefine(o, coarse)
  const fine: Evaluated[] = []
  refine.forEach((t, i) => {
    onProgress?.(i, refine.length, '상위 후보 정밀 계산 중')
    const c = evaluateTask(o, t, false)
    if (c) fine.push(c)
  })
  const zoned = planZoned(fine)
  zoned.forEach((t, i) => {
    onProgress?.(i, zoned.length, '구역별 배치 계산 중')
    const c = evaluateTask(o, t, false)
    if (c) fine.push(c)
  })
  onProgress?.(1, 1, '완료')
  return pickCandidates(fine)
}

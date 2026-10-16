// 지도 화면과 발전량 계산이 함께 쓰는 음영 분석 묶음.

import { LocalFrame, type Vec } from './geo'
import type { LayoutParams, ModuleSet, SetGeometry } from './layout'
import { buildCasters, sampleAll, shadedFractions, shadowPolygons, shadowVector, type Obstacle } from './shading'
import { declination, sunPosition, type SunPos } from './sun'
import { REP_DAY } from './energy'

export interface Scene {
  frame: LocalFrame
  casters: ReturnType<typeof buildCasters>
  samples: ReturnType<typeof sampleAll>
}

export function buildScene(
  rings: number[][][],
  sets: ModuleSet[],
  obstacles: Obstacle[],
  p: LayoutParams,
  g: SetGeometry,
  /** 그늘 비율을 잴 세트(기본: 전부). 그림자는 항상 모든 세트·장애물이 드리운다. */
  sampleSets: ModuleSet[] = sets,
): Scene {
  const frame = LocalFrame.around(rings)
  // 일부 세트만 잴 때는 그 세트 근처(그림자가 닿을 수 있는 거리)의 세트만 그림자를 드리우게 해 계산을 줄인다.
  let casterSets = sets
  if (sampleSets !== sets) {
    const reach = Math.max(25, 12 * g.height) + g.width
    const centers = sampleSets.map((s) => frame.toLocal([s.lon, s.lat]))
    casterSets = sets.filter((s) => {
      const [x, y] = frame.toLocal([s.lon, s.lat])
      return centers.some(([cx, cy]) => Math.abs(cx - x) <= reach && Math.abs(cy - y) <= reach)
    })
  }
  return { frame, casters: buildCasters(casterSets, obstacles, p, g, frame), samples: sampleAll(sampleSets, p, g, frame) }
}

/**
 * 큰 배치에서 그늘 비율을 잴 세트를 고르게 뽑는다. 자동 배치 순서(열마다 서→동)대로 일정 간격으로 뽑으므로
 * 앞 열·뒤 열·가장자리가 고루 들어간다. 평균 음영 손실만 쓰는 계산(발전량, AI 설계)에 쓴다.
 */
export function spreadSample<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items
  const out: T[] = []
  const step = items.length / max
  for (let i = 0; i < max; i++) out.push(items[Math.floor(i * step + step / 2)])
  return out
}

export interface ShadeSnapshot {
  sun: SunPos
  /** 지도에 그릴 그림자(경위도 링) */
  shadows: Array<{ ring: Vec[]; fromSet: boolean }>
  perSet: Map<string, number>
  /** 전체 모듈 중 그늘진 비율 */
  overall: number
}

export function snapshot(scene: Scene, declDeg: number, solarHour: number): ShadeSnapshot {
  const sun = sunPosition(scene.frame.lat0, declDeg, solarHour)
  const v = shadowVector(sun)
  if (!v) return { sun, shadows: [], perSet: new Map(), overall: 0 }
  const shadows = shadowPolygons(scene.casters, v).map((sp) => ({
    ring: sp.ring.map((q) => scene.frame.toLonLat(q)),
    fromSet: sp.setId !== undefined,
  }))
  const perSet = shadedFractions(scene.samples, scene.casters, v)
  return { sun, shadows, perSet, overall: mean(perSet) }
}

function mean(m: Map<string, number>): number {
  if (!m.size) return 0
  let s = 0
  for (const x of m.values()) s += x
  return s / m.size
}

/** 하루 동안 해의 고도로 가중한 평균 음영 비율 (직달 일사 손실의 근사) */
export function dailyShadeLoss(scene: Scene, declDeg: number): number {
  let w = 0
  let s = 0
  for (let t = 5; t <= 19; t += 0.5) {
    const sun = sunPosition(scene.frame.lat0, declDeg, t)
    const v = shadowVector(sun)
    if (!v) continue
    const weight = Math.sin(sun.altitude)
    w += weight
    s += weight * mean(shadedFractions(scene.samples, scene.casters, v))
  }
  return w ? s / w : 0
}

export type ShadeQuality = 'quick' | 'medium' | 'full'

/**
 * 달마다 대표일의 음영 비율 표를 만들고, 발전량 계산이 쓰는 함수로 돌려준다.
 * full: 12개월 30분 간격. medium: 12개월 1시간 간격. quick: 동지·춘분·하지·추분 무렵 네 달만 1시간 간격으로
 * 계산하고, 나머지 달은 태양 적위가 가장 가까운 달 값을 빌려 쓴다(최적 배치 탐색용).
 */
export function shadeTable(scene: Scene, quality: ShadeQuality | boolean = 'full'): (month: number, solarHour: number) => number {
  const q: ShadeQuality = quality === true ? 'quick' : quality === false ? 'full' : quality
  const quick = q === 'quick'
  const step = q === 'full' ? 0.5 : 1
  const computed = quick ? [11, 2, 5, 8] : REP_DAY.map((_, i) => i)
  const decs = REP_DAY.map((n) => declination(n))
  const rows = new Map<number, number[]>()
  for (const m of computed) {
    const row: number[] = []
    for (let t = 0; t <= 24; t += step) {
      const v = shadowVector(sunPosition(scene.frame.lat0, decs[m], t))
      row.push(v ? mean(shadedFractions(scene.samples, scene.casters, v)) : 0)
    }
    rows.set(m, row)
  }
  const source = decs.map((d) => computed.reduce((best, m) => (Math.abs(decs[m] - d) < Math.abs(decs[best] - d) ? m : best)))
  return (month, h) => {
    const row = rows.get(source[month])!
    const i = Math.max(0, Math.min(row.length - 1, Math.round(h / step)))
    return row[i]
  }
}

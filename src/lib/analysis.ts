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
): Scene {
  const frame = LocalFrame.around(rings)
  return { frame, casters: buildCasters(sets, obstacles, p, g, frame), samples: sampleAll(sets, p, g, frame) }
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

/**
 * 달마다 대표일의 30분 간격 음영 비율 표를 만들고, 발전량 계산이 쓰는 함수로 돌려준다.
 */
export function shadeTable(scene: Scene): (month: number, solarHour: number) => number {
  const step = 0.5
  const table: number[][] = REP_DAY.map((n) => {
    const dec = declination(n)
    const row: number[] = []
    for (let t = 0; t <= 24; t += step) {
      const v = shadowVector(sunPosition(scene.frame.lat0, dec, t))
      row.push(v ? mean(shadedFractions(scene.samples, scene.casters, v)) : 0)
    }
    return row
  })
  return (month, h) => {
    const i = Math.max(0, Math.min(table[month].length - 1, Math.round(h / step)))
    return table[month][i]
  }
}

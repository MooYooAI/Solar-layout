// 지도 화면과 발전량 계산이 함께 쓰는 음영 분석 묶음.

import { LocalFrame, type Vec } from './geo'
import { moduleQuads3D, totalModules, type LayoutParams, type ModuleSet, type SetGeometry } from './layout'
import { buildCasters, sampleAll, shadedFractions, ShadowIndex, shadowPolygons, shadowVector, type Ground, type Obstacle, type Vec3 } from './shading'
import { declination, sunPosition, sunriseSunsetSolar, type SunPos } from './sun'
import { REP_DAY } from './energy'
import { anglesNear, groundOffset, sunBehindTerrain, type Horizon } from './horizon'

export interface Scene {
  frame: LocalFrame
  casters: ReturnType<typeof buildCasters>
  samples: ReturnType<typeof sampleAll>
  /** 주변 지형 지평선. 해가 그 아래면 그 자리가 그늘이다. */
  horizon: Horizon | null
  /** 그늘 비율을 재는 세트마다 그 자리의 지평선(부지 안 위치마다 산이 가리는 시각이 다르다) */
  setAngles: Map<string, number[]>
  /** 부지 중심 기준 지반고 차(m). 지붕 설치거나 표고가 없으면 평지 */
  ground: Ground
}

export function buildScene(
  rings: number[][][],
  sets: ModuleSet[],
  obstacles: Obstacle[],
  p: LayoutParams,
  g: SetGeometry,
  /** 그늘 비율을 잴 세트(기본: 전부). 그림자는 항상 모든 세트·장애물이 드리운다. */
  sampleSets: ModuleSet[] = sets,
  horizon: Horizon | null = null,
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
  // 지붕은 지형을 따르지 않는다. 땅 위 세트는 지반 높낮이대로 놓아 비탈에서 앞뒤 열이 가리는 정도를 맞춘다.
  const ground: Ground = horizon?.grid && p.racking !== 'roof' ? (x, y) => groundOffset(horizon, x, y) : () => 0
  const setAngles = new Map<string, number[]>()
  if (horizon)
    for (const s of sampleSets) {
      const [x, y] = frame.toLocal([s.lon, s.lat])
      setAngles.set(s.id, anglesNear(horizon, x, y))
    }
  return {
    frame,
    casters: buildCasters(casterSets, obstacles, p, g, frame, ground),
    samples: sampleAll(sampleSets, p, g, frame, ground),
    horizon,
    setAngles,
    ground,
  }
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
  /** 해가 주변 산 뒤에 있어 부지 중심이 그늘인지 */
  terrainBlocked: boolean
  /** 산에 가린 세트 수(그늘 비율을 잰 세트 가운데) */
  terrainSets: number
}

/** 세트 자리에서 해가 산 뒤에 있는지 */
const setBehindTerrain = (scene: Scene, id: string, sun: SunPos) => sunBehindTerrain(scene.horizon, sun, scene.setAngles.get(id))

/** 세트별 그늘 비율. 산에 가린 세트는 1. 모두 가리면 그림자 계산을 건너뛴다. */
function fractionsAt(scene: Scene, sun: SunPos, v: [number, number]): { perSet: Map<string, number>; blocked: number } {
  const ids = [...scene.samples.keys()]
  const hidden = new Set(ids.filter((id) => setBehindTerrain(scene, id, sun)))
  if (ids.length && hidden.size === ids.length) return { perSet: new Map(ids.map((id) => [id, 1])), blocked: hidden.size }
  const perSet = shadedFractions(scene.samples, scene.casters, v)
  for (const id of hidden) perSet.set(id, 1)
  return { perSet, blocked: hidden.size }
}

/** 이 해 위치에서 모듈 평균 그늘 비율(산에 가린 세트는 1) */
function shadeAt(scene: Scene, sun: SunPos): number {
  const v = shadowVector(sun)
  if (!v) return 0
  if (!scene.samples.size) return sunBehindTerrain(scene.horizon, sun) ? 1 : 0
  return mean(fractionsAt(scene, sun, v).perSet)
}

export function snapshot(scene: Scene, declDeg: number, solarHour: number): ShadeSnapshot {
  const sun = sunPosition(scene.frame.lat0, declDeg, solarHour)
  const v = shadowVector(sun)
  if (!v) return { sun, shadows: [], perSet: new Map(), overall: 0, terrainBlocked: false, terrainSets: 0 }
  const { perSet, blocked } = fractionsAt(scene, sun, v)
  // 땅 위 그림자: 그 물체 자리에 해가 드는 것만 그린다(산 그늘 속에서는 그림자가 따로 지지 않는다).
  const lit = (sp: { setId?: string; caster: { points: Vec3[] } }) => {
    const [x, y] = sp.caster.points[0]
    const angles = sp.setId !== undefined ? scene.setAngles.get(sp.setId) : undefined
    return !sunBehindTerrain(scene.horizon, sun, angles ?? (scene.horizon ? anglesNear(scene.horizon, x, y) : undefined))
  }
  const shadows = shadowPolygons(scene.casters, v, true)
    .filter(lit)
    .map((sp) => ({
      ring: sp.ring.map((q) => scene.frame.toLonLat(q)),
      fromSet: sp.setId !== undefined,
    }))
  return { sun, shadows, perSet, overall: mean(perSet), terrainBlocked: sunBehindTerrain(scene.horizon, sun), terrainSets: blocked }
}

/** 모듈 표면의 그늘 칸. 모듈마다 nu(가로) × nv(경사 방향) 칸, moduleQuads3D 순서대로 1이면 그늘. */
export interface PanelShade {
  nu: number
  nv: number
  cells: Map<string, Uint8Array>
}

/** 칸 수가 이보다 많으면 모듈당 칸을 줄인다(계산 부담). */
const MAX_PANEL_CELLS = 150_000

/**
 * 3D 지도에서 모듈 표면에 그림자를 그리기 위한 칸별 그늘 여부.
 * 지면 그림자는 옆이나 정면에서 보면 판에 가려 안 보이므로, 판 위에 떨어진 그림자를 직접 칠한다.
 */
export function panelShadeCells(scene: Scene, sets: ModuleSet[], p: LayoutParams, g: SetGeometry, sun: SunPos): PanelShade | null {
  const v = shadowVector(sun)
  if (!v || !sets.length) return null
  const dense = totalModules(sets, g) * 12 <= MAX_PANEL_CELLS
  const nu = dense ? 3 : 1
  const nv = dense ? 4 : 2
  const index = new ShadowIndex(shadowPolygons(scene.casters, v))
  const cells = new Map<string, Uint8Array>()
  for (const s of sets) {
    const quads = moduleQuads3D(s, p, g)
    const out = new Uint8Array(quads.length * nu * nv)
    const [cx, cy] = scene.frame.toLocal([s.lon, s.lat])
    const angles = scene.setAngles.get(s.id) ?? (scene.horizon ? anglesNear(scene.horizon, cx, cy) : undefined)
    if (sunBehindTerrain(scene.horizon, sun, angles)) out.fill(1)
    else {
      const cz = scene.ground(cx, cy)
      let k = 0
      for (const q of quads)
        for (let j = 0; j < nv; j++)
          for (let i = 0; i < nu; i++) {
            const u = (i + 0.5) / nu
            const w = (j + 0.5) / nv
            const pt = [0, 1, 2].map(
              (d) => (1 - u) * (1 - w) * q[0][d] + u * (1 - w) * q[1][d] + u * w * q[2][d] + (1 - u) * w * q[3][d],
            )
            const world: Vec3 = [pt[0] + cx, pt[1] + cy, pt[2] + cz]
            out[k++] = index.shaded(world, v, s.id) ? 1 : 0
          }
    }
    cells.set(s.id, out)
  }
  return { nu, nv, cells }
}

function mean(m: Map<string, number>): number {
  if (!m.size) return 0
  let s = 0
  for (const x of m.values()) s += x
  return s / m.size
}

/**
 * 하루 동안 해의 고도로 가중한 평균 음영 비율 (직달 일사 손실의 근사).
 * 일출부터 일몰까지 10분 간격으로 본다. sin(고도) 가중은 대기 감쇠를 넣은 경사면 직달(DNI·cosθ) 가중과
 * 1%p 안쪽으로 맞는다(30° 경사·정남 배치로 확인).
 */
export function dailyShadeLoss(scene: Scene, declDeg: number): number {
  const day = sunriseSunsetSolar(scene.frame.lat0, declDeg) ?? { rise: 0, set: 24 }
  let w = 0
  let s = 0
  for (let t = day.rise; t <= day.set; t += 1 / 6) {
    const sun = sunPosition(scene.frame.lat0, declDeg, t)
    if (!shadowVector(sun)) continue
    const weight = Math.sin(sun.altitude)
    w += weight
    s += weight * shadeAt(scene, sun)
  }
  return w ? s / w : 0
}

/**
 * 세트별로 정한 시간(기본: 동지 무음영 기준인 태양시 9~15시) 동안 그늘진 비율의 평균. 해의 고도로 가중해
 * 그 시간 직달 일사 손실에 가깝게 본다. 모든 세트가 산에 가린 시각은 세트를 가려내는 데 쓸모가 없어 빼고,
 * 일부 세트만 산에 가린 시각은 그 세트를 그늘로 센다.
 */
export function perSetShade(scene: Scene, declDeg: number, from = 9, to = 15): Map<string, number> {
  const out = new Map<string, number>([...scene.samples.keys()].map((id) => [id, 0]))
  let w = 0
  for (let t = from; t <= to + 1e-9; t += 1 / 6) {
    const sun = sunPosition(scene.frame.lat0, declDeg, t)
    const v = shadowVector(sun)
    if (!v) continue
    const { perSet, blocked } = fractionsAt(scene, sun, v)
    if (blocked && blocked === perSet.size) continue
    const weight = Math.sin(sun.altitude)
    w += weight
    for (const [id, f] of perSet) out.set(id, out.get(id)! + weight * f)
  }
  if (w) for (const [id, x] of out) out.set(id, x / w)
  return out
}

/**
 * 주변 산을 넘어 부지에 햇빛이 처음 드는 시각과 산 뒤로 넘어가는 시각(태양시).
 * 지평선이 없거나 하루 종일 가리면 null.
 */
export function terrainSunWindow(horizon: Horizon | null, latDeg: number, declDeg: number): { rise: number; set: number } | null {
  if (!horizon) return null
  const day = sunriseSunsetSolar(latDeg, declDeg)
  if (!day) return null
  const lit = (t: number) => {
    const sun = sunPosition(latDeg, declDeg, t)
    return sun.altitude > 0 && !sunBehindTerrain(horizon, sun)
  }
  const STEP = 1 / 60
  let rise: number | null = null
  for (let t = day.rise; t <= 12; t += STEP) if (lit(t)) { rise = t; break }
  let set: number | null = null
  for (let t = day.set; t >= 12; t -= STEP) if (lit(t)) { set = t; break }
  return rise === null || set === null ? null : { rise, set }
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
      row.push(shadeAt(scene, sunPosition(scene.frame.lat0, decs[m], t)))
    }
    rows.set(m, row)
  }
  const source = decs.map((d) => computed.reduce((best, m) => (Math.abs(decs[m] - d) < Math.abs(decs[best] - d) ? m : best)))
  return (month, h) => {
    // 해 뜰 무렵·질 무렵은 30분 사이에도 그늘이 크게 바뀌어 가까운 칸 값 대신 선형 보간한다.
    const row = rows.get(source[month])!
    const f = Math.max(0, Math.min(row.length - 1, h / step))
    const i = Math.min(row.length - 2, Math.floor(f))
    return row[i] + (row[i + 1] - row[i]) * (f - i)
  }
}

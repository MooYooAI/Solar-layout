import { deg2rad, LocalFrame, pointInRing, rotate, type Vec } from './geo'
import type { LayoutParams, ModuleSet, SetGeometry } from './layout'
import type { SunPos } from './sun'

export type Vec3 = [number, number, number]

/** 주변 장애물(건물, 나무 등). 바닥 윤곽 + 높이. */
export interface Obstacle {
  id: string
  name: string
  ring: number[][] // 경위도, 닫힌 링
  height: number // m
}

/** 태양 반대쪽으로 높이 1m당 그림자가 뻗는 지면 벡터(m). 해가 지평선 아래면 null. */
export function shadowVector(sun: SunPos): Vec | null {
  if (sun.altitude <= deg2rad(0.5)) return null
  const k = 1 / Math.tan(sun.altitude)
  // 방위각: 남 0, 서 +. 해가 있는 쪽 지도 벡터 = (−sin A, −cos A), 그림자는 반대.
  return [Math.sin(sun.azimuth) * k, Math.cos(sun.azimuth) * k]
}

const project = ([x, y, z]: Vec3, v: Vec): Vec => [x + v[0] * z, y + v[1] * z]

function convexHull(points: Vec[]): Vec[] {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (pts.length < 3) return pts
  const cross = (o: Vec, a: Vec, b: Vec) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower: Vec[] = []
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop()
    lower.push(p)
  }
  const upper: Vec[] = []
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop()
    upper.push(p)
  }
  const hull = lower.slice(0, -1).concat(upper.slice(0, -1))
  return [...hull, hull[0]]
}

/** 세트 경사면 네 꼭짓점(공통 로컬 좌표, m). 앞(남)쪽 모서리가 낮다. */
export function setCorners3D(s: ModuleSet, p: LayoutParams, g: SetGeometry, frame: LocalFrame): Vec3[] {
  const c = frame.toLocal([s.lon, s.lat])
  const r = -deg2rad(s.azimuth)
  const hw = g.width / 2
  const hd = g.depth / 2
  const zLow = p.groundClearance
  const zHigh = g.height
  return (
    [
      [-hw, -hd, zLow],
      [hw, -hd, zLow],
      [hw, hd, zHigh],
      [-hw, hd, zHigh],
    ] as Vec3[]
  ).map(([x, y, z]) => {
    const [rx, ry] = rotate([x, y], r)
    return [rx + c[0], ry + c[1], z]
  })
}

/**
 * 모듈마다 경사면 위의 표본점 2개(아래쪽 1/4, 위쪽 3/4 지점).
 * 반환: 세트별 [모듈][표본점] 3D 좌표.
 */
export function moduleSamples(s: ModuleSet, p: LayoutParams, g: SetGeometry, frame: LocalFrame): Vec3[][] {
  const c = frame.toLocal([s.lon, s.lat])
  const r = -deg2rad(s.azimuth)
  const along = (p.portrait ? p.moduleWidth : p.moduleLength) / 1000
  const across = (p.portrait ? p.moduleLength : p.moduleWidth) / 1000
  const gap = p.moduleGap / 1000
  const cos = Math.cos(deg2rad(p.tilt))
  const sin = Math.sin(deg2rad(p.tilt))
  const out: Vec3[][] = []
  for (let row = 0; row < p.setRows; row++) {
    for (let col = 0; col < p.setCols; col++) {
      const x = -g.width / 2 + col * (along + gap) + along / 2
      const pts: Vec3[] = [0.25, 0.75].map((f) => {
        const s = row * (across + gap) + f * across // 경사면을 따라 잰 거리
        const [rx, ry] = rotate([x, -g.depth / 2 + s * cos], r)
        return [rx + c[0], ry + c[1], p.groundClearance + s * sin]
      })
      out.push(pts)
    }
  }
  return out
}

export interface Caster {
  /** 그림자를 드리우는 3D 점들. 지면에 투영해 볼록 껍질을 만든다. */
  points: Vec3[]
  /** 이 물체에 속한 세트 id (자기 그림자 제외용) */
  setId?: string
}

export function buildCasters(
  sets: ModuleSet[],
  obstacles: Obstacle[],
  p: LayoutParams,
  g: SetGeometry,
  frame: LocalFrame,
): Caster[] {
  const casters: Caster[] = sets.map((s) => ({ points: setCorners3D(s, p, g, frame), setId: s.id }))
  for (const o of obstacles) {
    const base = o.ring.slice(0, -1).map((c) => frame.toLocal(c))
    casters.push({
      points: [...base.map(([x, y]) => [x, y, 0] as Vec3), ...base.map(([x, y]) => [x, y, o.height] as Vec3)],
    })
  }
  return casters
}

export interface ShadowPoly {
  ring: Vec[]
  setId?: string
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export function shadowPolygons(casters: Caster[], v: Vec): ShadowPoly[] {
  return casters.map((c) => {
    const ring = convexHull(c.points.map((pt) => project(pt, v)))
    const xs = ring.map((q) => q[0])
    const ys = ring.map((q) => q[1])
    return {
      ring,
      setId: c.setId,
      minX: Math.min(...xs),
      minY: Math.min(...ys),
      maxX: Math.max(...xs),
      maxY: Math.max(...ys),
    }
  })
}

/** 격자 버킷으로 그림자 다각형을 빠르게 찾는다. */
class ShadowIndex {
  private cells = new Map<string, ShadowPoly[]>()
  private readonly size: number
  constructor(polys: ShadowPoly[], size = 10) {
    this.size = size
    for (const sp of polys) {
      for (let i = Math.floor(sp.minX / size); i <= Math.floor(sp.maxX / size); i++)
        for (let j = Math.floor(sp.minY / size); j <= Math.floor(sp.maxY / size); j++) {
          const k = `${i},${j}`
          const list = this.cells.get(k)
          if (list) list.push(sp)
          else this.cells.set(k, [sp])
        }
    }
  }
  shaded(pt: Vec, ownSet?: string): boolean {
    const list = this.cells.get(`${Math.floor(pt[0] / this.size)},${Math.floor(pt[1] / this.size)}`)
    if (!list) return false
    for (const sp of list) {
      if (sp.setId !== undefined && sp.setId === ownSet) continue
      if (pt[0] < sp.minX || pt[0] > sp.maxX || pt[1] < sp.minY || pt[1] > sp.maxY) continue
      if (pointInRing(pt, sp.ring)) return true
    }
    return false
  }
}

/**
 * 표본점이 그림자 안에 있는 비율. 경사면 위 점은 태양 광선을 따라 지면까지 내려
 * 투영한 뒤, 다른 물체의 지면 그림자 안에 들어가는지로 판단한다.
 */
export function shadedFractions(
  samples: Map<string, Vec3[][]>,
  casters: Caster[],
  v: Vec,
): Map<string, number> {
  const index = new ShadowIndex(shadowPolygons(casters, v))
  const out = new Map<string, number>()
  for (const [id, modules] of samples) {
    let shaded = 0
    let total = 0
    for (const pts of modules)
      for (const pt of pts) {
        total++
        if (index.shaded(project(pt, v), id)) shaded++
      }
    out.set(id, total ? shaded / total : 0)
  }
  return out
}

export function sampleAll(sets: ModuleSet[], p: LayoutParams, g: SetGeometry, frame: LocalFrame) {
  return new Map(sets.map((s) => [s.id, moduleSamples(s, p, g, frame)]))
}

export const toLonLatRing = (ring: Vec[], frame: LocalFrame) => ring.map((q) => frame.toLonLat(q))

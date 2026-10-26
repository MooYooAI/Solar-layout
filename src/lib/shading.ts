import { convexHull as hullOpen, deg2rad, LocalFrame, pointInRing, rotate, type Vec } from './geo'
import { forSet, type LayoutParams, type ModuleSet, type SetGeometry } from './layout'
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

export const project = ([x, y, z]: Vec3, v: Vec): Vec => [x + v[0] * z, y + v[1] * z]

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

/** 부지 중심 기준 로컬 (x, y) m의 지반고가 중심보다 높은 만큼(m). 평지로 보면 0. */
export type Ground = (x: number, y: number) => number
const FLAT: Ground = () => 0

/** 세트 경사면 네 꼭짓점(공통 로컬 좌표, m). 앞(남)쪽 모서리가 낮다. z는 부지 중심 지반 기준. */
export function setCorners3D(s: ModuleSet, p: LayoutParams, g0: SetGeometry, frame: LocalFrame, ground: Ground = FLAT): Vec3[] {
  const g = forSet(g0, s)
  const c = frame.toLocal([s.lon, s.lat])
  const gz = ground(c[0], c[1])
  const r = -deg2rad(s.azimuth)
  const hw = g.width / 2
  const hd = g.depth / 2
  const zLow = p.groundClearance + gz
  const zHigh = g.height + gz
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
 * 경사면을 따라 잴 표본점 위치(모듈 길이 비율). 앞열 그림자는 뒷열 모듈 아래 끝부터 얇게 올라오므로
 * 아래쪽 1/8 지점까지 봐야 동지 정오처럼 띠 모양으로 걸치는 그늘을 놓치지 않는다.
 */
const SAMPLE_AT = [0.125, 0.375, 0.625, 0.875]

/**
 * 모듈마다 경사면 위의 표본점 4개(아래에서 1/8, 3/8, 5/8, 7/8 지점).
 * 반환: 세트별 [모듈][표본점] 3D 좌표.
 */
export function moduleSamples(s: ModuleSet, p: LayoutParams, g0: SetGeometry, frame: LocalFrame, ground: Ground = FLAT): Vec3[][] {
  const g = forSet(g0, s)
  const c = frame.toLocal([s.lon, s.lat])
  const gz = ground(c[0], c[1])
  const r = -deg2rad(s.azimuth)
  const along = (p.portrait ? p.moduleWidth : p.moduleLength) / 1000
  const across = (p.portrait ? p.moduleLength : p.moduleWidth) / 1000
  const gap = p.moduleGap / 1000
  const cos = Math.cos(deg2rad(p.tilt))
  const sin = Math.sin(deg2rad(p.tilt))
  const out: Vec3[][] = []
  for (let row = 0; row < p.setRows; row++) {
    for (let col = 0; col < g.cols; col++) {
      const x = -g.width / 2 + col * (along + gap) + along / 2
      const pts: Vec3[] = SAMPLE_AT.map((f) => {
        const s = row * (across + gap) + f * across // 경사면을 따라 잰 거리
        const [rx, ry] = rotate([x, -g.depth / 2 + s * cos], r)
        return [rx + c[0], ry + c[1], gz + p.groundClearance + s * sin]
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
  /** 가림 판정 모양: 세트 경사면(평면 사각형) 또는 바닥 윤곽을 세운 기둥(장애물) */
  shape: { kind: 'plane'; c: Vec3; n: Vec3 } | { kind: 'prism'; hull: Vec[]; top: number }
  /** 이 물체가 선 지반고(m). 땅에 그릴 그림자를 이 높이 지면에 떨군다. */
  base: number
}

const sub3 = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot3 = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross3 = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]

export function buildCasters(
  sets: ModuleSet[],
  obstacles: Obstacle[],
  p: LayoutParams,
  g: SetGeometry,
  frame: LocalFrame,
  ground: Ground = FLAT,
): Caster[] {
  const casters: Caster[] = sets.map((s) => {
    const points = setCorners3D(s, p, g, frame, ground)
    const [cx, cy] = frame.toLocal([s.lon, s.lat])
    const n = cross3(sub3(points[1], points[0]), sub3(points[3], points[0]))
    return { points, setId: s.id, shape: { kind: 'plane', c: points[0], n }, base: ground(cx, cy) }
  })
  for (const o of obstacles) {
    const foot = o.ring.slice(0, -1).map((c) => frame.toLocal(c))
    if (foot.length < 3) continue
    const hull = hullOpen(foot)
    const base = Math.min(...foot.map(([x, y]) => ground(x, y)))
    const top = base + o.height
    casters.push({
      points: [...hull.map(([x, y]) => [x, y, base] as Vec3), ...hull.map(([x, y]) => [x, y, top] as Vec3)],
      shape: { kind: 'prism', hull, top },
      base,
    })
  }
  return casters
}

/**
 * 점 P에서 해 쪽으로 쏜 빛이 이 물체에 막히는지. v는 shadowVector(높이 1 m당 그림자가 뻗는 지면 벡터)라
 * 해 쪽 광선은 P + (−v, 1)·λ (λ ≥ 0, 오르는 높이)다. 지면에 투영한 그림자 안에 든 점만 넘어오므로
 * 여기서는 물체가 P보다 해 쪽에 있는지(뒤쪽이 아닌지)를 가린다.
 */
function blocks(c: Caster, P: Vec3, v: Vec): boolean {
  const ray: Vec3 = [-v[0], -v[1], 1]
  if (c.shape.kind === 'plane') {
    const { c: c0, n } = c.shape
    const den = dot3(n, ray)
    if (Math.abs(den) < 1e-12) return false
    return dot3(n, sub3(c0, P)) / den > 1e-6
  }
  // 기둥: 바닥 껍질(반시계)을 광선의 지면 자취가 지나는 구간 [λin, λout]을 구한다(Cyrus–Beck).
  const { hull, top } = c.shape
  let lin = -Infinity
  let lout = Infinity
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i]
    const b = hull[(i + 1) % hull.length]
    const nx = b[1] - a[1]
    const ny = a[0] - b[0]
    const num = nx * (P[0] - a[0]) + ny * (P[1] - a[1])
    const den = -(nx * v[0] + ny * v[1])
    if (Math.abs(den) < 1e-12) {
      if (num > 0) return false
      continue
    }
    const t = -num / den
    if (den > 0) lout = Math.min(lout, t)
    else lin = Math.max(lin, t)
  }
  const l0 = Math.max(lin, 0)
  return lout >= l0 && P[2] + l0 <= top
}

export interface ShadowPoly {
  ring: Vec[]
  setId?: string
  caster: Caster
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/**
 * 물체를 해 반대쪽으로 지면에 투영한 다각형. relative면 물체가 선 지반(base) 높이 지면에 떨군다(지도 표시용).
 * 아니면 부지 중심 지반 높이 평면에 떨군다(가림 판정용: 같은 평면이어야 점과 비교할 수 있다).
 */
export function shadowPolygons(casters: Caster[], v: Vec, relative = false): ShadowPoly[] {
  return casters.map((c) => {
    const projected = c.points.map(([x, y, z]) => project([x, y, relative ? z - c.base : z], v))
    // 세트 경사면(평면 사각형)을 한 방향으로 투영하면 꼭짓점 순서가 그대로인 볼록 사각형이라 껍질 계산이 필요 없다.
    const ring = c.setId !== undefined && projected.length === 4 ? [...projected, projected[0]] : convexHull(projected)
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const [x, y] of ring) {
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
    return { ring, setId: c.setId, caster: c, minX, minY, maxX, maxY }
  })
}

/** 격자 칸 번호 → 숫자 키(필지 단위 좌표라 ±50만 칸 안에 든다) */
const cellKey = (i: number, j: number) => (i + 500_000) * 1_000_003 + (j + 500_000)

/** 격자 버킷으로 그림자 다각형을 빠르게 찾는다. */
export class ShadowIndex {
  private cells = new Map<number, ShadowPoly[]>()
  private readonly size: number
  constructor(polys: ShadowPoly[], size = 10) {
    this.size = size
    for (const sp of polys) {
      for (let i = Math.floor(sp.minX / size); i <= Math.floor(sp.maxX / size); i++)
        for (let j = Math.floor(sp.minY / size); j <= Math.floor(sp.maxY / size); j++) {
          const k = cellKey(i, j)
          const list = this.cells.get(k)
          if (list) list.push(sp)
          else this.cells.set(k, [sp])
        }
    }
  }
  /** 3D 점 P가 다른 물체의 그늘에 드는지. v는 이 색인을 만든 그림자 벡터. */
  shaded(P: Vec3, v: Vec, ownSet?: string): boolean {
    const pt = project(P, v)
    const list = this.cells.get(cellKey(Math.floor(pt[0] / this.size), Math.floor(pt[1] / this.size)))
    if (!list) return false
    for (const sp of list) {
      if (sp.setId !== undefined && sp.setId === ownSet) continue
      if (pt[0] < sp.minX || pt[0] > sp.maxX || pt[1] < sp.minY || pt[1] > sp.maxY) continue
      if (pointInRing(pt, sp.ring) && blocks(sp.caster, P, v)) return true
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
        if (index.shaded(pt, v, id)) shaded++
      }
    out.set(id, total ? shaded / total : 0)
  }
  return out
}

export function sampleAll(sets: ModuleSet[], p: LayoutParams, g: SetGeometry, frame: LocalFrame, ground: Ground = FLAT) {
  return new Map(sets.map((s) => [s.id, moduleSamples(s, p, g, frame, ground)]))
}

export const toLonLatRing = (ring: Vec[], frame: LocalFrame) => ring.map((q) => frame.toLonLat(q))

// 필지 단위의 작은 영역은 중심점 기준 평면 좌표(미터)로 계산해도 오차가 무시할 수준이다.

const M_PER_DEG_LAT = 110_574
const M_PER_DEG_LON_EQ = 111_320

export type Vec = [number, number]

export class LocalFrame {
  readonly lon0: number
  readonly lat0: number
  private readonly kx: number

  constructor(lon0: number, lat0: number) {
    this.lon0 = lon0
    this.lat0 = lat0
    this.kx = M_PER_DEG_LON_EQ * Math.cos((lat0 * Math.PI) / 180)
  }

  static around(rings: number[][][]): LocalFrame {
    let sx = 0
    let sy = 0
    let n = 0
    for (const r of rings)
      for (const [x, y] of r) {
        sx += x
        sy += y
        n++
      }
    return new LocalFrame(sx / n, sy / n)
  }

  toLocal([lon, lat]: number[]): Vec {
    return [(lon - this.lon0) * this.kx, (lat - this.lat0) * M_PER_DEG_LAT]
  }

  toLonLat([x, y]: Vec): Vec {
    return [this.lon0 + x / this.kx, this.lat0 + y / M_PER_DEG_LAT]
  }
}

export const deg2rad = (d: number) => (d * Math.PI) / 180
export const rad2deg = (r: number) => (r * 180) / Math.PI

/** 반시계 방향 회전 */
export function rotate([x, y]: Vec, rad: number): Vec {
  const c = Math.cos(rad)
  const s = Math.sin(rad)
  return [x * c - y * s, x * s + y * c]
}

export function pointInRing([px, py]: Vec, ring: Vec[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function pointSegDist2([px, py]: Vec, [ax, ay]: Vec, [bx, by]: Vec): number {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0
  const ex = ax + t * dx - px
  const ey = ay + t * dy - py
  return ex * ex + ey * ey
}

function cross(o: Vec, a: Vec, b: Vec) {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
}

function segmentsIntersect(a: Vec, b: Vec, c: Vec, d: Vec): boolean {
  const d1 = cross(c, d, a)
  const d2 = cross(c, d, b)
  const d3 = cross(a, b, c)
  const d4 = cross(a, b, d)
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
}

/** 두 선분 사이 최단거리 */
/** 점과 선분 사이 거리 */
export const pointSegDist = (p: Vec, a: Vec, b: Vec) => Math.sqrt(pointSegDist2(p, a, b))

export function segSegDist(a: Vec, b: Vec, c: Vec, d: Vec): number {
  if (segmentsIntersect(a, b, c, d)) return 0
  return Math.sqrt(Math.min(pointSegDist2(a, c, d), pointSegDist2(b, c, d), pointSegDist2(c, a, b), pointSegDist2(d, a, b)))
}

/** 볼록 사각형 quad가 ring 안에 완전히 들어가고 경계에서 margin 이상 떨어져 있는지 */
export function quadFitsInRing(quad: Vec[], ring: Vec[], margin: number | readonly number[]): boolean {
  for (const p of quad) if (!pointInRing(p, ring)) return false
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i]
    const b = ring[i + 1]
    // 변마다 다른 이격을 주면 i번째 변(ring[i] → ring[i + 1])에 margin[i]를 쓴다
    const m = typeof margin === 'number' ? margin : margin[i]
    for (let k = 0; k < 4; k++) {
      if (segSegDist(quad[k], quad[(k + 1) % 4], a, b) < m) return false
    }
  }
  return true
}

/** 점들의 볼록 껍질(반시계, 닫지 않은 링) */
export function convexHull(pts: Vec[]): Vec[] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (p.length < 3) return p
  const cross = (o: Vec, a: Vec, b: Vec) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower: Vec[] = []
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop()
    lower.push(q)
  }
  const upper: Vec[] = []
  for (const q of [...p].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop()
    upper.push(q)
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)]
}

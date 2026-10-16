// 표고 격자: 표고 타일(Dem)을 필지 주변 규칙 격자로 한 번 읽어 둔 것.
// 함수가 아니라 숫자 배열이라 웹 워커로 넘길 수 있고, 설계 가능 영역·배수 경로·배치 토공량·등고선이 함께 쓴다.

import { LocalFrame, type Vec } from './geo'
import type { Parcel } from './parcel'
import type { Dem } from './terrain'

export interface ElevGrid {
  /** 격자 좌표계 원점(필지 중심, LocalFrame.around) */
  lon0: number
  lat0: number
  /** 첫 셀 중심의 로컬 좌표(m) */
  x0: number
  y0: number
  cell: number
  nx: number
  ny: number
  /** 행 우선(j * nx + i), 표고(m). 읽지 못한 곳은 NaN */
  z: Float32Array
}

/** 셀 수 상한. 넘으면 셀을 키운다. */
const MAX_CELLS = 90_000

export function sampleElevGrid(parcel: Parcel, dem: Dem, margin = 100, cell = 3): ElevGrid {
  const frame = LocalFrame.around(parcel.rings)
  const pts = parcel.rings.flat().map((c) => frame.toLocal(c))
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  const minX = Math.min(...xs) - margin
  const maxX = Math.max(...xs) + margin
  const minY = Math.min(...ys) - margin
  const maxY = Math.max(...ys) + margin
  let c = cell
  while (((maxX - minX) / c) * ((maxY - minY) / c) > MAX_CELLS) c *= 1.25
  const nx = Math.max(2, Math.ceil((maxX - minX) / c))
  const ny = Math.max(2, Math.ceil((maxY - minY) / c))
  const z = new Float32Array(nx * ny)
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const [lon, lat] = frame.toLonLat([minX + (i + 0.5) * c, minY + (j + 0.5) * c])
      z[j * nx + i] = dem.elevation(lon, lat)
    }
  return { lon0: frame.lon0, lat0: frame.lat0, x0: minX + c / 2, y0: minY + c / 2, cell: c, nx, ny, z }
}

export const gridFrame = (g: { lon0: number; lat0: number }) => new LocalFrame(g.lon0, g.lat0)

/** 격자 로컬 좌표(m)의 표고, 쌍선형 보간. 격자 밖이면 NaN */
export function elevAt(g: ElevGrid, x: number, y: number): number {
  const fx = (x - g.x0) / g.cell
  const fy = (y - g.y0) / g.cell
  const i = Math.floor(fx)
  const j = Math.floor(fy)
  if (i < 0 || j < 0 || i >= g.nx - 1 || j >= g.ny - 1) return NaN
  const dx = fx - i
  const dy = fy - j
  const k = j * g.nx + i
  return (
    g.z[k] * (1 - dx) * (1 - dy) + g.z[k + 1] * dx * (1 - dy) + g.z[k + g.nx] * (1 - dx) * dy + g.z[k + g.nx + 1] * dx * dy
  )
}

/** 셀 중심 로컬 좌표 */
export const cellCenter = (g: { x0: number; y0: number; cell: number }, i: number, j: number): Vec => [
  g.x0 + i * g.cell,
  g.y0 + j * g.cell,
]

/**
 * 등고선(마칭 스퀘어). 격자 로컬 좌표 선분 목록을 돌려준다. 간격(m)마다, major 배수는 계곡선으로 표시.
 * 선분은 이어 붙이지 않는다(CAD에서 그대로 보인다).
 */
export function contours(g: ElevGrid, interval: number): Array<{ z: number; seg: [Vec, Vec] }> {
  let lo = Infinity
  let hi = -Infinity
  for (const v of g.z)
    if (Number.isFinite(v)) {
      lo = Math.min(lo, v)
      hi = Math.max(hi, v)
    }
  const out: Array<{ z: number; seg: [Vec, Vec] }> = []
  if (!Number.isFinite(lo) || interval <= 0 || (hi - lo) / interval > 400) return out
  const at = (i: number, j: number) => g.z[j * g.nx + i]
  const lerp = (a: Vec, b: Vec, za: number, zb: number, level: number): Vec => {
    const t = (level - za) / (zb - za)
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
  }
  for (let level = Math.ceil(lo / interval) * interval; level <= hi; level += interval) {
    for (let j = 0; j < g.ny - 1; j++)
      for (let i = 0; i < g.nx - 1; i++) {
        const p: Vec[] = [cellCenter(g, i, j), cellCenter(g, i + 1, j), cellCenter(g, i + 1, j + 1), cellCenter(g, i, j + 1)]
        const v = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)]
        if (v.some((x) => !Number.isFinite(x))) continue
        // 꼭짓점이 등고선 높이와 같으면 살짝 올려 퇴화를 피한다.
        const w = v.map((x) => (x === level ? x + 1e-6 : x))
        const pts: Vec[] = []
        for (let e = 0; e < 4; e++) {
          const a = w[e]
          const b = w[(e + 1) % 4]
          if ((a < level) !== (b < level)) pts.push(lerp(p[e], p[(e + 1) % 4], a, b, level))
        }
        if (pts.length === 2) out.push({ z: level, seg: [pts[0], pts[1]] })
        else if (pts.length === 4) {
          out.push({ z: level, seg: [pts[0], pts[1]] })
          out.push({ z: level, seg: [pts[2], pts[3]] })
        }
      }
  }
  return out
}

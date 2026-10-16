// 설계 가능 영역: 표고 격자에서 경사 제한을 넘는 곳과 배수 경로(물길) 주변을 빼고 남은 땅.
// 배수 경로는 D8 흐름 방향(가장 가파른 이웃 셀로 흐른다고 보는 방식)으로 셀마다 위쪽에서 모여드는
// 집수면적을 누적해, 기준 면적을 넘는 셀을 물길로 본다. 공개 표고 자료(약 30m 원자료) 기준 개략값이다.

import { LocalFrame, pointInRing, type Vec } from './geo'
import { cellCenter, type ElevGrid } from './elevation'
import type { Parcel } from './parcel'

export interface BuildableOptions {
  /** 이보다 가파른 셀은 제외(%) */
  maxSlopePct: number
  /** 배수 경로를 제외할지 */
  drainage: boolean
  /** 물길로 볼 집수면적 기준(㎡) */
  drainAreaM2: number
  /** 물길 양쪽으로 비울 거리(m) */
  drainBuffer: number
}

export const DEFAULT_BUILDABLE: BuildableOptions = {
  maxSlopePct: 25,
  drainage: true,
  drainAreaM2: 5000,
  drainBuffer: 3,
}

/** 셀 값 */
export const CELL = { outside: 0, ok: 1, slope: 2, drain: 3 } as const

/** 웹 워커로 넘길 수 있는 배치 가능 격자 */
export interface BuildMask {
  lon0: number
  lat0: number
  x0: number
  y0: number
  cell: number
  nx: number
  ny: number
  data: Uint8Array
}

export interface BuildableResult {
  mask: BuildMask
  /** 격자로 센 부지 면적(㎡) */
  siteArea: number
  buildableArea: number
  slopeArea: number
  drainArea: number
  /** 지도·도면용 제외 구역(경위도 사각형, 같은 행의 이웃 셀을 합침) */
  excluded: Array<{ ring: Vec[]; kind: 'slope' | 'drain' }>
  /** 물길 선분(경위도) */
  channels: Array<[Vec, Vec]>
  options: BuildableOptions
}

const NEIGHBORS: Array<[number, number, number]> = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
]

export function computeBuildable(parcel: Parcel, g: ElevGrid, o: BuildableOptions): BuildableResult {
  const { nx, ny, cell, z } = g
  const n = nx * ny
  const frame = new LocalFrame(g.lon0, g.lat0)
  const rings = parcel.rings.map((r) => r.map((c) => frame.toLocal(c)))
  const area = cell * cell

  // 경사(%) — 중앙 차분
  const slope = new Float32Array(n).fill(NaN)
  for (let j = 1; j < ny - 1; j++)
    for (let i = 1; i < nx - 1; i++) {
      const k = j * nx + i
      const gx = (z[k + 1] - z[k - 1]) / (2 * cell)
      const gy = (z[k + nx] - z[k - nx]) / (2 * cell)
      slope[k] = 100 * Math.hypot(gx, gy)
    }

  // D8 흐름 방향과 집수면적
  const channel = new Uint8Array(n)
  const receiver = new Int32Array(n).fill(-1)
  if (o.drainage) {
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i
        if (!Number.isFinite(z[k])) continue
        let best = 1e-3 // 거의 평평하면 흐르지 않는다고 본다(m/m)
        for (const [di, dj, d] of NEIGHBORS) {
          const ii = i + di
          const jj = j + dj
          if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue
          const kk = jj * nx + ii
          const drop = (z[k] - z[kk]) / (d * cell)
          if (drop > best) {
            best = drop
            receiver[k] = kk
          }
        }
      }
    const order = Array.from({ length: n }, (_, k) => k).filter((k) => Number.isFinite(z[k]))
    order.sort((a, b) => z[b] - z[a])
    const acc = new Float64Array(n).fill(area)
    for (const k of order) if (receiver[k] >= 0) acc[receiver[k]] += acc[k]
    for (let k = 0; k < n; k++) if (acc[k] >= o.drainAreaM2) channel[k] = 1
  }

  // 물길 주변 넓히기(원형)
  const nearDrain = new Uint8Array(n)
  if (o.drainage) {
    const r = Math.max(0, Math.ceil(o.drainBuffer / cell))
    const offsets: Array<[number, number]> = []
    for (let dj = -r; dj <= r; dj++)
      for (let di = -r; di <= r; di++) if (Math.hypot(di, dj) * cell <= o.drainBuffer + cell / 2) offsets.push([di, dj])
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        if (!channel[j * nx + i]) continue
        for (const [di, dj] of offsets) {
          const ii = i + di
          const jj = j + dj
          if (ii >= 0 && jj >= 0 && ii < nx && jj < ny) nearDrain[jj * nx + ii] = 1
        }
      }
  }

  const data = new Uint8Array(n)
  let siteCells = 0
  let okCells = 0
  let slopeCells = 0
  let drainCells = 0
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i
      const c = cellCenter(g, i, j)
      if (!rings.some((r) => pointInRing(c, r))) continue
      siteCells++
      if (nearDrain[k]) {
        data[k] = CELL.drain
        drainCells++
      } else if (slope[k] > o.maxSlopePct) {
        data[k] = CELL.slope
        slopeCells++
      } else {
        data[k] = CELL.ok
        okCells++
      }
    }

  const half = cell / 2
  const excluded: BuildableResult['excluded'] = []
  for (let j = 0; j < ny; j++) {
    let i = 0
    while (i < nx) {
      const v = data[j * nx + i]
      if (v !== CELL.slope && v !== CELL.drain) {
        i++
        continue
      }
      let e = i
      while (e + 1 < nx && data[j * nx + e + 1] === v) e++
      const [x1, y] = cellCenter(g, i, j)
      const [x2] = cellCenter(g, e, j)
      const ring = (
        [
          [x1 - half, y - half],
          [x2 + half, y - half],
          [x2 + half, y + half],
          [x1 - half, y + half],
          [x1 - half, y - half],
        ] as Vec[]
      ).map((q) => frame.toLonLat(q))
      excluded.push({ ring, kind: v === CELL.slope ? 'slope' : 'drain' })
      i = e + 1
    }
  }

  // 지도에는 부지 근처(40m) 물길만 그린다.
  const xs = rings.flat().map((p) => p[0])
  const ys = rings.flat().map((p) => p[1])
  const [bx0, bx1, by0, by1] = [Math.min(...xs) - 40, Math.max(...xs) + 40, Math.min(...ys) - 40, Math.max(...ys) + 40]
  const channels: Array<[Vec, Vec]> = []
  for (let k = 0; k < n; k++) {
    if (!channel[k] || receiver[k] < 0) continue
    const a = cellCenter(g, k % nx, Math.floor(k / nx))
    if (a[0] < bx0 || a[0] > bx1 || a[1] < by0 || a[1] > by1) continue
    const b = cellCenter(g, receiver[k] % nx, Math.floor(receiver[k] / nx))
    channels.push([frame.toLonLat(a), frame.toLonLat(b)])
  }

  return {
    mask: { lon0: g.lon0, lat0: g.lat0, x0: g.x0, y0: g.y0, cell, nx, ny, data },
    siteArea: siteCells * area,
    buildableArea: okCells * area,
    slopeArea: slopeCells * area,
    drainArea: drainCells * area,
    excluded,
    channels,
    options: o,
  }
}

/** 마스크 로컬 좌표(m)가 제외 구역인지 */
export function blockedAt(m: BuildMask, x: number, y: number): boolean {
  const i = Math.round((x - m.x0) / m.cell)
  const j = Math.round((y - m.y0) / m.cell)
  if (i < 0 || j < 0 || i >= m.nx || j >= m.ny) return false
  const v = m.data[j * m.nx + i]
  return v === CELL.slope || v === CELL.drain
}

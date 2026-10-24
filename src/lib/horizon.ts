// 주변 지형(산·언덕)이 해를 가리는지 보는 지평선 높이각.
// 부지 중심에서 방위마다 반경 수 km까지 표고를 훑어, 그 방향에서 가장 높이 올라오는 지형의 높이각을 구한다.
// 해가 그 높이각보다 낮게 떠 있으면 지형 그늘에 든다. 가까운 산은 부지 안 자리마다 가리는 시각이 달라서,
// 부지를 덮는 격자 마디마다 지평선과 지반고를 따로 구해 세트마다 가장 가까운 마디 값을 쓴다.
// 표고는 terrain.ts와 같은 공개 타일(약 30 m 해상도)이다.

import { deg2rad, LocalFrame, rad2deg } from './geo'
import type { Parcel } from './parcel'
import type { SunPos } from './sun'
import { loadDemBounds } from './terrain'

export interface Horizon {
  /** 방위 간격(도) */
  step: number
  /** angles[i]: 방위 −180 + i·step(도, 남 0·서 +)에서 지형의 높이각(도). 0 아래는 0. */
  angles: number[]
  /** 훑은 반경(m) */
  radius: number
  /** 부지 중심 지반고(m) */
  siteElevation: number
  /** 부지를 덮는 격자 마디별 지평선·지반고. 없으면 부지 전체에 중심 값을 쓴다. */
  grid?: HorizonGrid
}

/** 부지 중심(LocalFrame.around) 기준 로컬 m 격자 */
export interface HorizonGrid {
  x0: number
  y0: number
  cell: number
  nx: number
  ny: number
  /** 마디 지반고(m), 행 우선(j * nx + i) */
  elev: number[]
  /** 마디 지평선 높이각(도), Horizon.angles와 같은 방위 순서 */
  angles: number[][]
}

const EARTH_R = 6_371_000
/** 대기 굴절을 넣은 지구 곡률 보정 계수 */
const REFRACTION_K = 0.13
/** 모듈 높이쯤에서 바라본다(m) */
const EYE_HEIGHT = 2

/**
 * 표고 함수로 지평선을 계산한다.
 * near(m)보다 가까운 땅은 부지 자체로 보고 건너뛴다(부지 안 경사가 지평선으로 잡히지 않게).
 */
export function computeHorizon(
  frame: LocalFrame,
  elevation: (lon: number, lat: number) => number,
  o: { radius: number; near: number; step?: number },
): Horizon {
  const step = o.step ?? 2
  const h0 = elevation(frame.lon0, frame.lat0) + EYE_HEIGHT
  const angles: number[] = []
  for (let az = -180; az < 180; az += step) {
    // 해가 방위 A에 있으면 그 방향 지도 벡터는 (−sin A, −cos A)다(shading.ts와 같은 규약).
    const a = deg2rad(az)
    const dx = -Math.sin(a)
    const dy = -Math.cos(a)
    let best = 0
    for (let d = o.near; d <= o.radius; d += Math.max(25, d * 0.015)) {
      const [lon, lat] = frame.toLonLat([dx * d, dy * d])
      const z = elevation(lon, lat)
      if (!Number.isFinite(z)) continue
      const drop = ((1 - REFRACTION_K) * d * d) / (2 * EARTH_R)
      const ang = Math.atan2(z - drop - h0, d)
      if (ang > best) best = ang
    }
    angles.push(rad2deg(best))
  }
  return { step, angles, radius: o.radius, siteElevation: h0 - EYE_HEIGHT }
}

/** 방위(rad, 남 0·서 +)에서 지형 높이각(rad), 이웃 값 선형 보간. angles를 주면 그 지평선(격자 마디)을 쓴다. */
export function horizonAt(h: Horizon, azimuthRad: number, angles = h.angles): number {
  const n = angles.length
  const f = (rad2deg(azimuthRad) + 180) / h.step
  const i = Math.floor(f)
  const t = f - i
  const a = angles[((i % n) + n) % n]
  const b = angles[(((i + 1) % n) + n) % n]
  return deg2rad(a + (b - a) * t)
}

/** 해가 산 뒤에 있는지(부지 중심, 또는 angles로 준 자리) */
export const sunBehindTerrain = (h: Horizon | null | undefined, sun: SunPos, angles?: number[]) =>
  !!h && sun.altitude > 0 && sun.altitude < horizonAt(h, sun.azimuth, angles)

/** 부지 중심 기준 로컬 (x, y) m에서 가장 가까운 격자 마디의 지평선. 격자가 없으면 중심 지평선. */
export function anglesNear(h: Horizon, x: number, y: number): number[] {
  const g = h.grid
  if (!g) return h.angles
  const i = Math.max(0, Math.min(g.nx - 1, Math.round((x - g.x0) / g.cell)))
  const j = Math.max(0, Math.min(g.ny - 1, Math.round((y - g.y0) / g.cell)))
  return g.angles[j * g.nx + i]
}

/** 부지 중심 기준 로컬 (x, y) m의 지반고가 중심보다 높은 만큼(m). 격자가 없으면 0. 격자 밖은 가장자리 값. */
export function groundOffset(h: Horizon | null | undefined, x: number, y: number): number {
  const g = h?.grid
  if (!h || !g) return 0
  const fx = Math.max(0, Math.min(g.nx - 1, (x - g.x0) / g.cell))
  const fy = Math.max(0, Math.min(g.ny - 1, (y - g.y0) / g.cell))
  const i = Math.min(g.nx - 2, Math.floor(fx))
  const j = Math.min(g.ny - 2, Math.floor(fy))
  if (i < 0 || j < 0) return g.elev[0] - h.siteElevation
  const tx = fx - i
  const ty = fy - j
  const e = (a: number, b: number) => g.elev[b * g.nx + a]
  const z = e(i, j) * (1 - tx) * (1 - ty) + e(i + 1, j) * tx * (1 - ty) + e(i, j + 1) * (1 - tx) * ty + e(i + 1, j + 1) * tx * ty
  return z - h.siteElevation
}

/**
 * 지형이 가려 잃는 하늘 산란광 비율(등방성 하늘). 높이각 h인 지평선 아래 하늘은 sin²h만큼이다.
 * 격자가 있으면 마디 평균.
 */
export function skyLoss(h: Horizon | null | undefined): number {
  if (!h) return 0
  const lists = h.grid?.angles ?? [h.angles]
  let s = 0
  for (const a of lists) s += a.reduce((t, x) => t + Math.sin(deg2rad(x)) ** 2, 0) / a.length
  return s / lists.length
}

/** 격자 마디 지평선에서 건너뛰는 가까운 땅(m). 표고 해상도(약 30 m)보다 가까운 땅은 마디 자체의 경사로 본다. */
const GRID_NEAR = 40
/** 격자 마디 수 상한(한 변) */
const GRID_MAX = 7

/** 부지를 덮는 격자 마디마다 지평선과 지반고를 구한다. */
export function computeHorizonGrid(parcel: Parcel, frame: LocalFrame, elevation: (lon: number, lat: number) => number, radius: number): HorizonGrid {
  const pts = parcel.rings.flat().map((c) => frame.toLocal(c))
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  const cell = Math.max(30, Math.max(x1 - x0, y1 - y0) / (GRID_MAX - 1))
  const nx = Math.max(2, Math.ceil((x1 - x0) / cell) + 1)
  const ny = Math.max(2, Math.ceil((y1 - y0) / cell) + 1)
  const gx0 = (x0 + x1) / 2 - ((nx - 1) * cell) / 2
  const gy0 = (y0 + y1) / 2 - ((ny - 1) * cell) / 2
  const elev: number[] = []
  const angles: number[][] = []
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const [lon, lat] = frame.toLonLat([gx0 + i * cell, gy0 + j * cell])
      const h = computeHorizon(new LocalFrame(lon, lat), elevation, { radius, near: GRID_NEAR })
      elev.push(h.siteElevation)
      angles.push(h.angles)
    }
  return { x0: gx0, y0: gy0, cell, nx, ny, elev, angles }
}

/** 지형 그림자 지도를 그리려고 받아 둔 표고(부지 중심 기준 반경 radius m) */
export interface SiteDem {
  frame: LocalFrame
  radius: number
  elevation: (lon: number, lat: number) => number
}

/** 부지 주변 radius(m)의 표고를 받아 지평선을 만든다. 표고는 지형 그림자 지도용으로 같이 돌려준다. */
export async function loadHorizon(parcel: Parcel, radius = 5000): Promise<{ horizon: Horizon; dem: SiteDem }> {
  const frame = LocalFrame.around(parcel.rings)
  const reach = Math.max(...parcel.rings.flat().map((c) => Math.hypot(...frame.toLocal(c))))
  const sw = frame.toLonLat([-radius, -radius])
  const ne = frame.toLonLat([radius, radius])
  // 반경 5 km면 줌 12(픽셀 약 30 m, 원자료 해상도와 비슷)로 타일 4~9장이다.
  const dem = await loadDemBounds(sw, ne, 12)
  const horizon = computeHorizon(frame, dem.elevation, { radius, near: reach + 30 })
  horizon.grid = computeHorizonGrid(parcel, frame, dem.elevation, radius)
  return { horizon, dem: { frame, radius, elevation: dem.elevation } }
}

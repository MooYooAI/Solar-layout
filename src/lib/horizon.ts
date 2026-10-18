// 주변 지형(산·언덕)이 해를 가리는지 보는 지평선 높이각.
// 부지 중심에서 방위마다 반경 수 km까지 표고를 훑어, 그 방향에서 가장 높이 올라오는 지형의 높이각을 구한다.
// 해가 그 높이각보다 낮게 떠 있으면 부지 전체가 지형 그늘에 든다고 본다(먼 산은 부지 크기보다 훨씬 멀어서
// 부지 안 위치에 따른 차이는 무시한다). 표고는 terrain.ts와 같은 공개 타일(약 30 m 해상도)이다.

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

/** 방위(rad, 남 0·서 +)에서 지형 높이각(rad), 이웃 값 선형 보간 */
export function horizonAt(h: Horizon, azimuthRad: number): number {
  const n = h.angles.length
  const f = (rad2deg(azimuthRad) + 180) / h.step
  const i = Math.floor(f)
  const t = f - i
  const a = h.angles[((i % n) + n) % n]
  const b = h.angles[(((i + 1) % n) + n) % n]
  return deg2rad(a + (b - a) * t)
}

/** 해가 산 뒤에 있는지 */
export const sunBehindTerrain = (h: Horizon | null | undefined, sun: SunPos) =>
  !!h && sun.altitude > 0 && sun.altitude < horizonAt(h, sun.azimuth)

/** 부지 주변 radius(m)의 표고를 받아 지평선을 만든다. */
export async function loadHorizon(parcel: Parcel, radius = 5000): Promise<Horizon> {
  const frame = LocalFrame.around(parcel.rings)
  const reach = Math.max(...parcel.rings.flat().map((c) => Math.hypot(...frame.toLocal(c))))
  const sw = frame.toLonLat([-radius, -radius])
  const ne = frame.toLonLat([radius, radius])
  // 반경 5 km면 줌 12(픽셀 약 30 m, 원자료 해상도와 비슷)로 타일 4~9장이다.
  const dem = await loadDemBounds(sw, ne, 12)
  return computeHorizon(frame, dem.elevation, { radius, near: reach + 30 })
}

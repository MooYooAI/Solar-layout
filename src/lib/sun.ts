import { deg2rad } from './geo'

/** 태양 적위(도). n = 1월 1일부터의 날짜 순번(1..365). Cooper 식. */
export function declination(n: number): number {
  return 23.45 * Math.sin(deg2rad((360 * (284 + n)) / 365))
}

export const DAY_OF_YEAR = {
  winterSolstice: 355,
  springEquinox: 80,
  summerSolstice: 172,
  autumnEquinox: 266,
}

export interface SunPos {
  /** 고도각(rad) */
  altitude: number
  /** 방위각(rad), 남쪽 0, 서쪽 +, 동쪽 − */
  azimuth: number
}

/** 위도와 적위, 시각(태양시, 12 = 남중)으로 태양 위치 계산 */
export function sunPosition(latDeg: number, declDeg: number, solarHour: number): SunPos {
  const lat = deg2rad(latDeg)
  const dec = deg2rad(declDeg)
  const h = deg2rad(15 * (solarHour - 12))
  const sinAlt = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(h)
  const altitude = Math.asin(sinAlt)
  const cosAz = (sinAlt * Math.sin(lat) - Math.sin(dec)) / (Math.cos(altitude) * Math.cos(lat))
  const az = Math.acos(Math.max(-1, Math.min(1, cosAz)))
  return { altitude, azimuth: h < 0 ? -az : az }
}

/**
 * 앞 열 세트가 뒤 열에 그림자를 드리우지 않도록 필요한 열 간 이격거리(m).
 * 동지 fromHour~toHour(태양시) 동안 그림자가 닿지 않는 최소 거리.
 * height: 세트 상단의 지면 대비 높이, arrayAzimuthDeg: 세트가 바라보는 방향(남 0, 서 +).
 */
export function rowSpacingForNoShade(
  latDeg: number,
  height: number,
  arrayAzimuthDeg = 0,
  fromHour = 9,
  toHour = 15,
): number {
  const dec = declination(DAY_OF_YEAR.winterSolstice)
  let worst = 0
  for (let t = fromHour; t <= toHour + 1e-9; t += 0.25) {
    const { altitude, azimuth } = sunPosition(latDeg, dec, t)
    if (altitude <= 0) continue
    const shadow = height / Math.tan(altitude)
    worst = Math.max(worst, shadow * Math.cos(azimuth - deg2rad(arrayAzimuthDeg)))
  }
  return worst
}

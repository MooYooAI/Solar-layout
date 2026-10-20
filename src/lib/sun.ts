import { deg2rad } from './geo'

/**
 * 태양 적위(도). n = 1월 1일부터의 날짜 순번(1..365). Spencer 식.
 * 예전 Cooper 식은 춘분·추분 무렵 1° 가까이 틀려 일출·일몰이 2~3분 어긋났다(Spencer는 0.1° 안쪽).
 */
export function declination(n: number): number {
  const g = (2 * Math.PI * (n - 1)) / 365
  const rad =
    0.006918 -
    0.399912 * Math.cos(g) +
    0.070257 * Math.sin(g) -
    0.006758 * Math.cos(2 * g) +
    0.000907 * Math.sin(2 * g) -
    0.002697 * Math.cos(3 * g) +
    0.00148 * Math.sin(3 * g)
  return (rad * 180) / Math.PI
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

/** 균시차(분), Spencer 식 */
export function equationOfTime(n: number): number {
  const b = deg2rad((360 / 365) * (n - 81))
  return 9.87 * Math.sin(2 * b) - 7.53 * Math.cos(b) - 1.5 * Math.sin(b)
}

/** 일출·일몰 높이각: 대기 굴절(34′)과 해 반지름(16′)만큼 해가 지평선 아래 있을 때 뜨고 진다(천문연 기준과 같다). */
const RISE_ALT = deg2rad(-0.833)

/** 해가 뜨고 지는 태양시(시). 백야·극야면 null. 계산은 고도 0° 기준을 쓰고, 이 값은 화면 표시용이다. */
export function sunriseSunsetSolar(latDeg: number, declDeg: number): { rise: number; set: number } | null {
  const lat = deg2rad(latDeg)
  const dec = deg2rad(declDeg)
  const c = (Math.sin(RISE_ALT) - Math.sin(lat) * Math.sin(dec)) / (Math.cos(lat) * Math.cos(dec))
  if (c <= -1 || c >= 1) return null
  const ws = (Math.acos(c) * 180) / Math.PI / 15
  return { rise: 12 - ws, set: 12 + ws }
}

/** 한국 표준시(KST, 동경 135°) → 태양시(시) */
export function kstToSolar(kstHour: number, lonDeg: number, n: number): number {
  return kstHour + (4 * (lonDeg - 135) + equationOfTime(n)) / 60
}

/** 태양시 → 한국 표준시(시) */
export function solarToKst(solarHour: number, lonDeg: number, n: number): number {
  return solarHour - (4 * (lonDeg - 135) + equationOfTime(n)) / 60
}

export function dayOfYear(month: number, day: number): number {
  const cum = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]
  return cum[month - 1] + day
}

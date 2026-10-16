// 경위도(GRS80) → 국내 TM 평면좌표(Korea 2000 / 2010 원점, m). CAD 도면이 실제 지적 좌표에 바로 겹치도록 쓴다.
// 서부·중부·동부·동해 원점 중 경도에 맞는 원점을 고른다. 가로(E)·세로(N) 가산값은 200,000 / 600,000 m.

export interface TmZone {
  epsg: number
  name: string
  lon0: number
}

export const TM_ZONES: TmZone[] = [
  { epsg: 5185, name: '서부원점', lon0: 125 },
  { epsg: 5186, name: '중부원점', lon0: 127 },
  { epsg: 5187, name: '동부원점', lon0: 129 },
  { epsg: 5188, name: '동해원점', lon0: 131 },
]

export function zoneFor(lon: number): TmZone {
  if (lon < 126) return TM_ZONES[0]
  if (lon < 128) return TM_ZONES[1]
  if (lon < 130) return TM_ZONES[2]
  return TM_ZONES[3]
}

const A = 6378137
const F = 1 / 298.257222101
const E2 = 2 * F - F * F
const EP2 = E2 / (1 - E2)
const LAT0 = (38 * Math.PI) / 180
const K0 = 1
const FE = 200000
const FN = 600000

function meridian(phi: number): number {
  const e4 = E2 * E2
  const e6 = e4 * E2
  return (
    A *
    ((1 - E2 / 4 - (3 * e4) / 64 - (5 * e6) / 256) * phi -
      ((3 * E2) / 8 + (3 * e4) / 32 + (45 * e6) / 1024) * Math.sin(2 * phi) +
      ((15 * e4) / 256 + (45 * e6) / 1024) * Math.sin(4 * phi) -
      ((35 * e6) / 3072) * Math.sin(6 * phi))
  )
}

const M0 = meridian(LAT0)

/** [lon, lat] → [x(동), y(북)] m */
export function toTm([lon, lat]: number[], zone: TmZone): [number, number] {
  const phi = (lat * Math.PI) / 180
  const dl = ((lon - zone.lon0) * Math.PI) / 180
  const sin = Math.sin(phi)
  const cos = Math.cos(phi)
  const tan = Math.tan(phi)
  const N = A / Math.sqrt(1 - E2 * sin * sin)
  const T = tan * tan
  const C = EP2 * cos * cos
  const a = dl * cos
  const x = FE + K0 * N * (a + ((1 - T + C) * a ** 3) / 6 + ((5 - 18 * T + T * T + 72 * C - 58 * EP2) * a ** 5) / 120)
  const y =
    FN +
    K0 *
      (meridian(phi) -
        M0 +
        N * tan * (a ** 2 / 2 + ((5 - T + 9 * C + 4 * C * C) * a ** 4) / 24 + ((61 - 58 * T + T * T + 600 * C - 330 * EP2) * a ** 6) / 720))
  return [x, y]
}

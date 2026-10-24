// 필지 안 건물: 지붕 배치(건물)와 지상 배치에서 비울 건물 자리·그늘(복합)에 쓴다.
// 필지 밖 이웃 건물은 음영 장애물로 넣는다.
// 건물 도형은 VWorld 도로명주소 건물, 높이는 지상 층수로 어림한다.

import { pointInRing, type Vec } from './geo'
import { interiorPoint, ringsArea, type Parcel } from './parcel'
import type { BuildingFeature } from './vworld'

/** 층 높이 어림값(m) */
export const FLOOR_HEIGHT = 3.5
/** 층수를 모를 때 보는 층수 */
const DEFAULT_FLOORS = 2

export interface Building {
  id: string
  name: string
  floors: number
  /** 지붕 높이 어림값(m) */
  height: number
  /** 외곽 링(경위도, 닫힌 링) */
  rings: number[][][]
  /** 지붕 면적(㎡) */
  area: number
}

/** 경위도 사각형 [서, 남, 동, 북] */
export function ringsBox(rings: number[][][]): [number, number, number, number] {
  const pts = rings.flat()
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}

function toBuildings(features: BuildingFeature[]): Building[] {
  return features
    .map((f, i) => {
      const g = f.geometry
      const polys = (g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates]) as number[][][][]
      const rings = polys.map((p) => p[0])
      const floors = Number(f.properties.gro_flo_co) || DEFAULT_FLOORS
      const name = f.properties.buld_nm || f.properties.buld_nm_dc || `건물 ${i + 1}`
      return { id: `bld-${i}-${rings[0]?.[0]?.join(',')}`, name, floors, height: floors * FLOOR_HEIGHT, rings, area: ringsArea(rings) }
    })
    .filter((b) => b.rings.length && b.area > 1)
}

const inside = (parcel: Parcel) => (b: Building) => parcel.rings.some((r) => pointInRing(interiorPoint(b.rings), r as Vec[]))

/** 가운데 점이 필지 안에 있는 건물만, 넓은 것부터 */
export function buildingsOnParcel(features: BuildingFeature[], parcel: Parcel): Building[] {
  return toBuildings(features)
    .filter(inside(parcel))
    .sort((a, b) => b.area - a.area)
}

/** 필지 밖 이웃 건물(그림자를 드리울 수 있는 주변 건물), 높은 것부터 */
export function buildingsAround(features: BuildingFeature[], parcel: Parcel): Building[] {
  const inP = inside(parcel)
  return toBuildings(features)
    .filter((b) => !inP(b))
    .sort((a, b) => b.height - a.height)
}

/** 경위도 사각형을 사방으로 m만큼 넓힌다 */
export function growBox([w, s, e, n]: [number, number, number, number], m: number): [number, number, number, number] {
  const dLat = m / 111_320
  const dLon = m / (111_320 * Math.cos((((s + n) / 2) * Math.PI) / 180))
  return [w - dLon, s - dLat, e + dLon, n + dLat]
}

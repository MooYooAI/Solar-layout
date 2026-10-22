// 필지 안 건물: 지붕 배치(건물)와 지상 배치에서 비울 건물 자리·그늘(복합)에 쓴다.
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

/** 가운데 점이 필지 안에 있는 건물만, 넓은 것부터 */
export function buildingsOnParcel(features: BuildingFeature[], parcel: Parcel): Building[] {
  const inParcel = (p: Vec) => parcel.rings.some((r) => pointInRing(p, r as Vec[]))
  return features
    .map((f, i) => {
      const g = f.geometry
      const polys = (g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates]) as number[][][][]
      const rings = polys.map((p) => p[0])
      const floors = Number(f.properties.gro_flo_co) || DEFAULT_FLOORS
      const name = f.properties.buld_nm || f.properties.buld_nm_dc || `건물 ${i + 1}`
      return { id: `bld-${i}-${rings[0]?.[0]?.join(',')}`, name, floors, height: floors * FLOOR_HEIGHT, rings, area: ringsArea(rings) }
    })
    .filter((b) => b.rings.length && b.area > 1 && inParcel(interiorPoint(b.rings)))
    .sort((a, b) => b.area - a.area)
}

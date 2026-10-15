import { getArea } from 'ol/sphere'
import Polygon from 'ol/geom/Polygon'
import MultiPolygon from 'ol/geom/MultiPolygon'
import type { ParcelFeature } from './vworld'

/** 앱 전체에서 쓰는 필지 표현. 좌표는 EPSG:4326 [lon, lat]. */
export interface Parcel {
  pnu?: string
  address: string
  jiga?: number
  jigaYear?: string
  landCategory?: string
  /** 외곽 링 목록 (멀티폴리곤이면 여러 개). 각 링은 닫힌 좌표 배열. */
  rings: number[][][]
  source: 'vworld' | 'manual'
}

export function parcelFromFeature(f: ParcelFeature): Parcel {
  const g = f.geometry
  const polys = (g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates]) as number[][][][]
  return {
    pnu: f.properties.pnu,
    address: f.properties.addr,
    jiga: f.properties.jiga ? Number(f.properties.jiga) : undefined,
    jigaYear: f.properties.gosi_year,
    landCategory: landCategory(f.properties.jibun),
    rings: polys.map((p) => p[0]),
    source: 'vworld',
  }
}

export function parcelGeometry(p: Parcel): MultiPolygon {
  return new MultiPolygon(p.rings.map((r) => [r]))
}

/** 면적(㎡), 측지 계산 */
export function parcelArea(p: Parcel): number {
  return p.rings.reduce(
    (sum, r) => sum + getArea(new Polygon([r]), { projection: 'EPSG:4326' }),
    0,
  )
}

/** 지목은 PNU에 없으므로 지번 문자열 끝의 한글(예: "123-4답")에서 꺼낸다. */
export function landCategory(jibun: string | undefined): string | undefined {
  return jibun?.trim().match(/([가-힣]+)$/)?.[1]
}

export const SQM_PER_PYEONG = 3.305785

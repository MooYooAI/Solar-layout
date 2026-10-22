import { getArea } from 'ol/sphere'
import Polygon from 'ol/geom/Polygon'
import MultiPolygon from 'ol/geom/MultiPolygon'
import polygonClipping, { type MultiPolygon as PcMultiPolygon } from 'polygon-clipping'
import type { ParcelFeature } from './vworld'

/** 부지를 이루는 지번 하나 */
export interface Lot {
  pnu: string
  address: string
  jiga?: number
  jigaYear?: string
  landCategory?: string
  rings: number[][][]
  area: number
}

/** 설치 장소: 땅 위(지상), 건물 지붕, 둘 다 */
export type SiteKind = 'land' | 'building' | 'mixed'
export const SITE_KINDS: Array<[SiteKind, string, string, string]> = [
  ['land', '토지', '지상', '필지 땅 위에 지상 구조물로 설치합니다.'],
  ['building', '건물', '지붕·옥상', '지붕 고정식(앵커·블록)으로 놓고 지붕 가장자리에서 1.5 m 띄웁니다. 토공·전기실 자리는 빼고, 필지 안 건물을 불러와 지붕을 고르거나 영역 직접 그리기로 지붕 윤곽을 그리세요.'],
  ['mixed', '복합', '지상+지붕', '땅에는 지상 구조물로 놓고, 건물 자리는 비우고 건물 그림자를 넣어 배치합니다. 지붕은 설치 장소를 건물로 바꿔 따로 설계합니다.'],
]
export const siteKindLabel = (k: SiteKind) => SITE_KINDS.find(([v]) => v === k)![1]

/** 앱 전체에서 쓰는 필지(부지) 표현. 좌표는 EPSG:4326 [lon, lat]. */
export interface Parcel {
  pnu?: string
  address: string
  jiga?: number
  jigaYear?: string
  landCategory?: string
  /** 외곽 링 목록 (멀티폴리곤이면 여러 개). 각 링은 닫힌 좌표 배열. 여러 지번이면 맞닿은 경계를 없앤 합집합. */
  rings: number[][][]
  /** 여러 지번을 묶은 부지면 각 지번 */
  lots?: Lot[]
  source: 'vworld' | 'manual'
}

export function lotFromFeature(f: ParcelFeature): Lot {
  const g = f.geometry
  const polys = (g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates]) as number[][][][]
  const rings = polys.map((p) => p[0])
  return {
    pnu: f.properties.pnu,
    address: f.properties.addr,
    jiga: f.properties.jiga ? Number(f.properties.jiga) : undefined,
    jigaYear: f.properties.gosi_year,
    landCategory: landCategory(f.properties.jibun),
    rings,
    area: ringsArea(rings),
  }
}

export function parcelFromFeature(f: ParcelFeature): Parcel {
  return parcelFromLots([lotFromFeature(f)])!
}

/** 지번 여러 개를 한 부지로 묶는다. 대표 지목·공시지가는 가장 넓은 지번 것을 쓴다. */
export function parcelFromLots(lots: Lot[]): Parcel | null {
  if (!lots.length) return null
  const main = lots.reduce((a, b) => (b.area > a.area ? b : a))
  const rings = lots.length === 1 ? lots[0].rings : unionRings(lots.flatMap((l) => l.rings))
  return {
    pnu: lots.length === 1 ? main.pnu : undefined,
    address: lots.length === 1 ? main.address : `${lots[0].address} 외 ${lots.length - 1}필지`,
    jiga: main.jiga,
    jigaYear: main.jigaYear,
    landCategory: main.landCategory,
    rings,
    lots,
    source: 'vworld',
  }
}

/** 맞닿은 지번 경계를 지운 외곽 링들. 구멍은 버린다(배치 영역은 외곽만 본다). */
export function unionRings(rings: number[][][]): number[][][] {
  const polys = rings.map((r) => [r as [number, number][]])
  const [first, ...rest] = polys
  // 지적 좌표가 미세하게 어긋나 생기는 실오라기 틈은 남을 수 있지만 배치에는 영향이 작다.
  const merged: PcMultiPolygon = polygonClipping.union(first, ...rest)
  return merged.map((poly) => poly[0])
}

/** 링 목록 중 가장 넓은 링 안쪽의 한 점(오목해도 안쪽). 용도지역 조회용. */
export function interiorPoint(rings: number[][][]): [number, number] {
  const polys = rings.map((r) => new Polygon([r]))
  const big = polys.reduce((a, b) => (b.getArea() > a.getArea() ? b : a))
  const [lon, lat] = big.getInteriorPoint().getCoordinates()
  return [lon, lat]
}

export function parcelGeometry(p: Parcel): MultiPolygon {
  return new MultiPolygon(p.rings.map((r) => [r]))
}

/** 면적(㎡), 측지 계산 */
export function parcelArea(p: Parcel): number {
  return ringsArea(p.rings)
}

export function ringsArea(rings: number[][][]): number {
  return rings.reduce(
    (sum, r) => sum + getArea(new Polygon([r]), { projection: 'EPSG:4326' }),
    0,
  )
}

/** 지목은 PNU에 없으므로 지번 문자열 끝의 한글(예: "123-4답")에서 꺼낸다. */
export function landCategory(jibun: string | undefined): string | undefined {
  return jibun?.trim().match(/([가-힣]+)$/)?.[1]
}

export const SQM_PER_PYEONG = 3.305785

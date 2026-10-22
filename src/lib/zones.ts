// 구역별 배치와 빈자리 채우기.
// 꺾인 띠 모양처럼 경계 방향이 여러 개인 필지는 한 방향 격자로만 채우면 비스듬한 경계를 따라 빈 땅이 남는다. 필지 경계 가운데 남쪽을 보는
// 긴 변마다 그 변에 나란한 방위각을 "구역"으로 두고, 필지의 각 자리를 가장 가까운 변의 구역에 넣어 구역마다 그
// 방위각으로 채운다. 채운 뒤 남은 자리는 다른 방위각 세트로 한 번 더 채운다.
// 경사각과 모듈·세트 구성은 모든 구역이 같다.

import type { BuildMask } from './buildable'
import { LocalFrame, pointInRing, rad2deg, type Vec } from './geo'
import { fillLayout, Occupancy, setGeometry, type LayoutParams, type ModuleSet } from './layout'
import type { Parcel } from './parcel'

export type ZoneMode = 'edge' | 'half' | 'fill'

/** 이 각도 넘게 동서로 돈 방향은 쓰지 않는다(발전량 손실이 커서). */
const MAX_ZONE_AZIMUTH = 30
/** 구역 방위각을 이 단위로 반올림해 비슷한 변을 한 구역으로 묶는다. */
const AZIMUTH_STEP = 5

interface Edge {
  a: Vec
  b: Vec
  azimuth: number
}

/** 세트 폭 방향이 변과 나란할 때 세트가 바라보는 방위각(남 0, 서 +), −90~90 */
function edgeAzimuth(a: Vec, b: Vec): number {
  let az = -rad2deg(Math.atan2(b[1] - a[1], b[0] - a[0]))
  while (az > 90) az -= 180
  while (az <= -90) az += 180
  return az
}

/** 구역의 기준이 될 경계 변: 세트 폭보다 길고 남쪽 ±35° 안을 보는 변 */
function zoneEdges(parcel: Parcel, minLen: number): Edge[] {
  const frame = LocalFrame.around(parcel.rings)
  const out: Edge[] = []
  for (const ring of parcel.rings) {
    const pts = ring.map((c) => frame.toLocal(c))
    for (let i = 0; i < pts.length - 1; i++) {
      const [a, b] = [pts[i], pts[i + 1]]
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) < minLen) continue
      const az = edgeAzimuth(a, b)
      if (Math.abs(az) > MAX_ZONE_AZIMUTH + 5) continue
      const clamped = Math.max(-MAX_ZONE_AZIMUTH, Math.min(MAX_ZONE_AZIMUTH, az))
      out.push({ a, b, azimuth: Math.round(clamped / AZIMUTH_STEP) * AZIMUTH_STEP })
    }
  }
  return out
}

function pointSegDist([px, py]: Vec, [ax, ay]: Vec, [bx, by]: Vec): number {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0
  return Math.hypot(ax + t * dx - px, ay + t * dy - py)
}

/** 필지의 구역 방위각 목록과, 한 점이 어느 구역(방위각)에 드는지 알려 주는 함수 */
export function parcelZones(parcel: Parcel, p: LayoutParams): { azimuths: number[]; zoneOf: (pt: Vec) => number } | null {
  const g = setGeometry(p)
  const edges = zoneEdges(parcel, Math.max(12, g.width))
  if (!edges.length) return null
  const azimuths = [...new Set(edges.map((e) => e.azimuth))]
  const zoneOf = (pt: Vec) => {
    let best = edges[0]
    let bestD = Infinity
    for (const e of edges) {
      const d = pointSegDist(pt, e.a, e.b)
      if (d < bestD) {
        bestD = d
        best = e
      }
    }
    return best.azimuth
  }
  return { azimuths, zoneOf }
}

export interface ZonedOptions {
  mode: ZoneMode
  rowOffset?: number
  mask?: BuildMask | null
  keepOut?: number[][][]
}

/**
 * 구역별 배치. 세트를 하나도 못 놓거나 구역이 하나뿐이라 한 방향 배치와 같으면 null.
 * edge: 구역마다 경계 변에 나란한 방위각. half: 그 방위각과 기준 방위각의 중간(발전량 손실을 줄인 절충안).
 * fill: 기준 방위각으로 채운 뒤 남은 자리만 다른 방위각으로 채운다.
 * 어느 방식이든 마지막에 남은 자리를 구역 방위각 세트로 한 번 더 채운다.
 */
export function zonedLayout(parcel: Parcel, base: LayoutParams, o: ZonedOptions): ModuleSet[] | null {
  const zones = parcelZones(parcel, base)
  if (!zones) return null
  const zoneAz = (az: number) => (o.mode === 'half' ? Math.round((az + base.azimuth) / 2 / AZIMUTH_STEP) * AZIMUTH_STEP : az)
  const occupied = new Occupancy()
  const sets: ModuleSet[] = []
  const place = (azimuth: number, accept?: (q: Vec[]) => boolean, rowOffset = 0) => {
    // 열 이격거리는 기준과 같게 둔다. 돌린 구역에 생기는 아침·저녁 그늘은 발전량 계산이 잰다.
    const params = { ...base, azimuth }
    sets.push(...fillLayout(parcel, params, { rowOffset, mask: o.mask, accept, occupied, keepOut: o.keepOut }))
  }
  const centre = (q: Vec[]): Vec => [(q[0][0] + q[2][0]) / 2, (q[0][1] + q[2][1]) / 2]

  if (o.mode === 'fill') place(base.azimuth, undefined, o.rowOffset)
  else {
    const distinct = new Set(zones.azimuths.map(zoneAz))
    if (distinct.size < 2 && distinct.has(base.azimuth)) return null
    // 큰 구역부터 채워야 작은 구역이 큰 구역 자리를 먼저 차지하지 않는다.
    const order = zoneOrder(parcel, zones)
    for (const az of order) place(zoneAz(az), (q) => zones.zoneOf(centre(q)) === az, o.rowOffset)
  }
  const before = sets.length
  // 남은 자리 채우기: 기준 방향과 구역 방향을 모두 시도한다.
  for (const az of new Set([base.azimuth, ...zones.azimuths.map(zoneAz), ...zones.azimuths])) place(az)
  if (!sets.length) return null
  if (o.mode === 'fill' && sets.length === before) return null
  return sets
}

/** 구역을 넓은 순서로. 필지를 2m 간격으로 찍어 구역마다 점 수를 센다. */
function zoneOrder(parcel: Parcel, zones: { azimuths: number[]; zoneOf: (pt: Vec) => number }): number[] {
  const frame = LocalFrame.around(parcel.rings)
  const count = new Map(zones.azimuths.map((a) => [a, 0]))
  for (const ring of parcel.rings) {
    const pts = ring.map((c) => frame.toLocal(c))
    const xs = pts.map((v) => v[0])
    const ys = pts.map((v) => v[1])
    const step = Math.max(2, Math.sqrt(((Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys))) / 4000))
    for (let x = Math.min(...xs); x <= Math.max(...xs); x += step)
      for (let y = Math.min(...ys); y <= Math.max(...ys); y += step) {
        if (!pointInRing([x, y], pts)) continue
        const z = zones.zoneOf([x, y])
        count.set(z, (count.get(z) ?? 0) + 1)
      }
  }
  return [...zones.azimuths].sort((a, b) => (count.get(b) ?? 0) - (count.get(a) ?? 0))
}

/** 배치에 쓰인 방위각별 세트 수(많은 순) */
export function azimuthMix(sets: ModuleSet[]): Array<{ azimuth: number; count: number }> {
  const m = new Map<number, number>()
  for (const s of sets) m.set(s.azimuth, (m.get(s.azimuth) ?? 0) + 1)
  return [...m].map(([azimuth, count]) => ({ azimuth, count })).sort((a, b) => b.count - a.count)
}

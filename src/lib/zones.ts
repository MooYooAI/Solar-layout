// 구역별 배치와 빈자리 채우기.
// 꺾인 띠 모양처럼 경계 방향이 여러 개인 필지는 한 방향 격자로만 채우면 비스듬한 경계를 따라 빈 땅이 남는다. 필지 경계 가운데 남쪽을 보는
// 긴 변마다 그 변에 나란한 방위각을 "구역"으로 두고, 필지의 각 자리를 가장 가까운 변의 구역에 넣어 구역마다 그
// 방위각으로 채운다. 채운 뒤 남은 자리는 다른 방위각 세트로 한 번 더 채운다.
// 경사각과 모듈·세트 구성은 모든 구역이 같다.

import type { BuildMask } from './buildable'
import { LocalFrame, pointInRing, rad2deg, type Vec } from './geo'
import { autoLayout, fillLayout, Occupancy, setGeometry, totalModules, type LayoutParams, type ModuleSet } from './layout'
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
  // 세트 자리마다 불려서 빨라야 하므로, 필지를 감싼 사각형을 잘게 나눠 칸마다 가장 가까운 변의 구역을 미리 정해 둔다.
  // 칸 크기는 0.5 m부터, 큰 필지는 칸이 20만 개를 넘지 않게 키운다. 구역 경계가 칸 크기만큼 어긋나는 것은 배치에 영향이 거의 없다.
  const pts = edges.flatMap((e) => [e.a, e.b])
  const frame = LocalFrame.around(parcel.rings)
  for (const ring of parcel.rings) for (const c of ring) pts.push(frame.toLocal(c))
  const xs = pts.map((v) => v[0])
  const ys = pts.map((v) => v[1])
  const [x0, y0] = [Math.min(...xs), Math.min(...ys)]
  const [w, h] = [Math.max(...xs) - x0, Math.max(...ys) - y0]
  const cell = Math.max(0.5, Math.sqrt((w * h) / 200000))
  const nx = Math.ceil(w / cell) + 1
  const ny = Math.ceil(h / cell) + 1
  const nearest = (pt: Vec, hint: number) => {
    let best = hint
    let bestD = pointSegDist(pt, edges[hint].a, edges[hint].b)
    for (let i = 0; i < edges.length; i++) {
      if (i === hint) continue
      const d = pointSegDist(pt, edges[i].a, edges[i].b)
      if (d < bestD || (d === bestD && i < best)) {
        bestD = d
        best = i
      }
    }
    return best
  }
  const zoneAt = new Uint16Array(nx * ny)
  let hint = 0
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) zoneAt[j * nx + i] = hint = nearest([x0 + (i + 0.5) * cell, y0 + (j + 0.5) * cell], hint)
  const zoneOf = (pt: Vec) => {
    const i = Math.min(nx - 1, Math.max(0, Math.floor((pt[0] - x0) / cell)))
    const j = Math.min(ny - 1, Math.max(0, Math.floor((pt[1] - y0) / cell)))
    return edges[zoneAt[j * nx + i]].azimuth
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
  const z = zonedPlanner(parcel, base, o)
  if (!z) return null
  const main = z.main(o.rowOffset ?? 0)
  return z.finish(main)
}

/** 구역별 배치를 첫 열 위치(main)와 남은 자리 채우기(finish) 두 단계로 나눈 것. 구역이 하나뿐이면 null. */
function zonedPlanner(parcel: Parcel, base: LayoutParams, o: Omit<ZonedOptions, 'rowOffset'>) {
  const zones = parcelZones(parcel, base)
  if (!zones) return null
  const zoneAz = (az: number) => (o.mode === 'half' ? Math.round((az + base.azimuth) / 2 / AZIMUTH_STEP) * AZIMUTH_STEP : az)
  if (o.mode !== 'fill') {
    const distinct = new Set(zones.azimuths.map(zoneAz))
    if (distinct.size < 2 && distinct.has(base.azimuth)) return null
  }
  // 큰 구역부터 채워야 작은 구역이 큰 구역 자리를 먼저 차지하지 않는다.
  const order = o.mode === 'fill' ? [] : zoneOrder(parcel, zones)
  const centre = (q: Vec[]): Vec => [(q[0][0] + q[2][0]) / 2, (q[0][1] + q[2][1]) / 2]
  type Placed = { sets: ModuleSet[]; occupied: Occupancy; rowOffset: number }
  const place = (into: Placed, azimuth: number, accept?: (q: Vec[]) => boolean, rowOffset = 0) => {
    // 열 이격거리는 기준과 같게 둔다. 돌린 구역에 생기는 아침·저녁 그늘은 발전량 계산이 잰다.
    const params = { ...base, azimuth }
    into.sets.push(...fillLayout(parcel, params, { rowOffset, mask: o.mask, accept, occupied: into.occupied, keepOut: o.keepOut }))
  }
  const main = (rowOffset: number): Placed => {
    const r: Placed = { sets: [], occupied: new Occupancy(), rowOffset }
    if (o.mode === 'fill') place(r, base.azimuth, undefined, rowOffset)
    else for (const az of order) place(r, zoneAz(az), (q) => zones.zoneOf(centre(q)) === az, rowOffset)
    return r
  }
  const finish = (r: Placed): ModuleSet[] | null => {
    const before = r.sets.length
    // 남은 자리 채우기: 기준 방향과 구역 방향을 모두 시도한다. 먼저 첫 열 위치를 앞 단계와 같게 두어 기존 열 줄의 빈자리를
    // 채우고(안 그러면 윗열에 자리가 있어도 열 사이로 어긋난 세트가 먼저 들어간다), 그래도 남은 자리는 줄과 상관없이 채운다.
    const azimuths = [...new Set([base.azimuth, ...zones.azimuths.map(zoneAz), ...zones.azimuths])]
    for (const rowOffset of new Set([r.rowOffset, 0])) for (const az of azimuths) place(r, az, undefined, rowOffset)
    if (!r.sets.length) return null
    if (o.mode === 'fill' && r.sets.length === before) return null
    return r.sets
  }
  return { main, finish }
}

export interface PlaceOptions {
  /** 'grid'면 한 방향 배치, 아니면 구역별 배치 방식 */
  mode: ZoneMode | 'grid'
  mask?: BuildMask | null
  keepOut?: number[][][]
}

/**
 * 배치 방식대로 채우되, 첫 열 시작 위치를 열 피치 안에서 고르게 훑어 세트가 가장 많이 들어가는 자리를 쓴다.
 * 작은 필지일수록 시작 위치에 따라 들어가는 열 수가 크게 달라서 촘촘히 훑는다. 입력이 같으면 늘 같은 배치가 나온다.
 * 구역별 배치는 구역 채우기까지로 시작 위치를 고른 뒤 남은 자리를 한 번 채운다. 구역별 배치가 안 되면 null.
 * 구역별 배치는 두 방향이 만나는 곳에 세모난 빈자리가 생긴다. 그래서 구역 방위각 가운데 하나로 한 방향 배치를 해 봐서
 * 모듈이 같거나 더 많이 들어가면 그 한 방향 배치를 돌려준다(azimuth에 그 방위각). 꺾인 필지에서 쓸데없이 꺾는 것을 막는다.
 */
export function placeLayout(parcel: Parcel, p: LayoutParams, o: PlaceOptions): { sets: ModuleSet[]; rowOffset: number; azimuth?: number } | null {
  const offsets = rowOffsets(parcel, p)
  const grid = (q: LayoutParams) => {
    let best = { sets: [] as ModuleSet[], rowOffset: 0 }
    for (const rowOffset of offsets) {
      const sets = autoLayout(parcel, q, rowOffset, o.mask, o.keepOut)
      if (sets.length > best.sets.length) best = { sets, rowOffset }
    }
    return best
  }
  if (o.mode === 'grid') return grid(p)
  const z = zonedPlanner(parcel, p, { ...o, mode: o.mode })
  if (!z) return null
  let best = { placed: z.main(0), rowOffset: 0 }
  for (const rowOffset of offsets.slice(1)) {
    const placed = z.main(rowOffset)
    if (placed.sets.length > best.placed.sets.length) best = { placed, rowOffset }
  }
  const sets = z.finish(best.placed)
  if (!sets) return null
  // 구역별 배치에 쓴 방위각마다 한 방향으로 깔아 보고, 모듈이 같거나 많으면 한 방향 배치가 낫다.
  const g = setGeometry(p)
  const zoned = totalModules(sets, g)
  let single: { sets: ModuleSet[]; rowOffset: number; azimuth: number } | null = null
  for (const { azimuth } of azimuthMix(sets)) {
    if (azimuth === p.azimuth) continue
    const r = grid({ ...p, azimuth })
    if (totalModules(r.sets, g) >= zoned && (!single || r.sets.length > single.sets.length)) single = { ...r, azimuth }
  }
  if (single) return single
  return { sets, rowOffset: best.rowOffset }
}

/** 첫 열 시작 위치 후보(m). 열 피치를 필지 크기에 따라 4~16칸으로 나눈다. */
export function rowOffsets(parcel: Parcel, p: LayoutParams): number[] {
  const pitch = setGeometry(p).depth + p.rowSpacing
  const frame = LocalFrame.around(parcel.rings)
  let area = 0
  for (const ring of parcel.rings) {
    const pts = ring.map((c) => frame.toLocal(c))
    for (let i = 0; i < pts.length - 1; i++) area += pts[i][0] * pts[i + 1][1] - pts[i + 1][0] * pts[i][1]
  }
  const rows = Math.sqrt(Math.abs(area) / 2) / pitch
  const n = rows <= 8 ? 16 : rows <= 20 ? 8 : 4
  return Array.from({ length: n }, (_, i) => Math.round(((pitch * i) / n) * 100) / 100)
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

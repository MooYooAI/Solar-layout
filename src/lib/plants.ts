// 발전소 나누기: 한 부지를 여러 사업자의 발전소로 쪼갠다. 깔린 세트를 한쪽 끝부터 훑어 발전소마다 용량(모듈 DC 상한)이
// 찰 때까지 담고, 다음 발전소는 앞 발전소에서 정한 간격만큼 떨어진 세트부터 담는다. 용량을 다 채우고 남은 세트는 뺀다.

import { deg2rad, LocalFrame, rotate, type Vec } from './geo'
import { forSet, setQuadLocal, type LayoutParams, type ModuleSet, type SetGeometry } from './layout'
import type { Parcel } from './parcel'

/** 같은 용량 발전소 묶음: 용량(kW, 모듈 DC 상한) × 개수, 이웃 발전소와 띄울 간격(m) */
export interface PlantSpec {
  kw: number
  count: number
  gap: number
}

/** 발전소 하나씩 펼친 목록(입력 순서). 세트의 plant 번호가 이 목록의 자리다. */
export function expandPlants(specs: PlantSpec[] | undefined): Array<{ kw: number; gap: number }> {
  const out: Array<{ kw: number; gap: number }> = []
  for (const s of specs ?? []) for (let i = 0; i < Math.max(0, Math.floor(s.count)); i++) if (s.kw > 0) out.push({ kw: s.kw, gap: Math.max(0, s.gap) })
  return out
}

/** 발전소 이름: 1번 발전소 */
export const plantName = (i: number) => `${i + 1}번 발전소`

/**
 * 세트를 발전소로 나눈다. 한쪽 끝부터 훑으며 발전소마다 용량까지 담고, 다음 발전소에는 앞 발전소 세트와
 * 두 발전소 간격 중 큰 값 이상 떨어진 세트만 담는다. 열 방향·앞뒤 방향으로 양쪽 끝에서 해 보고 가장 많이 담기는 쪽을 쓴다.
 * 나누는 설정이 없으면 그대로 돌려준다.
 */
export function splitPlants(parcel: Parcel, sets: ModuleSet[], p: LayoutParams, g: SetGeometry): ModuleSet[] {
  const plants = expandPlants(p.plants)
  if (!plants.length || !sets.length) return sets
  const frame = LocalFrame.around(parcel.rings)
  const r = deg2rad(p.azimuth)
  // 기준 방위각 좌표계(+x 열 방향, +y 뒤쪽)에서 세트 바닥의 범위
  const items = sets.map((s) => {
    const gs = forSet(g, s)
    const q = setQuadLocal(frame.toLocal([s.lon, s.lat]) as Vec, s.azimuth, gs).map((v) => rotate(v, r))
    const xs = q.map((v) => v[0])
    const ys = q.map((v) => v[1])
    return { s, watt: gs.watt, x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) }
  })
  type Item = (typeof items)[number]
  /** 두 세트 바닥 사이 최단 거리(m) */
  const dist = (a: Item, b: Item) => Math.hypot(Math.max(0, a.x0 - b.x1, b.x0 - a.x1), Math.max(0, a.y0 - b.y1, b.y0 - a.y1))
  const maxGap = Math.max(...plants.map((pl) => pl.gap))

  /** 한 방향으로 훑어 나눈다. axis는 훑는 축(x: 열 방향, y: 앞뒤), dir은 그 축의 방향 */
  const sweep = (axis: 'x' | 'y', dir: 1 | -1) => {
    const lo = (it: Item) => (axis === 'x' ? (dir > 0 ? it.x0 : -it.x1) : dir > 0 ? it.y0 : -it.y1)
    const hi = (it: Item) => (axis === 'x' ? (dir > 0 ? it.x1 : -it.x0) : dir > 0 ? it.y1 : -it.y0)
    const cross = (it: Item) => (axis === 'x' ? it.y0 : it.x0)
    const sorted = [...items].sort((a, b) => lo(a) - lo(b) || cross(a) - cross(b))
    const maxLen = Math.max(...sorted.map((it) => hi(it) - lo(it)))
    // 같은 줄(열 또는 칸)끼리 묶어 줄마다 방향을 바꿔(뱀 모양) 훑어야 발전소가 줄 끝에서 끊기지 않고 이어진다.
    const order: Item[] = []
    let line: Item[] = []
    let flip = false
    const flush = () => {
      order.push(...(flip ? line.reverse() : line))
      flip = !flip
      line = []
    }
    for (const it of sorted) {
      if (line.length && lo(it) - lo(line[0]) > maxLen / 2) flush()
      line.push(it)
    }
    flush()
    const placed: Array<{ it: Item; plant: number }> = []
    let k = 0
    let watt = 0
    let total = 0
    for (const it of order) {
      if (watt + it.watt > plants[k].kw * 1000 + 1e-6) {
        // 이 발전소는 찼다. 다음 세트부터 다음 발전소에 담는다.
        if (watt === 0) continue
        k++
        watt = 0
        if (k >= plants.length) break
      }
      // 앞 발전소 세트와는 두 발전소 간격 중 큰 값 이상 떨어져야 한다. 훑는 방향으로 가까운 세트만 본다.
      let ok = true
      for (let i = placed.length - 1; i >= 0; i--) {
        const q = placed[i]
        if (lo(q.it) < lo(it) - maxGap - 2 * maxLen) break
        if (q.plant !== k && dist(q.it, it) < Math.max(plants[q.plant].gap, plants[k].gap) - 1e-6) {
          ok = false
          break
        }
      }
      if (!ok) continue
      placed.push({ it, plant: k })
      watt += it.watt
      total += it.watt
    }
    return { placed, total }
  }
  // 네 방향(열 방향·앞뒤 × 양쪽 끝에서)으로 나눠 보고 발전소에 가장 많이 담긴 쪽을 쓴다.
  let best = sweep('x', 1)
  for (const [axis, dir] of [['x', -1], ['y', 1], ['y', -1]] as const) {
    const r = sweep(axis, dir)
    if (r.total > best.total + 1e-6) best = r
  }
  const { placed } = best
  return placed.map(({ it, plant }) => ({ ...it.s, plant }))
}

/** 발전소별 세트 수와 용량(kWp). 나누지 않은 배치면 빈 배열 */
export function plantSummary(sets: ModuleSet[], g: SetGeometry, p: LayoutParams): Array<{ plant: number; target: number; sets: number; kWp: number }> {
  const plants = expandPlants(p.plants)
  if (!plants.length) return []
  const out = plants.map((pl, i) => ({ plant: i, target: pl.kw, sets: 0, kWp: 0 }))
  for (const s of sets) {
    const row = s.plant !== undefined ? out[s.plant] : undefined
    if (!row) continue
    row.sets++
    row.kWp += forSet(g, s).watt / 1000
  }
  return out
}

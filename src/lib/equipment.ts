// 전기실(저압반·변압기) 자리. 모듈을 놓기 전에 부지 경계 안쪽에 먼저 비워 두고, 수배전반 위치와 그림자 계산에 쓴다.
// 전주를 찍어 두었으면 그 쪽 경계에, 아니면 부지 가운데에서 가까운 북쪽 경계에 둔다(높이 2.5m 함체가 모듈에 그늘을 덜 드리운다).

import { LocalFrame, pointInRing, quadFitsInRing, type Vec } from './geo'
import { LV_LIMIT_KW } from './electrical'
import type { Parcel } from './parcel'

export type PadKind = 'LV' | 'MV'

export interface EquipPad {
  kind: PadKind
  label: string
  /** 함체 바닥(경위도, 닫힌 링) */
  ring: number[][]
  /** 점검 공간까지 넓힌 영역(경위도, 닫힌 링). 모듈이 들어오면 안 된다. */
  keepOut: number[][]
  center: Vec
  /** 함체 높이(m). 그림자 계산에 쓴다. */
  height: number
}

/** 경계 방향 × 안쪽 깊이(m) */
const PAD_SIZE: Record<PadKind, [number, number]> = { LV: [3, 2.5], MV: [5, 4] }
const PAD_LABEL: Record<PadKind, string> = { LV: '저압반(ACB)', MV: '전기실(저압반·변압기)' }
/** 함체 둘레 점검·출입 공간(m) */
const SERVICE = 1
/** 경계에서 함체까지(m) */
const EDGE_GAP = 0.5
/** 필지 1㎡당 대략 설비용량(kW). 배치 전에 전기실 크기를 고를 때만 쓴다. */
const KW_PER_M2 = 0.11

/** 배치 전 부지 면적으로 고른 전기실 종류. 100kW 이상이면 특고압 연계라 변압기까지 둔다. */
export function padKindFor(areaM2: number): PadKind {
  return areaM2 * KW_PER_M2 >= LV_LIMIT_KW ? 'MV' : 'LV'
}

/**
 * 전기실 자리를 고른다. 경계를 1m 간격으로 훑어 함체가 경계 안쪽에 들어가는 자리 가운데
 * 전주(anchor)에 가장 가까운 곳, 전주가 없으면 부지 가운데에 가깝고 북쪽 경계인 곳을 고른다.
 */
export function placeEquipPad(parcel: Parcel, kind: PadKind, anchor?: Vec | null): EquipPad | null {
  const frame = LocalFrame.around(parcel.rings)
  const rings = parcel.rings.map((r) => r.map((c) => frame.toLocal(c)))
  const [w, d] = PAD_SIZE[kind]
  const pts = rings.flat()
  const cx = pts.reduce((t, p) => t + p[0], 0) / pts.length
  const cy = pts.reduce((t, p) => t + p[1], 0) / pts.length
  const span = Math.max(...pts.map((p) => Math.hypot(p[0] - cx, p[1] - cy)))
  const a = anchor ? frame.toLocal(anchor) : null

  let best: { score: number; quad: Vec[]; keep: Vec[] } | null = null
  for (const ring of rings) {
    // 링 방향과 관계없이 안쪽을 가리키는 법선을 쓰도록, 법선 쪽 시험점이 링 안에 있는지로 정한다.
    for (let i = 0; i < ring.length - 1; i++) {
      const [ax, ay] = ring[i]
      const [bx, by] = ring[i + 1]
      const len = Math.hypot(bx - ax, by - ay)
      if (len < w + 2 * EDGE_GAP) continue
      const ux = (bx - ax) / len
      const uy = (by - ay) / len
      let [nx, ny] = [-uy, ux]
      const mid: Vec = [(ax + bx) / 2 + nx * 0.5, (ay + by) / 2 + ny * 0.5]
      if (!pointInRing(mid, ring)) [nx, ny] = [-nx, -ny]
      for (let t = w / 2 + EDGE_GAP; t <= len - w / 2 - EDGE_GAP; t += 1) {
        const px = ax + ux * t
        const py = ay + uy * t
        const box = (half: number, depth0: number, depth1: number): Vec[] => [
          [px - ux * half + nx * depth0, py - uy * half + ny * depth0],
          [px + ux * half + nx * depth0, py + uy * half + ny * depth0],
          [px + ux * half + nx * depth1, py + uy * half + ny * depth1],
          [px - ux * half + nx * depth1, py - uy * half + ny * depth1],
        ]
        const quad = box(w / 2, EDGE_GAP, EDGE_GAP + d)
        if (!quadFitsInRing(quad, ring, EDGE_GAP * 0.5)) continue
        const q0 = quad[0]
        const q2 = quad[2]
        const qc: Vec = [(q0[0] + q2[0]) / 2, (q0[1] + q2[1]) / 2]
        const score = a
          ? Math.hypot(px - a[0], py - a[1])
          : Math.hypot(qc[0] - cx, qc[1] - cy) + (ny > 0.3 ? span : 0) // 안쪽 법선이 북쪽이면(남쪽 경계) 뒤로 미룬다.
        if (!best || score < best.score) best = { score, quad, keep: box(w / 2 + SERVICE, 0, EDGE_GAP + d + SERVICE) }
      }
    }
  }
  if (!best) return null
  const close = (q: Vec[]) => [...q, q[0]].map((v) => frame.toLonLat(v) as number[])
  const c = best.quad
  return {
    kind,
    label: PAD_LABEL[kind],
    ring: close(c),
    keepOut: close(best.keep),
    center: frame.toLonLat([(c[0][0] + c[2][0]) / 2, (c[0][1] + c[2][1]) / 2]),
    height: 2.5,
  }
}

// 수배전반 함체·전기실 자리. 모듈을 놓기 전에 부지 경계 안쪽에 먼저 비워 두고, 수배전반 위치와 그림자 계산에 쓴다.
// 전주를 찍어 두었으면 그 쪽 경계에, 아니면 부지 가운데에서 가까운 북쪽 경계에 둔다(높이 2.5m 함체가 모듈에 그늘을 덜 드리운다).

import { LocalFrame, pointInRing, quadFitsInRing, type Vec } from './geo'
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
const PAD_LABEL: Record<PadKind, string> = { LV: '수배전반(옥외 함체)', MV: '전기실(수배전반·변압기)' }
/** 함체 둘레 점검·출입 공간(m) */
const SERVICE = 1
/** 경계에서 함체까지(m) */
const EDGE_GAP = 0.5
/** 필지 1㎡당 대략 설비용량(kW). 배치 전에 전기실이 필요한지 가늠할 때만 쓴다. */
const KW_PER_M2 = 0.11
/**
 * 이 용량(kW) 이상이면 수배전반 설치가 의무라 전기실(수배전반·변압기)을 둔다.
 * 그 아래는 의무가 아니어서 기본으로 두지 않고, 필요하면 옥외 수배전반 함체 자리를 직접 비운다.
 */
export const ELEC_ROOM_KW = 500

/** 배치 전 부지 면적으로 어림한 설비용량(kW) */
export const estimateKW = (areaM2: number) => areaM2 * KW_PER_M2

/** 설비용량(kW)으로 고른 함체 종류: 500 kW 미만은 옥외 수배전반 함체, 이상이면 전기실 */
export function padKindFor(kW: number): PadKind {
  return kW >= ELEC_ROOM_KW ? 'MV' : 'LV'
}

/** 경계 안쪽에 함체가 들어가는 자리 하나(부지 평면 좌표) */
interface Slot {
  quad: Vec[]
  keep: Vec[]
  /** 함체가 붙은 경계 위 점 */
  at: Vec
  /** 함체 가운데 */
  center: Vec
  /** 경계에서 안쪽을 가리키는 단위 법선 */
  inward: Vec
}

/** 경계 방향 단위벡터 u, 안쪽 법선 n으로 놓은 함체와 점검 공간 */
function padBox(c: Vec, u: Vec, n: Vec, kind: PadKind): { quad: Vec[]; keep: Vec[] } {
  const [w, d] = PAD_SIZE[kind]
  const box = (hw: number, hd: number): Vec[] => [
    [c[0] - u[0] * hw - n[0] * hd, c[1] - u[1] * hw - n[1] * hd],
    [c[0] + u[0] * hw - n[0] * hd, c[1] + u[1] * hw - n[1] * hd],
    [c[0] + u[0] * hw + n[0] * hd, c[1] + u[1] * hw + n[1] * hd],
    [c[0] - u[0] * hw + n[0] * hd, c[1] - u[1] * hw + n[1] * hd],
  ]
  return { quad: box(w / 2, d / 2), keep: box(w / 2 + SERVICE, d / 2 + SERVICE) }
}

/** 경계를 step(m) 간격으로 훑어 함체가 경계 안쪽에 들어가는 자리를 모두 모은다. */
function padSlots(parcel: Parcel, kind: PadKind, step = 1) {
  const frame = LocalFrame.around(parcel.rings)
  const rings = parcel.rings.map((r) => r.map((c) => frame.toLocal(c)))
  const [w, d] = PAD_SIZE[kind]
  const slots: Slot[] = []
  for (const ring of rings) {
    // 링 방향과 관계없이 안쪽을 가리키는 법선을 쓰도록, 법선 쪽 시험점이 링 안에 있는지로 정한다.
    for (let i = 0; i < ring.length - 1; i++) {
      const [ax, ay] = ring[i]
      const [bx, by] = ring[i + 1]
      const len = Math.hypot(bx - ax, by - ay)
      if (len < w + 2 * EDGE_GAP) continue
      const u: Vec = [(bx - ax) / len, (by - ay) / len]
      let n: Vec = [-u[1], u[0]]
      if (!pointInRing([(ax + bx) / 2 + n[0] * 0.5, (ay + by) / 2 + n[1] * 0.5], ring)) n = [-n[0], -n[1]]
      for (let t = w / 2 + EDGE_GAP; t <= len - w / 2 - EDGE_GAP; t += step) {
        const at: Vec = [ax + u[0] * t, ay + u[1] * t]
        const depth = EDGE_GAP + d / 2
        const center: Vec = [at[0] + n[0] * depth, at[1] + n[1] * depth]
        const { quad, keep } = padBox(center, u, n, kind)
        if (!quadFitsInRing(quad, ring, EDGE_GAP * 0.5)) continue
        slots.push({ quad, keep, at, center, inward: n })
      }
    }
  }
  return { frame, rings, slots }
}

function toPad(frame: LocalFrame, kind: PadKind, quad: Vec[], keep: Vec[]): EquipPad {
  const close = (q: Vec[]) => [...q, q[0]].map((v) => frame.toLonLat(v) as number[])
  return {
    kind,
    label: PAD_LABEL[kind],
    ring: close(quad),
    keepOut: close(keep),
    center: frame.toLonLat([(quad[0][0] + quad[2][0]) / 2, (quad[0][1] + quad[2][1]) / 2]),
    height: 2.5,
  }
}

/**
 * 기본 자리: 경계 안쪽 자리 가운데 전주(anchor)에 가장 가까운 곳,
 * 전주가 없으면 부지 가운데에 가깝고 북쪽 경계인 곳을 고른다.
 */
export function placeEquipPad(parcel: Parcel, kind: PadKind, anchor?: Vec | null): EquipPad | null {
  const { frame, rings, slots } = padSlots(parcel, kind)
  if (!slots.length) return null
  const pts = rings.flat()
  const cx = pts.reduce((t, p) => t + p[0], 0) / pts.length
  const cy = pts.reduce((t, p) => t + p[1], 0) / pts.length
  const span = Math.max(...pts.map((p) => Math.hypot(p[0] - cx, p[1] - cy)))
  const a = anchor ? frame.toLocal(anchor) : null
  const score = (s: Slot) =>
    a
      ? Math.hypot(s.at[0] - a[0], s.at[1] - a[1])
      : Math.hypot(s.center[0] - cx, s.center[1] - cy) + (s.inward[1] > 0.3 ? span : 0) // 안쪽 법선이 북쪽이면(남쪽 경계) 뒤로 미룬다.
  const best = slots.reduce((b, s) => (score(s) < score(b) ? s : b))
  return toPad(frame, kind, best.quad, best.keep)
}

/** 최적 자리 찾기에 쓸 후보: 경계 둘레를 따라 고르게 n곳 */
export function padCandidates(parcel: Parcel, kind: PadKind, n = 16): EquipPad[] {
  const { frame, slots } = padSlots(parcel, kind)
  if (!slots.length) return []
  const pick = slots.length <= n ? slots : Array.from({ length: n }, (_, i) => slots[Math.floor(((i + 0.5) * slots.length) / n)])
  return pick.map((s) => toPad(frame, kind, s.quad, s.keep))
}

/**
 * 사용자가 끌어다 놓은 자리(경위도). 가장 가까운 경계 방향으로 돌려 그 자리에 놓고,
 * 부지 밖으로 나가면 가장 가까운 경계 안쪽 자리로 붙인다.
 */
export function padNear(parcel: Parcel, kind: PadKind, at: Vec): EquipPad | null {
  const { frame, rings, slots } = padSlots(parcel, kind)
  const p = frame.toLocal(at)
  let edge: { u: Vec; ring: Vec[]; d: number } | null = null
  for (const ring of rings)
    for (let i = 0; i < ring.length - 1; i++) {
      const [ax, ay] = ring[i]
      const [bx, by] = ring[i + 1]
      const len = Math.hypot(bx - ax, by - ay)
      if (!len) continue
      const t = Math.max(0, Math.min(len, ((p[0] - ax) * (bx - ax) + (p[1] - ay) * (by - ay)) / len))
      const d = Math.hypot(ax + ((bx - ax) * t) / len - p[0], ay + ((by - ay) * t) / len - p[1])
      if (!edge || d < edge.d) edge = { u: [(bx - ax) / len, (by - ay) / len], ring, d }
    }
  if (edge) {
    const n: Vec = [-edge.u[1], edge.u[0]]
    const { quad, keep } = padBox(p, edge.u, n, kind)
    if (quadFitsInRing(quad, edge.ring, EDGE_GAP * 0.5)) return toPad(frame, kind, quad, keep)
  }
  if (!slots.length) return null
  const best = slots.reduce((b, s) => (Math.hypot(s.center[0] - p[0], s.center[1] - p[1]) < Math.hypot(b.center[0] - p[0], b.center[1] - p[1]) ? s : b))
  return toPad(frame, kind, best.quad, best.keep)
}

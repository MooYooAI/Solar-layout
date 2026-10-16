// 배치 토공량: 세트(어레이 테이블)마다 바닥 지반에 평면을 맞추고, 그 평면의 기울기를 구조물이 따라갈 수 있는
// 한도(래킹 방식별 남북·동서 허용 경사)로 줄인다. 계획면과 지반의 차이 중 기초 높이 조절로 흡수하는
// 요철(reveal)을 넘는 만큼만 깎거나 쌓는다고 본다. 필지 전체를 고르는 지형 탭 계산과 달리 세트 자리만 본다.

import { deg2rad, LocalFrame, rotate } from './geo'
import { elevAt, type ElevGrid } from './elevation'
import { RACKING } from './catalog'
import type { LayoutParams, ModuleSet, SetGeometry } from './layout'

export interface SetEarthwork {
  id: string
  /** 바닥 평균 지반고(m) */
  ground: number
  /** 지반 평면의 남북·동서 경사(%) */
  slopeNS: number
  slopeEW: number
  cut: number
  fill: number
  /** 지반 경사가 구조물 허용 경사를 넘어 계획면을 따로 잡은 세트 */
  steep: boolean
}

export interface EarthworkResult {
  cut: number
  fill: number
  maxCut: number
  maxFill: number
  steepSets: number
  perSet: SetEarthwork[]
}

/** 바닥 표본 간격(m) */
const STEP = 1

export function layoutEarthwork(sets: ModuleSet[], p: LayoutParams, g: SetGeometry, grid: ElevGrid): EarthworkResult {
  const rack = RACKING[p.racking]
  const frame = new LocalFrame(grid.lon0, grid.lat0)
  const nu = Math.max(2, Math.round(g.width / STEP))
  const nv = Math.max(2, Math.round(g.depth / STEP))
  const cellArea = (g.width * g.depth) / (nu * nv)
  let cut = 0
  let fill = 0
  let maxCut = 0
  let maxFill = 0
  let steepSets = 0
  const perSet: SetEarthwork[] = []
  for (const s of sets) {
    const c = frame.toLocal([s.lon, s.lat])
    const r = -deg2rad(s.azimuth)
    const pts: Array<{ u: number; v: number; z: number }> = []
    for (let a = 0; a < nu; a++)
      for (let b = 0; b < nv; b++) {
        const u = -g.width / 2 + (a + 0.5) * (g.width / nu)
        const v = -g.depth / 2 + (b + 0.5) * (g.depth / nv)
        const [x, y] = rotate([u, v], r)
        const z = elevAt(grid, c[0] + x, c[1] + y)
        if (Number.isFinite(z)) pts.push({ u, v, z })
      }
    if (pts.length < 3) continue
    // 표본이 대칭 격자라 u·v 교차항은 0에 가깝다고 보고 기울기를 따로 구한다.
    const n = pts.length
    const mu = pts.reduce((t, q) => t + q.u, 0) / n
    const mv = pts.reduce((t, q) => t + q.v, 0) / n
    const mz = pts.reduce((t, q) => t + q.z, 0) / n
    let suu = 0, svv = 0, suz = 0, svz = 0
    for (const q of pts) {
      suu += (q.u - mu) ** 2
      svv += (q.v - mv) ** 2
      suz += (q.u - mu) * (q.z - mz)
      svz += (q.v - mv) * (q.z - mz)
    }
    const bu = suu ? suz / suu : 0
    const bv = svv ? svz / svv : 0
    const limU = rack.ewSlopePct / 100
    const limV = rack.nsSlopePct / 100
    const du = Math.max(-limU, Math.min(limU, bu))
    const dv = Math.max(-limV, Math.min(limV, bv))
    const steep = du !== bu || dv !== bv
    // 계획면 높이는 표본 차이의 평균이 0(절성토 균형)이 되게 둔다.
    const a0 = pts.reduce((t, q) => t + q.z - du * (q.u - mu) - dv * (q.v - mv), 0) / n
    let sc = 0
    let sf = 0
    for (const q of pts) {
      const dz = a0 + du * (q.u - mu) + dv * (q.v - mv) - q.z
      const over = Math.abs(dz) - rack.reveal
      if (over <= 0) continue
      if (dz > 0) {
        sf += over * cellArea
        maxFill = Math.max(maxFill, over)
      } else {
        sc += over * cellArea
        maxCut = Math.max(maxCut, over)
      }
    }
    cut += sc
    fill += sf
    if (steep) steepSets++
    perSet.push({ id: s.id, ground: mz, slopeNS: bv * 100, slopeEW: bu * 100, cut: sc, fill: sf, steep })
  }
  return { cut, fill, maxCut, maxFill, steepSets, perSet }
}

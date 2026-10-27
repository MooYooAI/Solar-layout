// 스트링 구성도용 계산. 전기 설계가 세트 순서대로 자른 스트링을 모듈 위를 지나는 경로로 바꾸고,
// 이어 붙은 세트를 어레이(구조물 한 덩어리)로 묶어 번호를 매긴다. 직렬 장수가 인버터 전압 범위에 드는지도 여기서 따진다.

import { deg2rad, LocalFrame, rotate, type Vec } from './geo'
import { forSet, type ModuleSet, type SetGeometry } from './layout'
import { stringOrder, type ElecParams, type ElecResult } from './electrical'
import type { Parcel } from './parcel'

export interface StringPath {
  id: number
  inverter: number
  /** 모듈 가운데를 잇는 경로(로컬 m). 열이 바뀌면 조각이 나뉘고 조각 사이는 점프 케이블이다. */
  pieces: Vec[][]
  /** + 단자(첫 모듈)와 − 단자(마지막 모듈) */
  plus: Vec
  minus: Vec
}

export interface ArrayBlock {
  no: number
  setIds: string[]
  modules: number
  /** 번호를 붙일 왼쪽 끝 가운데(로컬 m)와 바깥쪽 방향(단위 벡터) */
  anchor: Vec
  outward: Vec
}

export interface StringPlanResult {
  paths: StringPath[]
  arrays: ArrayBlock[]
}

/** 스트링 경로와 어레이 번호. 세트 안 모듈은 진행 방향으로 한 줄(가로 한 칸)씩 스트링에 들어간다고 보고, 스트링마다 뒷단→앞단으로 되돌아오며 잇는다. */
export function stringPlan(parcel: Parcel, sets: ModuleSet[], g: SetGeometry, elec: ElecResult): StringPlanResult {
  const frame = LocalFrame.around(parcel.rings)
  const ordered = stringOrder(frame, sets, g)
  const rowsN = Math.max(1, Math.round(g.modules / Math.max(1, g.cols)))
  const pitchY = g.depth / rowsN
  const info = new Map(ordered.map((it) => [it.s.id, { ...it, gs: forSet(g, it.s), used: 0 }]))
  type Info = NonNullable<ReturnType<typeof info.get>>
  /** 진행 순서 t번째 칸, 아래에서 j번째 단 모듈 가운데(로컬 m) */
  const center = (it: Info, t: number, j: number): Vec => {
    const cols = it.gs.cols
    const i = it.dir > 0 ? t : cols - 1 - t
    const x = it.row[0] - it.gs.width / 2 + g.along / 2 + i * (g.along + g.gap)
    const y = it.row[1] - g.depth / 2 + (j + 0.5) * pitchY
    return rotate([x, y], -deg2rad(it.s.azimuth))
  }

  const paths: StringPath[] = []
  for (const st of elec.strings) {
    // 스트링이 지나는 칸(세트, 진행 순서 칸 번호)을 열마다 모은다.
    const runs: Array<Array<{ it: Info; t: number }>> = []
    for (const seg of st.segments) {
      const it = info.get(seg.setId)
      if (!it || seg.count <= 0) continue
      const t0 = Math.floor(it.used / rowsN)
      const t1 = Math.floor((it.used + seg.count - 1) / rowsN)
      it.used += seg.count
      let run = runs.at(-1)
      if (!run || run[0].it.line !== it.line) runs.push((run = []))
      for (let t = t0; t <= t1; t++) {
        const last = run.at(-1)
        if (!last || last.it !== it || last.t !== t) run.push({ it, t })
      }
    }
    const pieces = runs.map((run) => {
      const pts: Vec[] = []
      // 뒷단부터 진행 방향으로 갔다가 다음 단에서 되돌아온다(2단이면 ㄷ자).
      for (let k = 0; k < rowsN; k++) {
        const j = rowsN - 1 - k
        const cells = k % 2 ? [...run].reverse() : run
        for (const c of cells) pts.push(center(c.it, c.t, j))
      }
      return pts
    })
    if (!pieces.length || !pieces[0].length) continue
    paths.push({ id: st.id, inverter: st.inverter, pieces, plus: pieces[0][0], minus: pieces.at(-1)!.at(-1)! })
  }

  // 같은 열에서 모듈 간격만큼만 떨어져 이어진 세트를 한 어레이로 묶는다.
  const lines = new Map<number, Info[]>()
  for (const it of info.values()) lines.set(it.line, [...(lines.get(it.line) ?? []), it])
  const blocks: Array<{ items: Info[]; line: number }> = []
  for (const [line, items] of lines) {
    items.sort((a, b) => a.row[0] - b.row[0])
    let cur: Info[] = []
    for (const it of items) {
      const prev = cur.at(-1)
      const gap = prev ? it.row[0] - it.gs.width / 2 - (prev.row[0] + prev.gs.width / 2) : Infinity
      if (prev && gap <= g.gap + 0.05) cur.push(it)
      else {
        if (cur.length) blocks.push({ items: cur, line })
        cur = [it]
      }
    }
    if (cur.length) blocks.push({ items: cur, line })
  }
  // 번호는 위(북쪽) 열부터, 열 안에서는 왼쪽부터
  const mid = (b: (typeof blocks)[number]): Vec => {
    const xs = b.items.map((it) => it.local[0])
    const ys = b.items.map((it) => it.local[1])
    return [xs.reduce((a, v) => a + v, 0) / xs.length, ys.reduce((a, v) => a + v, 0) / ys.length]
  }
  blocks.sort((a, b) => {
    const [ma, mb] = [mid(a), mid(b)]
    return Math.abs(ma[1] - mb[1]) > g.depth / 2 ? mb[1] - ma[1] : ma[0] - mb[0]
  })
  const arrays: ArrayBlock[] = blocks.map((b, k) => {
    const first = b.items[0]
    const az = -deg2rad(first.s.azimuth)
    return {
      no: k + 1,
      setIds: b.items.map((it) => it.s.id),
      modules: b.items.reduce((n, it) => n + it.gs.modules, 0),
      anchor: rotate([first.row[0] - first.gs.width / 2, first.row[1]], az),
      outward: rotate([-1, 0], az),
    }
  })
  return { paths, arrays }
}

/** 인버터별 스트링 구성(직렬 × 병렬). 구성이 같은 이웃 인버터는 한 줄로 묶는다(예: INV-1~3). */
export function inverterGroups(elec: ElecResult): Array<{ from: number; to: number; series: number; parallel: number; kWdc: number }> {
  const out: Array<{ from: number; to: number; series: number; parallel: number; kWdc: number }> = []
  for (const inv of elec.inverters) {
    const last = out.at(-1)
    if (last && last.parallel === inv.strings && Math.abs(last.kWdc - inv.kWdc) < 1e-6) last.to = inv.id
    else out.push({ from: inv.id, to: inv.id, series: elec.stringLen, parallel: inv.strings, kWdc: inv.kWdc })
  }
  return out
}

export interface VoltageCheck {
  label: string
  /** 계산식 한 줄 */
  calc: string
  ok: boolean
}

/** 직렬 장수가 인버터 전압 범위에 드는지: 저온 개방전압 ≤ 최대 입력전압, 동작전압이 MPPT 범위 안 */
export function voltageChecks(elec: ElecResult, e: ElecParams): VoltageCheck[] {
  const n = elec.stringLen
  const f = (v: number) => v.toLocaleString('ko-KR', { maximumFractionDigits: 1 })
  return [
    {
      label: `최저기온(${e.minTemp}°C) 개방전압`,
      calc: `${f(elec.vocCold)} V × ${n} = ${f(elec.vocCold * n)} V ≤ 최대 입력 ${f(e.maxDcV)} V`,
      ok: elec.vocCold * n <= e.maxDcV,
    },
    {
      label: '동작전압(STC) MPPT 상한',
      calc: `${f(e.vmp)} V × ${n} = ${f(e.vmp * n)} V ≤ ${f(e.mpptMaxV)} V`,
      ok: e.vmp * n <= e.mpptMaxV,
    },
    {
      label: `고온(셀 ${e.maxCellTemp}°C) 동작전압 MPPT 하한`,
      calc: `${f(elec.vmpHot)} V × ${n} = ${f(elec.vmpHot * n)} V ≥ ${f(e.mpptMinV)} V`,
      ok: elec.vmpHot * n >= e.mpptMinV,
    },
  ]
}

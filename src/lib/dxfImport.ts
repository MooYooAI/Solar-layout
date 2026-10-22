// 사용자 DXF 도면에서 부지 경계(닫힌 선)를 읽는다.
// 닫힌 LWPOLYLINE·POLYLINE, 그리고 끝점이 이어져 닫히는 LINE 묶음을 경계 후보로 본다. 호(bulge)는 직선으로 근사한다.

import { LocalFrame, type Vec } from './geo'
import { fromTm, TM_ZONES, UTMK, zoneFor } from './export/tm'

export interface DxfShape {
  layer: string
  /** 도면 좌표(닫지 않은 링) */
  pts: Vec[]
  /** 도면 단위² */
  area: number
}

export interface DxfDrawing {
  shapes: DxfShape[]
  /** 헤더 $INSUNITS로 아는 1 도면 단위의 미터 값. 모르면 null */
  unitM: number | null
}

/** 좌표를 해석하는 방식: 국내 TM 원점(EPSG), UTM-K, 또는 좌표 없이 지도에 놓기 */
export type DxfCrs = 5185 | 5186 | 5187 | 5188 | 5179 | 'local'

export const DXF_CRS: Array<[DxfCrs, string]> = [
  ...TM_ZONES.map((z) => [z.epsg as DxfCrs, `${z.name} TM (EPSG:${z.epsg})`] as [DxfCrs, string]),
  [5179, 'UTM-K (EPSG:5179)'],
  ['local', '좌표 없음: 지도에서 놓을 자리 클릭'],
]

const INSUNITS_M: Record<number, number> = { 1: 0.0254, 2: 0.3048, 4: 0.001, 5: 0.01, 6: 1, 7: 1000 }

function shoelace(pts: Vec[]): number {
  let s = 0
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i]
    const [x2, y2] = pts[(i + 1) % pts.length]
    s += x1 * y2 - x2 * y1
  }
  return Math.abs(s) / 2
}

const same = (a: Vec, b: Vec, tol: number) => Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol

/** 끝점이 맞닿는 선분들을 이어 닫힌 고리를 만든다 */
function chainLines(segs: Array<{ layer: string; a: Vec; b: Vec }>, tol: number): DxfShape[] {
  const left = [...segs]
  const out: DxfShape[] = []
  while (left.length) {
    const first = left.pop()!
    const pts: Vec[] = [first.a, first.b]
    let grown = true
    while (grown) {
      grown = false
      const end = pts[pts.length - 1]
      const i = left.findIndex((s) => same(s.a, end, tol) || same(s.b, end, tol))
      if (i < 0) break
      const s = left.splice(i, 1)[0]
      pts.push(same(s.a, end, tol) ? s.b : s.a)
      grown = true
      if (same(pts[pts.length - 1], pts[0], tol)) break
    }
    if (pts.length >= 4 && same(pts[pts.length - 1], pts[0], tol)) {
      pts.pop()
      out.push({ layer: first.layer, pts, area: shoelace(pts) })
    }
  }
  return out
}

export function parseDxf(text: string): DxfDrawing {
  const lines = text.split(/\r?\n/)
  const pairs: Array<[number, string]> = []
  for (let i = 0; i + 1 < lines.length; i += 2) pairs.push([parseInt(lines[i].trim(), 10), lines[i + 1].trim()])

  let unitM: number | null = null
  const ins = pairs.findIndex(([c, v]) => c === 9 && v === '$INSUNITS')
  if (ins >= 0 && pairs[ins + 1]?.[0] === 70) unitM = INSUNITS_M[Number(pairs[ins + 1][1])] ?? null

  const start = pairs.findIndex(([c, v], i) => c === 0 && v === 'SECTION' && pairs[i + 1]?.[0] === 2 && pairs[i + 1][1] === 'ENTITIES')
  if (start < 0) throw new Error('DXF에서 도형(ENTITIES)을 찾지 못했습니다.')

  const shapes: DxfShape[] = []
  const segs: Array<{ layer: string; a: Vec; b: Vec }> = []
  let poly: { layer: string; closed: boolean; pts: Vec[] } | null = null
  const finishPoly = (p: { layer: string; closed: boolean; pts: Vec[] }) => {
    const pts = [...p.pts]
    const tol = 1e-9 * Math.max(1, ...pts.map(([x, y]) => Math.max(Math.abs(x), Math.abs(y))))
    if (pts.length > 2 && same(pts[0], pts[pts.length - 1], tol)) pts.pop()
    else if (!p.closed) {
      // 열린 선은 LINE처럼 이어 붙일 수 있게 선분으로 넘긴다
      for (let i = 0; i + 1 < pts.length; i++) segs.push({ layer: p.layer, a: pts[i], b: pts[i + 1] })
      return
    }
    if (pts.length >= 3) shapes.push({ layer: p.layer, pts, area: shoelace(pts) })
  }

  let i = start + 2
  while (i < pairs.length) {
    const [code, type] = pairs[i]
    if (code !== 0) {
      i++
      continue
    }
    if (type === 'ENDSEC') break
    // 엔티티 하나의 그룹 코드들
    let j = i + 1
    while (j < pairs.length && pairs[j][0] !== 0) j++
    const body = pairs.slice(i + 1, j)
    const layer = body.find(([c]) => c === 8)?.[1] ?? '0'
    const num = (c: number) => Number(body.find(([k]) => k === c)?.[1] ?? NaN)
    if (type === 'LWPOLYLINE') {
      const pts: Vec[] = []
      for (let k = 0; k < body.length; k++)
        if (body[k][0] === 10 && body[k + 1]?.[0] === 20) pts.push([Number(body[k][1]), Number(body[k + 1][1])])
      finishPoly({ layer, closed: (num(70) & 1) === 1, pts })
    } else if (type === 'POLYLINE') {
      const flags = num(70) || 0
      // 3D 메시·폴리페이스는 건너뛴다
      poly = flags & (16 | 64) ? null : { layer, closed: (flags & 1) === 1, pts: [] }
    } else if (type === 'VERTEX') {
      if (poly) poly.pts.push([num(10), num(20)])
    } else if (type === 'SEQEND') {
      if (poly) finishPoly(poly)
      poly = null
    } else if (type === 'LINE') {
      segs.push({ layer, a: [num(10), num(20)], b: [num(11), num(21)] })
    }
    i = j
  }

  const all = [...shapes.filter((s) => s.pts.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y)))]
  if (segs.length) {
    const ext = Math.max(1, ...segs.flatMap((s) => [...s.a, ...s.b].map(Math.abs)))
    all.push(...chainLines(segs, ext * 1e-7))
  }
  return { shapes: all.filter((s) => s.area > 0).sort((a, b) => b.area - a.area), unitM }
}

function box(pts: Vec[]) {
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) }
}

/** 좌표 크기로 좌표계와 단위를 짐작한다. TM은 경도로 원점을 고르므로 hintLon(지금 지도 위치)을 쓴다. */
export function guessCrs(d: DxfDrawing, hintLon: number): { crs: DxfCrs; unitM: number } {
  const b = box(d.shapes[0].pts)
  const cx = (b.x0 + b.x1) / 2
  const cy = (b.y0 + b.y1) / 2
  for (const s of d.unitM ? [d.unitM] : [1, 0.001]) {
    const x = cx * s
    const y = cy * s
    if (x > 700_000 && x < 1_400_000 && y > 1_300_000 && y < 2_300_000) return { crs: 5179, unitM: s }
    if (x > 50_000 && x < 450_000 && y > 30_000 && y < 800_000) {
      return { crs: zoneFor(hintLon).epsg as DxfCrs, unitM: s }
    }
  }
  // 좌표가 없는 도면: 단위를 모르면 크기로 짐작(5 km 넘는 부지는 드물어 mm로 본다)
  const size = Math.max(b.x1 - b.x0, b.y1 - b.y0)
  return { crs: 'local', unitM: d.unitM ?? (size > 5000 ? 0.001 : 1) }
}

/** 도면 좌표의 경계를 경위도 닫힌 링으로. 좌표 없음이면 at(경위도)에 경계 가운데를 놓는다. */
export function shapeToLonLat(s: DxfShape, crs: DxfCrs, unitM: number, at?: [number, number]): number[][] {
  let ring: number[][]
  if (crs === 'local') {
    if (!at) throw new Error('놓을 자리가 필요합니다.')
    const b = box(s.pts)
    const cx = (b.x0 + b.x1) / 2
    const cy = (b.y0 + b.y1) / 2
    const f = new LocalFrame(at[0], at[1])
    ring = s.pts.map(([x, y]) => f.toLonLat([(x - cx) * unitM, (y - cy) * unitM]))
  } else if (crs === 5179) {
    ring = s.pts.map(([x, y]) => fromTm([x * unitM, y * unitM], UTMK.lon0, UTMK.k0, UTMK.fe, UTMK.fn))
  } else {
    const zone = TM_ZONES.find((z) => z.epsg === crs)!
    ring = s.pts.map(([x, y]) => fromTm([x * unitM, y * unitM], zone.lon0))
  }
  return [...ring, ring[0]]
}

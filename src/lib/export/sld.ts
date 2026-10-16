// 단선결선도(SLD, 개략): PV 스트링 → DC 차단 → 인버터 → AC 차단 → 집합반 모선 → 주차단기 → 전력량계
// → (특고압이면) 변압기·VCB → 한전 계통. 같은 도형 목록으로 화면용 SVG와 CAD용 DXF를 함께 만든다.

import type { ElecParams, ElecResult } from '../electrical'
import { DxfWriter, type Pt } from './dxf'

type Prim =
  | { t: 'line'; a: Pt; b: Pt; heavy?: boolean }
  | { t: 'rect'; x: number; y: number; w: number; h: number }
  | { t: 'circle'; c: Pt; r: number }
  | { t: 'text'; p: Pt; s: string; size: number; anchor?: 'start' | 'middle' }

export interface SldDrawing {
  width: number
  height: number
  prims: Prim[]
}

export interface SldInfo {
  title: string
  moduleWatt: number
  date: string
}

const COL = 160
const fmt = (n: number, d = 1) => n.toLocaleString('ko-KR', { maximumFractionDigits: d, minimumFractionDigits: d })

export function buildSld(r: ElecResult, e: ElecParams, info: SldInfo): SldDrawing {
  const prims: Prim[] = []
  const line = (a: Pt, b: Pt, heavy = false) => prims.push({ t: 'line', a, b, heavy })
  const text = (p: Pt, s: string, size = 10, anchor: 'start' | 'middle' = 'start') => prims.push({ t: 'text', p, s, size, anchor })
  const rect = (x: number, y: number, w: number, h: number) => prims.push({ t: 'rect', x, y, w, h })
  const circle = (c: Pt, rr: number) => prims.push({ t: 'circle', c, r: rr })

  // 인버터가 많으면 같은 구성(스트링 수)끼리 한 칸으로 묶는다.
  type Col = { label: string; strings: number; kWdc: number; count: number }
  let cols: Col[]
  if (r.inverters.length <= 8) {
    cols = r.inverters.map((v) => ({ label: `INV-${v.id}`, strings: v.strings, kWdc: v.kWdc, count: 1 }))
  } else {
    const groups = new Map<number, typeof r.inverters>()
    for (const v of r.inverters) groups.set(v.strings, [...(groups.get(v.strings) ?? []), v])
    cols = [...groups.values()].map((g) => ({
      label: `INV-${g[0].id}~${g.at(-1)!.id}`,
      strings: g[0].strings,
      kWdc: g[0].kWdc,
      count: g.length,
    }))
  }

  const x0 = 80
  const width = Math.max(640, x0 + cols.length * COL + 40)
  cols.forEach((c, i) => {
    const cx = x0 + i * COL
    // PV 어레이
    rect(cx - 36, 40, 72, 44)
    line([cx - 36, 84], [cx + 36, 40])
    text([cx - 30, 56], 'PV', 11)
    line([cx, 84], [cx, 136])
    text([cx + 8, 104], `${c.strings}회로 × ${r.stringLen}장`, 9)
    text([cx + 8, 117], `DC ${fmt(c.kWdc)} kWp`, 9)
    // DC 차단기(개폐기)
    circle([cx, 138], 2)
    line([cx, 138], [cx + 10, 156])
    circle([cx, 158], 2)
    line([cx, 160], [cx, 190])
    text([cx + 14, 152], 'DC 차단기', 9)
    // 인버터
    rect(cx - 28, 190, 56, 48)
    line([cx - 28, 238], [cx + 28, 190])
    text([cx - 22, 206], '=', 12)
    text([cx + 10, 232], '~', 12)
    text([cx + 34, 208], c.count > 1 ? `${c.label}` : c.label, 9)
    text([cx + 34, 221], c.count > 1 ? `${fmt(e.inverterKW, 0)} kW × ${c.count}대` : `${fmt(e.inverterKW, 0)} kW`, 9)
    line([cx, 238], [cx, 272])
    // MCCB
    rect(cx - 7, 272, 14, 14)
    line([cx - 7, 272], [cx + 7, 286])
    line([cx - 7, 286], [cx + 7, 272])
    text([cx + 12, 283], 'MCCB', 9)
    line([cx, 286], [cx, 330])
  })

  const xa = x0 - 50
  const xb = x0 + (cols.length - 1) * COL + 50
  line([xa, 330], [xb, 330], true)
  text([xa, 346], `AC 집합반 ${e.acV}V 3상`, 10)
  const mx = (xa + xb) / 2
  line([mx, 330], [mx, 360])
  rect(mx - 8, 360, 16, 16)
  line([mx - 8, 360], [mx + 8, 376])
  line([mx - 8, 376], [mx + 8, 360])
  text([mx + 14, 372], `주차단기 (AC ${fmt(r.kWac, 0)} kW)`, 9)
  line([mx, 376], [mx, 410])
  circle([mx, 424], 14)
  text([mx, 428], 'kWh', 9, 'middle')
  text([mx + 20, 428], '전력량계(MOF)', 9)
  line([mx, 438], [mx, 470])
  let y = 470
  if (r.connection === 'MV') {
    circle([mx, y + 16], 15)
    circle([mx, y + 38], 15)
    text([mx + 22, y + 26], `변압기 ${e.acV}V / 22.9kV`, 9)
    text([mx + 22, y + 39], `${(r.transformerKVA ?? 0).toLocaleString('ko-KR')} kVA`, 9)
    line([mx, y + 53], [mx, y + 86])
    rect(mx - 8, y + 86, 16, 18)
    text([mx + 14, y + 99], 'VCB', 9)
    line([mx, y + 104], [mx, y + 140])
    y += 140
    text([mx, y + 18], '한전 배전선로 22.9kV', 11, 'middle')
  } else {
    line([mx, y], [mx, y + 40])
    y += 40
    text([mx, y + 18], `한전 저압 계통 ${e.acV}V`, 11, 'middle')
  }
  line([mx - 6, y - 8], [mx, y])
  line([mx + 6, y - 8], [mx, y])

  // 표제란
  const height = y + 130
  const tx = width - 300
  const ty = height - 100
  rect(tx, ty, 280, 84)
  line([tx, ty + 22], [tx + 280, ty + 22])
  text([tx + 8, ty + 16], '태양광 단선결선도 (개략·검토용)', 11)
  text([tx + 8, ty + 38], info.title, 9)
  text(
    [tx + 8, ty + 52],
    `DC ${fmt(r.kWdc)} kWp · AC ${fmt(r.kWac, 0)} kW · DC/AC ${r.dcAc.toFixed(2)} · 모듈 ${info.moduleWatt}W`,
    9,
  )
  text([tx + 8, ty + 66], `스트링 ${r.strings.length}회로 × ${r.stringLen}장 · 인버터 ${r.inverters.length}대 · ${r.connection === 'MV' ? '특고압' : '저압'} 연계`, 9)
  text([tx + 8, ty + 80], info.date, 9)
  return { width, height, prims }
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function sldToSvg(d: SldDrawing, standalone = true): string {
  const parts = d.prims.map((p) => {
    switch (p.t) {
      case 'line':
        return `<line x1="${p.a[0]}" y1="${p.a[1]}" x2="${p.b[0]}" y2="${p.b[1]}" stroke-width="${p.heavy ? 3 : 1.2}"/>`
      case 'rect':
        return `<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" fill="none" stroke-width="1.2"/>`
      case 'circle':
        return `<circle cx="${p.c[0]}" cy="${p.c[1]}" r="${p.r}" fill="none" stroke-width="1.2"/>`
      case 'text':
        return `<text x="${p.p[0]}" y="${p.p[1]}" font-size="${p.size}" text-anchor="${p.anchor ?? 'start'}" stroke="none" fill="currentColor">${esc(p.s)}</text>`
    }
  })
  const head = standalone ? ' xmlns="http://www.w3.org/2000/svg"' : ''
  return `<svg${head} viewBox="0 0 ${d.width} ${d.height}" width="${d.width}" height="${d.height}" font-family="Pretendard, 'Malgun Gothic', sans-serif" stroke="currentColor" color="#1d2330"><rect width="100%" height="100%" fill="#fff" stroke="none"/>${parts.join('')}</svg>`
}

export function sldToDxf(d: SldDrawing): string {
  const w = new DxfWriter().layer('SLD', 7).layer('SLD_TEXT', 2)
  const f = ([x, y]: Pt): Pt => [x, d.height - y]
  for (const p of d.prims) {
    if (p.t === 'line') w.line('SLD', f(p.a), f(p.b))
    else if (p.t === 'rect') w.polyline('SLD', [f([p.x, p.y]), f([p.x + p.w, p.y]), f([p.x + p.w, p.y + p.h]), f([p.x, p.y + p.h])], true)
    else if (p.t === 'circle') w.circle('SLD', f(p.c), p.r)
    else w.text('SLD_TEXT', f(p.p), p.size * 0.8, p.s, p.anchor === 'middle' ? 'center' : 'left')
  }
  return w.toString()
}

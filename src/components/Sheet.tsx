// 도면 한 장: 용지(mm 좌표) 위에 도곽, 표제란, 설계 개요, 도면 본문, 사용자가 그린 주석을 그린다.
// 평면도는 실제 축척으로, 상세도는 개략도라 "NONE"으로 둔다.

import { useEffect, useMemo } from 'react'
import SideElevation from './SideElevation'
import { DcWiringSheet, FrontElevation, InverterOutline, ModuleOutline, SimpleSection } from './DetailDrawings'
import { LocalFrame, type Vec } from '../lib/geo'
import { setbackRings, setMixText, setQuadLonLat, type LayoutParams, type LayoutStats, type ModuleSet, type SetGeometry } from '../lib/layout'
import type { Parcel } from '../lib/parcel'
import type { Obstacle } from '../lib/shading'
import type { ElecParams, ElecResult } from '../lib/electrical'
import type { TerrainResult } from '../lib/terrain'
import { buildSld } from '../lib/export/sld'
import { GROUP_COLORS } from '../lib/palette'
import { calcBlocks, bomBlocks, quantityBlocks, type DocBlock } from '../lib/docs'
import type { DesignMetrics } from '../lib/design'
import { FRAME, PAPER, SHEETS, drawArea, fitScale, scaleBar, type Annot, type Paper, type SheetDef } from '../lib/sheets'

export interface SheetData {
  parcel: Parcel | null
  sets: ModuleSet[]
  params: LayoutParams
  geometry: SetGeometry
  stats: LayoutStats
  obstacles: Obstacle[]
  elec: ElecResult | null
  elecParams: ElecParams
  terrain: TerrainResult | null
  area: number
  date: string
  /** 설계 지표(설치비·발전량). 계산 전이면 null */
  metrics: DesignMetrics | null
}

interface Props {
  def: SheetDef
  paper: Paper
  data: SheetData
  annots: Annot[]
  selected?: string | null
  /** 이 장의 축척(1/S)을 알려 준다. 치수 주석이 실제 길이를 적는 데 쓴다. */
  scale?: number | null
  ref?: React.Ref<SVGSVGElement>
  /** 이 장의 축척이 정해지면 알려 준다(상단 표시용) */
  onScale?: (scale: number | null) => void
  onPointerDown?: (e: React.PointerEvent<SVGSVGElement>) => void
  onPointerMove?: (e: React.PointerEvent<SVGSVGElement>) => void
  onPointerUp?: (e: React.PointerEvent<SVGSVGElement>) => void
  draft?: Annot | null
}

const fmt = (n: number, d = 0) => n.toLocaleString('ko-KR', { maximumFractionDigits: d })
const azText = (a: number) => (Math.abs(a) < 0.05 ? '정남' : `${a > 0 ? '서' : '동'} ${fmt(Math.abs(a), 1)}°`)
/** 개요 칸 높이(mm) */
const SUMMARY_H = 24

/** 평면도에 쓸 로컬 좌표(m) 모음 */
function usePlan(data: SheetData) {
  const { parcel, sets, geometry, obstacles, elec, terrain, params } = data
  return useMemo(() => {
    if (!parcel) return null
    const f = LocalFrame.around(parcel.rings)
    const loc = (r: number[][]) => r.map((c) => f.toLocal(c) as Vec)
    const rings = parcel.rings.map(loc)
    const all = rings.flat()
    const minX = Math.min(...all.map((v) => v[0]))
    const maxX = Math.max(...all.map((v) => v[0]))
    const minY = Math.min(...all.map((v) => v[1]))
    const maxY = Math.max(...all.map((v) => v[1]))
    return {
      frame: f,
      rings,
      setback: setbackRings(parcel, params).map(loc),
      bbox: { minX, maxX, minY, maxY, w: maxX - minX, h: maxY - minY },
      sets: sets.map((s) => ({ id: s.id, q: loc(setQuadLonLat(s, geometry)), inv: elec?.setInverter[s.id] ?? -1 })),
      obstacles: obstacles.map((o) => ({ name: o.name, h: o.height, q: loc(o.ring) })),
      inverters: elec ? elec.inverters.map((v) => ({ id: v.id, p: f.toLocal(v.lonlat) as Vec, kW: v.kWdc })) : [],
      board: elec ? (f.toLocal(elec.switchboard) as Vec) : null,
      cells: terrain ? terrain.cells.map((c) => ({ q: loc(c.ring), dz: c.dz, slope: c.slopePct })) : [],
    }
  }, [parcel, sets, geometry, obstacles, elec, terrain, params])
}
type Plan = NonNullable<ReturnType<typeof usePlan>>

/** 실제 m 좌표를 용지 mm로 옮기는 함수. 북쪽이 위. */
function planTransform(plan: Plan, area: { x: number; y: number; w: number; h: number }, pad = 1.12) {
  const { bbox } = plan
  const scale = fitScale(bbox.w * pad, bbox.h * pad, area.w, area.h)
  const k = 1000 / scale
  const cx = area.x + area.w / 2
  const cy = area.y + area.h / 2
  const mx = (bbox.minX + bbox.maxX) / 2
  const my = (bbox.minY + bbox.maxY) / 2
  const P = ([x, y]: Vec): Vec => [cx + (x - mx) * k, cy - (y - my) * k]
  const pts = (r: Vec[]) => r.map((v) => P(v).join(',')).join(' ')
  return { scale, k, P, pts }
}

function North({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`} className="sh-north">
      <circle r={5} />
      <path d="M0,-4.2 L2.2,2.8 L0,1.4 L-2.2,2.8 Z" />
      <text y={-6.2} textAnchor="middle">
        N
      </text>
    </g>
  )
}

function ScaleBar({ x, y, scale }: { x: number; y: number; scale: number }) {
  const m = scaleBar(scale)
  const len = (m * 1000) / scale
  return (
    <g transform={`translate(${x} ${y})`} className="sh-scalebar">
      <rect width={len / 2} height={1.2} className="fill" />
      <rect x={len / 2} width={len / 2} height={1.2} />
      <text y={-1.2}>0</text>
      <text x={len} y={-1.2} textAnchor="end">
        {fmt(m)} m
      </text>
    </g>
  )
}

/** 위쪽 설계 개요 표 */
function Summary({ data, x, y, w }: { data: SheetData; x: number; y: number; w: number }) {
  const { params: p, stats, elec } = data
  const cells: Array<[string, string]> = [
    ['발전소', data.parcel?.address ?? '-'],
    ['설비용량', `${fmt(stats.kWp, 2)} kWp`],
    ['모듈', `${p.moduleWatt} W × ${fmt(stats.modules)}장`],
    ['인버터', elec ? `${elec.inverters.length}대 · AC ${fmt(elec.kWac, 1)} kW` : '-'],
    ['경사·방위', `${p.tilt}° · ${azText(p.azimuth)}`],
    ['부지 면적', `${fmt(data.area)} ㎡`],
    ['세트', stats.mix.length > 1 ? setMixText(stats, p) : `${p.setCols}열×${p.setRows}단 · ${fmt(stats.sets)}개`],
    ['열 이격', `${p.rowSpacing} m · 경계 ${p.boundarySetback} m${p.edgeSetbacks?.length ? ` (변별 ${p.edgeSetbacks.length}곳)` : ''}`],
  ]
  const cols = 4
  const cw = w / cols
  const rh = (SUMMARY_H - 6) / 2
  return (
    <g className="sh-summary">
      <rect x={x} y={y} width={w} height={SUMMARY_H} />
      <text x={x + 2} y={y + 4} className="sh-h">
        ■ 설계 개요
      </text>
      {cells.map(([k, v], i) => {
        const cx = x + (i % cols) * cw
        const cy = y + 6 + Math.floor(i / cols) * rh
        return (
          <g key={k}>
            <rect x={cx} y={cy} width={cw} height={rh} className="cell" />
            <text x={cx + 1.6} y={cy + 3.4} className="sh-k">
              {k}
            </text>
            <text x={cx + 1.6} y={cy + 7.4} className="sh-v">
              {v.length > 28 ? `${v.slice(0, 27)}…` : v}
            </text>
          </g>
        )
      })}
    </g>
  )
}

function Legend({ x, y, items }: { x: number; y: number; items: Array<[string, string]> }) {
  const h = 5 + items.length * 4.2
  return (
    <g className="sh-legend" transform={`translate(${x} ${y - h})`}>
      <rect width={46} height={h} />
      <text x={2} y={3.8} className="sh-h">
        ■ 범례
      </text>
      {items.map(([cls, label], i) => (
        <g key={label} transform={`translate(2.5 ${6 + i * 4.2})`}>
          <rect width={5} height={2.6} className={cls} />
          <text x={7} y={2.3}>
            {label}
          </text>
        </g>
      ))}
    </g>
  )
}

/**
 * 문서 표(설계계산서 등). 표를 위에서부터 쌓고, 칸 아래에 닿으면 오른쪽 단으로 넘긴다.
 * 오른쪽 단까지 차면 나머지 줄은 줄여 쓰고 그 사실을 적는다.
 */
function DocTables({ title, blocks, area, empty }: { title: string; blocks: DocBlock[]; area: { x: number; y: number; w: number; h: number }; empty: string }) {
  const rowH = 5
  const top = area.y + 14
  // 한 단에 다 들어가면 폭을 다 쓰고, 넘칠 때만 두 단으로 나눈다.
  const total = blocks.reduce((a, b) => a + (b.rows.length + 2) * rowH + 4, 0)
  const twoCols = area.w > 250 && top + total > area.y + area.h
  const colW = twoCols ? (area.w - 8) / 2 : area.w
  const out: React.ReactNode[] = []
  let col = 0
  let y = top
  let cut = 0
  const maxChars = (w: number) => Math.floor(w / 2.3)
  const clip = (t: string, w: number) => (t.length > maxChars(w) ? `${t.slice(0, maxChars(w) - 1)}…` : t)
  blocks.forEach((b, bi) => {
    const need = (b.rows.length + 2) * rowH + 4
    if (y + need > area.y + area.h && y > top && twoCols && col === 0) {
      col = 1
      y = top
    }
    const x0 = area.x + col * (colW + 8)
    out.push(
      <text key={`h${bi}`} x={x0} y={y + 3.6} className="sh-h">
        {b.heading}
      </text>,
    )
    y += rowH
    let cx = x0
    const head = b.cols.map(([label, frac], ci) => {
      const w = colW * frac
      const node = (
        <g key={`c${ci}`}>
          <rect x={cx} y={y} width={w} height={rowH} className="sh-group" />
          <text x={cx + 1.5} y={y + 3.5} className="sh-k">
            {label}
          </text>
        </g>
      )
      cx += w
      return node
    })
    out.push(<g key={`hd${bi}`}>{head}</g>)
    y += rowH
    for (const [ri, row] of b.rows.entries()) {
      if (y + rowH > area.y + area.h) {
        cut += b.rows.length - ri
        break
      }
      let rx = x0
      out.push(
        <g key={`r${bi}-${ri}`}>
          {row.map((cell, ci) => {
            const w = colW * b.cols[ci][1]
            const last = ci === row.length - 1
            const node = (
              <g key={ci}>
                <rect x={rx} y={y} width={w} height={rowH} className="cell" />
                <text x={last ? rx + w - 1.5 : rx + 1.5} y={y + 3.5} textAnchor={last ? 'end' : 'start'}>
                  {clip(cell, w)}
                </text>
              </g>
            )
            rx += w
            return node
          })}
        </g>,
      )
      y += rowH
    }
    y += 4
  })
  return (
    <g className="sh-table">
      <text x={area.x + area.w / 2} y={area.y + 8} textAnchor="middle" className="sh-title-big">
        {title}
      </text>
      {blocks.length ? out : (
        <text x={area.x + area.w / 2} y={area.y + area.h / 2} textAnchor="middle" className="sh-empty">
          {empty}
        </text>
      )}
      {cut > 0 && (
        <text x={area.x} y={area.y + area.h + 3} className="sh-label">
          {`칸이 모자라 ${cut}줄을 줄였습니다. A3 용지로 바꾸면 모두 들어갑니다.`}
        </text>
      )}
    </g>
  )
}

/** 도면 본문. 축척(없으면 null)과 그림을 돌려준다. */
function useBody(def: SheetDef, paper: Paper, data: SheetData) {
  const plan = usePlan(data)
  const full = drawArea(paper)
  const withSummary = drawArea(paper, SUMMARY_H + 4)
  const { w: pw, h: ph } = PAPER[paper]
  const legendX = full.x + full.w - 48
  const legendY = full.y + full.h - 2
  const emptyMsg = (msg: string) => (
    <text x={full.x + full.w / 2} y={full.y + full.h / 2} textAnchor="middle" className="sh-empty">
      {msg}
    </text>
  )
  // 개략 상세도는 칸 가운데에 조금 작게 둔다(글자가 지나치게 커지지 않게).
  const detail = { x: full.x + full.w * 0.12, y: full.y + 8, w: full.w * 0.76, h: full.h - 16 }
  const embed = (node: React.ReactNode, area = detail) => (
    <svg x={area.x} y={area.y} width={area.w} height={area.h}>
      {node}
    </svg>
  )

  switch (def.id) {
    case 'cover': {
      return {
        scale: null,
        body: (
          <g className="sh-cover">
            <text x={full.x + full.w / 2} y={full.y + full.h * 0.32} textAnchor="middle" className="t1">
              태양광 발전설비 설계도서
            </text>
            <text x={full.x + full.w / 2} y={full.y + full.h * 0.32 + 12} textAnchor="middle" className="t2">
              {data.parcel?.address ?? '부지 미정'}
            </text>
            <text x={full.x + full.w / 2} y={full.y + full.h * 0.32 + 22} textAnchor="middle" className="t3">
              설비용량 {fmt(data.stats.kWp, 2)} kWp · 모듈 {fmt(data.stats.modules)}장{data.elec ? ` · 인버터 ${data.elec.inverters.length}대` : ''}
            </text>
            <line x1={full.x + full.w * 0.25} x2={full.x + full.w * 0.75} y1={full.y + full.h * 0.32 + 28} y2={full.y + full.h * 0.32 + 28} />
            <text x={full.x + full.w / 2} y={full.y + full.h * 0.75} textAnchor="middle" className="t3">
              {data.date}
            </text>
            <text x={full.x + full.w / 2} y={full.y + full.h * 0.75 + 8} textAnchor="middle" className="t2">
              솔라 레이아웃
            </text>
          </g>
        ),
      }
    }
    case 'index': {
      const rowH = 5.4
      const tw = Math.min(full.w * 0.8, 200)
      const tx = full.x + (full.w - tw) / 2
      let y = full.y + 16
      const rows: React.ReactNode[] = []
      let lastGroup = ''
      for (const s of SHEETS) {
        if (s.group !== lastGroup) {
          rows.push(
            <g key={`g-${s.group}`}>
              <rect x={tx} y={y} width={tw} height={rowH} className="sh-group" />
              <text x={tx + 2} y={y + 3.8} className="sh-h">
                ■ {s.group}
              </text>
            </g>,
          )
          y += rowH
          lastGroup = s.group
        }
        rows.push(
          <g key={s.id}>
            <rect x={tx} y={y} width={tw} height={rowH} className="cell" />
            <line x1={tx + 24} x2={tx + 24} y1={y} y2={y + rowH} />
            <line x1={tx + tw - 40} x2={tx + tw - 40} y1={y} y2={y + rowH} />
            <text x={tx + 12} y={y + 3.8} textAnchor="middle">
              {s.no}
            </text>
            <text x={tx + 27} y={y + 3.8}>
              {s.title}
            </text>
            <text x={tx + tw - 20} y={y + 3.8} textAnchor="middle">
              {['site-plan', 'array-plan', 'inverter-plan', 'grading', 'slope'].includes(s.id) ? '축척 표기' : 'NONE'}
            </text>
          </g>,
        )
        y += rowH
      }
      return {
        scale: null,
        body: (
          <g className="sh-table">
            <text x={full.x + full.w / 2} y={full.y + 8} textAnchor="middle" className="sh-title-big">
              도면 목록표
            </text>
            <rect x={tx} y={full.y + 16 - rowH} width={tw} height={rowH} className="sh-group" />
            <text x={tx + 12} y={full.y + 16 - 1.6} textAnchor="middle" className="sh-h">
              도면번호
            </text>
            <text x={tx + 27} y={full.y + 16 - 1.6} className="sh-h">
              도면명
            </text>
            <text x={tx + tw - 20} y={full.y + 16 - 1.6} textAnchor="middle" className="sh-h">
              축척
            </text>
            {rows}
          </g>
        ),
      }
    }
    case 'site-plan':
    case 'array-plan':
    case 'inverter-plan':
    case 'grading':
    case 'slope': {
      if (!plan) return { scale: null, body: emptyMsg('필지를 고르거나 영역을 그리면 평면도를 그립니다.') }
      const area = withSummary
      const t = planTransform(plan, area)
      const byInv = def.id === 'array-plan' || def.id === 'inverter-plan'
      const showTerrain = def.id === 'grading' || def.id === 'slope'
      if (showTerrain && !plan.cells.length)
        return {
          scale: null,
          body: (
            <>
              <Summary data={data} x={full.x} y={full.y} w={full.w} />
              {emptyMsg('지형 탭에서 표고를 불러오면 이 도면을 그립니다.')}
            </>
          ),
        }
      const dzMax = Math.max(0.1, ...plan.cells.map((c) => Math.abs(c.dz)))
      const cellFill = (c: Plan['cells'][number]) =>
        def.id === 'grading'
          ? c.dz >= 0
            ? `rgba(28,64,140,${Math.min(0.85, (c.dz / dzMax) * 0.85 + 0.05)})`
            : `rgba(201,42,42,${Math.min(0.85, (-c.dz / dzMax) * 0.85 + 0.05)})`
          : ['#d3f9d8', '#8ce99a', '#ffe066', '#ffa94d', '#ff6b6b'][Math.min(4, Math.floor(c.slope / 5))]
      const bb = plan.bbox
      const [x0, y0] = t.P([bb.minX, bb.minY])
      const [x1, y1] = t.P([bb.maxX, bb.maxY])
      return {
        scale: t.scale,
        body: (
          <g>
            <Summary data={data} x={full.x} y={full.y} w={full.w} />
            {showTerrain &&
              plan.cells.map((c, i) => <polygon key={`c${i}`} points={t.pts(c.q)} fill={cellFill(c)} stroke="none" />)}
            {plan.rings.map((r, i) => (
              <polygon key={`p${i}`} points={t.pts(r)} className="sh-parcel" />
            ))}
            {plan.setback.map((r, i) => (
              <polygon key={`b${i}`} points={t.pts(r)} className="sh-setback" />
            ))}
            {plan.obstacles.map((o, i) => (
              <polygon key={`o${i}`} points={t.pts(o.q)} className="sh-obstacle" />
            ))}
            {plan.sets.map((s) => (
              <polygon
                key={s.id}
                points={t.pts(s.q)}
                className={showTerrain ? 'sh-set ghost' : 'sh-set'}
                style={byInv && s.inv >= 0 ? { fill: GROUP_COLORS[s.inv % GROUP_COLORS.length] } : undefined}
              />
            ))}
            {def.id === 'inverter-plan' && plan.board && (
              <>
                {plan.inverters.map((v) => {
                  const a = t.P(v.p)
                  const b = t.P(plan.board!)
                  return <polyline key={`l${v.id}`} points={`${a[0]},${a[1]} ${b[0]},${a[1]} ${b[0]},${b[1]}`} className="sh-ac" />
                })}
                {(() => {
                  const b = t.P(plan.board!)
                  return (
                    <g>
                      <rect x={b[0] - 2.5} y={b[1] - 1.8} width={5} height={3.6} className="sh-board" />
                      <text x={b[0] + 3.5} y={b[1] + 1} className="sh-label">
                        {data.elec?.switchboardLabel ?? '수배전반'}
                      </text>
                    </g>
                  )
                })()}
              </>
            )}
            {byInv &&
              plan.inverters.map((v) => {
                const [x, y] = t.P(v.p)
                return (
                  <g key={`i${v.id}`}>
                    <rect x={x - 1.6} y={y - 1.2} width={3.2} height={2.4} className="sh-inv" />
                    <text x={x + 2.2} y={y - 1.4} className="sh-label">
                      INV-{v.id}
                    </text>
                  </g>
                )
              })}
            {def.id === 'array-plan' && (
              <g className="sh-dim">
                <line x1={x0} x2={x1} y1={y0 + 5} y2={y0 + 5} />
                <line x1={x0} x2={x0} y1={y0 + 3} y2={y0 + 7} />
                <line x1={x1} x2={x1} y1={y0 + 3} y2={y0 + 7} />
                <text x={(x0 + x1) / 2} y={y0 + 9}>
                  동서 {fmt(bb.w, 1)} m
                </text>
                <line x1={x0 - 5} x2={x0 - 5} y1={y0} y2={y1} />
                <line x1={x0 - 7} x2={x0 - 3} y1={y0} y2={y0} />
                <line x1={x0 - 7} x2={x0 - 3} y1={y1} y2={y1} />
                <text x={x0 - 7} y={(y0 + y1) / 2} transform={`rotate(-90 ${x0 - 7} ${(y0 + y1) / 2})`}>
                  남북 {fmt(bb.h, 1)} m
                </text>
              </g>
            )}
            <North x={area.x + area.w - 8} y={area.y + 9} />
            <ScaleBar x={area.x + 4} y={area.y + area.h - 3} scale={t.scale} />
            <Legend
              x={legendX}
              y={legendY}
              items={
                def.id === 'grading'
                  ? [
                      ['lg-fill', '성토(계획고 > 지반)'],
                      ['lg-cut', '절토(계획고 < 지반)'],
                      ['lg-parcel', '부지 경계'],
                    ]
                  : def.id === 'slope'
                    ? [
                        ['lg-s0', '0~5%'],
                        ['lg-s1', '5~10%'],
                        ['lg-s2', '10~15%'],
                        ['lg-s3', '15~20%'],
                        ['lg-s4', '20% 이상'],
                      ]
                    : [
                        ['lg-parcel', '부지 경계'],
                        ['lg-setback', '경계 이격선'],
                        ['lg-set', byInv ? '모듈 세트(인버터별 색)' : '모듈 세트'],
                        ['lg-obstacle', '장애물'],
                        ...(byInv ? ([['lg-inv', '인버터']] as Array<[string, string]>) : []),
                        ...(def.id === 'inverter-plan' ? ([['lg-ac', 'AC 간선(개략 경로)']] as Array<[string, string]>) : []),
                      ]
              }
            />
          </g>
        ),
      }
    }
    case 'set-plan': {
      const p = data.params
      const g = data.geometry
      const along = (p.portrait ? p.moduleWidth : p.moduleLength) / 1000
      const across = (p.portrait ? p.moduleLength : p.moduleWidth) / 1000
      const gap = p.moduleGap / 1000
      const area = withSummary
      const scale = fitScale(g.width * 1.3, g.depth * 1.6, area.w, area.h)
      const k = 1000 / scale
      const ox = area.x + (area.w - g.width * k) / 2
      const oy = area.y + (area.h - g.depth * k) / 2
      const projected = (across * Math.cos((p.tilt * Math.PI) / 180)) * k
      const gapProj = gap * Math.cos((p.tilt * Math.PI) / 180) * k
      const mods: React.ReactNode[] = []
      for (let r = 0; r < p.setRows; r++)
        for (let c = 0; c < p.setCols; c++)
          mods.push(<rect key={`${r}-${c}`} x={ox + c * (along + gap) * k} y={oy + r * (projected + gapProj)} width={along * k} height={projected} className="sh-module" />)
      return {
        scale,
        body: (
          <g>
            <Summary data={data} x={full.x} y={full.y} w={full.w} />
            {mods}
            <g className="sh-dim">
              <line x1={ox} x2={ox + g.width * k} y1={oy - 6} y2={oy - 6} />
              <line x1={ox} x2={ox} y1={oy - 8} y2={oy - 4} />
              <line x1={ox + g.width * k} x2={ox + g.width * k} y1={oy - 8} y2={oy - 4} />
              <text x={ox + (g.width * k) / 2} y={oy - 7.5}>
                {fmt(g.width * 1000)}
              </text>
              <line x1={ox + g.width * k + 6} x2={ox + g.width * k + 6} y1={oy} y2={oy + g.depth * k} />
              <line x1={ox + g.width * k + 4} x2={ox + g.width * k + 8} y1={oy} y2={oy} />
              <line x1={ox + g.width * k + 4} x2={ox + g.width * k + 8} y1={oy + g.depth * k} y2={oy + g.depth * k} />
              <text x={ox + g.width * k + 9} y={oy + (g.depth * k) / 2} textAnchor="start">
                {fmt(g.depth * 1000)} (수평 투영)
              </text>
              <line x1={ox} x2={ox + along * k} y1={oy + g.depth * k + 6} y2={oy + g.depth * k + 6} />
              <text x={ox + (along * k) / 2} y={oy + g.depth * k + 10}>
                모듈 {fmt(along * 1000)}
              </text>
            </g>
            <text x={area.x + area.w / 2} y={area.y + area.h - 4} textAnchor="middle" className="sh-label">
              {p.setCols}열 × {p.setRows}단 = {g.modules}장 · {fmt(g.watt / 1000, 2)} kWp · 패널 간격 {p.moduleGap} mm · 경사 {p.tilt}°
            </text>
            <North x={area.x + area.w - 8} y={area.y + 9} />
          </g>
        ),
      }
    }
    case 'calc':
    case 'bom':
    case 'quantity': {
      const make = { calc: calcBlocks, bom: bomBlocks, quantity: quantityBlocks }[def.id]
      return {
        scale: null,
        body: <DocTables title={def.title} blocks={data.parcel && data.sets.length ? make(data) : []} area={full} empty="세트를 배치하면 이 문서를 만듭니다." />,
      }
    }
    case 'side':
      return { scale: null, body: embed(<SideElevation params={data.params} geometry={data.geometry} lat={data.parcel ? LocalFrame.around(data.parcel.rings).lat0 : 36.5} />) }
    case 'front':
    case 'section':
    case 'module':
    case 'inverter': {
      const props = { params: data.params, geometry: data.geometry, lat: 36.5, elec: data.elec, elecParams: data.elecParams }
      const C = { front: FrontElevation, section: SimpleSection, module: ModuleOutline, inverter: InverterOutline }[def.id]
      return { scale: null, body: embed(<C {...props} />) }
    }
    case 'dc': {
      if (!data.elec || !data.elec.inverters.length) return { scale: null, body: emptyMsg('세트를 배치하면 스트링 구성으로 DC 결선도를 그립니다.') }
      const n = Math.min(4, data.elec.inverters.length)
      const cols = n > 1 ? 2 : 1
      const rowsN = Math.ceil(n / cols)
      const cw = full.w / cols
      const rh = full.h / rowsN
      return {
        scale: null,
        body: (
          <g>
            {Array.from({ length: n }, (_, i) =>
              embed(
                <DcWiringSheet params={data.params} geometry={data.geometry} lat={36.5} elec={data.elec!} elecParams={data.elecParams} inverter={i} />,
                { x: full.x + (i % cols) * cw, y: full.y + Math.floor(i / cols) * rh, w: cw - 2, h: rh - 2 },
              ),
            )}
            {data.elec.inverters.length > n && (
              <text x={full.x + 2} y={full.y + full.h - 1} className="sh-label">
                인버터 {data.elec.inverters.length}대 중 {n}대를 그렸습니다. 나머지도 같은 구성입니다.
              </text>
            )}
          </g>
        ),
      }
    }
    case 'sld': {
      if (!data.elec) return { scale: null, body: emptyMsg('세트를 배치하면 스트링·인버터 구성으로 단선결선도를 그립니다.') }
      const d = buildSld(data.elec, data.elecParams, { title: data.parcel?.address ?? '', moduleWatt: data.params.moduleWatt, date: data.date })
      return {
        scale: null,
        body: (
          <svg x={full.x} y={full.y} width={full.w} height={full.h} viewBox={`0 0 ${d.width} ${d.height}`} className="sh-sld">
            {d.prims.map((q, i) =>
              q.t === 'line' ? (
                <line key={i} x1={q.a[0]} y1={q.a[1]} x2={q.b[0]} y2={q.b[1]} strokeWidth={q.heavy ? 3 : 1.2} />
              ) : q.t === 'rect' ? (
                <rect key={i} x={q.x} y={q.y} width={q.w} height={q.h} fill="none" strokeWidth={1.2} />
              ) : q.t === 'circle' ? (
                <circle key={i} cx={q.c[0]} cy={q.c[1]} r={q.r} fill="none" strokeWidth={1.2} />
              ) : (
                <text key={i} x={q.p[0]} y={q.p[1]} fontSize={q.size} textAnchor={q.anchor ?? 'start'} stroke="none">
                  {q.s}
                </text>
              ),
            )}
          </svg>
        ),
      }
    }
  }
  void pw
  void ph
}

/** 오른쪽 표제란 */
function TitleBlock({ def, paper, data, scale }: { def: SheetDef; paper: Paper; data: SheetData; scale: number | null }) {
  const { w, h } = PAPER[paper]
  const m = FRAME.margin
  const x = w - m - FRAME.title
  const tw = FRAME.title
  const rows: Array<[string, string]> = [
    ['도면번호', def.no],
    ['축척', scale ? `1/${fmt(scale)}` : 'NONE'],
    ['용지', paper],
    ['작성일', data.date],
  ]
  const bottom = h - m
  const rowH = 7
  const infoTop = bottom - rows.length * rowH
  const titleTop = infoTop - 16
  const projTop = titleTop - 18
  const signH = 14
  return (
    <g className="sh-titleblock">
      <line x1={x} x2={x} y1={m} y2={bottom} />
      <text x={x + tw / 2} y={m + 8} textAnchor="middle" className="brand">
        ☀ 솔라 레이아웃
      </text>
      <text x={x + tw / 2} y={m + 12.5} textAnchor="middle" className="small">
        태양광 설계 자동화
      </text>
      {['설계', '검토', '승인'].map((k, i) => (
        <g key={k}>
          <rect x={x} y={m + 18 + i * signH} width={tw} height={signH} />
          <text x={x + 2} y={m + 22 + i * signH} className="small">
            {k}
          </text>
        </g>
      ))}
      <rect x={x} y={projTop} width={tw} height={18} />
      <text x={x + 2} y={projTop + 4} className="small">
        공사명
      </text>
      <text x={x + tw / 2} y={projTop + 11} textAnchor="middle" className="mid">
        {(data.parcel?.address ?? '태양광 발전소').slice(0, 22)}
      </text>
      <text x={x + tw / 2} y={projTop + 15.5} textAnchor="middle" className="small">
        태양광 발전시설 ({fmt(data.stats.kWp, 1)} kWp)
      </text>
      <rect x={x} y={titleTop} width={tw} height={16} />
      <text x={x + 2} y={titleTop + 4} className="small">
        도면명
      </text>
      <text x={x + tw / 2} y={titleTop + 11} textAnchor="middle" className="name">
        {def.title}
      </text>
      {rows.map(([k, v], i) => (
        <g key={k}>
          <rect x={x} y={infoTop + i * rowH} width={tw} height={rowH} />
          <line x1={x + 18} x2={x + 18} y1={infoTop + i * rowH} y2={infoTop + (i + 1) * rowH} />
          <text x={x + 2} y={infoTop + i * rowH + 4.6} className="small">
            {k}
          </text>
          <text x={x + 20} y={infoTop + i * rowH + 4.8} className="mid">
            {v}
          </text>
        </g>
      ))}
    </g>
  )
}

function AnnotShape({ a, scale, selected }: { a: Annot; scale: number | null; selected: boolean }) {
  const cls = `sh-annot${selected ? ' on' : ''}`
  switch (a.kind) {
    case 'line':
      return <line data-annot={a.id} className={cls} x1={a.a[0]} y1={a.a[1]} x2={a.b[0]} y2={a.b[1]} />
    case 'rect':
      return (
        <rect
          data-annot={a.id}
          className={cls}
          x={Math.min(a.a[0], a.b[0])}
          y={Math.min(a.a[1], a.b[1])}
          width={Math.abs(a.b[0] - a.a[0])}
          height={Math.abs(a.b[1] - a.a[1])}
        />
      )
    case 'circle':
      return <circle data-annot={a.id} className={cls} cx={a.a[0]} cy={a.a[1]} r={Math.hypot(a.b[0] - a.a[0], a.b[1] - a.a[1])} />
    case 'text':
      return (
        <text data-annot={a.id} className={`${cls} txt`} x={a.a[0]} y={a.a[1]}>
          {a.text}
        </text>
      )
    case 'dim': {
      const mm = Math.hypot(a.b[0] - a.a[0], a.b[1] - a.a[1])
      const label = scale ? `${fmt((mm * scale) / 1000, 2)} m` : `${fmt(mm, 1)} mm`
      const ang = (Math.atan2(a.b[1] - a.a[1], a.b[0] - a.a[0]) * 180) / Math.PI
      const up = ang > 90 || ang < -90 ? ang + 180 : ang
      const mx = (a.a[0] + a.b[0]) / 2
      const my = (a.a[1] + a.b[1]) / 2
      return (
        <g data-annot={a.id} className={`${cls} dim`}>
          <line x1={a.a[0]} y1={a.a[1]} x2={a.b[0]} y2={a.b[1]} />
          <circle cx={a.a[0]} cy={a.a[1]} r={0.6} />
          <circle cx={a.b[0]} cy={a.b[1]} r={0.6} />
          <text x={mx} y={my - 1} textAnchor="middle" transform={`rotate(${up} ${mx} ${my})`}>
            {label}
          </text>
        </g>
      )
    }
  }
}

export default function Sheet({ ref, ...props }: Props) {
  const { def, paper, data, onScale } = props
  const { w, h } = PAPER[paper]
  const m = FRAME.margin
  const out = useBody(def, paper, data)
  const scale = out?.scale ?? null
  useEffect(() => onScale?.(scale), [onScale, scale])
  const full = drawArea(paper)
  const tx = full.x + full.w / 2
  const ty = h - m - 9
  return (
    <svg
      ref={ref}
      className="sheet"
      viewBox={`0 0 ${w} ${h}`}
      width={`${w}mm`}
      height={`${h}mm`}
      xmlns="http://www.w3.org/2000/svg"
      onPointerDown={props.onPointerDown}
      onPointerMove={props.onPointerMove}
      onPointerUp={props.onPointerUp}
    >
      <rect width={w} height={h} className="sh-paper" />
      <rect x={m} y={m} width={w - m * 2} height={h - m * 2} className="sh-frame" />
      <rect x={m + 1.2} y={m + 1.2} width={w - m * 2 - 2.4} height={h - m * 2 - 2.4} className="sh-frame-in" />
      {out?.body}
      <g className="sh-caption">
        <circle cx={tx - 22} cy={ty} r={3} />
        <text x={tx - 22} y={ty + 1.1} textAnchor="middle" className="small">
          1
        </text>
        <text x={tx - 16} y={ty + 1.4}>
          {def.title}
        </text>
        <line x1={tx - 16} x2={tx + 26} y1={ty + 2.6} y2={ty + 2.6} />
        <text x={tx - 16} y={ty + 6} className="small">
          SCALE : {scale ? `1/${fmt(scale)}` : 'NONE'}
        </text>
      </g>
      <TitleBlock def={def} paper={paper} data={data} scale={scale} />
      <g className="sh-annots">
        {props.annots.map((a) => (
          <AnnotShape key={a.id} a={a} scale={scale} selected={props.selected === a.id} />
        ))}
        {props.draft && <AnnotShape a={props.draft} scale={scale} selected={false} />}
      </g>
    </svg>
  )
}

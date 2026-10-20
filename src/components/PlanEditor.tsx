import { useEffect, useMemo, useRef, useState } from 'react'
import { LocalFrame, type Vec } from '../lib/geo'
import { moduleQuadsLonLat, setQuadLocal, type LayoutParams, type ModuleSet, type SetGeometry } from '../lib/layout'
import type { Parcel } from '../lib/parcel'
import type { Obstacle } from '../lib/shading'
import type { ElecResult } from '../lib/electrical'
import { GROUP_COLORS } from '../lib/palette'
import type { MapTool } from './MapView'

interface Props {
  parcel: Parcel
  sets: ModuleSet[]
  params: LayoutParams
  geometry: SetGeometry
  obstacles: Obstacle[]
  selected: ReadonlySet<string>
  tool: MapTool
  elec: ElecResult | null
  onSelect: (ids: string[], additive: boolean) => void
  onMoveSets: (moved: Array<{ id: string; lon: number; lat: number }>) => void
  onAddSet: (lon: number, lat: number) => void
}

/** 이보다 모듈이 많으면 패널 줄눈은 생략하고 세트 외곽만 그린다(그리기 부담). */
const MAX_MODULE_LINES = 6000

type Drag =
  | { kind: 'move'; ids: string[]; start: Vec; d: Vec }
  | { kind: 'pan'; start: Vec; startCenter: Vec; moved: boolean }
  | { kind: 'box'; start: Vec; end: Vec }

/**
 * 지도 타일 없이 필지·세트를 미터 단위로 그린 편집용 배치도.
 * 세트를 끌어 옮기고, Shift+클릭·Shift+드래그로 여러 개 고르고, 화살표 키로 미세 이동한다. 휠로 확대, 빈 곳을 끌면 화면 이동.
 */
export default function PlanEditor(props: Props) {
  const { parcel, sets, geometry, selected } = props
  const frame = useMemo(() => LocalFrame.around(parcel.rings), [parcel])
  const svgRef = useRef<SVGSVGElement>(null)
  const [size, setSize] = useState<Vec>([320, 320])
  // 보기 상태는 필지에 묶어 둔다. 필지가 바뀌면 기본 맞춤으로 돌아간다.
  const [viewState, setViewState] = useState<{ parcel: Parcel; zoom: number; center: Vec | null }>({ parcel, zoom: 1, center: null })
  const fresh = viewState.parcel === parcel
  const zoom = fresh ? viewState.zoom : 1
  const center = fresh ? viewState.center : null
  const setZoom = (f: (z: number) => number) => setViewState({ parcel, zoom: f(zoom), center })
  const setCenter = (c: Vec | null) => setViewState((v) => ({ parcel, zoom: v.parcel === parcel ? v.zoom : 1, center: c }))
  const [drag, setDrag] = useState<Drag | null>(null)

  const base = useMemo(() => {
    const pts = parcel.rings.flat().map((c) => frame.toLocal(c))
    const xs = pts.map((p) => p[0])
    const ys = pts.map((p) => p[1])
    const minX = Math.min(...xs)
    const maxX = Math.max(...xs)
    const minY = Math.min(...ys)
    const maxY = Math.max(...ys)
    const pad = Math.max(4, 0.08 * Math.max(maxX - minX, maxY - minY))
    return {
      rings: parcel.rings.map((r) => r.map((c) => frame.toLocal(c))),
      cx: (minX + maxX) / 2,
      cy: (minY + maxY) / 2,
      w: maxX - minX + 2 * pad,
      h: maxY - minY + 2 * pad,
    }
  }, [parcel, frame])

  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setSize([e.contentRect.width || 1, e.contentRect.height || 1]))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // 화면 비율에 맞춘 보기 영역(미터). SVG 좌표는 (x, −y)로 북쪽이 위.
  const [cw, ch] = size
  const fit = Math.min(cw / base.w, ch / base.h) * zoom // px per m
  const vw = cw / fit
  const vh = ch / fit
  const c = center ?? [base.cx, base.cy]
  const viewBox = `${c[0] - vw / 2} ${-c[1] - vh / 2} ${vw} ${vh}`

  const local = useMemo(() => {
    const quads = sets.map((s) => ({ id: s.id, center: frame.toLocal([s.lon, s.lat]), azimuth: s.azimuth }))
    const modules =
      sets.length * geometry.modules <= MAX_MODULE_LINES
        ? sets.map((s) => {
            const [x0, y0] = frame.toLocal([s.lon, s.lat])
            return moduleQuadsLonLat(s, props.params, geometry).map((q) =>
              q.map((v) => {
                const [x, y] = frame.toLocal(v)
                return [x - x0, y - y0] as Vec
              }),
            )
          })
        : null
    return { quads, modules }
  }, [sets, frame, geometry, props.params])

  const obstacles = useMemo(() => props.obstacles.map((o) => o.ring.map((c) => frame.toLocal(c))), [props.obstacles, frame])

  const pts = (r: Vec[], dx = 0, dy = 0) => r.map(([x, y]) => `${(x + dx).toFixed(3)},${(-(y + dy)).toFixed(3)}`).join(' ')

  /** 화면 좌표 → 로컬 미터 */
  const toLocal = (clientX: number, clientY: number): Vec => {
    const svg = svgRef.current!
    const m = svg.getScreenCTM()
    if (!m) return [0, 0]
    const p = new DOMPoint(clientX, clientY).matrixTransform(m.inverse())
    return [p.x, -p.y]
  }

  const commitMove = (ids: string[], [dx, dy]: Vec) => {
    if (Math.hypot(dx, dy) < 0.01) return
    const byId = new Set(ids)
    props.onMoveSets(
      sets
        .filter((s) => byId.has(s.id))
        .map((s) => {
          const [x, y] = frame.toLocal([s.lon, s.lat])
          const [lon, lat] = frame.toLonLat([x + dx, y + dy])
          return { id: s.id, lon, lat }
        }),
    )
  }

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return
    const p = toLocal(e.clientX, e.clientY)
    const id = (e.target as Element).closest('[data-set]')?.getAttribute('data-set')
    svgRef.current?.focus({ preventScroll: true })
    if (props.tool === 'add' && !id) {
      const [lon, lat] = frame.toLonLat(p)
      props.onAddSet(lon, lat)
      return
    }
    if (id) {
      if (e.shiftKey) {
        props.onSelect([id], true)
        return
      }
      const ids = selected.has(id) ? [...selected] : [id]
      if (!selected.has(id)) props.onSelect([id], false)
      setDrag({ kind: 'move', ids, start: p, d: [0, 0] })
    } else if (e.shiftKey) {
      // Shift+빈 곳 끌기: 영역 안 세트를 선택에 더한다.
      setDrag({ kind: 'box', start: p, end: p })
    } else {
      setDrag({ kind: 'pan', start: [e.clientX, e.clientY], startCenter: c, moved: false })
    }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!drag) return
    if (drag.kind === 'move') {
      const p = toLocal(e.clientX, e.clientY)
      setDrag({ ...drag, d: [p[0] - drag.start[0], p[1] - drag.start[1]] })
    } else if (drag.kind === 'box') {
      setDrag({ ...drag, end: toLocal(e.clientX, e.clientY) })
    } else {
      const dx = (e.clientX - drag.start[0]) / fit
      const dy = (e.clientY - drag.start[1]) / fit
      const moved = drag.moved || Math.hypot(e.clientX - drag.start[0], e.clientY - drag.start[1]) > 3
      setDrag({ ...drag, moved })
      if (moved) setCenter([drag.startCenter[0] - dx, drag.startCenter[1] + dy])
    }
  }

  const onPointerUp = () => {
    if (!drag) return
    if (drag.kind === 'move') commitMove(drag.ids, drag.d)
    else if (drag.kind === 'box') {
      const [x0, x1] = [Math.min(drag.start[0], drag.end[0]), Math.max(drag.start[0], drag.end[0])]
      const [y0, y1] = [Math.min(drag.start[1], drag.end[1]), Math.max(drag.start[1], drag.end[1])]
      const ids = local.quads.filter(({ center: [x, y] }) => x >= x0 && x <= x1 && y >= y0 && y <= y1).map((q) => q.id)
      if (ids.length) props.onSelect(ids, true)
    } else if (!drag.moved) props.onSelect([], false)
    setDrag(null)
  }

  // 휠 확대는 커서 자리를 고정한 채로. React의 onWheel은 passive라 직접 건다.
  const zoomRef = useRef({ zoom, c })
  const parcelRef = useRef(parcel)
  useEffect(() => {
    zoomRef.current = { zoom, c }
    parcelRef.current = parcel
  })
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const { zoom: z, c: cc } = zoomRef.current
      const next = Math.min(40, Math.max(0.5, z * Math.exp(-e.deltaY * 0.0015)))
      const m = svg.getScreenCTM()
      if (!m) return
      const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse())
      const px: Vec = [p.x, -p.y]
      const r = z / next
      setViewState({ parcel: parcelRef.current, zoom: next, center: [px[0] + (cc[0] - px[0]) * r, px[1] + (cc[1] - px[1]) * r] })
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
  }, [])

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 1 : 0.1
    const d: Record<string, Vec> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }
    if (!d[e.key] || !selected.size) return
    e.preventDefault()
    commitMove([...selected], d[e.key])
  }

  const [cx, cy] = c
  const grid = useMemo(() => {
    const step = niceLength(Math.max(vw, vh) / 8)
    const x0 = Math.floor((cx - vw / 2) / step) * step
    const y0 = Math.floor((cy - vh / 2) / step) * step
    const xs: number[] = []
    const ys: number[] = []
    for (let x = x0; x <= cx + vw / 2; x += step) xs.push(x)
    for (let y = y0; y <= cy + vh / 2; y += step) ys.push(y)
    return { xs, ys }
  }, [vw, vh, cx, cy])

  const bar = niceLength(vw / 5)
  const moving = drag?.kind === 'move' ? new Set(drag.ids) : null
  const md = drag?.kind === 'move' ? drag.d : ([0, 0] as Vec)

  return (
    <div className="plan">
      <svg
        ref={svgRef}
        className={`plan-svg${props.tool === 'add' ? ' adding' : ''}${drag?.kind === 'pan' && drag.moved ? ' panning' : ''}`}
        viewBox={viewBox}
        tabIndex={0}
        role="application"
        aria-label="배치도 편집. 세트를 끌어 옮기고 화살표 키로 미세 이동합니다."
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => setDrag(null)}
        onKeyDown={onKeyDown}
      >
        <g className="plan-grid">
          {grid.xs.map((x) => (
            <line key={`x${x}`} x1={x} x2={x} y1={-(c[1] + vh)} y2={-(c[1] - vh)} />
          ))}
          {grid.ys.map((y) => (
            <line key={`y${y}`} y1={-y} y2={-y} x1={c[0] - vw} x2={c[0] + vw} />
          ))}
        </g>
        {base.rings.map((r, i) => (
          <polygon key={`p${i}`} points={pts(r)} className="plan-parcel" />
        ))}
        {obstacles.map((r, i) => (
          <polygon key={`o${i}`} points={pts(r)} className="plan-obstacle" />
        ))}
        {local.quads.map((s, i) => {
          const [dx, dy] = moving?.has(s.id) ? md : [0, 0]
          const q = setQuadLocal(s.center, s.azimuth, geometry)
          const inv = props.elec?.setInverter[s.id]
          const fill = inv !== undefined ? GROUP_COLORS[inv % GROUP_COLORS.length] : undefined
          return (
            <g key={s.id} data-set={s.id} className={selected.has(s.id) ? 'plan-set selected' : 'plan-set'}>
              <polygon points={pts(q, dx, dy)} style={fill ? { fill } : undefined} />
              {local.modules?.[i].map((m, j) => (
                <polygon key={j} className="plan-module" points={pts(m, s.center[0] + dx, s.center[1] + dy)} />
              ))}
            </g>
          )
        })}
        {drag?.kind === 'box' && (
          <rect
            className="plan-box"
            x={Math.min(drag.start[0], drag.end[0])}
            y={-Math.max(drag.start[1], drag.end[1])}
            width={Math.abs(drag.end[0] - drag.start[0])}
            height={Math.abs(drag.end[1] - drag.start[1])}
          />
        )}
      </svg>
      <div className="plan-overlay scalebar" aria-hidden="true">
        <span style={{ width: bar * fit }} />
        {bar} m
      </div>
      <div className="plan-overlay northmark" aria-hidden="true">
        <svg viewBox="-10 -12 20 24" width="16" height="20">
          <path d="M0,-11 L7,8 L0,4 L-7,8 Z" />
        </svg>
        N
      </div>
      <div className="plan-overlay plan-zoom">
        <button type="button" className="ghost icon" onClick={() => setZoom((z) => Math.min(40, z * 1.4))} aria-label="확대">
          +
        </button>
        <button type="button" className="ghost icon" onClick={() => setZoom((z) => Math.max(0.5, z / 1.4))} aria-label="축소">
          −
        </button>
        <button
          type="button"
          className="ghost"
          onClick={() => setViewState({ parcel, zoom: 1, center: null })}
        >
          맞춤
        </button>
      </div>
    </div>
  )
}

function niceLength(x: number): number {
  const p = 10 ** Math.floor(Math.log10(Math.max(x, 1e-6)))
  const m = x / p
  return (m >= 5 ? 5 : m >= 2 ? 2 : 1) * p
}

import { useEffect, useMemo, useRef, useState } from 'react'
import { LocalFrame, deg2rad, type Vec } from '../lib/geo'
import { forSet, moduleQuads3D, setPosts3D, setQuadLocal, totalModules, type LayoutParams, type ModuleSet, type SetGeometry } from '../lib/layout'
import type { Parcel } from '../lib/parcel'
import type { Obstacle } from '../lib/shading'
import type { ElecResult } from '../lib/electrical'
import { GROUP_COLORS } from '../lib/palette'

interface Props {
  parcel: Parcel
  sets: ModuleSet[]
  params: LayoutParams
  geometry: SetGeometry
  obstacles: Obstacle[]
  selected: ReadonlySet<string>
  elec: ElecResult | null
}

type P3 = [number, number, number]
/** 그릴 면 하나. 먼 것부터 칠한다(화가 알고리즘). */
type Face = { pts: P3[]; fill: string; stroke: string; lw: number; kind: 'module' | 'solid' | 'post' }

/** 이보다 모듈이 많으면 패널 대신 세트 판 하나로 그린다. */
const MAX_MODULES = 8000

/** yaw: 보는 방향(0 = 남쪽에서 북쪽을 본다, −90 = 동쪽에서), pitch: 내려다보는 각 */
const VIEWS = {
  iso: { yaw: -35, pitch: 32 },
  top: { yaw: 0, pitch: 90 },
  front: { yaw: 0, pitch: 12 },
  side: { yaw: -90, pitch: 12 },
}

const MODULE = '#1c408c'
const BACK = '#c9ced6'

/** 모듈 앞면 색을 빛 방향에 따라 밝기만 바꾼다. */
function shade(hex: string, k: number) {
  const n = parseInt(hex.slice(1), 16)
  const ch = (v: number) => Math.round(Math.min(255, v * k))
  return `rgb(${ch(n >> 16)}, ${ch((n >> 8) & 255)}, ${ch(n & 255)})`
}

/**
 * 배치도를 3D로 본다. 지도 타일 없이 필지 바닥, 기울어진 모듈, 가대 기둥, 장애물을 캔버스에 직접 그린다.
 * 끌어서 돌리고, 휠이나 +/−로 확대한다. 편집은 2D 배치도에서 한다.
 */
export default function Plan3D(props: Props) {
  const { parcel, sets, params, geometry, selected } = props
  const frame = useMemo(() => LocalFrame.around(parcel.rings), [parcel])
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState<Vec>([320, 320])
  const [view, setView] = useState(VIEWS.iso)
  const [zoom, setZoom] = useState(1)
  const drag = useRef<{ x: number; y: number; yaw: number; pitch: number } | null>(null)

  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setSize([e.contentRect.width || 1, e.contentRect.height || 1]))
    ro.observe(el)
    // 휠로 페이지가 스크롤되지 않게 passive: false로 단다.
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      setZoom((z) => Math.min(30, Math.max(0.4, z * (e.deltaY < 0 ? 1.15 : 1 / 1.15))))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      ro.disconnect()
      el.removeEventListener('wheel', onWheel)
    }
  }, [])

  // 세계 좌표(로컬 m, x 동 · y 북 · z 위)의 면 목록. 시점과 무관해서 배치가 바뀔 때만 다시 만든다.
  const scene = useMemo(() => {
    const ground = parcel.rings.map((r) => r.map((c) => frame.toLocal(c)))
    const pts = ground.flat()
    const xs = pts.map((p) => p[0])
    const ys = pts.map((p) => p[1])
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2
    const radius = Math.max(5, ...pts.map(([x, y]) => Math.hypot(x - cx, y - cy)))

    const faces: Face[] = []
    const tan = Math.tan(deg2rad(params.tilt))
    const detailed = totalModules(sets, geometry) <= MAX_MODULES
    for (const s of sets) {
      const [ox, oy] = frame.toLocal([s.lon, s.lat])
      const inv = props.elec?.setInverter[s.id]
      const color = inv !== undefined ? GROUP_COLORS[inv % GROUP_COLORS.length] : MODULE
      const sel = selected.has(s.id)
      for (const [x, y, h] of setPosts3D(s, params, geometry))
        faces.push({ pts: [[ox + x, oy + y, 0], [ox + x, oy + y, h]], fill: '', stroke: '#868e96', lw: 1.5, kind: 'post' })
      const quads: P3[][] = detailed
        ? moduleQuads3D(s, params, geometry)
        : [setQuadLocal([0, 0], s.azimuth, forSet(geometry, s)).map(([x, y], i) => [x, y, params.groundClearance + (i < 2 ? 0 : geometry.depth * tan)] as P3)]
      for (const q of quads)
        faces.push({
          pts: q.map(([x, y, z]) => [ox + x, oy + y, z] as P3),
          fill: sel ? '#e8590c' : color,
          stroke: sel ? '#c2410c' : 'rgba(255,255,255,0.55)',
          lw: sel ? 1.2 : 0.6,
          kind: 'module',
        })
    }
    // 장애물: 벽과 지붕을 면으로 세운다.
    for (const o of props.obstacles) {
      const r = o.ring.map((c) => frame.toLocal(c))
      const ring = r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1] ? r.slice(0, -1) : r
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i]
        const b = ring[(i + 1) % ring.length]
        faces.push({ pts: [[a[0], a[1], 0], [b[0], b[1], 0], [b[0], b[1], o.height], [a[0], a[1], o.height]], fill: '#adb5bd', stroke: '#495057', lw: 0.8, kind: 'solid' })
      }
      faces.push({ pts: ring.map(([x, y]) => [x, y, o.height] as P3), fill: '#ced4da', stroke: '#495057', lw: 0.8, kind: 'solid' })
    }
    return { ground, cx, cy, radius, faces }
  }, [parcel, frame, sets, params, geometry, selected, props.obstacles, props.elec])

  useEffect(() => {
    const cv = canvasRef.current
    if (!cv) return
    const [w, h] = size
    const dpr = window.devicePixelRatio || 1
    cv.width = Math.round(w * dpr)
    cv.height = Math.round(h * dpr)
    const ctx = cv.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)

    const yaw = deg2rad(view.yaw)
    const pitch = deg2rad(view.pitch)
    const cyaw = Math.cos(yaw)
    const syaw = Math.sin(yaw)
    const cp = Math.cos(pitch)
    const sp = Math.sin(pitch)
    const scale = (Math.min(w, h) / (2 * scene.radius)) * 0.92 * zoom
    // 직교 투영: 화면 x, 화면 위쪽 높이, 카메라에서의 깊이
    const proj = ([x, y, z]: P3) => {
      const dx = x - scene.cx
      const dy = y - scene.cy
      const rx = dx * cyaw - dy * syaw
      const ry = dx * syaw + dy * cyaw
      return { x: w / 2 + rx * scale, y: h / 2 - (ry * sp + z * cp) * scale, d: ry * cp - z * sp }
    }
    const path = (pts: P3[]) => {
      ctx.beginPath()
      pts.forEach((p, i) => {
        const q = proj(p)
        if (i) ctx.lineTo(q.x, q.y)
        else ctx.moveTo(q.x, q.y)
      })
    }

    // 바닥: 필지
    for (const r of scene.ground) {
      path(r.map(([x, y]) => [x, y, 0]))
      ctx.closePath()
      ctx.fillStyle = 'rgba(232, 89, 12, 0.07)'
      ctx.fill()
      ctx.strokeStyle = '#e8590c'
      ctx.lineWidth = 1.5
      ctx.stroke()
    }

    // 카메라 쪽 단위 벡터(세계 좌표). 면이 이쪽을 보면 앞면이다.
    const toCam: P3 = [syaw * cp * -1, -cyaw * cp, sp]
    const sun: P3 = [0, -Math.cos(deg2rad(45)), Math.sin(deg2rad(45))]
    const items = scene.faces.map((f) => {
      let d = 0
      for (const p of f.pts) d += proj(p).d
      return { f, d: d / f.pts.length }
    })
    items.sort((a, b) => b.d - a.d)
    for (const { f } of items) {
      if (f.kind === 'post') {
        path(f.pts)
        ctx.strokeStyle = f.stroke
        ctx.lineWidth = f.lw
        ctx.stroke()
        continue
      }
      const [a, b, c] = f.pts
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
      const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
      const len = Math.hypot(n[0], n[1], n[2]) || 1
      if (n[2] < 0) for (let i = 0; i < 3; i++) n[i] = -n[i] // 모듈 앞면 법선은 위를 향한다
      const facing = (n[0] * toCam[0] + n[1] * toCam[1] + n[2] * toCam[2]) / len
      const lit = Math.max(0, (n[0] * sun[0] + n[1] * sun[1] + n[2] * sun[2]) / len)
      path(f.pts)
      ctx.closePath()
      ctx.fillStyle = f.kind === 'module' && facing < -0.02 ? BACK : shade(f.fill, 0.75 + 0.45 * lit)
      ctx.fill()
      ctx.strokeStyle = f.stroke
      ctx.lineWidth = f.lw
      ctx.stroke()
    }
  }, [scene, size, view, zoom])

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { x: e.clientX, y: e.clientY, yaw: view.yaw, pitch: view.pitch }
  }
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current
    if (!d) return
    setView({ yaw: d.yaw - (e.clientX - d.x) * 0.4, pitch: Math.min(90, Math.max(2, d.pitch + (e.clientY - d.y) * 0.3)) })
  }
  const onPointerUp = () => {
    drag.current = null
  }

  // 북쪽 표시: 화면에서 북(+y)이 가리키는 방향
  const north = { x: -Math.sin(deg2rad(view.yaw)), y: -Math.cos(deg2rad(view.yaw)) * Math.sin(deg2rad(view.pitch)) }
  const nl = Math.hypot(north.x, north.y) || 1

  return (
    <>
      <canvas
        ref={canvasRef}
        className="plan-3d"
        role="img"
        aria-label="3D 배치도. 끌어서 돌리고 휠로 확대합니다."
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
      <div className="plan-overlay northmark" aria-hidden>
        <svg width="14" height="14" viewBox="-7 -7 14 14">
          <path d="M0,-6 L4,5 L0,2 L-4,5 Z" transform={`rotate(${(Math.atan2(north.x / nl, -north.y / nl) * 180) / Math.PI})`} />
        </svg>
        N
      </div>
      <div className="plan-overlay plan-zoom plan-3d-views">
        <button type="button" className="ghost" onClick={() => setView(VIEWS.iso)} title="비스듬히 내려다보기">
          기본
        </button>
        <button type="button" className="ghost" onClick={() => setView(VIEWS.top)} title="위에서 내려다보기">
          위
        </button>
        <button type="button" className="ghost" onClick={() => setView(VIEWS.front)} title="남쪽에서 모듈 정면 보기">
          정면
        </button>
        <button type="button" className="ghost" onClick={() => setView(VIEWS.side)} title="동쪽에서 경사 단면 보기">
          측면
        </button>
        <span className="toolbar-sep" />
        <button type="button" className="ghost icon" onClick={() => setZoom((z) => Math.min(30, z * 1.4))} aria-label="확대">
          +
        </button>
        <button type="button" className="ghost icon" onClick={() => setZoom((z) => Math.max(0.4, z / 1.4))} aria-label="축소">
          −
        </button>
      </div>
    </>
  )
}

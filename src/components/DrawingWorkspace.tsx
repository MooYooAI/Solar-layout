import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Sheet, { type SheetData } from './Sheet'
import { PAPER, SHEETS, SHEET_GROUPS, type Annot, type AnnotKind, type Paper, type SheetId } from '../lib/sheets'

interface Props {
  data: SheetData
  annots: Partial<Record<SheetId, Annot[]>>
  onAnnots: (sheet: SheetId, next: Annot[]) => void
  /** 배치도 DXF·단선결선도 DXF 내보내기. 못 하면 이유 */
  dxf: { layout: string | null; sld: string | null }
  onLayoutDxf: () => void
  onSldDxf: () => void
  fileBase: string
}

type Tool = 'select' | 'pan' | AnnotKind
const TOOLS: Array<[Tool, string, string]> = [
  ['select', '↖', '선택·옮기기 (V)'],
  ['pan', '✥', '화면 이동 (H)'],
  ['line', '╱', '선 (L)'],
  ['rect', '▭', '사각형 (R)'],
  ['circle', '◯', '원 (C)'],
  ['text', 'T', '글자 (T)'],
  ['dim', '↔', '치수 재기 (D)'],
]
const KEYS: Record<string, Tool> = { v: 'select', h: 'pan', l: 'line', r: 'rect', c: 'circle', t: 'text', d: 'dim' }

/** 화면 1mm = 몇 px인지(96dpi) */
const PX_PER_MM = 96 / 25.4
const fmt = (n: number, d = 0) => n.toLocaleString('ko-KR', { maximumFractionDigits: d })
const uid = () => Math.random().toString(36).slice(2, 9)

/** 화면 CSS로 칠한 SVG를 파일로 쓸 수 있게 계산된 스타일을 속성으로 넣는다. */
function inlineSvg(svg: SVGSVGElement): string {
  const clone = svg.cloneNode(true) as SVGSVGElement
  const props = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-opacity', 'font-size', 'font-weight', 'font-family', 'text-anchor', 'opacity']
  const src = svg.querySelectorAll('*')
  const dst = clone.querySelectorAll('*')
  src.forEach((el, i) => {
    const cs = getComputedStyle(el)
    const d = dst[i] as SVGElement
    for (const p of props) {
      const v = cs.getPropertyValue(p)
      if (v) d.setAttribute(p, v)
    }
    d.removeAttribute('class')
  })
  clone.removeAttribute('class')
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(clone)
}

/** 도면 탭: 왼쪽 도면 목록, 위 도구 막대, 가운데 용지 캔버스. 그려 넣은 주석은 도면마다 따로 남는다. */
export default function DrawingWorkspace(props: Props) {
  const { data, annots, onAnnots } = props
  const [sheetId, setSheetId] = useState<SheetId>('site-plan')
  const [paper, setPaper] = useState<Paper>('A3')
  const [dark, setDark] = useState(true)
  const [tool, setTool] = useState<Tool>('select')
  const [view, setView] = useState({ x: 0, y: 0, z: 0.5 })
  const [scale, setScale] = useState<number | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [draft, setDraft] = useState<Annot | null>(null)
  const [printing, setPrinting] = useState<SheetId[] | null>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const drag = useRef<{ kind: 'pan' | 'move' | 'draw'; sx: number; sy: number; vx: number; vy: number; start?: [number, number]; orig?: Annot } | null>(null)

  const idx = SHEETS.findIndex((s) => s.id === sheetId)
  const def = SHEETS[idx]
  const list = annots[sheetId] ?? []
  const { w: pw, h: ph } = PAPER[paper]

  const fit = useCallback(() => {
    const el = canvasRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const z = Math.min((r.width - 40) / (pw * PX_PER_MM), (r.height - 40) / (ph * PX_PER_MM))
    setView({ z, x: (r.width - pw * PX_PER_MM * z) / 2, y: (r.height - ph * PX_PER_MM * z) / 2 })
  }, [pw, ph])
  useEffect(() => {
    fit()
    const el = canvasRef.current
    if (!el) return
    const ro = new ResizeObserver(() => fit())
    ro.observe(el)
    return () => ro.disconnect()
  }, [fit])

  const zoomAt = (factor: number, cx?: number, cy?: number) => {
    const el = canvasRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const px = cx ?? r.width / 2
    const py = cy ?? r.height / 2
    setView((v) => {
      const z = Math.min(8, Math.max(0.1, v.z * factor))
      const k = z / v.z
      return { z, x: px - (px - v.x) * k, y: py - (py - v.y) * k }
    })
  }
  // 휠 확대는 passive가 아니어야 페이지가 같이 스크롤되지 않는다.
  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - r.left, e.clientY - r.top)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const setList = (next: Annot[]) => onAnnots(sheetId, next)
  const removeSelected = useCallback(() => {
    if (!selected) return
    onAnnots(sheetId, (annots[sheetId] ?? []).filter((a) => a.id !== selected))
    setSelected(null)
  }, [selected, sheetId, annots, onAnnots])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selected) {
          e.preventDefault()
          removeSelected()
        }
        return
      }
      if (e.key === 'Escape') {
        setDraft(null)
        setSelected(null)
        drag.current = null
        return
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const t = KEYS[e.key.toLowerCase()]
      if (t) setTool(t)
      if (e.key === 'PageDown' && idx < SHEETS.length - 1) setSheetId(SHEETS[idx + 1].id)
      if (e.key === 'PageUp' && idx > 0) setSheetId(SHEETS[idx - 1].id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected, removeSelected, idx])

  /** 화면 좌표 → 용지 mm */
  const toPaper = (e: React.PointerEvent): [number, number] => {
    const svg = svgRef.current!
    const pt = svg.createSVGPoint()
    pt.x = e.clientX
    pt.y = e.clientY
    const p = pt.matrixTransform(svg.getScreenCTM()!.inverse())
    return [p.x, p.y]
  }

  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.button !== 1) return
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    const base = { sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y }
    if (e.button === 1 || tool === 'pan') {
      drag.current = { kind: 'pan', ...base }
      return
    }
    const p = toPaper(e)
    if (tool === 'select') {
      const hit = (e.target as Element).closest('[data-annot]')?.getAttribute('data-annot') ?? null
      setSelected(hit)
      const orig = hit ? list.find((a) => a.id === hit) : undefined
      drag.current = orig ? { kind: 'move', ...base, start: p, orig } : { kind: 'pan', ...base }
      return
    }
    if (tool === 'text') {
      const text = window.prompt('넣을 글자')
      if (text?.trim()) setList([...list, { id: uid(), kind: 'text', a: p, b: p, text: text.trim() }])
      return
    }
    drag.current = { kind: 'draw', ...base, start: p }
    setDraft({ id: 'draft', kind: tool, a: p, b: p })
  }
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    if (d.kind === 'pan') {
      setView((v) => ({ ...v, x: d.vx + e.clientX - d.sx, y: d.vy + e.clientY - d.sy }))
      return
    }
    const p = toPaper(e)
    if (d.kind === 'move' && d.orig && d.start) {
      const dx = p[0] - d.start[0]
      const dy = p[1] - d.start[1]
      const o = d.orig
      setList(list.map((a) => (a.id === o.id ? { ...a, a: [o.a[0] + dx, o.a[1] + dy], b: [o.b[0] + dx, o.b[1] + dy] } : a)))
      return
    }
    if (d.kind === 'draw') {
      // Shift를 누르면 선·치수를 수평/수직으로 맞춘다.
      let b = p
      if (e.shiftKey && d.start && (tool === 'line' || tool === 'dim')) {
        const dx = Math.abs(p[0] - d.start[0])
        const dy = Math.abs(p[1] - d.start[1])
        b = dx > dy ? [p[0], d.start[1]] : [d.start[0], p[1]]
      }
      setDraft((dr) => (dr ? { ...dr, b } : dr))
    }
  }
  const onUp = () => {
    const d = drag.current
    drag.current = null
    if (d?.kind === 'draw' && draft) {
      const len = Math.hypot(draft.b[0] - draft.a[0], draft.b[1] - draft.a[1])
      if (len > 0.8) {
        const id = uid()
        setList([...list, { ...draft, id }])
        setSelected(id)
      }
      setDraft(null)
    }
  }

  // 인쇄: 고른 도면을 용지 크기 그대로 문서 끝에 그려 두고 인쇄 창을 연다.
  useEffect(() => {
    if (!printing) return
    const done = () => setPrinting(null)
    window.addEventListener('afterprint', done)
    const id = requestAnimationFrame(() => window.print())
    return () => {
      cancelAnimationFrame(id)
      window.removeEventListener('afterprint', done)
    }
  }, [printing])

  const exportSvg = () => {
    if (!svgRef.current) return
    const blob = new Blob([inlineSvg(svgRef.current)], { type: 'image/svg+xml' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${props.fileBase}-${def.no}-${def.title.replace(/\s+/g, '')}.svg`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }

  return (
    <div className="dw" role="tabpanel" aria-label="도면">
      <aside className="dw-list" aria-label="도면 목록">
        <h3>
          도면 목록 <small>{SHEETS.length}종</small>
        </h3>
        <nav>
          {SHEET_GROUPS.map((g) => (
            <section key={g}>
              <h4>{g}</h4>
              {SHEETS.filter((s) => s.group === g).map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={s.id === sheetId ? 'on' : undefined}
                  aria-current={s.id === sheetId ? 'page' : undefined}
                  onClick={() => {
                    setSheetId(s.id)
                    setSelected(null)
                  }}
                >
                  <span>{s.no}</span>
                  {s.title}
                  {(annots[s.id]?.length ?? 0) > 0 && <i title="그려 넣은 주석이 있습니다">●</i>}
                </button>
              ))}
            </section>
          ))}
        </nav>
      </aside>

      <div className="dw-main">
        <div className="dw-bar" role="toolbar" aria-label="도면 도구">
          <div className="dw-group">
            <button type="button" className="ghost icon" disabled={idx === 0} onClick={() => setSheetId(SHEETS[idx - 1].id)} aria-label="이전 도면" title="이전 도면 (PageUp)">
              ‹
            </button>
            <strong className="dw-name">
              <span>{def.no}</span>
              {def.title}
            </strong>
            <button
              type="button"
              className="ghost icon"
              disabled={idx === SHEETS.length - 1}
              onClick={() => setSheetId(SHEETS[idx + 1].id)}
              aria-label="다음 도면"
              title="다음 도면 (PageDown)"
            >
              ›
            </button>
          </div>
          <div className="dw-group">
            <button type="button" className="ghost" onClick={() => zoomAt(1 / 1.25)} title="축소">
              −
            </button>
            <span className="dw-zoom">{fmt(view.z * 100)}%</span>
            <button type="button" className="ghost" onClick={() => zoomAt(1.25)} title="확대">
              ＋
            </button>
            <button type="button" className="ghost" onClick={fit}>
              맞춤
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => {
                const el = canvasRef.current!
                const r = el.getBoundingClientRect()
                setView({ z: 1, x: (r.width - pw * PX_PER_MM) / 2, y: 20 })
              }}
              title="실제 크기(1 mm = 화면 1 mm)"
            >
              100%
            </button>
          </div>
          <div className="dw-group">
            <span className="dw-label">축척</span>
            <span className="dw-chip">{scale ? `1/${fmt(scale)}` : 'NONE'}</span>
            <span className="dw-label">용지</span>
            <select value={paper} onChange={(e) => setPaper(e.target.value as Paper)} aria-label="용지">
              <option value="A3">A3</option>
              <option value="A4">A4</option>
            </select>
            <button type="button" className={dark ? 'ghost' : 'ghost on'} onClick={() => setDark((v) => !v)} title="종이 색 바꾸기">
              {dark ? '◐ 검은 바탕' : '□ 흰 종이'}
            </button>
          </div>
          <div className="dw-group">
            <button type="button" className="ghost danger" disabled={!list.length} onClick={() => window.confirm('이 도면에 그려 넣은 주석을 모두 지울까요?') && setList([])}>
              편집 지우기
            </button>
            <button type="button" className="ghost" onClick={exportSvg}>
              SVG
            </button>
            <button type="button" className="ghost" disabled={!!props.dxf.layout} title={props.dxf.layout ?? '필지·모듈·전기 레이어 DXF'} onClick={props.onLayoutDxf}>
              배치도 DXF
            </button>
            <button type="button" className="ghost" disabled={!!props.dxf.sld} title={props.dxf.sld ?? '단선결선도 DXF'} onClick={props.onSldDxf}>
              결선도 DXF
            </button>
            <button type="button" className="ghost" onClick={() => setPrinting([sheetId])}>
              인쇄
            </button>
            <button type="button" className="dw-primary" onClick={() => setPrinting(SHEETS.map((s) => s.id))} title="모든 도면을 한 번에 인쇄하거나 PDF로 저장">
              일괄 PDF
            </button>
          </div>
        </div>

        <div className="dw-stage">
          <div className="dw-tools" role="toolbar" aria-label="그리기 도구" aria-orientation="vertical">
            {TOOLS.map(([t, icon, label]) => (
              <button key={t} type="button" className={tool === t ? 'on' : undefined} onClick={() => setTool(t)} title={label} aria-label={label} aria-pressed={tool === t}>
                {icon}
              </button>
            ))}
            <span className="dw-tools-sep" />
            <button type="button" disabled={!selected} onClick={removeSelected} title="선택한 주석 지우기 (Delete)" aria-label="선택한 주석 지우기">
              🗑
            </button>
          </div>
          <div ref={canvasRef} className={`dw-canvas tool-${tool}`} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
            <div className={dark ? 'dw-paper dark' : 'dw-paper'} style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})` }}>
              <Sheet
                ref={svgRef}
                def={def}
                paper={paper}
                data={data}
                annots={list}
                selected={selected}
                draft={draft}
                onScale={setScale}
              />
            </div>
            <p className="dw-hint">
              휠로 확대·축소, 빈 곳을 끌어 이동합니다. 도구로 선·사각형·원·글자·치수를 그려 넣고, 치수는 이 도면의 축척으로 실제 길이를 적습니다.
              Shift를 누르면 수평·수직으로 맞춥니다.
            </p>
          </div>
        </div>
      </div>

      {printing &&
        createPortal(
          <div className={`dw-print paper-${paper}`}>
            {printing.map((id) => (
              <div className="dw-print-page" key={id}>
                <Sheet def={SHEETS.find((s) => s.id === id)!} paper={paper} data={data} annots={annots[id] ?? []} />
              </div>
            ))}
          </div>,
          document.body,
        )}
    </div>
  )
}

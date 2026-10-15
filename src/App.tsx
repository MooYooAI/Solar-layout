import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import MapView, { type FlyTarget, type MapTool } from './components/MapView'
import LayoutPanel from './components/LayoutPanel'
import { getParcelAt, getZoningAt, searchParcel, type BaseMap, type ParcelSearchItem } from './lib/vworld'
import { interiorPoint, lotFromFeature, parcelArea, parcelFromFeature, parcelFromLots, SQM_PER_PYEONG, type Parcel } from './lib/parcel'
import {
  autoLayout,
  DEFAULT_PARAMS,
  layoutStats,
  newSetId,
  setGeometry,
  type LayoutParams,
  type ModuleSet,
} from './lib/layout'
import { dayOfYear, declination, kstToSolar, rowSpacingForNoShade } from './lib/sun'
import { deg2rad, LocalFrame, rotate, type Vec } from './lib/geo'
import ShadePanel from './components/ShadePanel'
import EnergyPanel from './components/EnergyPanel'
import type { Obstacle } from './lib/shading'
import { buildScene, dailyShadeLoss, shadeTable, snapshot } from './lib/analysis'
import { KOREA_GHI, simulateEnergy, type EnergyResult } from './lib/energy'

import OptimizePanel from './components/OptimizePanel'
import type { Candidate, OptimizeInput } from './lib/optimize'
import EconomicsPanel, { type EconSettings } from './components/EconomicsPanel'
import { DEFAULT_ECON } from './lib/economics'
import ReportView from './components/ReportView'

type Tab = 'parcel' | 'layout' | 'shade' | 'energy' | 'econ' | 'ai'

const NO_SHADOWS: Array<{ ring: number[][]; fromSet: boolean }> = []

/** 복사할 때 섞여 들어온 공백·따옴표를 걷어낸다. */
const cleanKey = (k: string | undefined) => (k ?? '').trim().replace(/^["']|["']$/g, '').trim()

// 키는 빌드할 때 저장소 시크릿(VITE_VWORLD_KEY)에서만 넣는다. 화면에서는 보여주지도 받지도 않는다.
const VWORLD_KEY = cleanKey(import.meta.env.VITE_VWORLD_KEY as string | undefined)

// 예전 버전이 브라우저에 저장해 둔 키를 지운다.
try {
  localStorage.removeItem('vworld-key')
} catch {
  /* 저장소를 못 쓰는 환경 */
}

const fmt = (n: number, digits = 0) => n.toLocaleString('ko-KR', { maximumFractionDigits: digits })

export default function App() {
  const vworldKey = VWORLD_KEY
  const [baseMap, setBaseMap] = useState<BaseMap>('Satellite')
  const [showCadastral, setShowCadastral] = useState(true)
  const [showZoning, setShowZoning] = useState(false)
  const [clearMeasuresSeq, setClearMeasuresSeq] = useState(0)
  // 지번(PNU)별 용도지역. 직접 그린 영역은 'manual:…' 키.
  const [zoning, setZoning] = useState<Record<string, string[] | 'error'>>({})
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ParcelSearchItem[]>([])
  const [parcel, setParcelState] = useState<Parcel | null>(null)
  const [flyTo, setFlyTo] = useState<FlyTarget | null>(null)
  const [tab, setTab] = useState<Tab>('parcel')
  const [tool, setTool] = useState<MapTool>('none')
  const [params, setParams] = useState<LayoutParams>(DEFAULT_PARAMS)
  const [sets, setSets] = useState<ModuleSet[]>([])
  // 배치 편집 이력(되돌리기·다시실행). 필지가 바뀌면 비운다.
  const [history, setHistory] = useState<{ past: ModuleSet[][]; future: ModuleSet[][] }>({ past: [], future: [] })
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [obstacles, setObstacles] = useState<Obstacle[]>([])
  const [shadeDate, setShadeDate] = useState({ month: 12, day: 22 })
  const [shadeHour, setShadeHour] = useState(12)
  const [playing, setPlaying] = useState(false)
  const [performanceRatio, setPerformanceRatio] = useState(0.8)
  const [withShade, setWithShade] = useState(true)
  const [energy, setEnergy] = useState<EnergyResult | null>(null)
  const [energyBusy, setEnergyBusy] = useState(false)
  const [optWorker, setOptWorker] = useState<Worker | null>(null)
  const [optProgress, setOptProgress] = useState<{ done: number; total: number; phase: string } | null>(null)
  const [optResults, setOptResults] = useState<Candidate[] | null>(null)
  const [optError, setOptError] = useState<string | null>(null)
  const [econ, setEcon] = useState<EconSettings>(DEFAULT_ECON)
  const [econHours, setEconHours] = useState(3.6)
  const [showReport, setShowReport] = useState(false)
  const drawing = tool === 'draw'
  // 필지가 바뀌면 이전 배치는 의미가 없다.
  const setParcel = (p: Parcel | null) => {
    setParcelState(p)
    if (!p) setAddingLot(false)
    setOptResults(null)
    setObstacles([])
    setEnergy(null)
    setSets([])
    setHistory({ past: [], future: [] })
    setSelected(new Set())
  }
  const setDrawing = (on: boolean | ((d: boolean) => boolean)) => {
    const next = typeof on === 'function' ? on(drawing) : on
    setTool(next ? 'draw' : 'none')
  }
  /** 되돌릴 수 있는 배치 변경 */
  const editSets = (next: ModuleSet[] | ((prev: ModuleSet[]) => ModuleSet[])) => {
    const value = typeof next === 'function' ? next(sets) : next
    setHistory((h) => ({ past: [...h.past.slice(-49), sets], future: [] }))
    setSets(value)
  }
  const undo = () => {
    const prev = history.past.at(-1)
    if (!prev) return
    setHistory({ past: history.past.slice(0, -1), future: [sets, ...history.future] })
    setSets(prev)
    setSelected(new Set())
  }
  const redo = () => {
    const next = history.future[0]
    if (!next) return
    setHistory({ past: [...history.past, sets], future: history.future.slice(1) })
    setSets(next)
    setSelected(new Set())
  }
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  // 켜 두면 지도 클릭·검색 결과가 부지를 바꾸지 않고 지번을 더하거나 뺀다.
  const [addingLot, setAddingLot] = useState(false)
  const lots = parcel?.lots

  const selectParcelAt = useCallback(
    async (lon: number, lat: number) => {
      if (!vworldKey) return
      setBusy(true)
      setMessage(null)
      try {
        const f = await getParcelAt(lon, lat, vworldKey)
        if (!f) setMessage('이 위치에서 필지를 찾지 못했습니다.')
        else if (addingLot && lots) {
          const lot = lotFromFeature(f)
          const next = lots.some((l) => l.pnu === lot.pnu) ? lots.filter((l) => l.pnu !== lot.pnu) : [...lots, lot]
          setParcel(parcelFromLots(next))
        } else setParcel(parcelFromFeature(f))
      } catch (e) {
        setMessage((e as Error).message)
      } finally {
        setBusy(false)
      }
    },
    [vworldKey, addingLot, lots],
  )

  // 부지가 바뀌면 아직 모르는 지번의 용도지역을 찾아 둔다. 결과가 오기 전(undefined)은 조회 중으로 본다.
  const zoningRequested = useRef(new Set<string>())
  const zoningTargets = useMemo(
    () =>
      !parcel
        ? []
        : parcel.lots?.length
          ? parcel.lots.map((l) => ({ key: l.pnu, rings: l.rings }))
          : [{ key: `manual:${parcel.rings[0]?.[0]?.join(',')}:${parcel.rings[0]?.length}`, rings: parcel.rings }],
    [parcel],
  )
  useEffect(() => {
    if (!vworldKey) return
    for (const t of zoningTargets) {
      if (zoningRequested.current.has(t.key)) continue
      zoningRequested.current.add(t.key)
      const [lon, lat] = interiorPoint(t.rings)
      getZoningAt(lon, lat, vworldKey).then(
        (names) => setZoning((z) => ({ ...z, [t.key]: names })),
        () => {
          zoningRequested.current.delete(t.key)
          setZoning((z) => ({ ...z, [t.key]: 'error' }))
        },
      )
    }
  }, [zoningTargets, vworldKey])

  const zoningText = (key: string) => {
    const z = zoning[key]
    if (z === undefined) return '조회 중…'
    if (z === 'error') return '조회 실패'
    return z.length ? z.join(', ') : '정보 없음'
  }
  const parcelZoningKeys = zoningTargets.map((t) => t.key)
  const parcelZoning = [
    ...new Set(
      parcelZoningKeys.flatMap((k) => {
        const z = zoning[k]
        return Array.isArray(z) ? z : []
      }),
    ),
  ]

  const removeLot = (pnu: string) => {
    if (!lots) return
    const next = lots.filter((l) => l.pnu !== pnu)
    setParcel(parcelFromLots(next))
    if (!next.length) setAddingLot(false)
  }

  const onSearch = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!query.trim()) return
    setBusy(true)
    setMessage(null)
    try {
      const items = await searchParcel(query.trim(), vworldKey)
      setResults(items)
      if (items.length === 0) setMessage('검색 결과가 없습니다. 시·군·구와 동·리를 함께 입력해 보세요.')
      if (items.length === 1) pickResult(items[0])
    } catch (err) {
      setMessage((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const pickResult = (it: ParcelSearchItem) => {
    setFlyTo({ lon: it.lon, lat: it.lat, seq: Date.now() })
    void selectParcelAt(it.lon, it.lat)
  }

  // 사각형 수치 입력: 가로(동서)·세로(남북) m, 회전(도, 시계 방향)
  const [rect, setRect] = useState({ width: 50, depth: 30, rotation: 0 })
  const placeRect = (lon: number, lat: number) => {
    const f = new LocalFrame(lon, lat)
    const hw = rect.width / 2
    const hd = rect.depth / 2
    const corners: Vec[] = [
      [-hw, -hd],
      [hw, -hd],
      [hw, hd],
      [-hw, hd],
    ]
    const ring = corners.map((c) => f.toLonLat(rotate(c, -deg2rad(rect.rotation))) as number[])
    setTool('none')
    setParcel({ address: `사각형 영역 ${rect.width}×${rect.depth} m`, rings: [[...ring, ring[0]]], source: 'manual' })
  }
  const onMapClick = (lon: number, lat: number) => {
    if (tool === 'rect') placeRect(lon, lat)
    else void selectParcelAt(lon, lat)
  }

  const onDrawEnd = (ring: number[][]) => {
    setTool('none')
    setParcel({ address: '직접 그린 영역', rings: [ring], source: 'manual' })
  }

  const area = useMemo(() => (parcel ? parcelArea(parcel) : 0), [parcel])
  const geometry = useMemo(() => setGeometry(params), [params])
  const stats = layoutStats(sets, geometry, area)
  const suggestedRowSpacing = useMemo(() => {
    if (!parcel) return null
    const { lat0 } = LocalFrame.around(parcel.rings)
    return rowSpacingForNoShade(lat0, geometry.height - params.groundClearance, params.azimuth)
  }, [parcel, geometry, params.groundClearance, params.azimuth])


  const switchTab = (t: Tab) => {
    setTab(t)
    setTool('none')
    setPlaying(false)
  }

  // 음영 분석 장면: 세트·장애물·설정이 바뀔 때만 다시 만든다.
  const scene = useMemo(
    () => (parcel ? buildScene(parcel.rings, sets, obstacles, params, geometry) : null),
    [parcel, sets, obstacles, params, geometry],
  )
  const n = dayOfYear(shadeDate.month, shadeDate.day)
  const decl = declination(n)
  const shadeView = useMemo(() => {
    if (!scene || tab !== 'shade') return null
    const solar = kstToSolar(shadeHour, scene.frame.lon0, n)
    return snapshot(scene, decl, solar)
  }, [scene, tab, shadeHour, n, decl])
  const dailyLoss = useMemo(
    () => (scene && tab === 'shade' && sets.length ? dailyShadeLoss(scene, decl) : null),
    [scene, tab, sets.length, decl],
  )

  useEffect(() => {
    if (!playing) return
    const id = setInterval(() => setShadeHour((h) => (h >= 20 ? 5 : h + 0.25)), 250)
    return () => clearInterval(id)
  }, [playing])

  const onObstacleDrawn = (ring: number[][]) => {
    setTool('none')
    const name = `장애물 ${obstacles.length + 1}`
    const raw = window.prompt(`${name} 높이(m)를 입력하세요`, '10')
    const height = raw === null ? NaN : Number(raw)
    if (!Number.isFinite(height) || height <= 0) return
    setObstacles((prev) => [...prev, { id: newSetId(), name, ring, height }])
  }

  // 탐색은 수십 번의 배치·음영 계산이라 화면이 멈추지 않게 워커에서 돌린다.
  const runOptimize = () => {
    if (!parcel) return
    optWorker?.terminate()
    const w = new Worker(new URL('./lib/optimize.worker.ts', import.meta.url), { type: 'module' })
    setOptWorker(w)
    setOptResults(null)
    setOptError(null)
    setOptProgress(null)
    w.onmessage = (e) => {
      const m = e.data
      if (m.type === 'progress') setOptProgress({ done: m.done, total: m.total, phase: m.phase })
      else {
        if (m.type === 'done') setOptResults(m.results)
        else setOptError(m.message)
        w.terminate()
        setOptWorker(null)
      }
    }
    const input: OptimizeInput = { parcel, base: params, obstacles, performanceRatio }
    w.postMessage(input)
  }

  const cancelOptimize = () => {
    optWorker?.terminate()
    setOptWorker(null)
  }

  const applyCandidate = (c: Candidate) => {
    if (sets.length && !window.confirm('현재 배치를 이 안으로 바꿀까요?')) return
    setParams(c.params)
    editSets(c.sets)
    setSelected(new Set())
    setEnergy(null)
    switchTab('layout')
  }

  const runEnergy = () => {
    if (!scene || !sets.length) return
    setEnergyBusy(true)
    // 화면이 "계산 중"을 그릴 틈을 준다.
    setTimeout(() => {
      const shade = withShade ? shadeTable(scene) : undefined
      setEnergy(
        simulateEnergy({
          latDeg: scene.frame.lat0,
          tilt: params.tilt,
          azimuth: params.azimuth,
          kWp: stats.kWp,
          performanceRatio,
          albedo: 0.2,
          ghi: KOREA_GHI,
          shade,
        }),
      )
      setEnergyBusy(false)
    }, 30)
  }

  const runAutoLayout = () => {
    if (!parcel) return
    if (sets.length && !window.confirm('현재 배치를 지우고 다시 자동 배치할까요?')) return
    editSets(autoLayout(parcel, params))
    setSelected(new Set())
  }

  const onSelect = (ids: string[], additive: boolean) => {
    setSelected((prev) => {
      if (!additive) return new Set(ids)
      const next = new Set(prev)
      // 클릭 한 번은 토글, 영역 선택은 추가
      if (ids.length === 1 && prev.has(ids[0])) next.delete(ids[0])
      else ids.forEach((id) => next.add(id))
      return next
    })
  }

  const onMoveSets = (moved: Array<{ id: string; lon: number; lat: number }>) => {
    const byId = new Map(moved.map((m) => [m.id, m]))
    editSets((prev) => prev.map((s) => (byId.has(s.id) ? { ...s, ...byId.get(s.id)! } : s)))
  }

  const onAddSet = (lon: number, lat: number) => {
    const s: ModuleSet = { id: newSetId(), lon, lat, azimuth: params.azimuth }
    editSets((prev) => [...prev, s])
    setSelected(new Set([s.id]))
  }

  const deleteSelected = () => {
    editSets((prev) => prev.filter((s) => !selected.has(s.id)))
    setSelected(new Set())
  }

  const rotateSelected = (deg: number) =>
    editSets((prev) => prev.map((s) => (selected.has(s.id) ? { ...s, azimuth: s.azimuth + deg } : s)))

  const clearSets = () => {
    editSets([])
    setSelected(new Set())
  }

  useEffect(() => {
    if (tab !== 'layout') return
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected.size) {
        e.preventDefault()
        deleteSelected()
      }
      if (e.key === 'Escape') setSelected(new Set())
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        redo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // 핸들러가 매번 최신 배치를 쓰도록 렌더마다 다시 건다.
  })

  return (
    <>
    <div className="app">
      <aside className="panel">
        <header>
          <div className="title-row">
            <h1>태양광 배치 설계</h1>
            <button type="button" className="secondary" disabled={!parcel} onClick={() => setShowReport(true)}>
              보고서
            </button>
          </div>
          <ol className="steps">
            <li>
              <button type="button" className={tab === 'parcel' ? 'active' : ''} onClick={() => switchTab('parcel')}>
                필지
              </button>
            </li>
            <li>
              <button type="button" className={tab === 'layout' ? 'active' : ''} onClick={() => switchTab('layout')}>
                배치
              </button>
            </li>
            <li>
              <button type="button" className={tab === 'shade' ? 'active' : ''} onClick={() => switchTab('shade')}>
                음영
              </button>
            </li>
            <li>
              <button type="button" className={tab === 'energy' ? 'active' : ''} onClick={() => switchTab('energy')}>
                발전량
              </button>
            </li>
            <li>
              <button type="button" className={tab === 'econ' ? 'active' : ''} onClick={() => switchTab('econ')}>
                경제성
              </button>
            </li>
            <li>
              <button type="button" className={tab === 'ai' ? 'active' : ''} onClick={() => switchTab('ai')}>
                AI 배치
              </button>
            </li>
          </ol>
        </header>

        {tab === 'layout' && (
          <LayoutPanel
            params={params}
            onParams={setParams}
            suggestedRowSpacing={suggestedRowSpacing}
            stats={stats}
            canLayout={!!parcel}
            tool={tool}
            onTool={setTool}
            selectedCount={selected.size}
            onAutoLayout={runAutoLayout}
            onDeleteSelected={deleteSelected}
            onRotateSelected={rotateSelected}
            onClear={clearSets}
            canUndo={history.past.length > 0}
            canRedo={history.future.length > 0}
            onUndo={undo}
            onRedo={redo}
          />
        )}

        {tab === 'shade' && (
          <ShadePanel
            month={shadeDate.month}
            day={shadeDate.day}
            hour={shadeHour}
            onDate={(month, day) => setShadeDate({ month, day })}
            onHour={setShadeHour}
            playing={playing}
            onPlay={setPlaying}
            sun={shadeView?.sun ?? null}
            currentShade={shadeView?.overall ?? 0}
            dailyLoss={dailyLoss}
            hasSets={sets.length > 0}
            obstacles={obstacles}
            onObstacles={setObstacles}
            tool={tool}
            onTool={setTool}
          />
        )}

        {tab === 'ai' && (
          <OptimizePanel
            canRun={!!parcel}
            running={!!optWorker}
            progress={optProgress}
            results={optResults}
            error={optError}
            onRun={runOptimize}
            onCancel={cancelOptimize}
            onApply={applyCandidate}
          />
        )}

        {tab === 'energy' && (
          <EnergyPanel
            kWp={stats.kWp}
            result={energy}
            busy={energyBusy}
            performanceRatio={performanceRatio}
            onPerformanceRatio={setPerformanceRatio}
            withShade={withShade}
            onWithShade={setWithShade}
            onRun={runEnergy}
            canRun={sets.length > 0}
          />
        )}

        {tab === 'econ' && (
          <EconomicsPanel
            kWp={stats.kWp}
            energyKWh={energy ? energy.specificYield * stats.kWp : null}
            landCategory={parcel?.landCategory}
            settings={econ}
            onSettings={setEcon}
            hours={econHours}
            onHours={setEconHours}
            onGoEnergy={() => switchTab('energy')}
          />
        )}

        {tab === 'parcel' && (
        <>

        {!vworldKey && (
          <section className="card notice">
            <h2>VWorld 인증키</h2>
            <p>
              지번 검색과 지적도는 VWorld 오픈API 키가 있어야 동작합니다.{' '}
              <a href="https://www.vworld.kr/dev/v4dv_apiDevGuide2_s001.do" target="_blank" rel="noreferrer">
                vworld.kr
              </a>
              에서 무료로 발급받아 저장소 시크릿 VITE_VWORLD_KEY(로컬 실행은 .env.local)에 넣으세요. 키 없이도 영역을 직접 그려서 쓸 수 있습니다.
            </p>
          </section>
        )}

        <section className="card">
          <h2>지번 검색</h2>
          <form onSubmit={onSearch} className="row">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="예: 전라남도 해남군 산이면 구성리 100"
              disabled={!vworldKey}
            />
            <button disabled={!vworldKey || busy}>검색</button>
          </form>
          {results.length > 1 && (
            <ul className="results">
              {results.map((r) => (
                <li key={r.id}>
                  <button type="button" onClick={() => pickResult(r)}>
                    <strong>{r.address}</strong>
                    {r.roadAddress && <span>{r.roadAddress}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="hint">
            {vworldKey ? '지도에서 필지를 클릭해도 선택됩니다.' : ''}{' '}
            <button type="button" className="link" onClick={() => setDrawing((d) => !d)}>
              {drawing ? '그리기 취소' : '영역 직접 그리기'}
            </button>
          </p>
          {drawing && <p className="hint">지도를 클릭해 꼭짓점을 찍고, 첫 점을 다시 클릭하면 끝납니다.</p>}
          <details style={{ marginTop: 10 }} open={tool === 'rect'}>
            <summary>사각형 수치 입력</summary>
            <div className="grid2" style={{ marginTop: 8 }}>
              {(
                [
                  ['width', '가로(동서)', 'm'],
                  ['depth', '세로(남북)', 'm'],
                  ['rotation', '회전', '°'],
                ] as const
              ).map(([k, label, unit]) => (
                <label key={k} className="field">
                  <span>{label}</span>
                  <input
                    type="number"
                    step={k === 'rotation' ? 1 : 0.5}
                    min={k === 'rotation' ? -90 : 1}
                    max={k === 'rotation' ? 90 : undefined}
                    value={rect[k]}
                    onChange={(e) => !Number.isNaN(e.target.valueAsNumber) && setRect({ ...rect, [k]: e.target.valueAsNumber })}
                  />
                  <em>{unit}</em>
                </label>
              ))}
            </div>
            <button
              type="button"
              className={tool === 'rect' ? 'block' : 'secondary block'}
              disabled={rect.width <= 0 || rect.depth <= 0}
              onClick={() => setTool(tool === 'rect' ? 'none' : 'rect')}
            >
              {tool === 'rect' ? '놓기 취소' : '지도에 놓기'}
            </button>
            {tool === 'rect' && <p className="hint">사각형 중심이 될 자리를 지도에서 클릭하세요. 회전은 시계 방향입니다.</p>}
          </details>
          {message && <p className="error">{message}</p>}
          {busy && <p className="hint">불러오는 중…</p>}
        </section>

        {parcel && (
          <section className="card">
            <h2>{lots && lots.length > 1 ? `선택한 부지 (${lots.length}필지)` : '선택한 필지'}</h2>
            <dl className="facts">
              <dt>주소</dt>
              <dd>{parcel.address}</dd>
              {parcel.landCategory && (
                <>
                  <dt>지목</dt>
                  <dd>{parcel.landCategory}</dd>
                </>
              )}
              <dt>면적</dt>
              <dd>
                {fmt(area)} ㎡ ({fmt(area / SQM_PER_PYEONG)} 평)
              </dd>
              {vworldKey && (
                <>
                  <dt>용도지역</dt>
                  <dd>
                    {parcelZoning.length
                      ? parcelZoning.join(', ')
                      : zoningText(parcelZoningKeys[0])}
                  </dd>
                </>
              )}
              {parcel.jiga !== undefined && (
                <>
                  <dt>공시지가</dt>
                  <dd>
                    {fmt(parcel.jiga)} 원/㎡ {parcel.jigaYear && `(${parcel.jigaYear}년)`}
                  </dd>
                </>
              )}
              {parcel.pnu && (
                <>
                  <dt>PNU</dt>
                  <dd className="mono">{parcel.pnu}</dd>
                </>
              )}
            </dl>
            {lots && lots.length > 1 && (
              <ul className="lots">
                {lots.map((l) => (
                  <li key={l.pnu}>
                    <span>
                      {l.address}
                      <small>
                        {l.landCategory ?? ''} {fmt(l.area)} ㎡ · {zoningText(l.pnu)}
                      </small>
                    </span>
                    <button type="button" className="secondary" onClick={() => removeLot(l.pnu)} aria-label={`${l.address} 빼기`}>
                      빼기
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {lots && (
              <>
                <button
                  type="button"
                  className={addingLot ? 'block' : 'secondary block'}
                  onClick={() => setAddingLot((a) => !a)}
                >
                  {addingLot ? '지번 추가 끝내기' : '옆 지번 추가'}
                </button>
                {addingLot && (
                  <p className="hint">
                    지도에서 필지를 클릭하거나 위에서 검색해 고르면 부지에 더해집니다. 이미 들어간 필지를 다시 클릭하면 빠집니다. 맞닿은
                    지번은 경계 없이 하나로 합쳐 배치합니다.
                  </p>
                )}
              </>
            )}
            <div className="row" style={{ marginTop: 10 }}>
              <button type="button" onClick={() => switchTab('layout')}>
                {lots && lots.length > 1 ? '이 부지에 배치하기' : '이 필지에 배치하기'}
              </button>
              <button type="button" className="secondary" onClick={() => setParcel(null)}>
                선택 해제
              </button>
            </div>
          </section>
        )}

        <section className="card">
          <h2>지도</h2>
          <div className="row">
            <label>
              <input type="radio" checked={baseMap === 'Satellite'} onChange={() => setBaseMap('Satellite')} /> 위성
            </label>
            <label>
              <input type="radio" checked={baseMap === 'Base'} onChange={() => setBaseMap('Base')} /> 일반
            </label>
            <label>
              <input type="checkbox" checked={showCadastral} onChange={(e) => setShowCadastral(e.target.checked)} /> 지적도
            </label>
            {vworldKey && (
              <label>
                <input type="checkbox" checked={showZoning} onChange={(e) => setShowZoning(e.target.checked)} /> 용도지역
              </label>
            )}
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <button
              type="button"
              className={tool === 'measureLine' ? '' : 'secondary'}
              onClick={() => setTool(tool === 'measureLine' ? 'none' : 'measureLine')}
            >
              거리 재기
            </button>
            <button
              type="button"
              className={tool === 'measureArea' ? '' : 'secondary'}
              onClick={() => setTool(tool === 'measureArea' ? 'none' : 'measureArea')}
            >
              면적 재기
            </button>
            <button type="button" className="secondary" onClick={() => setClearMeasuresSeq((n) => n + 1)}>
              지우기
            </button>
          </div>
          {(tool === 'measureLine' || tool === 'measureArea') && (
            <p className="hint">지도를 클릭해 점을 찍고, 마지막 점에서 두 번 클릭하면 끝납니다.</p>
          )}
        </section>

        </>
        )}
      </aside>

      <main className="map-wrap">
        <MapView
          vworldKey={vworldKey}
          baseMap={baseMap}
          showCadastral={showCadastral}
          showZoning={showZoning}
          clearMeasuresSeq={clearMeasuresSeq}
          parcel={parcel}
          flyTo={flyTo}
          tool={tool}
          sets={sets}
          params={params}
          geometry={geometry}
          selected={selected}
          onMapClick={onMapClick}
          onDrawEnd={onDrawEnd}
          onSelect={onSelect}
          onMoveSets={onMoveSets}
          onAddSet={onAddSet}
          obstacles={obstacles}
          shadows={shadeView?.shadows ?? NO_SHADOWS}
          setShade={shadeView?.perSet ?? null}
          onObstacleDrawn={onObstacleDrawn}
        />
      </main>
    </div>
    {showReport && parcel && (
      <ReportView
        parcel={parcel}
        area={area}
        zoning={parcelZoning}
        params={params}
        geometry={geometry}
        stats={stats}
        sets={sets}
        obstacles={obstacles}
        scene={scene}
        suggestedRowSpacing={suggestedRowSpacing}
        energy={energy}
        econ={econ}
        econHours={econHours}
        onClose={() => setShowReport(false)}
      />
    )}
    </>
  )
}

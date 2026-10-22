import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import MapView, { type FlyTarget, type MapTool } from './components/MapView'
import LayoutPanel, { type LayoutMode } from './components/LayoutPanel'

// 3D 지도(MapLibre)는 무거워서 처음 3D로 볼 때 따로 읽는다.
const Map3D = lazy(() => import('./components/Map3D'))
/** 2D 지도에서만 되는 도구. 고르면 3D 보기 중에도 잠시 2D로 그린다. */
const TOOLS_2D: ReadonlySet<MapTool> = new Set(['draw', 'obstacle', 'measureLine', 'measureArea'])
import { getParcelAt, getParcelForResult, getParcelsInBox, getZoningAt, searchParcel, type BaseMap, type ParcelFeature, type ParcelSearchItem } from './lib/vworld'
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
import { dayOfYear, declination, kstToSolar, rowSpacingForNoShade, solarToKst, sunriseSunsetSolar } from './lib/sun'
import { deg2rad, LocalFrame, pointInRing, rotate, type Vec } from './lib/geo'
import ShadePanel from './components/ShadePanel'
import TerrainPanel, { type TerrainView } from './components/TerrainPanel'
import { analyzeTerrain, loadDem, type Dem, type GradingMode, type TerrainResult } from './lib/terrain'
import EnergyPanel from './components/EnergyPanel'
import type { Obstacle } from './lib/shading'
import { buildScene, dailyShadeLoss, perSetShade, panelShadeCells, snapshot, terrainSunWindow } from './lib/analysis'
import type { EnergyResult } from './lib/energy'
import { DEFAULT_NOCT, DEFAULT_TEMP_COEFF, nearestStation, STATIONS, type TempModel } from './lib/climate'

import OptimizePanel from './components/OptimizePanel'
import { zonedLayout } from './lib/zones'
import { STRATEGIES, type Candidate, type OptimizeInput } from './lib/optimize'
import { runOptimizePool } from './lib/optimizePool'
import EconomicsPanel, { type EconSettings } from './components/EconomicsPanel'
import { DEFAULT_ECON } from './lib/economics'
import ReportView from './components/ReportView'
import ElectricalPanel from './components/ElectricalPanel'
import SidePanel from './components/SidePanel'
import Resizer from './components/Resizer'
import { loadHorizon, type Horizon } from './lib/horizon'
import { loadTimeline, MERGE_MS, parcelKey, saveTimeline, TIMELINE_MAX, type TimelineEntry } from './lib/timeline'
import ExportPanel, { type ExportItem } from './components/ExportPanel'
import type { Scenario } from './components/OptimizePanel'
import { computeBuildable, DEFAULT_BUILDABLE, type BuildableOptions, type BuildableResult } from './lib/buildable'
import { sampleElevGrid, type ElevGrid } from './lib/elevation'
import { DEFAULT_ELEC, type ElecParams } from './lib/electrical'
import { DEFAULT_COSTS, type CostParams } from './lib/costs'
import { layoutEnergy, type DesignInput, type DesignResult } from './lib/design'
import type { EconResult } from './lib/economics'
import { INVERTERS, RACKING, type ModuleSpec } from './lib/catalog'
import {
  arraysCsv,
  capexCsv,
  cashflowCsv,
  compareCsv,
  download,
  invertersCsv,
  toCsv,
  layoutDxf,
  monthlyCsv,
  parcelZone,
  stringsCsv,
  type CompareRow,
} from './lib/export/exports'
import { buildSld, sldToDxf, sldToSvg } from './lib/export/sld'
import LayoutEditor from './components/LayoutEditor'
import AiAnalyzing from './components/AiAnalyzing'
import TimelineMenu from './components/TimelineMenu'
import DrawingWorkspace from './components/DrawingWorkspace'
import PermitPanel from './components/PermitPanel'
import SiteReviewPanel from './components/SiteReviewPanel'
import DesignBar from './components/DesignBar'
import SideElevation from './components/SideElevation'
import CapacityCompare, { type CapacityOption } from './components/CapacityCompare'
import { forestReview, gridReview, landReview, mergeSiteCheck, nearbyRoads, roadReview, searchBox, terrainReview, type RoadCandidate, type SiteCheck } from './lib/siteCheck'
import { isForest, pctToDeg } from './lib/siteReview'
import type { MapMark } from './components/MapView'
import ShadeCleanup from './components/ShadeCleanup'
import OrderPanel from './components/OrderPanel'
import { orderLines } from './lib/order'
import { stageOf, STAGES, TABS, type DesignVersion, type PermitProgress, type PlantInfo, type Stage, type Tab, EMPTY_PLANT } from './lib/stages'
import type { Annot, SheetId } from './lib/sheets'
import ProjectDialog from './components/ProjectDialog'
import { projectStore, projectToFile, type ProjectData } from './lib/projectStore'

/** 오른쪽 개요의 진행 상황에 보여 줄 화면 */
const NO_MARKS: MapMark[] = []
const OVERVIEW_STEPS: Tab[] = ['parcel', 'terrain', 'layout', 'elec', 'energy', 'econ']

/** 왼쪽 입력 패널·오른쪽 작업면 폭(px). 사용자가 끈 값을 브라우저에 기억한다. */
const DEFAULT_PANES = { left: 372, right: 400 }
const PANE_LIMITS = { left: [300, 640], right: [300, 760] } as const
const clampPane = (k: 'left' | 'right', v: number) => Math.round(Math.min(PANE_LIMITS[k][1], Math.max(PANE_LIMITS[k][0], v)))
function loadPanes() {
  try {
    const v = JSON.parse(localStorage.getItem('solar-panes') ?? 'null')
    if (v && Number.isFinite(v.left) && Number.isFinite(v.right)) return { left: clampPane('left', v.left), right: clampPane('right', v.right) }
  } catch {
    /* 저장소를 못 쓰는 환경 */
  }
  return DEFAULT_PANES
}

/** 지도 위 작업 화면 */
type Workspace = 'map' | 'edit' | 'drawing'
/** 단계마다 고를 수 있는 작업 화면 */
const WORKSPACES: Record<Stage, Array<[Workspace, string]>> = {
  site: [['map', '지도']],
  design: [
    ['map', '지도'],
    ['edit', '배치 편집'],
  ],
  drawing: [['map', '지도']],
  permit: [['map', '지도']],
  econ: [['map', '지도']],
  order: [['map', '지도']],
}

/** 자동 저장 전에 편집이 멈추길 기다리는 시간(ms) */
const AUTOSAVE_DEBOUNCE = 1500

/** AI 설계 분석 화면을 보여 주는 최소 시간(ms). 계산이 일찍 끝나도 결과는 이 시간이 지난 뒤에 낸다. */
const AI_MIN_MS = 10_000

/** 설계 지표를 다시 계산하기 전에 편집이 멈추길 기다리는 시간(ms) */
const DESIGN_DEBOUNCE = 400

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
  const [mapMode, setMapMode] = useState<'2d' | '3d'>('3d')
  const [exaggeration, setExaggeration] = useState(1)
  const [camera, setCamera] = useState<{ view: 'top' | 'front' | 'side'; seq: number } | null>(null)
  const turnCamera = (view: 'top' | 'front' | 'side') => setCamera((c) => ({ view, seq: (c?.seq ?? 0) + 1 }))
  const [params, setParams] = useState<LayoutParams>(DEFAULT_PARAMS)
  const [sets, setSets] = useState<ModuleSet[]>([])
  // 배치 편집 이력(되돌리기·다시실행). 필지가 바뀌면 비운다.
  const [history, setHistory] = useState<{ past: ModuleSet[][]; future: ModuleSet[][] }>({ past: [], future: [] })
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [obstacles, setObstacles] = useState<Obstacle[]>([])
  const [shadeDate, setShadeDate] = useState({ month: 12, day: 22 })
  const [shadeHour, setShadeHour] = useState(12)
  const [playing, setPlaying] = useState(false)
  // 온도 손실을 따로 계산하므로 성능계수에는 인버터·배선·오염·불일치 등 나머지 손실만 넣는다.
  const [performanceRatio, setPerformanceRatio] = useState(0.86)
  const [tempOn, setTempOn] = useState(true)
  const [tempCoeff, setTempCoeff] = useState(DEFAULT_TEMP_COEFF)
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('grid')
  // 'auto'면 필지에서 가장 가까운 권역
  const [stationId, setStationId] = useState('auto')
  const [withShade, setWithShade] = useState(true)
  const [energy, setEnergy] = useState<EnergyResult | null>(null)
  const [energyBusy, setEnergyBusy] = useState(false)
  const [optRun, setOptRun] = useState<{ cancel: () => void } | null>(null)
  const [optResults, setOptResults] = useState<Candidate[] | null>(null)
  const [optError, setOptError] = useState<string | null>(null)
  // 분석 화면용: 시작 시각과 실제 계산이 끝났는지
  const [optStartedAt, setOptStartedAt] = useState(0)
  const [optFinished, setOptFinished] = useState(false)
  const activeRun = useRef<object | null>(null)
  const [workspace, setWorkspace] = useState<Workspace>('map')
  const stage = stageOf(tab)
  // 지금 단계에서 보여 줄 작업 화면. 도면 단계는 도면, 배치 편집은 기본설계에서만 연다.
  const ws: Workspace = tab === 'sheets' ? 'drawing' : stage === 'design' && workspace === 'edit' ? 'edit' : 'map'
  // 단계마다 마지막으로 본 화면(단계를 다시 누르면 그 화면으로 연다)
  const [lastTab, setLastTab] = useState<Partial<Record<Stage, Tab>>>({})
  // 지금 열어 둔 저장 프로젝트(저장하면 같은 이름으로 덮어쓴다)
  const [project, setProject] = useState<{ id: string; name: string } | null>(null)
  const [showProjects, setShowProjects] = useState(false)
  const [projectRev, setProjectRev] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)
  useEffect(() => {
    if (!notice) return
    const id = setTimeout(() => setNotice(null), 3000)
    return () => clearTimeout(id)
  }, [notice])
  const [econ, setEcon] = useState<EconSettings>(DEFAULT_ECON)
  const [econHours, setEconHours] = useState(3.6)
  const [showReport, setShowReport] = useState(false)
  const [panes, setPanes] = useState(loadPanes)
  const paneStart = useRef(panes)
  // 지도만 크게 보기(양쪽 패널 접기)
  const [mapFocus, setMapFocus] = useState(false)
  useEffect(() => {
    try {
      localStorage.setItem('solar-panes', JSON.stringify(panes))
    } catch {
      /* 저장소를 못 쓰는 환경 */
    }
  }, [panes])
  const [terrain, setTerrain] = useState<TerrainResult | null>(null)
  const [terrainBusy, setTerrainBusy] = useState(false)
  const [terrainError, setTerrainError] = useState<string | null>(null)
  const [gradingMode, setGradingMode] = useState<GradingMode>('plane')
  const [maxDesignSlope, setMaxDesignSlope] = useState(15)
  const [terrainView, setTerrainView] = useState<TerrainView>('slope')
  const demCache = useRef<{ parcel: Parcel; dem: Dem } | null>(null)
  const [elevGrid, setElevGrid] = useState<ElevGrid | null>(null)
  const [buildOptions, setBuildOptions] = useState<BuildableOptions>(DEFAULT_BUILDABLE)
  const [buildable, setBuildable] = useState<BuildableResult | null>(null)
  const [useMask, setUseMask] = useState(true)
  const [elec, setElec] = useState<ElecParams>(DEFAULT_ELEC)
  const [costs, setCosts] = useState<CostParams>(DEFAULT_COSTS)
  const [capexMode, setCapexMode] = useState<'unit' | 'design'>('design')
  // 설계 지표 계산 결과와 그 계산에 쓴 입력
  const [designState, setDesignState] = useState<{ input: DesignInput; result: DesignResult | null } | null>(null)
  const [scenarios, setScenarios] = useState<Scenario[]>([])
  const [econResult, setEconResult] = useState<EconResult | null>(null)
  // ── 설계 확정: 기본설계에서 확정한 설계가 도면·인허가·경제성·발주의 기준이 된다. ──
  // 확정한 동안에는 배치·설정을 고치기 전에 "설계 변경"을 거친다. 확정본은 이력에 남는다.
  const [versions, setVersions] = useState<DesignVersion[]>([])
  const [confirmedId, setConfirmedId] = useState<string | null>(null)
  const confirmed = versions.find((v) => v.id === confirmedId) ?? null
  // 한 번의 동작 안에서 여러 번 물어보지 않게 확정 상태를 바로 읽고 바로 푼다.
  const lockRef = useRef<string | null>(null)
  useEffect(() => {
    lockRef.current = confirmedId
  }, [confirmedId])
  const [permits, setPermits] = useState<PermitProgress>({})
  const [plant, setPlant] = useState<PlantInfo>(EMPTY_PLANT)
  const [siteCheck, setSiteCheck] = useState<SiteCheck>(() => mergeSiteCheck())
  // 주변 도로 조회 결과. 부지가 바뀌면 버리도록 어느 부지의 결과인지 같이 둔다.
  const [roadResult, setRoadResult] = useState<{ parcel: Parcel; list: RoadCandidate[] } | null>(null)
  const [roadBusy, setRoadBusy] = useState(false)
  const [roadError, setRoadError] = useState<string | null>(null)
  /** 도면 탭에서 그려 넣은 주석(도면별) */
  const [sheetAnnots, setSheetAnnots] = useState<Partial<Record<SheetId, Annot[]>>>({})
  const drawing = tool === 'draw'

  // ── 작업 타임라인: 부지·배치·설정이 바뀔 때마다 한 줄씩 남기고, 어느 줄로든 돌아갈 수 있다. ──
  const [timeline, setTimeline] = useState<TimelineEntry[]>(loadTimeline)
  const [timelineAt, setTimelineAt] = useState<string | null>(null)
  // 다음 기록에 붙일 이름. 동작마다 정해 두고, 없으면 무엇이 바뀌었는지로 정한다.
  const pendingLabel = useRef<string | null>(null)
  const restoring = useRef(false)
  const mark = (label: string) => {
    pendingLabel.current = label
  }

  /** 확정한 설계를 고치려 할 때 묻는다. 풀면 true. */
  const unlock = () => {
    if (!lockRef.current) return true
    if (!window.confirm('확정한 설계입니다. 설계 변경으로 풀고 고칠까요?\n지금 확정본은 확정 이력에 남습니다.')) return false
    lockRef.current = null
    setConfirmedId(null)
    setNotice('설계 변경 중입니다. 다 고치면 다시 확정하세요')
    return true
  }

  // 필지가 바뀌면 이전 배치는 의미가 없다.
  const resetParcel = (p: Parcel | null) => {
    if (p) mark(`필지 선택 · ${p.address}`)
    setParcelState(p)
    setVersions([])
    lockRef.current = null
    setConfirmedId(null)
    setPermits({})
    setSiteCheck(mergeSiteCheck())
    setLayoutBasis(null)
    if (!p) setAddingLot(false)
    setTerrain(null)
    setTerrainError(null)
    setElevGrid(null)
    setBuildable(null)
    setScenarios([])
    setOptResults(null)
    setObstacles([])
    setEnergy(null)
    setSets([])
    setHistory({ past: [], future: [] })
    setSelected(new Set())
  }
  const setParcel = (p: Parcel | null) => {
    if (unlock()) resetParcel(p)
  }
  /** 확정 중이면 먼저 풀고 바꾸는 설정들 */
  const updateParams = (p: LayoutParams) => unlock() && setParams(p)
  const updateObstacles = (o: Obstacle[] | ((prev: Obstacle[]) => Obstacle[])) => unlock() && setObstacles(o)
  const updateElec = (e: ElecParams) => unlock() && setElec(e)
  const setDrawing = (on: boolean | ((d: boolean) => boolean)) => {
    const next = typeof on === 'function' ? on(drawing) : on
    setTool(next ? 'draw' : 'none')
  }
  /** 되돌릴 수 있는 배치 변경 */
  const editSets = (next: ModuleSet[] | ((prev: ModuleSet[]) => ModuleSet[])) => {
    if (!unlock()) return
    const value = typeof next === 'function' ? next(sets) : next
    setHistory((h) => ({ past: [...h.past.slice(-49), sets], future: [] }))
    setSets(value)
  }
  const undo = () => {
    const prev = history.past.at(-1)
    if (!prev || !unlock()) return
    mark('되돌리기')
    setHistory({ past: history.past.slice(0, -1), future: [sets, ...history.future] })
    setSets(prev)
    setSelected(new Set())
  }
  const redo = () => {
    const next = history.future[0]
    if (!next || !unlock()) return
    mark('다시실행')
    setHistory({ past: [...history.past, sets], future: history.future.slice(1) })
    setSets(next)
    setSelected(new Set())
  }
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  // 켜 두면 지도 클릭·검색 결과가 부지를 바꾸지 않고 지번을 더하거나 뺀다.
  const [addingLot, setAddingLot] = useState(false)
  const lots = parcel?.lots

  // 필지를 찾아 부지로 삼는다. 지도는 부지가 바뀌면 그 필지에 맞춰 움직인다.
  const selectParcel = useCallback(
    async (find: () => Promise<ParcelFeature | null>, notFound: () => void) => {
      if (!vworldKey) return
      setBusy(true)
      setMessage(null)
      try {
        const f = await find()
        if (!f) notFound()
        else if (addingLot && lots) {
          const lot = lotFromFeature(f)
          const removing = lots.some((l) => l.pnu === lot.pnu)
          const next = removing ? lots.filter((l) => l.pnu !== lot.pnu) : [...lots, lot]
          setParcel(parcelFromLots(next))
          mark(removing ? `지번 빼기 · ${lot.address}` : `지번 추가 · ${lot.address}`)
        } else {
          const next = parcelFromFeature(f)
          // 작업 중인 부지를 다른 필지로 바꾸기 전에 한 번 묻는다(되돌릴 길은 타임라인에 남는다).
          if (parcel && next.pnu !== parcel.pnu && (sets.length || obstacles.length)) {
            const ok = window.confirm(`${next.address}(으)로 부지를 바꿀까요?\n지금 배치는 화면에서 사라지지만 맨 위 타임라인에서 다시 돌아올 수 있습니다.`)
            if (!ok) return
          }
          setParcel(next)
        }
      } catch (e) {
        setMessage((e as Error).message)
      } finally {
        setBusy(false)
      }
    },
    [vworldKey, addingLot, lots, parcel, sets.length, obstacles.length],
  )
  const selectParcelAt = (lon: number, lat: number) =>
    selectParcel(
      () => getParcelAt(lon, lat, vworldKey),
      () => setMessage('이 위치에서 필지를 찾지 못했습니다.'),
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

  // 검색 대표점으로 먼저 날아가지 않는다. 대표점이 필지 밖에 찍히면 엉뚱한 곳을 보여 주기 때문이다.
  // 필지를 찾으면 지도가 그 경계에 맞춰지고, 못 찾을 때만 대표점으로 옮긴다.
  const pickResult = (it: ParcelSearchItem) =>
    void selectParcel(
      () => getParcelForResult(it, vworldKey),
      () => {
        setFlyTo({ lon: it.lon, lat: it.lat, seq: Date.now() })
        setMessage('이 주소의 지적 경계를 찾지 못했습니다. 지도에서 필지를 클릭해 주세요.')
      },
    )

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
    if (tool === 'rect') return placeRect(lon, lat)
    if (tool === 'pole') {
      setSiteCheck((c) => ({ ...c, grid: { ...c.grid, pole: [lon, lat] } }))
      return setTool('none')
    }
    if (addingLot) return void selectParcelAt(lon, lat)
    // 부지가 정해진 뒤에는 필지 단계에서만 지도 클릭으로 부지를 바꾼다.
    // 다른 단계에서 지도를 누르다가 작업이 사라지는 일을 막는다.
    if (parcel && tab !== 'parcel') return
    // 지금 부지 안을 누르면 아무 일도 하지 않는다.
    if (parcel && parcel.rings.some((r) => pointInRing([lon, lat], r as Vec[]))) return
    void selectParcelAt(lon, lat)
  }

  const onDrawEnd = (ring: number[][]) => {
    setTool('none')
    setParcel({ address: '직접 그린 영역', rings: [ring], source: 'manual' })
  }

  const area = useMemo(() => (parcel ? parcelArea(parcel) : 0), [parcel])
  const geometry = useMemo(() => setGeometry(params), [params])

  // 연속 편집(입력칸 타이핑, 끌어 옮기기 등)은 한 줄로 합친다.
  const MERGEABLE = /^(배치 설정 변경|장애물 편집|배치 편집|세트 이동|세트 회전|되돌리기|다시실행)$/
  const lastSnap = useRef<{ parcel: Parcel | null; sets: ModuleSet[]; params: LayoutParams; obstacles: Obstacle[] } | null>(null)
  useEffect(() => {
    const prev = lastSnap.current
    lastSnap.current = { parcel, sets, params, obstacles }
    const label = pendingLabel.current
    pendingLabel.current = null
    if (restoring.current) {
      restoring.current = false
      return
    }
    if (!prev || !parcel) return
    const name =
      label ??
      (prev.parcel !== parcel ? `필지 선택 · ${parcel.address}` : prev.sets !== sets ? '배치 편집' : prev.obstacles !== obstacles ? '장애물 편집' : '배치 설정 변경')
    const entry: TimelineEntry = {
      id: newSetId(),
      time: Date.now(),
      label: name,
      parcel,
      params,
      sets,
      obstacles,
      kWp: (sets.length * setGeometry(params).watt) / 1000,
    }
    setTimeline((tl) => {
      const last = tl.at(-1)
      const merge = last && last.label === name && MERGEABLE.test(name) && entry.time - last.time < MERGE_MS && parcelKey(last.parcel) === parcelKey(parcel)
      if (merge) entry.id = last.id
      return [...(merge ? tl.slice(0, -1) : tl), entry].slice(-TIMELINE_MAX)
    })
    setTimelineAt(entry.id)
    // 기록할 대상은 부지·배치·설정·장애물뿐이다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parcel, sets, params, obstacles])
  useEffect(() => saveTimeline(timeline), [timeline])

  /** 타임라인의 한 시점으로 돌아간다. 기록은 지우지 않고, 돌아간 뒤 편집하면 맨 아래에 새 줄이 붙는다. */
  const restoreTimeline = (e: TimelineEntry) => {
    if (!unlock()) return
    restoring.current = true
    const same = !!parcel && parcelKey(parcel) === parcelKey(e.parcel)
    if (same) setHistory((h) => ({ past: [...h.past.slice(-49), sets], future: [] }))
    else {
      resetParcel(e.parcel)
      const [lon, lat] = interiorPoint(e.parcel.rings)
      setFlyTo({ lon, lat, seq: Date.now() })
    }
    // 새 배열로 넣어야 상태가 바뀐 것으로 잡힌다(같은 시점을 다시 골라도).
    setParams({ ...e.params })
    setLayoutBasis(null)
    setSets([...e.sets])
    setObstacles([...e.obstacles])
    setSelected(new Set())
    setTool('none')
    setTimelineAt(e.id)
  }
  const stats = layoutStats(sets, geometry, area)
  const suggestedRowSpacing = useMemo(() => {
    if (!parcel) return null
    const { lat0 } = LocalFrame.around(parcel.rings)
    return rowSpacingForNoShade(lat0, geometry.height - params.groundClearance, params.azimuth)
  }, [parcel, geometry, params.groundClearance, params.azimuth])


  const panelRef = useRef<HTMLElement>(null)

  // 복제 방지(가벼운 장치): 지도·도면·보고서에서 우클릭 저장과 끌어서 복사를 막는다. 입력칸은 그대로 둔다.
  useEffect(() => {
    const guarded = (t: EventTarget | null) => t instanceof Element && !t.closest('input, textarea, select') && !!t.closest('.map, .map-stage, .sheet, .side-elev, .report-page, .dw-canvas, svg, canvas')
    const block = (e: Event) => guarded(e.target) && e.preventDefault()
    document.addEventListener('contextmenu', block)
    document.addEventListener('dragstart', block)
    document.addEventListener('copy', block)
    return () => {
      document.removeEventListener('contextmenu', block)
      document.removeEventListener('dragstart', block)
      document.removeEventListener('copy', block)
    }
  }, [])
  // 인쇄 워터마크 문구: 프로젝트 이름(없으면 부지 주소)과 날짜
  useEffect(() => {
    const name = project?.name ?? parcel?.address ?? ''
    const text = `솔라 레이아웃 · ${name} · ${new Date().toLocaleDateString('ko-KR')}`.replace(/"/g, '')
    document.documentElement.style.setProperty('--print-wm', `"${text}"`)
  }, [project, parcel])
  const switchTab = (t: Tab) => {
    if (t !== tab) panelRef.current?.scrollTo({ top: 0 })
    setLastTab((m) => ({ ...m, [stageOf(t)]: t }))
    if (stageOf(t) !== stageOf(tab)) setEntry(entryState())
    setTab(t)
    setTool('none')
    setPlaying(false)
  }

  // 음영 분석 장면: 세트·장애물·설정이 바뀔 때만 다시 만든다.
  // 주변 산의 지평선. 부지가 바뀌면 반경 5 km 표고를 받아 다시 만든다(실패하면 지형 그늘 없이 계산).
  const [horizonOn, setHorizonOn] = useState(true)
  const [horizonState, setHorizonState] = useState<{ parcel: Parcel; horizon: Horizon | null; error: string | null } | null>(null)
  useEffect(() => {
    if (!parcel) return
    let alive = true
    loadHorizon(parcel).then(
      (h) => alive && setHorizonState({ parcel, horizon: h, error: null }),
      (e: Error) => alive && setHorizonState({ parcel, horizon: null, error: e.message }),
    )
    return () => {
      alive = false
    }
  }, [parcel])
  const horizonFresh = horizonState?.parcel === parcel ? horizonState : null
  const horizon = horizonOn ? (horizonFresh?.horizon ?? null) : null

  const scene = useMemo(
    () => (parcel ? buildScene(parcel.rings, sets, obstacles, params, geometry, sets, horizon) : null),
    [parcel, sets, obstacles, params, geometry, horizon],
  )
  const n = dayOfYear(shadeDate.month, shadeDate.day)
  const decl = declination(n)
  const show3d = mapMode === '3d' && !TOOLS_2D.has(tool)
  const shadeView = useMemo(() => {
    if (!scene || tab !== 'shade') return null
    const solar = kstToSolar(shadeHour, scene.frame.lon0, n)
    const snap = snapshot(scene, decl, solar)
    // 3D에서 옆·정면으로 봐도 그늘이 보이게 모듈 표면에 떨어진 그림자도 칸별로 구한다.
    return { ...snap, panel: show3d ? panelShadeCells(scene, sets, params, geometry, snap.sun) : null }
  }, [scene, tab, shadeHour, n, decl, show3d, sets, params, geometry])
  // 고른 날의 일출·일몰과, 주변 산 때문에 실제로 햇빛이 드는 시간(한국 표준시)
  const sunTimes = useMemo(() => {
    if (!parcel || tab !== 'shade') return null
    const { lat0, lon0 } = LocalFrame.around(parcel.rings)
    const day = sunriseSunsetSolar(lat0, decl)
    if (!day) return null
    const kst = (w: { rise: number; set: number }) => ({ rise: solarToKst(w.rise, lon0, n), set: solarToKst(w.set, lon0, n) })
    const t = terrainSunWindow(horizon, lat0, decl)
    return { ...kst(day), terrain: t ? kst(t) : null }
  }, [parcel, tab, decl, n, horizon])
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
    updateObstacles((prev) => [...prev, { id: newSetId(), name, ring, height }])
  }

  // 탐색은 수십 번의 배치·음영 계산이라 화면이 멈추지 않게 워커에서 돌린다.
  const runOptimize = async () => {
    if (!parcel) return
    optRun?.cancel()
    const pending = { cancel: () => {} }
    activeRun.current = pending
    setOptRun(pending)
    setOptResults(null)
    setOptError(null)
    setOptFinished(false)
    const started = performance.now()
    setOptStartedAt(started)
    // 지형을 아직 안 불러왔으면 먼저 불러온다(실패해도 지형 없이 진행).
    let t: { grid: ElevGrid; buildable: BuildableResult } | null = elevGrid && buildable ? { grid: elevGrid, buildable } : null
    if (!t) {
      t = await ensureTerrain().catch(() => null)
      if (activeRun.current !== pending) return
    }
    const input: OptimizeInput = {
      parcel,
      base: params,
      obstacles,
      performanceRatio,
      temperature,
      elec,
      costs,
      econ,
      grid: t?.grid ?? null,
      mask: useMask ? (t?.buildable.mask ?? null) : null,
      horizon,
    }
    // 진행 단계는 분석 화면이 시간에 맞춰 보여 준다.
    const run = runOptimizePool(input, () => {})
    activeRun.current = run
    setOptRun(run)
    // 계산이 일찍 끝나도 분석 화면을 AI_MIN_MS 동안 보여 준 뒤에 결과를 낸다. 중간에 중단하면 버린다.
    const finish = (apply: () => void) => {
      if (activeRun.current !== run) return
      setOptFinished(true)
      setTimeout(() => {
        if (activeRun.current !== run) return
        activeRun.current = null
        apply()
        setOptRun(null)
      }, Math.max(0, AI_MIN_MS - (performance.now() - started)))
    }
    run.promise.then(
      (results) => finish(() => setOptResults(results)),
      (e: Error) => finish(() => setOptError(e.message)),
    )
  }

  const cancelOptimize = () => {
    optRun?.cancel()
    activeRun.current = null
    setOptRun(null)
  }

  const applyCandidate = (nextParams: LayoutParams, nextSets: ModuleSet[]) => {
    if (sets.length && !window.confirm('현재 배치를 이 안으로 바꿀까요?')) return
    if (!unlock()) return
    mark('AI 설계 적용')
    setParams(nextParams)
    setLayoutBasis(nextParams)
    editSets(nextSets)
    setSelected(new Set())
    setEnergy(null)
    switchTab('layout')
  }

  const autoStation = useMemo(() => {
    if (!parcel) return null
    const f = LocalFrame.around(parcel.rings)
    return nearestStation(f.lat0, f.lon0)
  }, [parcel])
  const station = (stationId === 'auto' ? autoStation : STATIONS.find((s) => s.id === stationId)) ?? STATIONS[0]
  const stationTemp = station.temp
  const temperature: TempModel | undefined = useMemo(
    () => (tempOn ? { temp: stationTemp, coeffPct: tempCoeff, noct: DEFAULT_NOCT } : undefined),
    [tempOn, stationTemp, tempCoeff],
  )
  const mask = useMask && buildable ? buildable.mask : null

  const runEnergy = () => {
    if (!parcel || !sets.length) return
    setEnergyBusy(true)
    // 화면이 "계산 중"을 그릴 틈을 준다.
    setTimeout(() => {
      setEnergy(
        layoutEnergy({
          rings: parcel.rings,
          sets,
          obstacles,
          params,
          horizon,
          shade: withShade ? 'full' : false,
          kWp: stats.kWp,
          performanceRatio,
          temperature,
        }),
      )
      setEnergyBusy(false)
    }, 30)
  }

  // 마지막 자동 배치(또는 AI 안 적용)에 쓴 설정. 그 뒤 설정이 바뀌면 다시 배치하라고 알린다.
  const [layoutBasis, setLayoutBasis] = useState<LayoutParams | null>(null)
  const layoutOutdated = sets.length > 0 && layoutBasis !== null && layoutBasis !== params

  /** 자동 배치. 확정 상태를 풀고 새 배치를 넣으면 그 배치를 돌려준다(취소하면 null). */
  const layoutWith = (p: LayoutParams) =>
    parcel ? ((layoutMode === 'grid' ? null : zonedLayout(parcel, p, { mode: layoutMode, mask })) ?? autoLayout(parcel, p, 0, mask)) : []
  const placeSets = (label: string, p: LayoutParams = params): ModuleSet[] | null => {
    if (!parcel) return null
    if (sets.length && !window.confirm('현재 배치를 지우고 다시 자동 배치할까요?')) return null
    if (!unlock()) return null
    mark(label)
    const next = layoutWith(p)
    if (p !== params) setParams(p)
    editSets(next)
    setLayoutBasis(p)
    setSelected(new Set())
    return next
  }
  const runAutoLayout = () => void placeSets('자동 배치')

  // 표준·권장 설계용량: 동지 9~15시 무음영 이격(표준)과 10~14시 무음영 이격(권장, 용량 우선)으로 각각 배치해 본다.
  const [capCompare, setCapCompare] = useState<{ key: unknown[]; rows: CapacityOption[] } | null>(null)
  const capKey = [parcel, params, mask, layoutMode]
  const capRows = capCompare && capCompare.key.every((v, i) => v === capKey[i]) ? capCompare.rows : null
  const compareCapacity = () => {
    if (!parcel) return
    const { lat0 } = LocalFrame.around(parcel.rings)
    const h = geometry.height - params.groundClearance
    const opts: Array<[CapacityOption['key'], string, string, number, number]> = [
      ['standard', '표준', '동지 9~15시 앞 열 그림자 없음', 9, 15],
      ['recommended', '권장', '동지 10~14시 앞 열 그림자 없음(용량 우선)', 10, 14],
    ]
    const rows = opts.map(([key, label, basis, from, to]) => {
      const spacing = Math.ceil(rowSpacingForNoShade(lat0, h, params.azimuth, from, to) * 10) / 10
      const n = layoutWith({ ...params, rowSpacing: spacing }).length
      return { key, label, basis, spacing, sets: n, kWp: (n * geometry.watt) / 1000 }
    })
    setCapCompare({ key: capKey, rows })
  }

  /**
   * 자동 설계: 배치한 뒤 용량에 맞는 인버터를 고른다. 스트링 결선·케이블은 설계 계산이 이어서 잡는다.
   * 목표 AC 용량(DC ÷ DC/AC 비율)을 두 대 이상으로 나눌 수 있는 가장 큰 인버터를 고르고, 작은 부지는 가장 작은 것을 쓴다.
   */
  const runAutoDesign = () => {
    const next = placeSets('자동 설계')
    if (!next) return
    const kWp = (next.length * geometry.watt) / 1000
    const targetAc = kWp / elec.dcAcRatio
    const inv = [...INVERTERS].reverse().find((i) => i.kw * 2 <= targetAc) ?? INVERTERS[0]
    setElec({ ...elec, inverterId: inv.id, inverterKW: inv.kw, maxDcV: inv.maxDcV, mpptMinV: inv.mpptMinV, mpptMaxV: inv.mpptMaxV, acV: inv.acV })
    setNotice(`자동 설계: ${fmt(kWp, 1)} kWp, ${inv.kw}kW 인버터 약 ${Math.max(1, Math.round(targetAc / inv.kw))}대`)
  }

  // 세트별 동지 그늘. 잰 뒤 배치·장애물이 바뀌면 다시 재야 한다.
  const [setShadeState, setSetShadeState] = useState<{ sets: ModuleSet[]; obstacles: Obstacle[]; map: Map<string, number> } | null>(null)
  const [setShadeBusy, setSetShadeBusy] = useState(false)
  const setShadeMap = setShadeState?.sets === sets && setShadeState.obstacles === obstacles ? setShadeState.map : null
  const measureSetShade = () => {
    if (!scene) return
    setSetShadeBusy(true)
    // 화면이 "재는 중"을 그릴 틈을 준다.
    setTimeout(() => {
      setSetShadeState({ sets, obstacles, map: perSetShade(scene, declination(dayOfYear(12, 22))) })
      setSetShadeBusy(false)
    }, 30)
  }
  const deleteSets = (ids: string[]) => {
    const drop = new Set(ids)
    if (!window.confirm(`그림자 지는 세트 ${ids.length}개를 지울까요?`)) return
    mark(`그늘 세트 ${ids.length}개 삭제`)
    editSets((prev) => prev.filter((s) => !drop.has(s.id)))
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
    mark(moved.length > 1 ? `세트 ${moved.length}개 이동` : '세트 이동')
    editSets((prev) => prev.map((s) => (byId.has(s.id) ? { ...s, ...byId.get(s.id)! } : s)))
  }

  const onAddSet = (lon: number, lat: number) => {
    const s: ModuleSet = { id: newSetId(), lon, lat, azimuth: params.azimuth }
    mark('세트 추가')
    editSets((prev) => [...prev, s])
    setSelected(new Set([s.id]))
  }

  const deleteSelected = () => {
    mark(selected.size > 1 ? `세트 ${selected.size}개 삭제` : '세트 삭제')
    editSets((prev) => prev.filter((s) => !selected.has(s.id)))
    setSelected(new Set())
  }

  const rotateSelected = (deg: number) => {
    mark('세트 회전')
    editSets((prev) => prev.map((s) => (selected.has(s.id) ? { ...s, azimuth: s.azimuth + deg } : s)))
  }

  const clearSets = () => {
    mark('전체 지우기')
    editSets([])
    setSelected(new Set())
  }

  const setAzimuthSelected = (deg: number) => {
    mark('세트 방위 맞춤')
    editSets((prev) => prev.map((s) => (selected.has(s.id) ? { ...s, azimuth: deg } : s)))
  }

  /** 선택한 세트를 동(dx)·북(dy)으로 m만큼 떨어뜨려 복제하고, 복제본을 선택한다. */
  const duplicateSelected = (dx: number, dy: number) => {
    if (!parcel || !selected.size) return
    const f = LocalFrame.around(parcel.rings)
    const copies = sets
      .filter((s) => selected.has(s.id))
      .map((s) => {
        const [x, y] = f.toLocal([s.lon, s.lat])
        const [lon, lat] = f.toLonLat([x + dx, y + dy])
        return { ...s, id: newSetId(), lon, lat }
      })
    mark(copies.length > 1 ? `세트 ${copies.length}개 복제` : '세트 복제')
    editSets((prev) => [...prev, ...copies])
    setSelected(new Set(copies.map((s) => s.id)))
  }

  const switchWorkspace = (w: Workspace) => {
    setWorkspace(w)
    setTool('none')
  }

  // 배치 편집 단축키. 오른쪽 작업면이 늘 보이므로 어느 단계에서든 듣는다.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) return
      if (showReport || showProjects) return
      // 도면 화면은 자체 단축키(주석 지우기 등)를 쓴다.
      if (ws === 'drawing') return
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
      // 배치 편집 화면에서만: 전체 선택, 복제
      if (ws === 'edit' && mod && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        setSelected(new Set(sets.map((s) => s.id)))
      }
      if (ws === 'edit' && mod && e.key.toLowerCase() === 'd') {
        e.preventDefault()
        duplicateSelected(geometry.width + params.setGap / 1000, 0)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // 핸들러가 매번 최신 배치를 쓰도록 렌더마다 다시 건다.
  })

  /** 표고 타일을 받아 격자와 설계 가능 영역을 만든다(필지당 한 번). */
  const ensureTerrain = async (): Promise<{ grid: ElevGrid; buildable: BuildableResult }> => {
    if (!parcel) throw new Error('필지가 없습니다.')
    if (demCache.current?.parcel !== parcel) demCache.current = { parcel, dem: await loadDem(parcel, 15, 120) }
    const grid = elevGrid ?? sampleElevGrid(parcel, demCache.current.dem)
    const b = buildable ?? computeBuildable(parcel, grid, buildOptions)
    setElevGrid(grid)
    setBuildable(b)
    return { grid, buildable: b }
  }
  const changeBuildOptions = (o: BuildableOptions) => {
    setBuildOptions(o)
    if (parcel && elevGrid) setBuildable(computeBuildable(parcel, elevGrid, o))
  }

  const runTerrain = async (mode = gradingMode, maxSlope = maxDesignSlope) => {
    if (!parcel) return
    setTerrainBusy(true)
    setTerrainError(null)
    try {
      await ensureTerrain()
      if (!terrain) setTerrainView('buildable')
      setTerrain(analyzeTerrain(parcel, demCache.current!.dem, { cell: 3, mode, maxDesignSlopePct: maxSlope }))
    } catch (e) {
      setTerrainError(`표고 자료를 불러오지 못했습니다. (${e instanceof Error ? e.message : String(e)})`)
    } finally {
      setTerrainBusy(false)
    }
  }
  // 이미 분석했다면 방식·경사를 바꿀 때 바로 다시 계산한다(표고는 캐시).
  const changeGrading = (mode: GradingMode, maxSlope: number) => {
    setGradingMode(mode)
    setMaxDesignSlope(maxSlope)
    if (terrain) void runTerrain(mode, maxSlope)
  }

  // 현재 배치의 설계 지표(전기·발전량·토공·설치비·LCOE)를 편집이 멈출 때마다 워커에서 다시 계산한다.
  const designInput = useMemo<DesignInput | null>(
    () =>
      parcel && sets.length
        ? { parcel, params, sets, obstacles, performanceRatio, temperature, elec, costs, econ, grid: elevGrid, horizon }
        : null,
    [parcel, params, sets, obstacles, performanceRatio, temperature, elec, costs, econ, elevGrid, horizon],
  )
  const designWorker = useRef<Worker | null>(null)
  const designPending = useRef<{ seq: number; input: DesignInput } | null>(null)
  useEffect(() => {
    const w = new Worker(new URL('./lib/design.worker.ts', import.meta.url), { type: 'module' })
    w.addEventListener('message', (e) => {
      const m = e.data
      const pending = designPending.current
      if (!pending || m.seq !== pending.seq) return
      setDesignState({ input: pending.input, result: m.type === 'done' ? m.result : null })
    })
    designWorker.current = w
    return () => w.terminate()
  }, [])
  useEffect(() => {
    if (!designInput) return
    const id = setTimeout(() => {
      const seq = (designPending.current?.seq ?? 0) + 1
      designPending.current = { seq, input: designInput }
      designWorker.current?.postMessage({ seq, input: designInput })
    }, DESIGN_DEBOUNCE)
    return () => clearTimeout(id)
  }, [designInput])
  // 다시 계산하는 동안에는 직전 결과를 그대로 보여 준다.
  const design = designInput ? (designState?.result ?? null) : null
  const designBusy = !!designInput && designState?.input !== designInput

  const onModule = (m: ModuleSpec) => {
    if (!unlock()) return
    mark(`모듈 변경 · ${m.label}`)
    setParams({ ...params, moduleLength: m.length, moduleWidth: m.width, moduleWatt: m.watt })
    setElec({ ...elec, voc: m.voc, vmp: m.vmp, isc: m.isc, imp: m.imp, betaVoc: m.betaVoc, gammaPmax: m.gammaPmax })
  }

  const saveScenario = () => {
    if (!design) return
    const name = window.prompt('배치안 이름', `배치안 ${scenarios.length + 1}`)
    if (name === null) return
    setScenarios((prev) => [...prev, { id: newSetId(), name: name || `배치안 ${prev.length + 1}`, params, sets, metrics: design.metrics }])
  }

  // ── 프로젝트 저장·불러오기: 지금은 이 브라우저에, 로그인이 생기면 projectStore만 바꾼다. ──
  const projectData = (): ProjectData | null =>
    parcel
      ? {
          parcel,
          params,
          sets,
          obstacles,
          layoutMode,
          elec,
          costs,
          econ,
          econHours,
          performanceRatio,
          tempOn,
          tempCoeff,
          stationId,
          withShade,
          buildOptions,
          useMask,
          gradingMode,
          maxDesignSlope,
          scenarios,
          versions,
          confirmedId,
          permits,
          plant,
          siteCheck,
          tab,
        }
      : null
  const saveProject = async (asNew = false) => {
    const data = projectData()
    if (!data) return
    let target = asNew ? null : project
    if (!target) {
      const name = window.prompt('프로젝트 이름', project?.name ?? parcel!.address)
      if (name === null) return
      target = { id: '', name: name.trim() || parcel!.address }
    }
    try {
      const saved = await projectStore.save({ id: target.id || undefined, name: target.name, data, kWp: stats.kWp })
      setProject({ id: saved.id, name: saved.name })
      setProjectRev((n) => n + 1)
      setNotice(`'${saved.name}' 저장했습니다`)
    } catch (e) {
      window.alert((e as Error).message)
    }
  }
  const applyProject = (name: string, d: ProjectData, id: string | null) => {
    if ((sets.length || obstacles.length) && !window.confirm(`'${name}' 프로젝트를 열까요?\n지금 작업은 맨 위 타임라인에 남아 다시 돌아올 수 있습니다.`)) return
    resetParcel(d.parcel)
    mark(`프로젝트 열기 · ${name}`)
    const [lon, lat] = interiorPoint(d.parcel.rings)
    setFlyTo({ lon, lat, seq: Date.now() })
    setParams({ ...DEFAULT_PARAMS, ...d.params })
    setSets([...d.sets])
    setObstacles([...d.obstacles])
    if (d.layoutMode) setLayoutMode(d.layoutMode as LayoutMode)
    if (d.elec) setElec({ ...DEFAULT_ELEC, ...d.elec })
    if (d.costs) setCosts({ ...DEFAULT_COSTS, ...d.costs })
    if (d.econ) setEcon({ ...DEFAULT_ECON, ...d.econ })
    if (d.econHours !== undefined) setEconHours(d.econHours)
    if (d.performanceRatio !== undefined) setPerformanceRatio(d.performanceRatio)
    if (d.tempOn !== undefined) setTempOn(d.tempOn)
    if (d.tempCoeff !== undefined) setTempCoeff(d.tempCoeff)
    if (d.stationId) setStationId(d.stationId)
    if (d.withShade !== undefined) setWithShade(d.withShade)
    if (d.buildOptions) setBuildOptions({ ...DEFAULT_BUILDABLE, ...d.buildOptions })
    if (d.useMask !== undefined) setUseMask(d.useMask)
    if (d.gradingMode) setGradingMode(d.gradingMode)
    if (d.maxDesignSlope !== undefined) setMaxDesignSlope(d.maxDesignSlope)
    if (d.scenarios) setScenarios(d.scenarios)
    setVersions(d.versions ?? [])
    const lock = d.confirmedId && d.versions?.some((v) => v.id === d.confirmedId) ? d.confirmedId : null
    lockRef.current = lock
    setConfirmedId(lock)
    setPermits(d.permits ?? {})
    setPlant({ ...EMPTY_PLANT, ...d.plant })
    setSiteCheck(mergeSiteCheck(d.siteCheck))
    if (d.tab && d.tab in TABS) switchTab(d.tab)
    setProject(id ? { id, name } : null)
    setShowProjects(false)
    setNotice(`'${name}' 열었습니다`)
  }
  const openProject = async (id: string) => {
    try {
      const p = await projectStore.load(id)
      if (!p) throw new Error('프로젝트를 찾지 못했습니다.')
      applyProject(p.name, p.data, p.id)
    } catch (e) {
      window.alert((e as Error).message)
    }
  }
  // 프로젝트로 저장한 뒤에는 고칠 때마다 저절로 저장한다.
  const [saveState, setSaveState] = useState<{ status: 'saving' | 'saved' | 'error'; at: number } | null>(null)
  const projectId = project?.id
  const savedFor = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!project) return
    // 프로젝트를 열거나 처음 저장한 직후의 값은 이미 저장돼 있다.
    if (savedFor.current !== project.id) {
      savedFor.current = project.id
      setSaveState({ status: 'saved', at: Date.now() })
      return
    }
    const data = projectData()
    if (!data) return
    setSaveState({ status: 'saving', at: Date.now() })
    const id = setTimeout(() => {
      projectStore.save({ id: project.id, name: project.name, data, kWp: stats.kWp }).then(
        () => setSaveState({ status: 'saved', at: Date.now() }),
        () => setSaveState({ status: 'error', at: Date.now() }),
      )
    }, AUTOSAVE_DEBOUNCE)
    return () => clearTimeout(id)
    // 저장할 값이 바뀔 때만 저장한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parcel, params, sets, obstacles, layoutMode, elec, costs, econ, econHours, performanceRatio, tempOn, tempCoeff, stationId, withShade, buildOptions, useMask, gradingMode, maxDesignSlope, scenarios, versions, confirmedId, permits, plant, siteCheck, projectId])

  // ── 설계 확정 ──
  const confirmDesign = () => {
    if (!design || designBusy || !sets.length) return
    const v: DesignVersion = {
      id: newSetId(),
      name: `설계 ${versions.length + 1}`,
      at: Date.now(),
      params,
      sets,
      obstacles,
      elec,
      kWp: design.metrics.kWp,
      annualKWh: design.metrics.annualKWh,
    }
    setVersions((vs) => [...vs, v])
    lockRef.current = v.id
    setConfirmedId(v.id)
    setNotice(`${v.name} 확정했습니다`)
  }
  /** 이전 확정본으로 돌아가 다시 기준으로 삼는다. */
  const restoreVersion = (v: DesignVersion) => {
    if (!window.confirm(`${v.name}(${fmt(v.kWp, 1)} kWp)을 기준 설계로 되돌릴까요?\n지금 배치는 타임라인에 남습니다.`)) return
    mark(`확정본 불러오기 · ${v.name}`)
    setParams({ ...v.params })
    setLayoutBasis(null)
    setSets([...v.sets])
    setObstacles([...v.obstacles])
    setElec({ ...v.elec })
    setSelected(new Set())
    lockRef.current = v.id
    setConfirmedId(v.id)
  }

  // ── 단계에 들어올 때의 상태. "들어올 때로"를 누르면 이 값으로 돌아간다. ──
  type Entry = Pick<ProjectData, 'params' | 'sets' | 'obstacles'> & {
    parcel: Parcel | null
    elec: ElecParams
    costs: CostParams
    econ: EconSettings
    versions: DesignVersion[]
    confirmedId: string | null
    permits: PermitProgress
  }
  const entryState = (): Entry => ({ parcel, params, sets, obstacles, elec, costs, econ, versions, confirmedId, permits })
  const [entry, setEntry] = useState<Entry>(entryState)
  const entryChanged = (Object.keys(entry) as Array<keyof Entry>).some((k) => entry[k] !== entryState()[k])
  const restoreEntry = () => {
    if (!window.confirm(`${STAGES.find((x) => x.key === stage)!.label} 단계에 들어올 때로 되돌릴까요?\n지금 상태는 타임라인에 남습니다.`)) return
    const e = entry
    if (e.parcel !== parcel) {
      resetParcel(e.parcel)
      if (e.parcel) {
        const [lon, lat] = interiorPoint(e.parcel.rings)
        setFlyTo({ lon, lat, seq: Date.now() })
      }
    }
    mark('들어올 때로')
    setParams(e.params)
    setLayoutBasis(null)
    setSets(e.sets)
    setObstacles(e.obstacles)
    setElec(e.elec)
    setCosts(e.costs)
    setEcon(e.econ)
    setVersions(e.versions)
    lockRef.current = e.confirmedId
    setConfirmedId(e.confirmedId)
    setPermits(e.permits)
    setSelected(new Set())
  }
  const goStage = (k: Stage) => {
    const st = STAGES.find((x) => x.key === k)!
    switchTab(lastTab[k] ?? st.tabs[0])
    setMapFocus(false)
  }
  const stageIndex = STAGES.findIndex((x) => x.key === stage)

  const exportProject = () => {
    const data = projectData()
    if (!data) return
    download(`${fileBase()}-project.json`, projectToFile(project?.name ?? parcel!.address, data), 'application/json')
  }

  const today = () => new Date().toISOString().slice(0, 10)
  // 파일 이름은 영문으로 둔다(일부 브라우저가 한글 다운로드 이름을 'download'로 바꾼다).
  const fileBase = () => `solar-${parcel?.pnu ?? 'site'}-${today()}`
  const compareRows = (): CompareRow[] => {
    const row = (name: string, p: LayoutParams, m: DesignResult['metrics']): CompareRow => ({
      name,
      m,
      tilt: p.tilt,
      azimuth: p.azimuth,
      rowSpacing: p.rowSpacing,
      pitch: setGeometry(p).depth + p.rowSpacing,
      racking: RACKING[p.racking].label,
    })
    return [
      ...(design ? [row('현재 배치', params, design.metrics)] : []),
      ...scenarios.map((sc) => row(sc.name, sc.params, sc.metrics)),
      ...(optResults ?? []).map((c) => row(`AI ${STRATEGIES[c.strategy].label}`, c.params, c.metrics)),
    ]
  }
  const noDesign = !parcel ? '필지를 먼저 고르세요.' : !sets.length ? '배치를 먼저 하세요.' : !design ? '계산 중입니다.' : undefined
  const noElec = noDesign ?? (!design?.elec ? '전기 설계를 할 수 없는 조건입니다.' : undefined)
  const sldDrawing = () =>
    buildSld(design!.elec!, elec, { title: parcel?.address ?? '', moduleWatt: params.moduleWatt, date: today() })
  const exportGroups: Array<{ title: string; note?: React.ReactNode; items: ExportItem[] }> = [
    {
      title: '도면 (DXF)',
      note: parcel
        ? `좌표는 EPSG:${parcelZone(parcel).epsg}(GRS80 ${parcelZone(parcel).name}) 평면좌표(m)라 연속지적도·측량도면과 바로 겹칩니다. 레이어: 부지경계, 등고선, 경사·배수 제외 구역, 물길, 어레이, 모듈, 인버터, AC 케이블, 수배전반.`
        : undefined,
      items: [
        {
          key: 'layout-dxf',
          label: '배치도 DXF',
          detail: '필지 경계, 모듈·어레이, 전기, 지형(불러왔으면) 레이어',
          disabled: !parcel ? '필지를 먼저 고르세요.' : !sets.length ? '배치를 먼저 하세요.' : undefined,
          run: () => {
            const { text } = layoutDxf({
              parcel: parcel!,
              sets,
              params,
              geometry,
              obstacles,
              elec: design?.elec ?? null,
              buildable,
              grid: elevGrid,
              kWp: stats.kWp,
              date: today(),
            })
            download(`${fileBase()}-layout.dxf`, text, 'application/dxf')
          },
        },
        {
          key: 'sld-dxf',
          label: '단선결선도 DXF',
          detail: 'PV 스트링 → 인버터 → 집합반 → (변압기) → 한전 계통',
          disabled: noElec,
          run: () => download(`${fileBase()}-sld.dxf`, sldToDxf(sldDrawing()), 'application/dxf'),
        },
        {
          key: 'sld-svg',
          label: '단선결선도 SVG',
          detail: '브라우저·문서에 바로 넣는 그림 파일',
          disabled: noElec,
          run: () => download(`${fileBase()}-sld.svg`, sldToSvg(sldDrawing()), 'image/svg+xml'),
        },
      ],
    },
    {
      title: '표 (CSV)',
      note: '엑셀에서 바로 열립니다(UTF-8).',
      items: [
        {
          key: 'arrays',
          label: '어레이 목록',
          detail: '어레이별 좌표(TM·경위도), 모듈 수, 인버터, 지반고·경사, 절성토',
          disabled: noDesign,
          run: () =>
            download(`${fileBase()}-arrays.csv`, arraysCsv(parcel!, sets, geometry, params.moduleWatt, design!.elec, design!.earth), 'text/csv'),
        },
        {
          key: 'strings',
          label: '스트링 결선표',
          detail: '스트링별 인버터, 지나는 어레이, DC 케이블 길이·손실',
          disabled: noElec,
          run: () => download(`${fileBase()}-strings.csv`, stringsCsv(sets, design!.elec!), 'text/csv'),
        },
        {
          key: 'inverters',
          label: '인버터·AC 케이블',
          detail: '인버터별 용량, 위치, AC 케이블 길이·규격·전압강하',
          disabled: noElec,
          run: () => download(`${fileBase()}-inverters.csv`, invertersCsv(design!.elec!), 'text/csv'),
        },
        {
          key: 'monthly',
          label: '월별 발전량',
          detail: '일사량과 발전량(음영·온도·클리핑·케이블 손실 반영)',
          disabled: noDesign,
          run: () => download(`${fileBase()}-monthly-energy.csv`, monthlyCsv(design!.metrics), 'text/csv'),
        },
        {
          key: 'capex',
          label: '설치비 내역',
          detail: '항목별 물량·단가·금액',
          disabled: noDesign,
          run: () => download(`${fileBase()}-capex.csv`, capexCsv(design!.metrics), 'text/csv'),
        },
        {
          key: 'compare',
          label: '배치안 비교',
          detail: '현재·저장·AI 배치안의 발전량, 토공, CAPEX, LCOE, IRR',
          disabled: compareRows().length ? undefined : '비교할 배치안이 없습니다.',
          run: () => download(`${fileBase()}-layout-comparison.csv`, compareCsv(compareRows()), 'text/csv'),
        },
        {
          key: 'cashflow',
          label: '연도별 현금흐름',
          detail: '경제성 탭 조건의 매출·운영비·원리금·누적 현금흐름',
          disabled: econResult ? undefined : '경제성 탭을 한 번 열면 받을 수 있습니다.',
          run: () => download(`${fileBase()}-cashflow.csv`, cashflowCsv(econResult!), 'text/csv'),
        },
      ],
    },
  ]

  const dxfItem = (key: string) => exportGroups[0].items.find((i) => i.key === key)!

  const stepDone: Partial<Record<Tab, boolean>> = {
    parcel: !!parcel,
    terrain: !!terrain,
    layout: sets.length > 0,
    elec: !!design?.elec,
    energy: !!energy,
    econ: !!econResult,
  }
  // 입지검토: 사람이 고친 토지 정보가 있으면 조회값 대신 쓴다.
  const siteLand = siteCheck.land.landCategory ?? parcel?.landCategory
  const siteZoning = siteCheck.land.zoning !== undefined ? siteCheck.land.zoning.split(/\s*,\s*/).filter(Boolean) : parcelZoning
  const siteArea = siteCheck.land.area ?? area
  const siteParcel = parcel && siteLand !== parcel.landCategory ? { ...parcel, landCategory: siteLand } : parcel
  // 발전소 정보 일람표: 지번별 현장 정보와 설비 요약
  const plantLots = !parcel
    ? []
    : parcel.lots?.length
      ? parcel.lots.map((l) => ({ address: l.address, land: l.landCategory ?? '-', area: l.area, zoning: vworldKey ? zoningText(l.pnu) : '-' }))
      : [{ address: parcel.address, land: siteLand ?? '-', area: siteArea, zoning: siteZoning.join(', ') || (vworldKey ? zoningText(parcelZoningKeys[0]) : '-') }]
  const plantEquipment: Array<[string, string]> = design
    ? [
        ['설비용량', `${fmt(design.metrics.kWp, 2)} kWp (AC ${fmt(design.metrics.kWac, 1)} kW)`],
        ['모듈', `${params.moduleWatt} W × ${fmt(design.metrics.modules)}장`],
        ['인버터', `${fmt(elec.inverterKW)} kW × ${fmt(design.metrics.inverters)}대`],
        ['구조물', `${RACKING[params.racking].label}, 경사 ${params.tilt}°`],
        ['연간 발전량', `${fmt(design.metrics.annualKWh)} kWh`],
        ['연계', design.elec?.connection === 'MV' ? '특고압(22.9 kV)' : '저압'],
      ]
    : [['설비', '배치 전']]
  const terrainSlopeDeg = terrain ? pctToDeg(terrain.meanSlopePct) : null
  const gridNeedKW = design?.elec?.kWac ?? ((confirmed?.kWp ?? stats.kWp) > 0 ? (confirmed?.kWp ?? stats.kWp) / 1.2 : null)
  const siteReviews = {
    land: landReview(siteLand, siteZoning, siteCheck.land.owner, siteCheck.kind),
    terrain: terrainReview(terrainSlopeDeg),
    road: roadReview(siteCheck.road),
    grid: gridReview(siteCheck.grid, gridNeedKW, parcel?.rings ?? null),
    forest: isForest(siteLand) ? forestReview(siteCheck.forest, terrainSlopeDeg) : null,
  }
  const findRoads = async () => {
    if (!parcel || !vworldKey) return
    setRoadBusy(true)
    setRoadError(null)
    try {
      const feats = await getParcelsInBox(searchBox(parcel.rings, 150), vworldKey)
      const list = nearbyRoads(
        parcel.rings,
        parcel.lots?.map((l) => l.pnu) ?? (parcel.pnu ? [parcel.pnu] : []),
        feats.map((f) => {
          const l = lotFromFeature(f)
          return { pnu: l.pnu, jibun: f.properties.jibun, rings: l.rings, area: l.area }
        }),
      )
      setRoadResult({ parcel, list })
    } catch (e) {
      setRoadError((e as Error).message)
    } finally {
      setRoadBusy(false)
    }
  }
  const roads = roadResult && roadResult.parcel === parcel ? roadResult.list : null
  const { picked } = siteCheck.road
  const { pole, poleNo } = siteCheck.grid
  const mapMarks: MapMark[] = useMemo(
    () =>
      tab !== 'review'
        ? NO_MARKS
        : [
            ...(roads ?? []).map((r) => ({ kind: 'road' as const, rings: r.rings, label: r.label, on: picked.includes(r.pnu) })),
            ...(pole ? [{ kind: 'pole' as const, at: pole, label: poleNo || '전주' }] : []),
          ],
    [tab, roads, picked, pole, poleNo],
  )

  const stageDone: Partial<Record<Stage, boolean>> = { site: !!parcel, design: !!confirmed, econ: !!econResult }

  const mapTerrainView = tab === 'terrain' ? terrainView : tab === 'layout' && mask ? 'buildable' : 'none'
  const mapElec = tab === 'elec' || tab === 'export' ? (design?.elec ?? null) : null

  return (
    <>
    <div
      className={mapFocus || ws === 'drawing' ? 'app map-focus' : 'app'}
      style={{ '--left': `${tab === 'ai' ? Math.max(panes.left, 520) : panes.left}px`, '--right': `${panes.right}px` } as React.CSSProperties}
    >
      <header className="topbar">
        <a className="brand" href="#" title="소개 화면으로">
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <rect x="3" y="9" width="18" height="11" rx="1.5" transform="skewX(-12) translate(2 0)" />
            <path d="M8 9v11M13 9v11M3.5 14.5h17" />
            <circle cx="18.5" cy="4.5" r="2.2" />
          </svg>
          <span>솔라 레이아웃</span>
        </a>
        <p className="site" title={parcel?.address}>
          {parcel ? (
            <>
              {project && <em className="site-project">{project.name}</em>}
              <strong>{parcel.address}</strong>
              <span>
                {fmt(area)} ㎡{parcel.landCategory ? ` · ${parcel.landCategory}` : ''}
                {sets.length > 0 && ` · ${fmt(stats.kWp, 1)} kWp`}
              </span>
            </>
          ) : (
            <span>부지를 아직 고르지 않았습니다</span>
          )}
        </p>
        <div className="topbar-actions">
          {notice && (
            <span className="topbar-notice" role="status">
              {notice}
            </span>
          )}
          <button type="button" className="ghost wide-only" onClick={() => setMapFocus((f) => !f)} aria-pressed={mapFocus}>
            {mapFocus ? '패널 펼치기' : '지도 크게'}
          </button>
          <TimelineMenu entries={timeline} currentId={timelineAt} onRestore={restoreTimeline} onClear={() => setTimeline([])} />
          <span className="topbar-sep" />
          <span className={`save-state ${saveState?.status ?? 'none'}`} role="status">
            {!project
              ? '저장 안 됨'
              : saveState?.status === 'saving'
                ? '저장 중…'
                : saveState?.status === 'error'
                  ? '저장 실패'
                  : `저장됨 ${new Date(saveState?.at ?? Date.now()).toTimeString().slice(0, 5)}`}
          </span>
          <button
            type="button"
            className="ghost"
            disabled={!parcel}
            onClick={() => void saveProject()}
            title={project ? `'${project.name}'에 지금 저장(고칠 때마다 저절로 저장됩니다)` : '이 브라우저에 프로젝트로 저장하고, 이후 자동 저장'}
          >
            {project ? '저장' : '프로젝트로 저장'}
          </button>
          <button type="button" className="ghost" onClick={() => setShowProjects(true)}>
            불러오기
          </button>
        </div>
      </header>

      <nav className="rail" aria-label="설계 단계">
        <ol>
          {STAGES.map((st, i) => (
            <li key={st.key}>
              <button
                type="button"
                className={stage === st.key ? 'active' : stageDone[st.key] ? 'done' : ''}
                aria-current={stage === st.key ? 'step' : undefined}
                onClick={() => goStage(st.key)}
              >
                <b>{stageDone[st.key] && stage !== st.key ? '✓' : i + 1}</b>
                <span>{st.label}</span>
                {st.key === 'design' && confirmed && <i className="rail-tag">확정</i>}
              </button>
            </li>
          ))}
        </ol>
        <p className="rail-copy" title="이 화면과 도면은 저작권 보호 대상입니다. 무단 복제·배포를 금합니다.">
          © 솔라 레이아웃
          <br />
          무단 복제 금지
        </p>
      </nav>

      <aside className="panel" aria-labelledby="panel-title" ref={panelRef}>
        <header className="panel-head">
          <p className="eyebrow">{`${String(stageIndex + 1).padStart(2, '0')} 단계`}</p>
          <h1 id="panel-title">{STAGES[stageIndex].label}</h1>
          {STAGES[stageIndex].tabs.length > 1 && (
            <div className="seg design-seg" role="tablist" aria-label={`${STAGES[stageIndex].label} 화면`}>
              {STAGES[stageIndex].tabs.map((t) => (
                <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => switchTab(t)}>
                  {TABS[t].label}
                </button>
              ))}
            </div>
          )}
          <p>{TABS[tab].desc}</p>
        </header>

        {stageIndex >= 2 && parcel && (
          confirmed ? (
            <section className="card basis">
              <p>
                기준 설계 <strong>{confirmed.name}</strong> · {fmt(confirmed.kWp, 1)} kWp · {new Date(confirmed.at).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' })} 확정
              </p>
            </section>
          ) : (
            <section className="card notice">
              <h2>설계를 아직 확정하지 않았습니다</h2>
              <p>지금 배치 값으로 보여 줍니다. 기본설계에서 확정하면 이 단계부터는 확정한 설계가 기준이 됩니다.</p>
              <button type="button" className="secondary" onClick={() => goStage('design')}>
                기본설계로
              </button>
            </section>
          )
        )}

        {tab === 'layout' && (
          <section className="card auto-design">
            <h2>자동 설계</h2>
            <p>지금 설정으로 배치하고, 용량에 맞는 인버터를 골라 스트링 결선과 케이블까지 한 번에 잡습니다. 결과는 아래에서 고치거나 배치 편집에서 손볼 수 있습니다.</p>
            <button type="button" className="block" disabled={!parcel} onClick={runAutoDesign}>
              배치 → 인버터 → 결선 자동 설계
            </button>
            {layoutOutdated && (
              <p className="warn-line">
                배치한 뒤에 설정이 바뀌었습니다. 지금 배치는 이전 설정 그대로입니다.{' '}
                <button type="button" className="link" onClick={runAutoLayout}>
                  다시 배치
                </button>
              </p>
            )}
          </section>
        )}
        {tab === 'layout' && parcel && (
          <CapacityCompare
            rows={capRows}
            current={{ spacing: params.rowSpacing, kWp: stats.kWp }}
            onCompare={compareCapacity}
            onApply={(r) => void placeSets(`${r.label} 설계용량으로 배치`, { ...params, rowSpacing: r.spacing })}
          />
        )}
        {tab === 'layout' && (
          <LayoutPanel
            params={params}
            onParams={updateParams}
            suggestedRowSpacing={suggestedRowSpacing}
            canLayout={!!parcel}
            onAutoLayout={runAutoLayout}
            geometry={geometry}
            onModule={onModule}
            maskActive={!!mask}
            layoutMode={layoutMode}
            onLayoutMode={setLayoutMode}
          />
        )}

        {tab === 'elec' && (
          <ElectricalPanel
            elec={elec}
            onElec={updateElec}
            result={design?.elec ?? null}
            metrics={design?.metrics ?? null}
            busy={designBusy}
            hasSets={sets.length > 0}
          />
        )}

        {tab === 'export' && <ExportPanel groups={exportGroups} busy={designBusy} />}

        {tab === 'permit' &&
          (parcel ? (
            <PermitPanel
              kWp={confirmed?.kWp ?? stats.kWp}
              address={parcel.address}
              landCategory={siteLand}
              area={siteArea}
              zoning={siteZoning}
              progress={permits}
              onProgress={setPermits}
              plant={plant}
              onPlant={setPlant}
              lots={plantLots}
              equipment={plantEquipment}
              onCsv={() =>
                download(
                  `${fileBase()}-plant-info.csv`,
                  toCsv(
                    ['구분', '항목', '값'],
                    [
                      ['발전소', '이름', plant.name],
                      ['사업자', '구분', plant.ownerType === 'corp' ? '법인' : '개인'],
                      ['사업자', plant.ownerType === 'corp' ? '법인명·대표자' : '성명', plant.owner],
                      ['사업자', '사업자번호', plant.bizNo],
                      ['사업자', '연락처', plant.phone],
                      ...plantLots.map((l) => ['현장', l.address, `${l.land} · ${fmt(l.area)} ㎡ · ${l.zoning}`]),
                      ...plantEquipment.map(([k, v]) => ['설비', k, v]),
                    ],
                  ),
                  'text/csv',
                )
              }
            />
          ) : (
            <section className="card">
              <p className="hint">현장정보에서 부지를 먼저 고르세요.</p>
            </section>
          ))}

        {tab === 'order' && (
          <OrderPanel
            metrics={design?.metrics ?? null}
            busy={designBusy}
            lines={design ? orderLines({ params, elecParams: elec, elec: design.elec, metrics: design.metrics, costs }) : []}
            plant={plant}
            address={parcel?.address ?? ''}
            fileBase={fileBase()}
            onCsv={() => exportGroups[1].items.find((i) => i.key === 'capex')!.run()}
          />
        )}

        {tab === 'review' && (
          <SiteReviewPanel
            check={siteCheck}
            onCheck={setSiteCheck}
            fetched={{ landCategory: parcel?.landCategory, zoning: parcelZoning, area }}
            hasParcel={!!parcel}
            canFindRoads={!!vworldKey && parcel?.source === 'vworld'}
            roads={roads}
            roadBusy={roadBusy}
            roadError={roadError}
            onFindRoads={() => void findRoads()}
            needKW={gridNeedKW}
            picking={tool === 'pole'}
            onPickPole={() => setTool(tool === 'pole' ? 'none' : 'pole')}
            forest={isForest(siteLand)}
            terrainSlopeDeg={terrainSlopeDeg}
            onGoTerrain={() => switchTab('terrain')}
            reviews={siteReviews}
          />
        )}

        {tab === 'terrain' && (
          <TerrainPanel
            canRun={!!parcel}
            busy={terrainBusy}
            error={terrainError}
            result={terrain}
            mode={gradingMode}
            onMode={(m) => changeGrading(m, maxDesignSlope)}
            maxSlope={maxDesignSlope}
            onMaxSlope={(v) => changeGrading(gradingMode, v)}
            view={terrainView}
            onView={setTerrainView}
            onRun={() => void runTerrain()}
            buildOptions={buildOptions}
            onBuildOptions={changeBuildOptions}
            buildable={buildable}
            useMask={useMask}
            onUseMask={setUseMask}
            earth={design?.earth ?? null}
            racking={params.racking}
            hasSets={sets.length > 0}
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
            onObstacles={updateObstacles}
            tool={tool}
            onTool={setTool}
            horizon={horizonFresh?.horizon ?? null}
            horizonError={horizonFresh?.error ?? null}
            horizonLoading={!!parcel && !horizonFresh}
            horizonOn={horizonOn}
            onHorizonOn={setHorizonOn}
            terrainBlocked={shadeView?.terrainBlocked ?? false}
            decl={decl}
            sunTimes={sunTimes}
            lat={scene?.frame.lat0 ?? null}
          />
        )}
        {tab === 'shade' && scene && (
          <section className="card">
            <h2>측면도로 보는 그림자</h2>
            <p className="hint">위 시각 막대를 움직이면 앞 열 그림자가 뒷열에 닿는지 단면으로 보여 줍니다.</p>
            <SideElevation
              params={params}
              geometry={geometry}
              lat={scene.frame.lat0}
              sun={shadeView ? { ...shadeView.sun, label: `${shadeDate.month}/${shadeDate.day} ${String(Math.floor(shadeHour)).padStart(2, '0')}:${String(Math.round((shadeHour % 1) * 60)).padStart(2, '0')}` } : null}
            />
          </section>
        )}
        {tab === 'shade' && (
          <ShadeCleanup
            shade={setShadeMap}
            busy={setShadeBusy}
            hasSets={sets.length > 0}
            onMeasure={measureSetShade}
            onSelect={(ids) => setSelected(new Set(ids))}
            onDelete={deleteSets}
          />
        )}

        {tab === 'ai' && (
          <OptimizePanel
            canRun={!!parcel}
            running={!!optRun}
            results={optResults}
            error={optError}
            onRun={() => void runOptimize()}
            onCancel={cancelOptimize}
            onApply={applyCandidate}
            current={design?.metrics ?? null}
            currentBusy={designBusy}
            scenarios={scenarios}
            onSaveCurrent={saveScenario}
            onRemoveScenario={(id) => setScenarios((prev) => prev.filter((x) => x.id !== id))}
            maskActive={!!mask}
            hasGrid={!!elevGrid}
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
            tempOn={tempOn}
            onTempOn={setTempOn}
            tempCoeff={tempCoeff}
            onTempCoeff={setTempCoeff}
            stationId={stationId}
            onStationId={setStationId}
            autoStationName={autoStation?.name ?? null}
            onRun={runEnergy}
            canRun={sets.length > 0}
          />
        )}

        {tab === 'econ' && (
          <EconomicsPanel
            kWp={capexMode === 'design' && design ? design.metrics.kWp : stats.kWp}
            energyKWh={energy ? energy.specificYield * stats.kWp : null}
            landCategory={siteLand}
            settings={econ}
            onSettings={setEcon}
            hours={econHours}
            onHours={setEconHours}
            onGoEnergy={() => switchTab('energy')}
            capexMode={capexMode}
            onCapexMode={setCapexMode}
            designCapex={design?.metrics.capex ?? null}
            designKWh={design?.metrics.annualKWh ?? null}
            costs={costs}
            onCosts={setCosts}
            racking={params.racking}
            onResult={setEconResult}
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
              <dt>위치</dt>
              <dd className="mono">
                {(() => {
                  const [lon, lat] = interiorPoint(parcel.rings)
                  return `위도 ${lat.toFixed(4)} · 경도 ${lon.toFixed(4)}`
                })()}
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
              <button type="button" onClick={() => switchTab('review')}>
                입지검토
              </button>
              <button type="button" className="secondary" onClick={() => switchTab('ai')}>
                {lots && lots.length > 1 ? '이 부지로 가설계' : '이 필지로 가설계'}
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

        {stage === 'design' && (
          <section className="card confirm">
            <h2>설계 확정</h2>
            {confirmed ? (
              <>
                <p>
                  <strong>{confirmed.name}</strong>을 확정했습니다. 도면·인허가·경제성·발주는 이 설계를 기준으로 합니다. 고치려면 설계 변경을 누르세요.
                </p>
                <button type="button" className="secondary block" onClick={() => unlock()}>
                  설계 변경
                </button>
              </>
            ) : (
              <>
                {design && sets.length > 0 ? (
                  <dl className="facts wide">
                    <dt>설비용량</dt>
                    <dd>
                      {fmt(design.metrics.kWp, 1)} kWp · 모듈 {fmt(design.metrics.modules)}장
                    </dd>
                    <dt>인버터</dt>
                    <dd>
                      {fmt(design.metrics.inverters)}대 · {fmt(design.metrics.kWac, 1)} kW
                    </dd>
                    <dt>연간 발전량</dt>
                    <dd>
                      {fmt(design.metrics.annualKWh / 1000, 1)} MWh · 하루 {fmt(design.metrics.specificYield / 365, 2)}시간
                    </dd>
                    <dt>손실</dt>
                    <dd>
                      음영 {fmt(design.metrics.shadeLoss * 100, 1)}% · 클리핑 {fmt(design.metrics.clipLoss * 100, 1)}% · 케이블{' '}
                      {fmt(design.metrics.cableLoss * 100, 1)}%
                    </dd>
                    {suggestedRowSpacing !== null && (
                      <>
                        <dt>열 이격</dt>
                        <dd>
                          {fmt(params.rowSpacing, 2)} m{' '}
                          {params.rowSpacing + 0.005 >= suggestedRowSpacing ? (
                            <span className="rv-badge ok">동지 무음영</span>
                          ) : (
                            <span className="rv-badge warn">{`동지 기준 ${fmt(suggestedRowSpacing, 2)} m보다 좁음`}</span>
                          )}
                        </dd>
                      </>
                    )}
                    {design.metrics.unusedModules > 0 && (
                      <>
                        <dt>결선</dt>
                        <dd>
                          <span className="rv-badge warn">{`스트링에 못 묶인 모듈 ${fmt(design.metrics.unusedModules)}장`}</span>
                        </dd>
                      </>
                    )}
                  </dl>
                ) : (
                  <p className="hint">{!sets.length ? '배치를 먼저 하세요.' : '설계를 계산하는 중입니다.'}</p>
                )}
                <button type="button" className="block" disabled={!design || designBusy || !sets.length} onClick={confirmDesign}>
                  이 설계로 확정
                </button>
                <p className="hint">확정하면 그 시점의 배치·전기 설계가 저장되고, 뒤 단계의 기준이 됩니다.</p>
              </>
            )}
            {versions.length > 0 && (
              <details style={{ marginTop: 10 }}>
                <summary>확정 이력 ({versions.length})</summary>
                <ul className="versions">
                  {[...versions].reverse().map((v) => (
                    <li key={v.id}>
                      <span>
                        {v.name} {v.id === confirmedId && <span className="rv-badge ok">기준</span>}
                        <small>
                          {new Date(v.at).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' })} · {fmt(v.kWp, 1)} kWp
                          {v.annualKWh !== null && ` · ${fmt(v.annualKWh / 1000, 1)} MWh`}
                        </small>
                      </span>
                      {v.id !== confirmedId && (
                        <button type="button" className="secondary" onClick={() => restoreVersion(v)}>
                          되돌리기
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </section>
        )}

        <footer className="stage-foot">
          <button type="button" className="ghost" disabled={stageIndex === 0} onClick={() => goStage(STAGES[stageIndex - 1].key)}>
            ← {stageIndex > 0 ? STAGES[stageIndex - 1].label : '이전'}
          </button>
          <button type="button" className="ghost" disabled={!entryChanged} onClick={restoreEntry} title="이 단계에 들어올 때의 상태로 되돌립니다">
            들어올 때로
          </button>
          <button
            type="button"
            disabled={stageIndex === STAGES.length - 1}
            onClick={() => goStage(STAGES[stageIndex + 1].key)}
          >
            {stageIndex < STAGES.length - 1 ? STAGES[stageIndex + 1].label : '다음'} →
          </button>
        </footer>
      </aside>

      <Resizer
        label="왼쪽 패널 폭"
        area="lr"
        onStart={() => (paneStart.current = panes)}
        onResize={(dx) => setPanes((p) => ({ ...p, left: clampPane('left', paneStart.current.left + dx) }))}
        onReset={() => setPanes((p) => ({ ...p, left: DEFAULT_PANES.left }))}
      />

      <main className="map-wrap">
        <div className="work-tabs" role="tablist" aria-label="작업 화면">
          {stage === 'drawing'
            ? STAGES[stageIndex].tabs.map((t) => (
                <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => switchTab(t)}>
                  {TABS[t].label}
                </button>
              ))
            : WORKSPACES[stage].map(([w, label]) => (
                <button key={w} type="button" role="tab" aria-selected={ws === w} onClick={() => switchWorkspace(w)}>
                  {label}
                </button>
              ))}
          <button type="button" role="tab" aria-selected={false} className="work-tab-report" disabled={!parcel} onClick={() => setShowReport(true)} title={parcel ? '인쇄용 보고서 열기' : '필지를 먼저 고르세요'}>
            보고서
          </button>
        </div>
        <div className="map-stage">
        {tab === 'layout' && parcel && (
          <DesignBar params={params} onParams={updateParams} noShadeSpacing={suggestedRowSpacing} canPlace={!!parcel} onPlace={runAutoLayout} kWp={stats.kWp} />
        )}
        {show3d ? (
          <Suspense fallback={<div className="map map-loading">3D 지도를 불러오는 중…</div>}>
            <Map3D
              vworldKey={vworldKey}
              baseMap={baseMap}
              showCadastral={showCadastral}
              showZoning={showZoning}
              parcel={parcel}
              flyTo={flyTo}
              tool={tool}
              sets={sets}
              params={params}
              geometry={geometry}
              selected={selected}
              onMapClick={onMapClick}
              onSelect={onSelect}
              onAddSet={onAddSet}
              obstacles={obstacles}
              shadows={shadeView?.shadows ?? NO_SHADOWS}
              setShade={shadeView?.perSet ?? null}
              panelShade={shadeView?.panel ?? null}
              terrainCells={terrain?.cells ?? null}
              terrainView={mapTerrainView}
              buildable={buildable}
              elec={mapElec}
              exaggeration={exaggeration}
              camera={camera}
            />
          </Suspense>
        ) : (
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
            terrainCells={terrain?.cells ?? null}
            terrainView={mapTerrainView}
            buildable={buildable}
            elec={mapElec}
            marks={mapMarks}
          />
        )}
        <div className="map-mode" role="group" aria-label="지도 보기">
          <button type="button" className={show3d ? '' : 'on'} aria-pressed={!show3d} onClick={() => setMapMode('2d')}>
            2D
          </button>
          <button
            type="button"
            className={show3d ? 'on' : ''}
            aria-pressed={show3d}
            onClick={() => {
              setMapMode('3d')
              if (TOOLS_2D.has(tool)) setTool('none')
            }}
          >
            3D
          </button>
          {show3d && (
            <>
              <span className="map-mode-sep" />
              <button type="button" onClick={() => turnCamera('top')} title="위에서 내려다보기">
                위
              </button>
              <button type="button" onClick={() => turnCamera('front')} title="남쪽에서 모듈 정면 보기">
                정면
              </button>
              <button type="button" onClick={() => turnCamera('side')} title="동쪽에서 경사 단면 보기">
                측면
              </button>
            </>
          )}
          {show3d && (
            <select aria-label="지형 높이 과장" value={exaggeration} onChange={(e) => setExaggeration(Number(e.target.value))}>
              <option value={1}>높이 1×</option>
              <option value={2}>높이 2×</option>
              <option value={3}>높이 3×</option>
            </select>
          )}
          {mapMode === '3d' && !show3d && <span>그리기 중에는 2D</span>}
        </div>
        {ws === 'edit' && (
          <LayoutEditor
            parcel={parcel}
            sets={sets}
            params={params}
            geometry={geometry}
            stats={stats}
            obstacles={obstacles}
            selected={selected}
            tool={tool}
            onTool={setTool}
            elec={design?.elec ?? null}
            onSelect={onSelect}
            onMoveSets={onMoveSets}
            onAddSet={onAddSet}
            onAutoLayout={runAutoLayout}
            onDeleteSelected={deleteSelected}
            onRotateSelected={rotateSelected}
            onSetAzimuth={setAzimuthSelected}
            onDuplicate={duplicateSelected}
            onClear={clearSets}
            canUndo={history.past.length > 0}
            canRedo={history.future.length > 0}
            onUndo={undo}
            onRedo={redo}
          />
        )}
        {ws === 'drawing' && (
          <DrawingWorkspace
            data={{
              parcel,
              sets,
              params,
              geometry,
              stats,
              obstacles,
              elec: design?.elec ?? null,
              elecParams: elec,
              terrain,
              area,
              date: today(),
              metrics: design?.metrics ?? null,
            }}
            annots={sheetAnnots}
            onAnnots={(id, next) => setSheetAnnots((m) => ({ ...m, [id]: next }))}
            dxf={{ layout: dxfItem('layout-dxf').disabled ?? null, sld: dxfItem('sld-dxf').disabled ?? null }}
            onLayoutDxf={() => dxfItem('layout-dxf').run()}
            onSldDxf={() => dxfItem('sld-dxf').run()}
            fileBase={fileBase()}
          />
        )}
        {optRun && <AiAnalyzing startedAt={optStartedAt} duration={AI_MIN_MS} finished={optFinished} onCancel={cancelOptimize} />}
        </div>
      </main>

      <Resizer
        label="오른쪽 작업면 폭"
        area="rr"
        onStart={() => (paneStart.current = panes)}
        onResize={(dx) => setPanes((p) => ({ ...p, right: clampPane('right', paneStart.current.right - dx) }))}
        onReset={() => setPanes((p) => ({ ...p, right: DEFAULT_PANES.right }))}
      />

      <aside className="side" aria-label="가배치 도면과 편집">
        <SidePanel
          parcel={parcel}
          sets={sets}
          params={params}
          geometry={geometry}
          stats={stats}
          obstacles={obstacles}
          selected={selected}
          tool={tool}
          onTool={setTool}
          elec={design?.elec ?? null}
          elecParams={elec}
          designBusy={designBusy}
          onSelect={onSelect}
          onMoveSets={onMoveSets}
          onAddSet={onAddSet}
          onAutoLayout={runAutoLayout}
          onDeleteSelected={deleteSelected}
          onRotateSelected={rotateSelected}
          onClear={clearSets}
          canUndo={history.past.length > 0}
          canRedo={history.future.length > 0}
          onUndo={undo}
          onRedo={redo}
          hasTimeline={timeline.length > 0}
          area={area}
          zoning={parcelZoning}
          energy={energy}
          econ={econ}
          econHours={econHours}
          steps={OVERVIEW_STEPS.map((t) => ({ key: t, label: TABS[t].label, done: !!stepDone[t] }))}
          onGoStep={(k) => switchTab(k as Tab)}
        />
      </aside>
    </div>
    {showReport && parcel && (
      <ReportView
        parcel={siteParcel ?? parcel}
        area={siteArea}
        zoning={siteZoning}
        siteChecks={{ land: siteReviews.land, road: siteReviews.road.review, grid: siteReviews.grid.review, forest: siteReviews.forest }}
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
        terrain={terrain}
        design={design}
        designCapex={capexMode === 'design' && design ? design.metrics.capex.total : null}
        horizon={horizon}
        onClose={() => setShowReport(false)}
      />
    )}
    {showProjects && (
      <ProjectDialog
        store={projectStore}
        revision={projectRev}
        currentId={project?.id ?? null}
        canExport={!!parcel}
        canSave={!!parcel}
        onSaveAs={() => void saveProject(true)}
        onOpen={(id) => void openProject(id)}
        onImport={(name, data) => applyProject(name, data, null)}
        onExport={exportProject}
        onClose={() => setShowProjects(false)}
      />
    )}
    </>
  )
}

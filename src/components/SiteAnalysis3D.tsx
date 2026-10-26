import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { Parcel } from '../lib/parcel'
import { totalModules, type LayoutParams, type ModuleSet, type SetGeometry } from '../lib/layout'
import type { Obstacle } from '../lib/shading'
import type { ElecResult } from '../lib/electrical'
import type { TerrainResult } from '../lib/terrain'
import { RACKING } from '../lib/catalog'
import { LocalFrame } from '../lib/geo'
import { panelShadeCells, snapshot, type Scene } from '../lib/analysis'
import { dayOfYear, declination, kstToSolar } from '../lib/sun'
import type { CameraView } from './Map3D'
import type { TerrainShader } from '../lib/terrainShadow'
import { useTerrainShade } from '../lib/useTerrainShade'

const Map3D = lazy(() => import('./Map3D'))

interface Props {
  title: string
  subtitle: string
  vworldKey: string
  parcel: Parcel
  sets: ModuleSet[]
  params: LayoutParams
  geometry: SetGeometry
  obstacles: Obstacle[]
  scene: Scene | null
  elec: ElecResult | null
  terrain: TerrainResult | null
  /** 산·언덕 그림자 지도를 그린다. 표고가 없거나 지형 그늘을 끄면 null */
  terrainShader: TerrainShader | null
  area: number
  kWp: number
  onClose: () => void
}

type Layer = 'satellite' | 'cadastral' | 'shadow' | 'obstacles' | 'elec' | 'slope'
const LAYERS: Array<[Layer, string, string]> = [
  ['satellite', '위성영상', '끄면 일반 지도'],
  ['cadastral', '지적도', '필지 경계와 지번(VWorld)'],
  ['shadow', '그림자', '3D 음영에서 고른 날짜·시각의 음영'],
  ['obstacles', '장애물·주변 건물', '음영 탭에서 그린 장애물 높이'],
  ['elec', '전기 설비', '인버터·수배전반과 케이블 길'],
  ['slope', '지형 경사', '지형 분석의 경사 구간 색'],
]

/** 절기 버튼이 쓰는 날짜 */
const SEASONS: Array<[string, number, number]> = [
  ['춘분', 3, 20],
  ['하지', 6, 21],
  ['추분', 9, 23],
  ['동지', 12, 22],
]
const daysIn = (month: number) => [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
const PLAY_START = 6
const PLAY_END = 19

const CAMERAS: Array<[CameraView, string]> = [
  ['top', '평면'],
  ['persp', '입체'],
  ['front', '남쪽'],
  ['fit', '처음 위치'],
]

const NO_SHADOWS: Array<{ ring: number[][]; fromSet: boolean }> = []
const NOOP = () => {}
const fmt = (n: number, d = 0) => n.toLocaleString('ko-KR', { maximumFractionDigits: d, minimumFractionDigits: d })
const deg = (rad: number) => (rad * 180) / Math.PI
const compass = (bearing: number) => ['북', '북동', '동', '남동', '남', '남서', '서', '북서'][Math.round((((bearing % 360) + 360) % 360) / 45) % 8]
const hhmm = (h: number) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`

/** 가설계 결과를 지형·위성 위에 3D로 띄워 현장 정보, 시공 치수, 계절·시각별 그림자를 함께 본다. */
export default function SiteAnalysis3D(p: Props) {
  const [mode, setMode] = useState<'design' | 'site' | 'shade'>('design')
  const [layers, setLayers] = useState<Record<Layer, boolean>>({
    satellite: true,
    cadastral: true,
    shadow: true,
    obstacles: true,
    elec: true,
    slope: false,
  })
  const [date, setDate] = useState({ month: 12, day: 22 })
  const [hour, setHour] = useState(12)
  const [playing, setPlaying] = useState(false)
  const [camera, setCamera] = useState<{ view: CameraView; seq: number; bearing?: number } | null>(null)
  const turn = (view: CameraView, bearing?: number) => setCamera((c) => ({ view, seq: (c?.seq ?? 0) + 1, bearing }))

  // 열면 대화상자로 초점을 옮겨 Esc가 바로 먹게 한다.
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => root.current?.focus(), [])

  // 하루 재생: 15분씩 06시에서 19시까지
  useEffect(() => {
    if (!playing) return
    const id = setInterval(
      () =>
        setHour((h) => {
          if (h >= PLAY_END) {
            setPlaying(false)
            return h
          }
          return h + 0.25
        }),
      220,
    )
    return () => clearInterval(id)
  }, [playing])
  const play = () => {
    if (playing) return setPlaying(false)
    if (hour >= PLAY_END || hour < PLAY_START) setHour(PLAY_START)
    setPlaying(true)
  }
  const step = (dh: number) => {
    setPlaying(false)
    setHour((h) => Math.min(20, Math.max(5, h + dh)))
  }

  const frame = useMemo(() => LocalFrame.around(p.parcel.rings), [p.parcel])
  const showSets = mode !== 'site'
  const sets = showSets ? p.sets : []
  const shadowOn = mode === 'shade' || layers.shadow

  const shade = useMemo(() => {
    if (!p.scene) return null
    const n = dayOfYear(date.month, date.day)
    const snap = snapshot(p.scene, declination(n), kstToSolar(hour, p.scene.frame.lon0, n))
    return { ...snap, panel: showSets && p.sets.length ? panelShadeCells(p.scene, p.sets, p.params, p.geometry, snap.sun) : null }
  }, [p.scene, p.sets, p.params, p.geometry, date, hour, showSets])
  // 산·언덕 그림자: 날짜·시각이 바뀔 때만 다시 그린다.
  const sunAz = shade?.sun.azimuth
  const sunAlt = shade?.sun.altitude
  const terrainShade = useTerrainShade(
    shadowOn ? p.terrainShader : null,
    useMemo(() => (sunAz !== undefined && sunAlt !== undefined ? { azimuth: sunAz, altitude: sunAlt } : null), [sunAz, sunAlt]),
  )
  const shadows = shadowOn && shade ? (showSets ? shade.shadows : shade.shadows.filter((s) => !s.fromSet)) : NO_SHADOWS

  const modules = totalModules(p.sets, p.geometry)
  const bearing = 180 + p.params.azimuth
  const sunUp = !!shade && shade.sun.altitude > 0
  const sunBearing = shade ? (((180 + deg(shade.sun.azimuth)) % 360) + 360) % 360 : 180
  // 산 그늘: 부지 중심이 가리거나 모든 세트가 가리면 전부, 몇 세트만 가리면 일부
  const terrainState: 'lit' | 'part' | 'all' = !shade
    ? 'lit'
    : shade.terrainBlocked && (!shade.perSet.size || shade.terrainSets >= shade.perSet.size)
      ? 'all'
      : shade.terrainSets > 0 || shade.terrainBlocked
        ? 'part'
        : 'lit'
  const toggle = (k: Layer) => setLayers((l) => ({ ...l, [k]: !l[k] }))

  const fact = (label: string, value: ReactNode, cls = '') => (
    <div className={`s3d-fact ${cls}`}>
      <small>{label}</small>
      <strong>{value}</strong>
    </div>
  )
  const modeBtn = (m: typeof mode, label: string) => (
    <button type="button" className={mode === m ? 'on' : ''} aria-pressed={mode === m} onClick={() => setMode(m)}>
      {label}
    </button>
  )

  const cameraCard = (
    <section>
      <h3>카메라 시점</h3>
      <div className="s3d-btns">
        {CAMERAS.map(([v, label]) => (
          <button key={v} type="button" onClick={() => turn(v)}>
            {label}
          </button>
        ))}
      </div>
    </section>
  )

  return createPortal(
    <div
      ref={root}
      className="s3d"
      role="dialog"
      aria-modal="true"
      aria-label="3D 입지 분석"
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === 'Escape') p.onClose()
        // 아래 앱의 배치 편집 단축키(삭제·되돌리기)가 먹지 않게 한다.
        e.stopPropagation()
      }}
    >
      <header className="s3d-head">
        <div className="s3d-title">
          <strong>3D 입지 분석</strong>
          <span>{p.subtitle}</span>
        </div>
        <div className="s3d-modes" role="group" aria-label="보기">
          {modeBtn('design', '설계 보기')}
          {modeBtn('site', '부지만 보기')}
          {modeBtn('shade', '3D 음영')}
        </div>
        <button type="button" className="s3d-close" onClick={p.onClose} aria-label="닫기">
          닫기 ✕
        </button>
      </header>
      <div className="s3d-body">
        <div className="s3d-map">
          <Suspense fallback={<div className="map map-loading">3D 지도를 불러오는 중…</div>}>
            <Map3D
              standalone
              vworldKey={p.vworldKey}
              baseMap={layers.satellite ? 'Satellite' : 'Base'}
              showCadastral={layers.cadastral}
              showZoning={false}
              parcel={p.parcel}
              flyTo={null}
              tool="none"
              sets={sets}
              params={p.params}
              geometry={p.geometry}
              selected={EMPTY_SELECTION}
              obstacles={layers.obstacles ? p.obstacles : []}
              shadows={shadows}
              setShade={shadowOn && showSets ? (shade?.perSet ?? null) : null}
              panelShade={shadowOn ? (shade?.panel ?? null) : null}
              terrainShade={terrainShade}
              sunLight={shadowOn && sunUp ? { bearing: sunBearing, altitude: deg(shade!.sun.altitude) } : null}
              terrainCells={layers.slope ? (p.terrain?.cells ?? null) : null}
              terrainView={layers.slope ? 'slope' : 'none'}
              buildable={null}
              elec={layers.elec && showSets && mode !== 'shade' ? p.elec : null}
              exaggeration={1}
              camera={camera}
              onMapClick={NOOP}
              onSelect={NOOP}
              onAddSet={NOOP}
            />
          </Suspense>
          {shadowOn && shade && (
            <div className="s3d-sun-badge">
              {date.month}월 {date.day}일 {hhmm(hour)} ·{' '}
              {!sunUp ? '해가 진 시각' : `태양 고도 ${fmt(deg(shade.sun.altitude), 1)}°`}
              {sunUp && terrainState !== 'lit' && ` · ${terrainState === 'all' ? '해가 산 뒤에 있음' : '일부가 산 그늘'}`}
              {sunUp && showSets && p.sets.length > 0 && ` · 모듈 그늘 ${fmt(shade.overall * 100, 1)}%`}
            </div>
          )}
        </div>

        <aside className="s3d-side">
          <section>
            <h3>현장 정보</h3>
            <div className="s3d-facts">
              {fact('위도', `${frame.lat0.toFixed(4)}°`)}
              {fact('경도', `${frame.lon0.toFixed(4)}°`)}
              {fact('표고', p.terrain ? `${fmt(p.terrain.minZ)}~${fmt(p.terrain.maxZ)} m` : '지형 분석 전')}
              {fact('면적', `${fmt(p.area)} ㎡`)}
              {fact('모듈', `${fmt(modules)}장`)}
              {fact('설비용량', `${fmt(p.kWp, 1)} kWp`)}
            </div>
            <p className="hint">{p.title}</p>
          </section>

          {mode === 'shade' ? (
            <section>
              <h3>시간별 태양과 그림자</h3>
              <label className="s3d-slider">
                <span>월</span>
                <input type="range" min={1} max={12} step={1} value={date.month} onChange={(e) => setDate({ month: e.target.valueAsNumber, day: Math.min(date.day, daysIn(e.target.valueAsNumber)) })} />
                <strong>{date.month}월</strong>
              </label>
              <label className="s3d-slider">
                <span>일</span>
                <input type="range" min={1} max={daysIn(date.month)} step={1} value={date.day} onChange={(e) => setDate({ ...date, day: e.target.valueAsNumber })} />
                <strong>{date.day}일</strong>
              </label>
              <label className="s3d-slider">
                <span>시각</span>
                <input
                  type="range"
                  min={5}
                  max={20}
                  step={0.25}
                  value={hour}
                  onChange={(e) => {
                    setPlaying(false)
                    setHour(e.target.valueAsNumber)
                  }}
                />
                <strong>{hhmm(hour)}</strong>
              </label>
              <div className="s3d-btns">
                {SEASONS.map(([label, month, day]) => (
                  <button key={label} type="button" className={date.month === month && date.day === day ? 'on' : ''} onClick={() => setDate({ month, day })}>
                    {label}
                  </button>
                ))}
              </div>
              <div className="s3d-btns two">
                <button type="button" className={playing ? 'on' : ''} onClick={play}>
                  {playing ? '■ 재생 멈춤' : '▶ 하루 재생 (06→19시)'}
                </button>
                <button type="button" disabled={!sunUp} onClick={() => turn('persp', sunBearing)}>
                  해 쪽 보기 ({compass(sunBearing)})
                </button>
                <button type="button" onClick={() => step(-0.5)}>
                  ◀ 30분
                </button>
                <button type="button" onClick={() => step(0.5)}>
                  30분 ▶
                </button>
              </div>
              <div className="s3d-facts three">
                {fact('태양 고도', sunUp && shade ? `${fmt(deg(shade.sun.altitude), 1)}°` : '해 진 뒤')}
                {fact('태양 방위', sunUp ? `${fmt(sunBearing)}° ${compass(sunBearing)}` : '-')}
                {fact(
                  '지형 가림',
                  !sunUp ? '-' : terrainState === 'all' ? '가림' : terrainState === 'part' ? `일부 가림 (${fmt(shade!.terrainSets)}세트)` : '직사',
                  sunUp ? (terrainState === 'lit' ? 'ok' : 'bad') : '',
                )}
              </div>
              <p className="hint">
                슬라이더를 움직이면 그 시각의 해 위치로 산·언덕 그림자, 모듈·장애물 그림자, 모듈 위 그늘을 다시 그립니다. 해가 낮은 아침·저녁에
                그림자가 길고, 산 그림자에 든 모듈은 어둡게 칠합니다. 해 쪽 보기는 해가 있는 방향을 낮게 바라봐 무엇이 해를 가리는지 보여 줍니다.
              </p>
            </section>
          ) : (
            <>
              <section>
                <h3>시공 치수</h3>
                {p.sets.length ? (
                  <div className="s3d-facts">
                    {fact('경사각', `${fmt(p.params.tilt)}°`)}
                    {fact('방위각', `${fmt(bearing)}° ${compass(bearing)}`)}
                    {fact('모듈 하단 높이', `${fmt(p.params.groundClearance, 2)} m`)}
                    {fact('모듈 상단 높이', `${fmt(p.geometry.height, 2)} m`)}
                    {fact('모듈 경사 길이', `${fmt(p.geometry.slope, 3)} m`)}
                    {fact('세트 폭', `${fmt(p.geometry.width, 2)} m`)}
                    {fact('열 이격', `${fmt(p.params.rowSpacing, 2)} m`)}
                    {fact('열 피치', `${fmt(p.geometry.depth + p.params.rowSpacing, 2)} m`)}
                  </div>
                ) : (
                  <p className="hint">가설계로 배치하면 치수가 나옵니다.</p>
                )}
                <p className="hint">구조물: {RACKING[p.params.racking].label}</p>
              </section>

              <section>
                <h3>레이어</h3>
                <div className="s3d-layers">
                  {LAYERS.map(([k, label, sub]) => {
                    const off =
                      (k === 'cadastral' || k === 'satellite') && !p.vworldKey ? '인증키가 있어야 합니다' : k === 'slope' && !p.terrain ? '지형 분석 뒤에 켤 수 있습니다' : null
                    return (
                      <label key={k} className={`s3d-layer ${layers[k] && !off ? 'on' : ''}`}>
                        <span>
                          <strong>{label}</strong>
                          <small>{off ?? sub}</small>
                        </span>
                        <input type="checkbox" role="switch" checked={layers[k] && !off} disabled={!!off} onChange={() => toggle(k)} />
                      </label>
                    )
                  })}
                </div>
                <p className="hint">
                  그림자는 {date.month}월 {date.day}일 {hhmm(hour)} 기준입니다. 날짜와 시각은 3D 음영에서 바꿉니다.
                </p>
              </section>
            </>
          )}

          {cameraCard}
        </aside>
      </div>
    </div>,
    document.body,
  )
}

const EMPTY_SELECTION: ReadonlySet<string> = new Set()

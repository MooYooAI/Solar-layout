import { useCallback, useEffect, useMemo, useState } from 'react'
import MapView, { type FlyTarget, type MapTool } from './components/MapView'
import LayoutPanel from './components/LayoutPanel'
import { getParcelAt, searchParcel, type BaseMap, type ParcelSearchItem } from './lib/vworld'
import { parcelArea, parcelFromFeature, SQM_PER_PYEONG, type Parcel } from './lib/parcel'
import {
  autoLayout,
  DEFAULT_PARAMS,
  layoutStats,
  newSetId,
  setGeometry,
  type LayoutParams,
  type ModuleSet,
} from './lib/layout'
import { rowSpacingForNoShade } from './lib/sun'
import { LocalFrame } from './lib/geo'

type Tab = 'parcel' | 'layout'

const KEY_STORAGE = 'vworld-key'

/** 복사할 때 섞여 들어온 공백·따옴표를 걷어낸다. */
const cleanKey = (k: string | null | undefined) => (k ?? '').trim().replace(/^["']|["']$/g, '').trim()

const BUILD_KEY = cleanKey(import.meta.env.VITE_VWORLD_KEY as string | undefined)

// 화면에서 직접 넣은 키가 빌드에 들어간 키보다 우선한다. 시크릿 값이 틀려도 화면에서 바로잡을 수 있다.
function loadKey(): string {
  try {
    const saved = cleanKey(localStorage.getItem(KEY_STORAGE))
    if (saved) return saved
  } catch {
    /* 저장소를 못 쓰는 환경 */
  }
  return BUILD_KEY
}

const maskKey = (k: string) => (k.length > 8 ? `${k.slice(0, 4)}…${k.slice(-4)}` : k ? '****' : '없음')

const fmt = (n: number, digits = 0) => n.toLocaleString('ko-KR', { maximumFractionDigits: digits })

export default function App() {
  const [vworldKey, setVworldKey] = useState(loadKey)
  const [keyDraft, setKeyDraft] = useState('')
  const [baseMap, setBaseMap] = useState<BaseMap>('Satellite')
  const [showCadastral, setShowCadastral] = useState(true)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ParcelSearchItem[]>([])
  const [parcel, setParcelState] = useState<Parcel | null>(null)
  const [flyTo, setFlyTo] = useState<FlyTarget | null>(null)
  const [tab, setTab] = useState<Tab>('parcel')
  const [tool, setTool] = useState<MapTool>('none')
  const [params, setParams] = useState<LayoutParams>(DEFAULT_PARAMS)
  const [sets, setSets] = useState<ModuleSet[]>([])
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const drawing = tool === 'draw'
  // 필지가 바뀌면 이전 배치는 의미가 없다.
  const setParcel = (p: Parcel | null) => {
    setParcelState(p)
    setSets([])
    setSelected(new Set())
  }
  const setDrawing = (on: boolean | ((d: boolean) => boolean)) => {
    const next = typeof on === 'function' ? on(drawing) : on
    setTool(next ? 'draw' : 'none')
  }
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const saveKey = () => {
    const k = cleanKey(keyDraft)
    setKeyDraft(k)
    setVworldKey(k || BUILD_KEY)
    try {
      if (k) localStorage.setItem(KEY_STORAGE, k)
      else localStorage.removeItem(KEY_STORAGE)
    } catch {
      /* 저장 불가 환경이면 이번 세션에서만 사용 */
    }
  }

  const selectParcelAt = useCallback(
    async (lon: number, lat: number) => {
      if (!vworldKey) return
      setBusy(true)
      setMessage(null)
      try {
        const f = await getParcelAt(lon, lat, vworldKey)
        if (f) setParcel(parcelFromFeature(f))
        else setMessage('이 위치에서 필지를 찾지 못했습니다.')
      } catch (e) {
        setMessage((e as Error).message)
      } finally {
        setBusy(false)
      }
    },
    [vworldKey],
  )

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
  }

  const runAutoLayout = () => {
    if (!parcel) return
    if (sets.length && !window.confirm('현재 배치를 지우고 다시 자동 배치할까요?')) return
    setSets(autoLayout(parcel, params))
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
    setSets((prev) => prev.map((s) => (byId.has(s.id) ? { ...s, ...byId.get(s.id)! } : s)))
  }

  const onAddSet = (lon: number, lat: number) => {
    const s: ModuleSet = { id: newSetId(), lon, lat, azimuth: params.azimuth }
    setSets((prev) => [...prev, s])
    setSelected(new Set([s.id]))
  }

  const deleteSelected = useCallback(() => {
    setSets((prev) => prev.filter((s) => !selected.has(s.id)))
    setSelected(new Set())
  }, [selected])

  const rotateSelected = (deg: number) =>
    setSets((prev) => prev.map((s) => (selected.has(s.id) ? { ...s, azimuth: s.azimuth + deg } : s)))

  const clearSets = () => {
    if (!window.confirm('배치한 세트를 모두 지울까요?')) return
    setSets([])
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
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tab, selected, deleteSelected])

  return (
    <div className="app">
      <aside className="panel">
        <header>
          <h1>태양광 배치 설계</h1>
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
              <button type="button" disabled>
                음영
              </button>
            </li>
            <li>
              <button type="button" disabled>
                발전량
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
              에서 무료로 발급받고, 서비스 URL에 이 사이트 주소(개발 중이면 localhost)를 등록하세요. 키 없이도 영역을 직접 그려서 쓸 수 있습니다.
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
          {message && <p className="error">{message}</p>}
          {busy && <p className="hint">불러오는 중…</p>}
        </section>

        {parcel && (
          <section className="card">
            <h2>선택한 필지</h2>
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
            <div className="row" style={{ marginTop: 10 }}>
              <button type="button" onClick={() => switchTab('layout')}>
                이 필지에 배치하기
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
          </div>
        </section>

        <details className="card">
          <summary>VWorld 인증키 설정</summary>
          <div className="row">
            <input value={keyDraft} onChange={(e) => setKeyDraft(e.target.value)} placeholder="인증키 붙여넣기" />
            <button type="button" onClick={saveKey}>
              저장
            </button>
          </div>
          <p className="hint">
            지금 쓰는 키: <span className="mono">{maskKey(vworldKey)}</span>
            {vworldKey && vworldKey === BUILD_KEY ? ' (저장소 시크릿)' : vworldKey ? ' (이 브라우저에 저장)' : ''}. 비워 두고 저장하면 저장소
            시크릿 키로 돌아갑니다.
          </p>
        </details>
        </>
        )}
      </aside>

      <main className="map-wrap">
        <MapView
          vworldKey={vworldKey}
          baseMap={baseMap}
          showCadastral={showCadastral}
          parcel={parcel}
          flyTo={flyTo}
          tool={tool}
          sets={sets}
          params={params}
          geometry={geometry}
          selected={selected}
          onMapClick={selectParcelAt}
          onDrawEnd={onDrawEnd}
          onSelect={onSelect}
          onMoveSets={onMoveSets}
          onAddSet={onAddSet}
        />
      </main>
    </div>
  )
}

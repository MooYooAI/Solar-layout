import { useCallback, useState } from 'react'
import MapView, { type FlyTarget } from './components/MapView'
import { getParcelAt, searchParcel, type BaseMap, type ParcelSearchItem } from './lib/vworld'
import { parcelArea, parcelFromFeature, SQM_PER_PYEONG, type Parcel } from './lib/parcel'

const KEY_STORAGE = 'vworld-key'

function loadKey(): string {
  const env = import.meta.env.VITE_VWORLD_KEY as string | undefined
  if (env) return env
  try {
    return localStorage.getItem(KEY_STORAGE) ?? ''
  } catch {
    return ''
  }
}

const fmt = (n: number, digits = 0) => n.toLocaleString('ko-KR', { maximumFractionDigits: digits })

export default function App() {
  const [vworldKey, setVworldKey] = useState(loadKey)
  const [keyDraft, setKeyDraft] = useState(vworldKey)
  const [baseMap, setBaseMap] = useState<BaseMap>('Satellite')
  const [showCadastral, setShowCadastral] = useState(true)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ParcelSearchItem[]>([])
  const [parcel, setParcel] = useState<Parcel | null>(null)
  const [flyTo, setFlyTo] = useState<FlyTarget | null>(null)
  const [drawing, setDrawing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const saveKey = () => {
    const k = keyDraft.trim()
    setVworldKey(k)
    try {
      localStorage.setItem(KEY_STORAGE, k)
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
    setDrawing(false)
    setParcel({ address: '직접 그린 영역', rings: [ring], source: 'manual' })
  }

  const area = parcel ? parcelArea(parcel) : 0

  return (
    <div className="app">
      <aside className="panel">
        <header>
          <h1>태양광 배치 설계</h1>
          <ol className="steps">
            <li className="active">필지</li>
            <li>배치</li>
            <li>음영</li>
            <li>발전량</li>
          </ol>
        </header>

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
            <button type="button" className="secondary" onClick={() => setParcel(null)}>
              선택 해제
            </button>
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
            <input value={keyDraft} onChange={(e) => setKeyDraft(e.target.value)} placeholder="인증키" />
            <button type="button" onClick={saveKey}>
              저장
            </button>
          </div>
        </details>
      </aside>

      <main className="map-wrap">
        <MapView
          vworldKey={vworldKey}
          baseMap={baseMap}
          showCadastral={showCadastral}
          parcel={parcel}
          flyTo={flyTo}
          drawing={drawing}
          onMapClick={selectParcelAt}
          onDrawEnd={onDrawEnd}
        />
      </main>
    </div>
  )
}

// VWorld (국토교통부 공간정보 오픈플랫폼) client.
// VWorld APIs don't send CORS headers, so search/data calls go through JSONP.

const API = 'https://api.vworld.kr/req'

// 인증키 발급 때 등록한 서비스 URL과 같아야 한다 (예: https://mooyooai.github.io).
const DOMAIN = window.location.origin

let jsonpSeq = 0

function jsonp<T>(url: string, params: Record<string, string>, timeoutMs = 10000): Promise<T> {
  return new Promise((resolve, reject) => {
    const cb = `__vw_cb_${Date.now()}_${jsonpSeq++}`
    const qs = new URLSearchParams({ ...params, callback: cb })
    const script = document.createElement('script')
    const w = window as unknown as Record<string, unknown>
    const cleanup = () => {
      clearTimeout(timer)
      delete w[cb]
      script.remove()
    }
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('VWorld 응답 시간이 초과되었습니다.'))
    }, timeoutMs)
    w[cb] = (data: T) => {
      cleanup()
      resolve(data)
    }
    script.onerror = () => {
      cleanup()
      reject(new Error('VWorld 요청에 실패했습니다. 인증키와 등록 도메인을 확인하세요.'))
    }
    script.src = `${url}?${qs}`
    document.head.appendChild(script)
  })
}

export interface ParcelSearchItem {
  id: string
  address: string
  roadAddress?: string
  lon: number
  lat: number
}

interface SearchResponse {
  response: {
    status: 'OK' | 'NOT_FOUND' | 'ERROR'
    error?: { text: string }
    result?: {
      items: Array<{
        id: string
        address: { parcel?: string; road?: string }
        point: { x: string; y: string }
      }>
    }
  }
}

/** 지번 주소 검색 (예: "서울특별시 중구 태평로1가 31"). */
export async function searchParcel(query: string, key: string): Promise<ParcelSearchItem[]> {
  const data = await jsonp<SearchResponse>(`${API}/search`, {
    service: 'search',
    request: 'search',
    version: '2.0',
    crs: 'EPSG:4326',
    size: '10',
    page: '1',
    query,
    type: 'address',
    category: 'parcel',
    format: 'json',
    errorformat: 'json',
    domain: DOMAIN,
    key,
  })
  const { status, error, result } = data.response
  if (status === 'NOT_FOUND') return []
  if (status !== 'OK') throw new Error(error?.text ?? '주소 검색에 실패했습니다.')
  return (result?.items ?? []).map((it) => ({
    id: it.id,
    address: it.address.parcel ?? '',
    roadAddress: it.address.road || undefined,
    lon: Number(it.point.x),
    lat: Number(it.point.y),
  }))
}

export interface ParcelFeature {
  type: 'Feature'
  geometry: { type: 'MultiPolygon' | 'Polygon'; coordinates: number[][][] | number[][][][] }
  properties: {
    pnu: string
    addr: string
    jibun: string
    bonbun: string
    bubun: string
    gosi_year?: string
    gosi_month?: string
    jiga?: string
  }
}

interface DataResponse {
  response: {
    status: 'OK' | 'NOT_FOUND' | 'ERROR'
    error?: { text: string }
    result?: { featureCollection: { features: ParcelFeature[] } }
  }
}

/** 좌표(경위도)가 포함된 연속지적도 필지 한 개를 가져온다. */
export function getParcelAt(lon: number, lat: number, key: string): Promise<ParcelFeature | null> {
  return getParcel({ geomFilter: `POINT(${lon} ${lat})` }, key)
}

/** PNU(19자리)로 연속지적도 필지 한 개를 가져온다. */
export function getParcelByPnu(pnu: string, key: string): Promise<ParcelFeature | null> {
  return getParcel({ attrFilter: `pnu:=:${pnu}` }, key)
}

const isPnu = (s: string) => /^\d{19}$/.test(s)

/**
 * 검색 결과의 필지. 검색 API의 대표점은 필지 밖(도로·이웃 필지, 건물 출입구 등)에 찍히는 경우가 있어
 * 점으로 찾으면 다른 필지가 잡힌다. 결과 id가 PNU면 PNU로 정확히 찾고, 아닐 때만 대표점으로 찾는다.
 */
export async function getParcelForResult(it: ParcelSearchItem, key: string): Promise<ParcelFeature | null> {
  if (isPnu(it.id)) {
    const f = await getParcelByPnu(it.id, key).catch(() => null)
    if (f) return f
  }
  return getParcelAt(it.lon, it.lat, key)
}

async function getParcel(filter: { geomFilter: string } | { attrFilter: string }, key: string): Promise<ParcelFeature | null> {
  const data = await jsonp<DataResponse>(`${API}/data`, {
    service: 'data',
    request: 'GetFeature',
    version: '2.0',
    data: 'LP_PA_CBND_BUBUN',
    ...filter,
    crs: 'EPSG:4326',
    geometry: 'true',
    attribute: 'true',
    size: '1',
    format: 'json',
    errorformat: 'json',
    domain: DOMAIN,
    key,
  })
  const { status, error, result } = data.response
  if (status === 'NOT_FOUND') return null
  if (status !== 'OK') throw new Error(error?.text ?? '필지 정보를 가져오지 못했습니다.')
  return result?.featureCollection.features[0] ?? null
}

/** 경위도 사각형 안의 연속지적도 필지들(최대 size개). 주변 도로·구거를 찾는 데 쓴다. */
export async function getParcelsInBox(box: [number, number, number, number], key: string, size = 200): Promise<ParcelFeature[]> {
  const data = await jsonp<DataResponse>(`${API}/data`, {
    service: 'data',
    request: 'GetFeature',
    version: '2.0',
    data: 'LP_PA_CBND_BUBUN',
    geomFilter: `BOX(${box.join(',')})`,
    crs: 'EPSG:4326',
    geometry: 'true',
    attribute: 'true',
    size: String(size),
    format: 'json',
    errorformat: 'json',
    domain: DOMAIN,
    key,
  })
  const { status, error, result } = data.response
  if (status === 'NOT_FOUND') return []
  if (status !== 'OK') throw new Error(error?.text ?? '주변 필지를 가져오지 못했습니다.')
  return result?.featureCollection.features ?? []
}

export type BaseMap = 'Base' | 'Satellite'

export function wmtsUrl(key: string, layer: BaseMap | 'Hybrid'): string {
  const ext = layer === 'Satellite' ? 'jpeg' : 'png'
  return `${API}/wmts/1.0.0/${key}/${layer}/{z}/{y}/{x}.${ext}`
}

export const CADASTRAL_WMS = {
  url: `${API}/wms`,
  params: {
    LAYERS: 'lp_pa_cbnd_bubun,lp_pa_cbnd_bonbun',
    STYLES: 'lp_pa_cbnd_bubun_line,lp_pa_cbnd_bonbun_line',
    FORMAT: 'image/png',
    TRANSPARENT: 'true',
  },
}

/** 용도지역 WMS 레이어: 도시(주거·상업·공업·녹지), 관리, 농림, 자연환경보전 */
const ZONING_LAYERS = ['lt_c_uq111', 'lt_c_uq112', 'lt_c_uq113', 'lt_c_uq114']

export const ZONING_WMS = {
  url: `${API}/wms`,
  params: {
    LAYERS: ZONING_LAYERS.join(','),
    STYLES: ZONING_LAYERS.join(','),
    FORMAT: 'image/png',
    TRANSPARENT: 'true',
  },
}

interface ZoningResponse {
  response: {
    status: 'OK' | 'NOT_FOUND' | 'ERROR'
    error?: { text: string }
    result?: { featureCollection: { features: Array<{ properties: Record<string, string> }> } }
  }
}

// 이름은 uname 속성에 있다. 없으면 '…지역'으로 끝나는 값을 쓴다.
const zoneName = (f: { properties: Record<string, string> }) =>
  f.properties.uname || Object.values(f.properties).find((v) => typeof v === 'string' && /지역$/.test(v))

/** 좌표가 속한 용도지역 이름들(예: 계획관리지역). 네 종류 레이어를 함께 찾는다. */
export async function getZoningAt(lon: number, lat: number, key: string): Promise<string[]> {
  const all = await Promise.all(
    ZONING_LAYERS.map((layer) =>
      jsonp<ZoningResponse>(`${API}/data`, {
        service: 'data',
        request: 'GetFeature',
        version: '2.0',
        data: layer.toUpperCase(),
        geomFilter: `POINT(${lon} ${lat})`,
        crs: 'EPSG:4326',
        geometry: 'false',
        attribute: 'true',
        size: '10',
        format: 'json',
        errorformat: 'json',
        domain: DOMAIN,
        key,
      }).then(
        (d) =>
          d.response.status === 'OK'
            ? (d.response.result?.featureCollection.features ?? []).map(zoneName).filter((n): n is string => !!n)
            : [],
        () => [] as string[],
      ),
    ),
  )
  return [...new Set(all.flat())]
}

interface PossessionResponse {
  possessions?: { field?: PossessionField[] | PossessionField; totalCount?: string }
}
interface PossessionField {
  /** 소유구분명(개인, 국유지, 법인 …) */
  posesnSeCodeNm?: string
  /** 공유인수 */
  cnrsPsnCo?: string
}

export interface Possession {
  /** 소유구분 이름들(공유면 여럿일 수 있다) */
  kinds: string[]
  /** 공유인 수. 모르면 0 */
  coOwners: number
}

/** 토지소유정보(국가공간정보센터). 지번 하나의 소유 구분을 찾는다. 자료가 없으면 kinds가 빈 배열이다. */
export async function getPossession(pnu: string, key: string): Promise<Possession> {
  const d = await jsonp<PossessionResponse>('https://api.vworld.kr/ned/data/getPossessionAttr', {
    pnu,
    format: 'json',
    numOfRows: '100',
    pageNo: '1',
    domain: DOMAIN,
    key,
  })
  const f = d.possessions?.field
  const rows = Array.isArray(f) ? f : f ? [f] : []
  return {
    kinds: [...new Set(rows.map((r) => r.posesnSeCodeNm?.trim()).filter((n): n is string => !!n))],
    coOwners: Math.max(0, ...rows.map((r) => Number(r.cnrsPsnCo) || 0)),
  }
}

/** PNU 11번째 자리: 1=일반, 2=산 */
export function describePnu(pnu: string): { legalDong: string; isMountain: boolean } {
  return { legalDong: pnu.slice(0, 10), isMountain: pnu.charAt(10) === '2' }
}

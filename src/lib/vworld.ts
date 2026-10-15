// VWorld (국토교통부 공간정보 오픈플랫폼) client.
// VWorld APIs don't send CORS headers, so search/data calls go through JSONP.

const API = 'https://api.vworld.kr/req'

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
export async function getParcelAt(lon: number, lat: number, key: string): Promise<ParcelFeature | null> {
  const data = await jsonp<DataResponse>(`${API}/data`, {
    service: 'data',
    request: 'GetFeature',
    version: '2.0',
    data: 'LP_PA_CBND_BUBUN',
    geomFilter: `POINT(${lon} ${lat})`,
    crs: 'EPSG:4326',
    geometry: 'true',
    attribute: 'true',
    size: '1',
    format: 'json',
    errorformat: 'json',
    domain: window.location.hostname,
    key,
  })
  const { status, error, result } = data.response
  if (status === 'NOT_FOUND') return null
  if (status !== 'OK') throw new Error(error?.text ?? '필지 정보를 가져오지 못했습니다.')
  return result?.featureCollection.features[0] ?? null
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

/** PNU 11번째 자리: 1=일반, 2=산 */
export function describePnu(pnu: string): { legalDong: string; isMountain: boolean } {
  return { legalDong: pnu.slice(0, 10), isMountain: pnu.charAt(10) === '2' }
}

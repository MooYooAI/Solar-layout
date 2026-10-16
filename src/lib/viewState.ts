// 2D와 3D 지도를 오갈 때 보던 자리를 이어 가려고 지도 상태를 모듈 하나에 둔다.
// zoom은 OpenLayers 기준(256px 타일). MapLibre는 512px 기준이라 1을 뺀다.

import type { Parcel } from './parcel'

export interface SharedView {
  lon: number
  lat: number
  zoom: number
  bearing: number
  pitch: number
}

export const shared: {
  view: SharedView | null
  /** 이미 맞춰 본 필지와 이동 요청. 지도를 바꿔 다시 그릴 때 같은 이동을 되풀이하지 않는다. */
  fitted: Parcel | null
  flySeq: number | undefined
} = { view: null, fitted: null, flySeq: undefined }

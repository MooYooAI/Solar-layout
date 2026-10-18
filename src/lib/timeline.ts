import type { LayoutParams, ModuleSet } from './layout'
import type { Parcel } from './parcel'
import type { Obstacle } from './shading'

/** 작업 타임라인의 한 시점. 이 값만 있으면 그때의 부지·배치로 돌아갈 수 있다. */
export interface TimelineEntry {
  id: string
  time: number
  label: string
  parcel: Parcel
  params: LayoutParams
  sets: ModuleSet[]
  obstacles: Obstacle[]
  kWp: number
}

const KEY = 'solar-timeline'
export const TIMELINE_MAX = 60
/** 같은 종류의 편집이 이 시간(ms) 안에 이어지면 한 줄로 합친다(입력칸 타이핑, 연속 이동). */
export const MERGE_MS = 4000

/** 필지가 같은지(새로 불러온 같은 필지도 같다고 본다) */
export const parcelKey = (p: Parcel) => p.pnu ?? p.lots?.map((l) => l.pnu).join('+') ?? `${p.address}:${JSON.stringify(p.rings[0]?.[0])}`

export function loadTimeline(): TimelineEntry[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(v) ? v.filter((e) => e && e.id && e.parcel && Array.isArray(e.sets)) : []
  } catch {
    return []
  }
}

export function saveTimeline(entries: TimelineEntry[]) {
  // 저장 공간이 모자라면 오래된 것부터 덜어 내며 다시 시도한다.
  for (let list = entries; list.length; list = list.slice(Math.ceil(list.length / 2))) {
    try {
      localStorage.setItem(KEY, JSON.stringify(list))
      return
    } catch {
      /* 용량 초과 또는 저장소를 못 쓰는 환경 */
    }
  }
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* 저장소를 못 쓰는 환경 */
  }
}

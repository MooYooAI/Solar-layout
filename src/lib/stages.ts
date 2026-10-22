// 작업 흐름: 현장정보 → 기본설계(설계 확정) → 도면·인허가·경제성·발주.
// 기본설계에서 확정한 설계가 뒤 단계 전부의 기준이 된다.
import type { LayoutParams, ModuleSet } from './layout'
import type { Obstacle } from './shading'
import type { ElecParams } from './electrical'

/** 왼쪽 패널 화면. 단계 하나에 화면이 여럿일 수 있다. */
export type Tab = 'parcel' | 'terrain' | 'review' | 'ai' | 'layout' | 'elec' | 'shade' | 'energy' | 'sheets' | 'export' | 'permit' | 'econ' | 'order'

export type Stage = 'site' | 'design' | 'drawing' | 'permit' | 'econ' | 'order'

/** label은 짧은 이름(진행 상황 칸 등), step은 단계 안 작업 순서 버튼에 쓰는 이름, note는 그 옆 작은 글씨 */
export const TABS: Record<Tab, { label: string; desc: string; step?: string; note?: string }> = {
  parcel: { label: '부지', step: '부지선정', desc: '지적선택·다각형·사각형·도면(DXF) 중 하나로 부지 영역을 정합니다.' },
  terrain: { label: '지형', step: '지형 자동분석', desc: '필지를 고르면 경사·절성토를 저절로 분석합니다. 설계 가능 영역 기준은 고칠 수 있습니다.' },
  review: { label: '입지검토', desc: '토지 정보를 바로잡고, 진입 도로·계통연계·산지 기준을 확인해 입지를 판정합니다.' },
  ai: { label: '가설계', step: 'AI 가설계', desc: 'AI가 여러 배치안을 비교해 추천합니다. 하나를 골라 기본설계로 넘깁니다.' },
  layout: { label: '배치', desc: '모듈·간격을 정해 자동 배치하고, 배치 편집에서 손봅니다.' },
  elec: { label: '전기', desc: '스트링과 인버터를 묶고 케이블을 잡습니다.' },
  shade: { label: '음영', desc: '날짜·시각별 그림자와 하루 음영 손실을 봅니다.' },
  energy: { label: '발전량', desc: '음영·온도를 반영해 월별·연간 발전량을 냅니다.' },
  sheets: { label: '도면', desc: '확정한 설계로 만든 도면을 보고, 고치고, 인쇄합니다.' },
  export: { label: '내보내기', desc: '도면(DXF)과 표(CSV)를 받습니다.' },
  permit: { label: '인허가', desc: '용량·지목·용도지역으로 필요한 인허가를 고르고 진행 상황을 적습니다.' },
  econ: { label: '경제성', desc: '회수기간·IRR·DSCR을 보고, 판매 방식을 비교하고, 목표 수익률에서 설치비 한계를 거꾸로 구합니다.' },
  order: { label: '발주', desc: '확정한 설계로 업체별 발주목록과 견적 요청서를 만듭니다.' },
}

export const STAGES: Array<{ key: Stage; label: string; tabs: Tab[] }> = [
  { key: 'site', label: '현장정보', tabs: ['parcel', 'terrain', 'review', 'ai'] },
  { key: 'design', label: '기본설계', tabs: ['layout', 'elec', 'shade', 'energy'] },
  { key: 'drawing', label: '도면', tabs: ['sheets', 'export'] },
  { key: 'permit', label: '인허가', tabs: ['permit'] },
  { key: 'econ', label: '경제성', tabs: ['econ'] },
  { key: 'order', label: '발주', tabs: ['order'] },
]

export const stageOf = (t: Tab): Stage => STAGES.find((s) => s.tabs.includes(t))!.key

/** 확정한 설계 한 벌. 설계를 바꿔 다시 확정해도 이전 것은 이력에 남는다. */
export interface DesignVersion {
  id: string
  name: string
  at: number
  params: LayoutParams
  sets: ModuleSet[]
  obstacles: Obstacle[]
  elec: ElecParams
  kWp: number
  annualKWh: number | null
}

export type PermitStatus = 'todo' | 'doing' | 'filed' | 'done'
export const PERMIT_STATUS: Record<PermitStatus, string> = { todo: '대기', doing: '준비 중', filed: '접수', done: '완료' }
/** 인허가 이름별 진행 상황 */
export type PermitProgress = Record<string, { status: PermitStatus; date?: string }>

/** 발전소 정보 일람표에 사람이 적는 칸. 부지·설비 값은 설계에서 채운다. */
export interface PlantInfo {
  name: string
  ownerType: 'person' | 'corp'
  owner: string
  bizNo: string
  phone: string
}
export const EMPTY_PLANT: PlantInfo = { name: '', ownerType: 'person', owner: '', bizNo: '', phone: '' }
